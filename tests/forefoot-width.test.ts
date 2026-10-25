// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { BASE_REFERENCE_THICKNESS_MM, getBaseFootprintFrame } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { forefootWidthLongitudinalEnvelope } from "@/lib/geometry/height-field";
import { countSelfIntersections, reconstructionManifold } from "@/lib/geometry/procedural-wall";
import { reconstructProceduralPreview } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { applyTextMarkingToPrintSolid } from "@/lib/geometry/text-marking/apply";
import { defaultTextMarking } from "@/lib/geometry/text-marking/constants";
import type { PlacedElement, SideCorrections } from "@/types";
import { loadSampleTopGlb } from "./helpers/load-sample-top-glb";

/** Frozen at origin/main M9 compose export (forefootWidthMm=0); full STL MD5 prefixes. */
const M9_BASELINE_STL_MD5_PREFIX: Record<"straight" | "round" | "hybrid", string> = {
    straight: "38dc5fb11432",
    round: "129269d7c0a1",
    hybrid: "4c56a8d00a15",
};

/** Bottom side-shift minus top side-shift, every sampled u. */
const BOTTOM_MINUS_TOP_MM = 0.25;

const CREASE_BASE_MAX_DEG = 8;
const CREASE_JUMP_MIN_DEG = 12;
/** Main hybrid folds sit in this mesh-X band. New hybrid folds outside it fail. */
const HYBRID_CREASE_X0 = 72;
const HYBRID_CREASE_X1 = 77;

type WallStyle = "straight" | "round" | "hybrid";

function neutralCorrections(): SideCorrections {
    return {
        forefootPostingDeg: 0,
        rearfootPostingDeg: 0,
        medialSkiveMm: 0,
        lateralSkiveMm: 0,
        archFillMm: 0,
        archHeightMm: 0,
        archEaseMm: 0,
        heelCupDepthMm: 0,
        heelCupHeightMm: 0,
        heelCupWidthMm: 0,
        forefootWidthMm: 0,
        heelLiftMm: 0,
        apexMoveMm: 0,
        medialFlangeMm: 0,
        lateralFlangeMm: 0,
    };
}

function m9Field(patch: Partial<SideCorrections>): HeightFieldParams {
    const layout = insoleLayoutForUsMenSize(9);
    return {
        side: "right",
        lengthMm: layout.lengthMm,
        widthMm: layout.widthMm,
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        corrections: { ...neutralCorrections(), ...patch },
        elements: [],
        includeSkives: false,
        includeElements: false,
        trimline: null,
    };
}

async function buildM9ExportSolid(forefootWidthMm: number, wallStyle: WallStyle): Promise<BufferGeometry> {
    const top = await loadSampleTopGlb();
    const field = m9Field({ forefootWidthMm });
    const { geometry } = await reconstructProceduralPreview(top, {
        sourceField: field,
        composedTop: true,
        wallStyle,
    });
    top.dispose();
    return geometry;
}

function stlMd5(geo: BufferGeometry): string {
    return createHash("md5")
        .update(Buffer.from(geometryToBinarySTL(geo)))
        .digest("hex");
}

function stlGates(stlPath: string): { watertight: boolean } {
    const helper = resolve(process.cwd(), "tests/helpers/stl-gates.py");
    const out = execFileSync("python3", [helper, "forefoot-width", stlPath], { encoding: "utf8" });
    return JSON.parse(out) as { watertight: boolean };
}

type Frame = {
    lengthAxis: number;
    widthAxis: number;
    thickAxis: number;
    lenMin: number;
    lenSize: number;
    topVertexCount: number;
};

