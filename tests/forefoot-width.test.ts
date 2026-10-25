// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { forefootWidthLongitudinalEnvelope } from "@/lib/geometry/height-field";
import { countSelfIntersections, reconstructionManifold } from "@/lib/geometry/procedural-wall";
import { reconstructProceduralPreview } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import type { SideCorrections } from "@/types";
import { loadSampleTopGlb } from "./helpers/load-sample-top-glb";

/** Frozen at origin/main M9 compose export (forefootWidthMm=0); full STL MD5 prefixes. */
const M9_BASELINE_STL_MD5_PREFIX: Record<"straight" | "round" | "hybrid", string> = {
    straight: "38dc5fb11432",
    round: "129269d7c0a1",
    hybrid: "4c56a8d00a15",
};

const CREASE_BASE_MAX_DEG = 8;
const CREASE_JUMP_MIN_DEG = 12;
const HYBRID_CREASE_CAP = 42;

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
    uBand = 0.02,
    topOnly = true,
): { medial: number; lateral: number } {
    const frame = resolveFrame(geo);
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
    const center = 0.5 * (minW + maxW);
    return { medial: center - minW, lateral: maxW - center };
}

function sideShiftMm(
    base: { medial: number; lateral: number },
    mod: { medial: number; lateral: number },
): { medial: number; lateral: number } {
    return { medial: mod.medial - base.medial, lateral: mod.lateral - base.lateral };
}

function outlineRingAtU(
    geo: BufferGeometry,
    uTarget: number,
    uBand = 0.02,
): { medial: number; lateral: number } | null {
    const ring =
        (geo.userData as { outlineRing?: Array<{ x: number; y: number; z: number }> }).outlineRing ?? [];
    if (ring.length < 8) return null;
    const frame = resolveFrame(geo);
    let minW = Infinity;
    let maxW = -Infinity;
    for (const p of ring) {
        const u = (p.x - frame.lenMin) / frame.lenSize;
        if (u < uTarget - uBand || u > uTarget + uBand) continue;
        minW = Math.min(minW, p.y);
        maxW = Math.max(maxW, p.y);
    }
    if (!Number.isFinite(minW)) return null;
    const center = 0.5 * (minW + maxW);
    return { medial: center - minW, lateral: maxW - center };
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

function countNewHardCreases(geoMod: BufferGeometry, baseArr: Float32Array, frame: Frame): number {
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
    let creases = 0;
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
            if (baseDeg < CREASE_BASE_MAX_DEG && modDeg > baseDeg + CREASE_JUMP_MIN_DEG) creases++;
        }
    }
    return creases;
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

    test("±5 and ±10 mm per-side targets, balance, heel idle, top/bottom parity", async () => {
        const style: WallStyle = "straight";
        const baseGeo = await buildM9ExportSolid(0, style);
        const baseArr = (baseGeo.getAttribute("position")!.array as Float32Array).slice();
        const frame = resolveFrame(baseGeo);

        const uStations = [0.65, 0.75, 0.9] as const;
        const magnitudes = [5, 10, -5, -10] as const;

        for (const mm of magnitudes) {
            const geo = await buildM9ExportSolid(mm, style);
            // Signed target: positive mm widens, negative mm narrows by the same envelope.
            const envAt = (u: number) => mm * forefootWidthLongitudinalEnvelope(u);
            for (const u of uStations) {
                const target = envAt(u);
                const bTop = sampleExtentsAtU(baseGeo, u, 0.025, true);
                const mTop = sampleExtentsAtU(geo, u, 0.025, true);
                const shift = sideShiftMm(bTop, mTop);
                expect(Math.abs(shift.medial - target)).toBeLessThan(0.3);
                expect(Math.abs(shift.lateral - target)).toBeLessThan(0.3);
                expect(Math.abs(shift.medial - shift.lateral)).toBeLessThan(0.3);
            }

            const heelTop = sampleExtentsAtU(baseGeo, 0.2, 0.02, true);
            const heelTopM = sampleExtentsAtU(geo, 0.2, 0.02, true);
            expect(Math.abs(heelTopM.medial - heelTop.medial)).toBeLessThan(0.05);
            expect(Math.abs(heelTopM.lateral - heelTop.lateral)).toBeLessThan(0.05);

            const heelBot = outlineRingAtU(baseGeo, 0.2, 0.02);
            const heelBotM = outlineRingAtU(geo, 0.2, 0.02);
            if (heelBot && heelBotM) {
                expect(Math.abs(heelBotM.medial - heelBot.medial)).toBeLessThan(0.05);
                expect(Math.abs(heelBotM.lateral - heelBot.lateral)).toBeLessThan(0.05);
            }

            for (let u = 0.55; u <= 0.98; u += 0.05) {
                const t0 = sampleExtentsAtU(baseGeo, u, 0.015, true);
                const t1 = sampleExtentsAtU(geo, u, 0.015, true);
                const b0 = outlineRingAtU(baseGeo, u, 0.015);
                const b1 = outlineRingAtU(geo, u, 0.015);
                if (!b0 || !b1) continue;
                const dTop = sideShiftMm(t0, t1);
                const dBot = sideShiftMm(b0, b1);
                expect(Math.abs(dTop.medial - dBot.medial)).toBeLessThan(0.3);
                expect(Math.abs(dTop.lateral - dBot.lateral)).toBeLessThan(0.3);
            }

            const creases = countNewHardCreases(geo, baseArr, frame);
            expect(creases).toBe(0);

            const man = reconstructionManifold(geo);
            expect(man.watertight).toBe(true);
            expect(countSelfIntersections(geo).real).toBe(0);

            geo.dispose();
        }
        baseGeo.dispose();
    });

    test("all wall styles ±10 watertight; crease caps", async () => {
        for (const style of ["straight", "round", "hybrid"] as const) {
            for (const mm of [-10, 10] as const) {
                const baseGeo = await buildM9ExportSolid(0, style);
                const baseArr = (baseGeo.getAttribute("position")!.array as Float32Array).slice();
                const frame = resolveFrame(baseGeo);
                const geo = await buildM9ExportSolid(mm, style);
                const creases = countNewHardCreases(geo, baseArr, frame);
                const cap = style === "hybrid" ? HYBRID_CREASE_CAP : 0;
                expect(creases).toBeLessThanOrEqual(cap);

                expect(reconstructionManifold(geo).watertight).toBe(true);
                expect(countSelfIntersections(geo).real).toBe(0);

                const dir = mkdtempSync(join(tmpdir(), "forefoot-stl-"));
                const stlPath = join(dir, `${style}-${mm}.stl`);
                writeFileSync(stlPath, Buffer.from(geometryToBinarySTL(geo)));
                expect(stlGates(stlPath).watertight).toBe(true);

                console.log("[FOREFOOT-WIDTH]", { style, mm, creases });

                geo.dispose();
                baseGeo.dispose();
            }
        }
    });
});