function resolveFrame(geo: BufferGeometry): Frame {
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    const sizes: [number, number][] = [
        [0, box.max.x - box.min.x],
        [1, box.max.y - box.min.y],
        [2, box.max.z - box.min.z],
    ];
    sizes.sort((a, b) => a[1] - b[1]);
    const thickAxis = sizes[0]![0];
    const widthAxis = sizes[1]![0];
    const lengthAxis = sizes[2]![0];
    const min = [box.min.x, box.min.y, box.min.z] as const;
    const lenMin = min[lengthAxis];
    const lenSize = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z][lengthAxis] || 1;
    const topVertexCount =
        (geo.userData as { topVertexCount?: number }).topVertexCount ?? geo.getAttribute("position")!.count;
    return { lengthAxis, widthAxis, thickAxis, lenMin, lenSize, topVertexCount };
}

function sampleExtentsAtU(
    geo: BufferGeometry,
    uTarget: number,
    frame: Frame,
    uBand = 0.008,
    topOnly = true,
): { minW: number; maxW: number } {
    const pos = geo.getAttribute("position")!.array as Float32Array;
    const n = topOnly ? frame.topVertexCount : pos.length / 3;
    let minW = Infinity;
    let maxW = -Infinity;
    for (let i = 0; i < n; i++) {
        const len = pos[i * 3 + frame.lengthAxis]!;
        const u = (len - frame.lenMin) / frame.lenSize;
        if (u < uTarget - uBand || u > uTarget + uBand) continue;
        const w = pos[i * 3 + frame.widthAxis]!;
        minW = Math.min(minW, w);
        maxW = Math.max(maxW, w);
    }
    return { minW, maxW };
}

/** Each side vs the base band's own center, so a one-sided move does not hide in the average. */
function sideShiftMm(
    base: { minW: number; maxW: number },
    mod: { minW: number; maxW: number },
): { medial: number; lateral: number } {
    const center = 0.5 * (base.minW + base.maxW);
    return {
        medial: center - mod.minW - (center - base.minW),
        lateral: mod.maxW - center - (base.maxW - center),
    };
}

function outlineRingAtU(
    geo: BufferGeometry,
    uTarget: number,
    frame: Frame,
    uBand = 0.008,
): { minW: number; maxW: number } | null {
    const ring =
        (geo.userData as { outlineRing?: Array<{ x: number; y: number; z: number }> }).outlineRing ?? [];
    if (ring.length < 8) return null;
    let minW = Infinity;
    let maxW = -Infinity;
    for (const p of ring) {
        const len = frame.lengthAxis === 0 ? p.x : frame.lengthAxis === 1 ? p.y : p.z;
        const wid = frame.widthAxis === 0 ? p.x : frame.widthAxis === 1 ? p.y : p.z;
        const u = (len - frame.lenMin) / frame.lenSize;
        if (u < uTarget - uBand || u > uTarget + uBand) continue;
        minW = Math.min(minW, wid);
        maxW = Math.max(maxW, wid);
    }
    if (!Number.isFinite(minW)) return null;
    return { minW, maxW };
}

function faceNormalOf(pos: Float32Array, idx: ArrayLike<number>, f: number): [number, number, number] {
    const a = idx[f * 3]!;
    const b = idx[f * 3 + 1]!;
    const c = idx[f * 3 + 2]!;
    const abx = pos[b * 3]! - pos[a * 3]!;
    const aby = pos[b * 3 + 1]! - pos[a * 3 + 1]!;
    const abz = pos[b * 3 + 2]! - pos[a * 3 + 2]!;
    const acx = pos[c * 3]! - pos[a * 3]!;
    const acy = pos[c * 3 + 1]! - pos[a * 3 + 1]!;
    const acz = pos[c * 3 + 2]! - pos[a * 3 + 2]!;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
}

function angleDeg(a: [number, number, number], b: [number, number, number]): number {
    const d = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
    return (Math.acos(d) * 180) / Math.PI;
}

type CreaseHit = { x: number };

/** Mesh X of each new top-sheet crease (base dihedral < 8°, jump > 12°). */
function newCreaseXs(geoMod: BufferGeometry, baseArr: Float32Array, frame: Frame): CreaseHit[] {
    const idx = geoMod.index!.array as ArrayLike<number>;
    const modArr = geoMod.getAttribute("position")!.array as Float32Array;
    const { topVertexCount } = frame;
    const groupOf = new Int32Array(topVertexCount).fill(-1);
    const keyToGroup = new Map<string, number>();
    let groupCount = 0;
    for (let i = 0; i < topVertexCount; i++) {
        const key = `${baseArr[i * 3]},${baseArr[i * 3 + 1]},${baseArr[i * 3 + 2]}`;
        let g = keyToGroup.get(key);
        if (g === undefined) {
            g = groupCount++;
            keyToGroup.set(key, g);
        }
        groupOf[i] = g;
    }
    const faceCount = idx.length / 3;
    const edgeToFace = new Map<string, number>();
    const xs: CreaseHit[] = [];
    for (let f = 0; f < faceCount; f++) {
        if (idx[f * 3]! >= topVertexCount) continue;
        for (let e = 0; e < 3; e++) {
            const v0 = idx[f * 3 + e]!;
            const v1 = idx[f * 3 + ((e + 1) % 3)]!;
            if (v0 >= topVertexCount || v1 >= topVertexCount) continue;
            const g0 = groupOf[v0]!;
            const g1 = groupOf[v1]!;
            if (g0 === g1) continue;
            const key = g0 < g1 ? `${g0},${g1}` : `${g1},${g0}`;
            const other = edgeToFace.get(key);
            if (other === undefined) {
                edgeToFace.set(key, f);
                continue;
            }
            const baseDeg = angleDeg(faceNormalOf(baseArr, idx, other), faceNormalOf(baseArr, idx, f));
            const modDeg = angleDeg(faceNormalOf(modArr, idx, other), faceNormalOf(modArr, idx, f));
            if (baseDeg < CREASE_BASE_MAX_DEG && modDeg > baseDeg + CREASE_JUMP_MIN_DEG) {
                xs.push({ x: 0.5 * (baseArr[v0 * 3]! + baseArr[v1 * 3]!) });
            }
        }
    }
    return xs;
}

describe("forefoot width — SAMPLE_Top M9 procedural export", () => {
    test("forefootWidthMm=0 STL matches main baselines (all styles)", async () => {
        for (const style of ["straight", "round", "hybrid"] as const) {
            const geo = await buildM9ExportSolid(0, style);
            const md5 = stlMd5(geo);
            expect(md5.startsWith(M9_BASELINE_STL_MD5_PREFIX[style])).toBe(true);
            geo.dispose();
        }
    });

    const styles = ["straight", "round", "hybrid"] as const;
    const magnitudes = [-10, -5, 5, 10] as const;
    for (const style of styles) {
        test(`${style} ±5/±10 hard gates`, async () => {
            const baseGeo = await buildM9ExportSolid(0, style);
            const baseArr = (baseGeo.getAttribute("position")!.array as Float32Array).slice();
            const frame = resolveFrame(baseGeo);
            baseGeo.computeBoundingBox();
            const baseBox = baseGeo.boundingBox!;
            const rows: Array<Record<string, number | string | boolean>> = [];

            for (const mm of magnitudes) {
                const geo = await buildM9ExportSolid(mm, style);
                const modArr = geo.getAttribute("position")!.array as Float32Array;
                const creaseXs = newCreaseXs(geo, baseArr, frame);
                const envAt = (u: number) => mm * forefootWidthLongitudinalEnvelope(u);
                let perSide = 0;
                let balance = 0;
                let past = 0;
                for (const u of [0.5, 0.55, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95]) {
                    const target = envAt(u);
                    const shift = sideShiftMm(
                        sampleExtentsAtU(baseGeo, u, frame, 0.003),
                        sampleExtentsAtU(geo, u, frame, 0.003),
                    );
                    perSide = Math.max(
                        perSide,
                        Math.abs(shift.medial - target),
                        Math.abs(shift.lateral - target),
                    );
                    expect(Math.abs(shift.medial - target)).toBeLessThanOrEqual(0.3);
                    expect(Math.abs(shift.lateral - target)).toBeLessThanOrEqual(0.3);
                    if (mm < 0 && u >= 0.65 && u <= 0.9) {
                        past = Math.max(past, target - shift.medial, target - shift.lateral);
                        expect(shift.medial).toBeGreaterThanOrEqual(target - 0.02);
                        expect(shift.lateral).toBeGreaterThanOrEqual(target - 0.02);
                    }
                }
                for (let u = 0.05; u <= 0.98; u += 0.05) {
                    const shift = sideShiftMm(
                        sampleExtentsAtU(baseGeo, u, frame, 0.003),
                        sampleExtentsAtU(geo, u, frame, 0.003),
                    );
                    balance = Math.max(balance, Math.abs(shift.medial - shift.lateral));
                    expect(Math.abs(shift.medial - shift.lateral)).toBeLessThanOrEqual(0.3);
                }
                let parity = 0;
                for (let u = 0.05; u <= 0.98; u += 0.05) {
                    const dTop = sideShiftMm(
                        sampleExtentsAtU(baseGeo, u, frame, 0.003),
                        sampleExtentsAtU(geo, u, frame, 0.003),
                    );
                    const b0 = outlineRingAtU(baseGeo, u, frame, 0.003);
                    const b1 = outlineRingAtU(geo, u, frame, 0.003);
                    expect(b0).not.toBeNull();
                    expect(b1).not.toBeNull();
                    const dBot = sideShiftMm(b0!, b1!);
                    parity = Math.max(
                        parity,
                        Math.abs(dTop.medial - dBot.medial),
                        Math.abs(dTop.lateral - dBot.lateral),
                    );
                    expect(Math.abs(dTop.medial - dBot.medial)).toBeLessThanOrEqual(BOTTOM_MINUS_TOP_MM);
                    expect(Math.abs(dTop.lateral - dBot.lateral)).toBeLessThanOrEqual(BOTTOM_MINUS_TOP_MM);
                }
                const heelTop = sideShiftMm(
                    sampleExtentsAtU(baseGeo, 0.2, frame, 0.02),
                    sampleExtentsAtU(geo, 0.2, frame, 0.02),
                );
                const heelBotPair = [
                    outlineRingAtU(baseGeo, 0.2, frame, 0.02),
                    outlineRingAtU(geo, 0.2, frame, 0.02),
                ] as const;
                expect(heelBotPair[0]).not.toBeNull();
                expect(heelBotPair[1]).not.toBeNull();
                const heelBot = sideShiftMm(heelBotPair[0]!, heelBotPair[1]!);
                expect(Math.abs(heelTop.medial)).toBeLessThanOrEqual(0.05);
                expect(Math.abs(heelTop.lateral)).toBeLessThanOrEqual(0.05);
                expect(Math.abs(heelBot.medial)).toBeLessThanOrEqual(0.05);
                expect(Math.abs(heelBot.lateral)).toBeLessThanOrEqual(0.05);

                geo.computeBoundingBox();
                const box = geo.boundingBox!;
                const len0 = baseBox.max.x - baseBox.min.x;
                const len1 = box.max.x - box.min.x;
                const dLen = Math.abs(len1 - len0);
                const dHeelX = Math.abs(box.min.x - baseBox.min.x);
                expect(dLen).toBeLessThanOrEqual(0.02);
                expect(dHeelX).toBeLessThanOrEqual(0.02);

                let heelOutline = 0;
                const nAll = Math.min(modArr.length / 3, baseArr.length / 3);
                for (let i = 0; i < nAll; i++) {
                    const u = (baseArr[i * 3 + frame.lengthAxis]! - frame.lenMin) / frame.lenSize;
                    if (u >= 0.45) continue;
                    const dx = modArr[i * 3]! - baseArr[i * 3]!;
                    const dy = modArr[i * 3 + 1]! - baseArr[i * 3 + 1]!;
                    const dz = modArr[i * 3 + 2]! - baseArr[i * 3 + 2]!;
                    heelOutline = Math.max(heelOutline, Math.hypot(dx, dy, dz));
                }
                const ring0 =
                    (baseGeo.userData as { outlineRing?: Array<{ x: number; y: number; z: number }> })
                        .outlineRing ?? [];
                const ring1 =
                    (geo.userData as { outlineRing?: Array<{ x: number; y: number; z: number }> })
                        .outlineRing ?? [];
                if (ring0.length === ring1.length) {
                    for (let i = 0; i < ring0.length; i++) {
                        const a = ring0[i]!;
                        const b = ring1[i]!;
                        const len = frame.lengthAxis === 0 ? a.x : frame.lengthAxis === 1 ? a.y : a.z;
                        const u = (len - frame.lenMin) / frame.lenSize;
                        if (u >= 0.45) continue;
                        heelOutline = Math.max(
                            heelOutline,
                            Math.hypot(b.x - a.x, b.y - a.y, (b.z ?? 0) - (a.z ?? 0)),
                        );
                    }
                }
                expect(heelOutline).toBeLessThanOrEqual(0.05);

                const creaseOutside =
                    style === "hybrid"
                        ? creaseXs.filter((c) => c.x < HYBRID_CREASE_X0 || c.x > HYBRID_CREASE_X1).length
                        : creaseXs.length;
                expect(creaseOutside).toBe(0);

                const man = reconstructionManifold(geo);
                expect(man.watertight).toBe(true);
                expect(countSelfIntersections(geo).real).toBe(0);
                const dir = mkdtempSync(join(tmpdir(), "forefoot-stl-"));
                const stlPath = join(dir, `${style}-${mm}.stl`);
                writeFileSync(stlPath, Buffer.from(geometryToBinarySTL(geo)));
                const pyTight = stlGates(stlPath).watertight;
                expect(pyTight).toBe(true);

                const row = {
                    style,
                    mm,
                    perSide: Number(perSide.toFixed(3)),
                    balance: Number(balance.toFixed(3)),
                    past: Number(past.toFixed(3)),
                    parity: Number(parity.toFixed(3)),
                    heelTop: Number(Math.max(Math.abs(heelTop.medial), Math.abs(heelTop.lateral)).toFixed(3)),
                    heelBot: Number(Math.max(Math.abs(heelBot.medial), Math.abs(heelBot.lateral)).toFixed(3)),
                    dLen: Number(dLen.toFixed(4)),
                    dHeelX: Number(dHeelX.toFixed(4)),
                    uLt045: Number(heelOutline.toFixed(4)),
                    creases: creaseXs.length,
                    creaseOutside,
                    watertight: man.watertight && pyTight,
                };
                rows.push(row);
                geo.dispose();
            }
            baseGeo.dispose();
            console.log("[FOREFOOT-METRICS]", JSON.stringify(rows));
            expect(rows).toHaveLength(magnitudes.length);
        });
    }

    test("met pad and text crossing the midline stay rigid at ±10", async () => {
        const probe = await loadSampleTopGlb();
        const frame = getBaseFootprintFrame(probe, "right");
        probe.dispose();
        const pad: PlacedElement = {
            id: "mid-pad",
            kind: "met_pad",
            side: "right",
            position: { x: 0.25 * frame.lenSize, y: 0 },
            rotationDeg: 0,
            scale: { x: 1, y: 1 },
            heightMm: 5,
            placementMode: "flow",
        };
        const text = {
            ...defaultTextMarking("bottom"),
            text: "OO",
            surface: "bottom" as const,
            mode: "engrave" as const,
            placementU: 0.62,
            capHeightMm: 6,
            nudgeAlongMm: 0,
            nudgeAcrossMm: 0,
        };
        const buildPad = async (mm: number) => {
            const top = await loadSampleTopGlb();
            const field = m9Field({ forefootWidthMm: mm });
            field.elements = [pad];
            field.includeElements = true;
            const preview = await reconstructProceduralPreview(top, {
                sourceField: field,
                composedTop: true,
                wallStyle: "straight",
                side: "right",
            });
            top.dispose();
            return preview.geometry;
        };
        const buildText = async (mm: number) => {
            const top = await loadSampleTopGlb();
            const preview = await reconstructProceduralPreview(top, {
                sourceField: m9Field({ forefootWidthMm: mm }),
                composedTop: true,
                wallStyle: "straight",
                textMarking: text,
                side: "right",
            });
            top.dispose();
            const marked = await applyTextMarkingToPrintSolid(preview.geometry, text, { side: "right" });
            if (marked !== preview.geometry) preview.geometry.dispose();
            return marked;
        };
        const span = (
            geo: Awaited<ReturnType<typeof buildPad>>,
            u: number,
            halfU: number,
            halfY: number,
            zOk: (z: number) => boolean,
        ) => {
            const pos = geo.getAttribute("position")!.array as Float32Array;
            const fr = getBaseFootprintFrame(geo, "right");
            let minW = Infinity;
            let maxW = -Infinity;
            let sumW = 0;
            let n = 0;
            for (let i = 0; i < pos.length / 3; i++) {
                const len = pos[i * 3 + fr.lengthAxis]!;
                const wid = pos[i * 3 + fr.widthAxis]!;
                const z = pos[i * 3 + fr.thickAxis]!;
                const uu = (len - fr.lenMin) / fr.lenSize;
                if (Math.abs(uu - u) > halfU || Math.abs(wid - fr.widCenter) > halfY) continue;
                if (!zOk(z)) continue;
                minW = Math.min(minW, wid);
                maxW = Math.max(maxW, wid);
                sumW += wid;
                n++;
            }
            return { n, width: maxW - minW, mid: n ? sumW / n : 0 };
        };
        const padBase = await buildPad(0);
        const textBase = await buildText(0);
        const rows: Array<Record<string, number>> = [];
        for (const mm of [10, -10] as const) {
            const padGeo = await buildPad(mm);
            const textGeo = await buildText(mm);
            const pad0 = span(padBase, 0.75, 0.08, 24, (z) => z > 6);
            const pad1 = span(padGeo, 0.75, 0.08, 24, (z) => z > 6);
            const text0 = span(textBase, 0.62, 0.06, 14, (z) => z > 0.12 && z < 1.4);
            const text1 = span(textGeo, 0.62, 0.06, 14, (z) => z > 0.12 && z < 1.4);
            expect(pad0.n).toBeGreaterThan(8);
            expect(pad1.n).toBeGreaterThan(8);
            expect(text0.n).toBeGreaterThan(8);
            expect(text1.n).toBeGreaterThan(8);
            // Centroid is on the centreline, so the rigid offset is 0. A sheared
            // pad would grow by about 2·|fw|.
            expect(Math.abs(pad1.width - pad0.width)).toBeLessThanOrEqual(0.4);
            expect(Math.abs(pad1.mid - pad0.mid)).toBeLessThanOrEqual(0.4);
            expect(Math.abs(text1.width - text0.width)).toBeLessThanOrEqual(0.4);
            expect(Math.abs(text1.mid - text0.mid)).toBeLessThanOrEqual(0.4);
            rows.push({
                mm,
                padN: pad1.n,
                padDWidth: Number((pad1.width - pad0.width).toFixed(3)),
                padDMid: Number((pad1.mid - pad0.mid).toFixed(3)),
                textN: text1.n,
                textDWidth: Number((text1.width - text0.width).toFixed(3)),
                textDMid: Number((text1.mid - text0.mid).toFixed(3)),
            });
            padGeo.dispose();
            textGeo.dispose();
        }
        console.log("[FOREFOOT-MIDLINE]", JSON.stringify(rows));
        padBase.dispose();
        textBase.dispose();
    }, 300_000);
});
