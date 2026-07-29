// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Synchronized bottom-shell field coupling — SYNC-0 / thickness / rim / ground /
 * crease invariants on tests/fixtures/Default.glb.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import {
    applyBaseModifiers,
    BASE_BOTTOM_DELTA_TOLERANCE_MM,
    PLANTAR_Z_MAX_MM,
} from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { extractOrderedBoundaryLoopWithIndices, submeshByVertexRange } from "@/lib/geometry/mesh-close";
import { deriveNativeShellThicknessDatum } from "@/lib/geometry/native-shell-thickness";
import { extractMergedGeometry, loadGlbFromBuffer } from "@/lib/library/loaders";
import type { SideCorrections } from "@/types";

const FIXTURE = resolve(process.cwd(), "tests/fixtures/Default.glb");

/**
 * Option C: thicknessMm is absolute min clearance above the plantar plane.
 * Identity / relative-correction tests must use the asset's native clearance
 * so the rigid offset is exactly 0 (the old thicknessMm:3 no-op).
 */
let identityThicknessMm = 3;

function neu(): SideCorrections {
    return {
        forefootPostingDeg: 0,
        rearfootPostingDeg: 0,
        medialSkiveMm: 0,
        lateralSkiveMm: 0,
        archFillMm: 0,
        archHeightMm: 0,
        heelCupDepthMm: 0,
        heelCupHeightMm: 0,
        heelCupWidthMm: 0,
        heelLiftMm: 0,
        apexMoveMm: 0,
        medialFlangeMm: 0,
        lateralFlangeMm: 0,
    };
}

function field(patch: Partial<SideCorrections>, thicknessMm = identityThicknessMm): HeightFieldParams {
    return {
        side: "right",
        lengthMm: 266,
        widthMm: 95,
        thicknessMm,
        corrections: { ...neu(), ...patch },
        elements: [],
        includeSkives: true,
        includeElements: true,
        trimline: null,
    };
}

interface Frame {
    lengthAxis: number;
    widthAxis: number;
    thickAxis: number;
    lenMin: number;
    lenSize: number;
    widMin: number;
    widSize: number;
    widCenter: number;
    topN: number;
    count: number;
}

function resolveFrame(geo: BufferGeometry): Frame {
    const arr = geo.getAttribute("position")!.array as Float32Array;
    const count = arr.length / 3;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) {
        for (let a = 0; a < 3; a++) {
            const c = arr[i * 3 + a]!;
            if (c < min[a]!) min[a] = c;
            if (c > max[a]!) max[a] = c;
        }
    }
    const sizes: [number, number][] = [
        [0, max[0]! - min[0]!],
        [1, max[1]! - min[1]!],
        [2, max[2]! - min[2]!],
    ];
    sizes.sort((a, b) => a[1] - b[1]);
    const thickAxis = sizes[0]![0];
    const widthAxis = sizes[1]![0];
    const lengthAxis = sizes[2]![0];
    const topN = (geo.userData as { topVertexCount?: number }).topVertexCount ?? count;
    const widMin = min[widthAxis]!;
    const widSize = max[widthAxis]! - widMin || 1;
    return {
        thickAxis,
        widthAxis,
        lengthAxis,
        lenMin: min[lengthAxis]!,
        lenSize: max[lengthAxis]! - min[lengthAxis]! || 1,
        widMin,
        widSize,
        widCenter: widMin + widSize / 2,
        topN,
        count,
    };
}

function copyPositions(geo: BufferGeometry): Float32Array {
    return new Float32Array(geo.getAttribute("position")!.array as Float32Array);
}

function maxAbsRange(a: Float32Array, b: Float32Array, start: number, end: number): number {
    let m = 0;
    for (let i = start; i < end; i++) {
        for (let c = 0; c < 3; c++) {
            m = Math.max(m, Math.abs(a[i * 3 + c]! - b[i * 3 + c]!));
        }
    }
    return m;
}

function topRimIndices(geo: BufferGeometry, topN: number): number[] {
    const sub = submeshByVertexRange(geo, 0, topN);
    try {
        return extractOrderedBoundaryLoopWithIndices(sub).indices;
    } finally {
        sub.dispose();
    }
}

/** Max |ΔZ_topRim − ΔZ_wallTop| over heel/midfoot rim pairs (footprint ≤1mm). */
function maxRimGapMm(base: Float32Array, mod: Float32Array, f: Frame, rim: number[]): number {
    const HQ = 20;
    const hash = new Map<string, number[]>();
    for (let i = f.topN; i < f.count; i++) {
        const k = `${Math.round(base[i * 3 + f.lengthAxis]! * HQ)},${Math.round(base[i * 3 + f.widthAxis]! * HQ)}`;
        let list = hash.get(k);
        if (!list) {
            list = [];
            hash.set(k, list);
        }
        list.push(i);
    }
    let maxGap = 0;
    for (const j of rim) {
        const lx = base[j * 3 + f.lengthAxis]!;
        const wy = base[j * 3 + f.widthAxis]!;
        const cx = Math.round(lx * HQ);
        const cy = Math.round(wy * HQ);
        let best = -1;
        let bestZ = -Infinity;
        let bestD = Infinity;
        for (let dx = -2; dx <= 2; dx++) {
            for (let dy = -2; dy <= 2; dy++) {
                const list = hash.get(`${cx + dx},${cy + dy}`);
                if (!list) continue;
                for (const bi of list) {
                    const d = Math.hypot(base[bi * 3 + f.lengthAxis]! - lx, base[bi * 3 + f.widthAxis]! - wy);
                    if (d > 1.0) continue;
                    const z = base[bi * 3 + f.thickAxis]!;
                    if (z > bestZ + 1e-9 || (Math.abs(z - bestZ) <= 1e-9 && d < bestD)) {
                        bestZ = z;
                        best = bi;
                        bestD = d;
                    }
                }
            }
        }
        if (best < 0 || bestZ < 2.0) continue;
        const dTop = mod[j * 3 + f.thickAxis]! - base[j * 3 + f.thickAxis]!;
        const dBot = mod[best * 3 + f.thickAxis]! - base[best * 3 + f.thickAxis]!;
        maxGap = Math.max(maxGap, Math.abs(dTop - dBot));
    }
    return maxGap;
}

/** Build bottom footprint hash for thickness pairing. */
function buildBottomHash(base: Float32Array, f: Frame): Map<string, number[]> {
    const cell = 1.0;
    const hash = new Map<string, number[]>();
    for (let i = f.topN; i < f.count; i++) {
        const k = `${Math.floor(base[i * 3 + f.lengthAxis]! / cell)},${Math.floor(base[i * 3 + f.widthAxis]! / cell)}`;
        let list = hash.get(k);
        if (!list) {
            list = [];
            hash.set(k, list);
        }
        list.push(i);
    }
    return hash;
}

function nearestBottom(
    hash: Map<string, number[]>,
    base: Float32Array,
    f: Frame,
    len: number,
    wid: number,
    tol = 1.5,
): number {
    const cell = 1.0;
    const cx = Math.floor(len / cell);
    const cy = Math.floor(wid / cell);
    const bins = Math.ceil(tol / cell) + 1;
    let best = -1;
    let bestD = Infinity;
    for (let dx = -bins; dx <= bins; dx++) {
        for (let dy = -bins; dy <= bins; dy++) {
            const list = hash.get(`${cx + dx},${cy + dy}`);
            if (!list) continue;
            for (const bi of list) {
                const d = Math.hypot(base[bi * 3 + f.lengthAxis]! - len, base[bi * 3 + f.widthAxis]! - wid);
                if (d < bestD) {
                    bestD = d;
                    best = bi;
                }
            }
        }
    }
    return bestD <= tol ? best : -1;
}

/** Coincident top/bottom multi-mesh (exact XY pairs) for thickness SYNC checks. */
function makeCoincidentMultiMesh(): BufferGeometry {
    const { BufferAttribute, BufferGeometry } = require("three") as typeof import("three");
    const nx = 40;
    const ny = 16;
    const lengthMm = 260;
    const widthMm = 90;
    const top: number[] = [];
    const bot: number[] = [];
    for (let i = 0; i <= nx; i++) {
        const u = i / nx;
        for (let j = 0; j <= ny; j++) {
            const v = (j / ny) * 2 - 1;
            const x = u * lengthMm;
            const y = v * (widthMm / 2);
            const zTop = 8 + 4 * Math.sin(Math.PI * u) * (1 - 0.3 * Math.abs(v));
            top.push(x, y, zTop);
            bot.push(x, y, 0);
        }
    }
    const topN = top.length / 3;
    const combined = new Float32Array(topN * 6);
    combined.set(top, 0);
    combined.set(bot, topN * 3);
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(combined, 3));
    geo.userData = { isMultiMeshBase: true, topVertexCount: topN };
    geo.computeVertexNormals();
    return geo;
}

/** Max new dihedral (degrees) on bottom mesh faces vs base, for crease scan. */
function maxNewBottomDihedralDeg(
    geo: BufferGeometry,
    baseArr: Float32Array,
    modArr: Float32Array,
    f: Frame,
    mode: false | true | "straddle" = false,
): number {
    const index = geo.index;
    if (!index) return 0;
    const idx = index.array as ArrayLike<number>;
    type Face = { a: number; b: number; c: number; nx: number; ny: number; nz: number };
    const facesBase: Face[] = [];
    const facesMod: Face[] = [];
    const faceNormal = (arr: Float32Array, a: number, b: number, c: number) => {
        const abx = arr[b * 3]! - arr[a * 3]!;
        const aby = arr[b * 3 + 1]! - arr[a * 3 + 1]!;
        const abz = arr[b * 3 + 2]! - arr[a * 3 + 2]!;
        const acx = arr[c * 3]! - arr[a * 3]!;
        const acy = arr[c * 3 + 1]! - arr[a * 3 + 1]!;
        const acz = arr[c * 3 + 2]! - arr[a * 3 + 2]!;
        const nx = aby * acz - abz * acy;
        const ny = abz * acx - abx * acz;
        const nz = abx * acy - aby * acx;
        const len = Math.hypot(nx, ny, nz) || 1;
        return { nx: nx / len, ny: ny / len, nz: nz / len };
    };
    const vNormOf = (vi: number) =>
        Math.abs((baseArr[vi * 3 + f.widthAxis]! - f.widCenter) / (f.widSize / 2));
    const inArch = (vi: number) => {
        const u = (baseArr[vi * 3 + f.lengthAxis]! - f.lenMin) / f.lenSize;
        return u >= 0.32 && u <= 0.68;
    };
    for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t]!;
        const b = idx[t + 1]!;
        const c = idx[t + 2]!;
        if (a < f.topN || b < f.topN || c < f.topN) continue;
        if (mode === true) {
            if (!(inArch(a) || inArch(b) || inArch(c))) continue;
            if (!(vNormOf(a) >= 0.85 || vNormOf(b) >= 0.85 || vNormOf(c) >= 0.85)) continue;
        }
        const nb = faceNormal(baseArr, a, b, c);
        const nm = faceNormal(modArr, a, b, c);
        facesBase.push({ a, b, c, ...nb });
        facesMod.push({ a, b, c, ...nm });
    }
    const edgeKey = (i: number, j: number) => (i < j ? `${i},${j}` : `${j},${i}`);
    const edgeFaces = new Map<string, number[]>();
    for (let fi = 0; fi < facesBase.length; fi++) {
        const fce = facesBase[fi]!;
        for (const [u, v] of [
            [fce.a, fce.b],
            [fce.b, fce.c],
            [fce.c, fce.a],
        ] as const) {
            const k = edgeKey(u, v);
            let list = edgeFaces.get(k);
            if (!list) {
                list = [];
                edgeFaces.set(k, list);
            }
            list.push(fi);
        }
    }
    let maxNew = 0;
    for (const [ek, flist] of edgeFaces) {
        if (flist.length !== 2) continue;
        if (mode === "straddle") {
            const [sa, sb] = ek.split(",").map(Number) as [number, number];
            if (!inArch(sa) && !inArch(sb)) continue;
            const na = vNormOf(sa);
            const nbv = vNormOf(sb);
            // Must straddle outline: one interior (<0.85), one exterior (≥0.98).
            const lo = Math.min(na, nbv);
            const hi = Math.max(na, nbv);
            if (!(lo < 0.85 && hi >= 0.98)) continue;
        }
        const i0 = flist[0]!;
        const i1 = flist[1]!;
        const b0 = facesBase[i0]!;
        const b1 = facesBase[i1]!;
        const m0 = facesMod[i0]!;
        const m1 = facesMod[i1]!;
        const dotBase = Math.max(-1, Math.min(1, b0.nx * b1.nx + b0.ny * b1.ny + b0.nz * b1.nz));
        const dotMod = Math.max(-1, Math.min(1, m0.nx * m1.nx + m0.ny * m1.ny + m0.nz * m1.nz));
        const degBase = (Math.acos(dotBase) * 180) / Math.PI;
        const degMod = (Math.acos(dotMod) * 180) / Math.PI;
        const added = degMod - degBase;
        if (added > maxNew) maxNew = added;
    }
    return maxNew;
}

describe("synced bottom-shell field (Default.glb)", () => {
    let baseGeo: BufferGeometry;
    let frame: Frame;
    let baseArr: Float32Array;
    let rimIdx: number[];

    beforeAll(async () => {
        expect(existsSync(FIXTURE)).toBe(true);
        const buf = readFileSync(FIXTURE);
        const group = await loadGlbFromBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        baseGeo = extractMergedGeometry(group)!.geometry;
        frame = resolveFrame(baseGeo);
        baseArr = copyPositions(baseGeo);
        rimIdx = topRimIndices(baseGeo, frame.topN);
        const datum = deriveNativeShellThicknessDatum(baseGeo);
        expect(datum).not.toBeNull();
        identityThicknessMm = datum!.nativeMinClearanceMm;
        expect(frame.topN).toBeGreaterThan(1000);
        expect(frame.count).toBeGreaterThan(frame.topN);
    });

    test("SYNC-0: top mesh bit-identical across runs; arch0 identity", () => {
        for (const arch of [0, 8, 18, 28]) {
            const f = field({ archHeightMm: arch });
            const a = applyBaseModifiers(baseGeo, f, 0);
            const b = applyBaseModifiers(baseGeo, f, 0);
            expect(maxAbsRange(copyPositions(a), copyPositions(b), 0, frame.topN)).toBe(0);
            if (arch === 0) {
                expect(maxAbsRange(baseArr, copyPositions(a), 0, frame.count)).toBe(0);
            }
            a.dispose();
            b.dispose();
        }
    });

    test("zero-correction identity: both meshes bit-identical (HC-1 extended)", () => {
        const mod = applyBaseModifiers(baseGeo, field({}), 0);
        const modArr = copyPositions(mod);
        expect(maxAbsRange(baseArr, modArr, 0, frame.count)).toBe(0);
        mod.dispose();
    });

    test("thickness invariance: |Δthickness| ≤ 0.05mm over ≥200 arch-band pairs @ arch 18", () => {
        // Exact-XY coincident synthetic mesh (Default.glb top/bottom are not
        // co-tessellated — NN offsets sample different F via field gradient).
        const syn = makeCoincidentMultiMesh();
        const synDatum = deriveNativeShellThicknessDatum(syn)!;
        // Zero rigid offset so this asserts clinical-F shell coupling only.
        const synThick = synDatum.nativeMinClearanceMm;
        const synBase = copyPositions(syn);
        const synMod = applyBaseModifiers(syn, field({ archHeightMm: 18 }, synThick), 0);
        const synArr = copyPositions(synMod);
        const synTopN = (syn.userData as { topVertexCount: number }).topVertexCount;
        let pairs = 0;
        let maxThickDelta = 0;
        for (let i = 0; i < synTopN; i++) {
            const u = synBase[i * 3]! / 260;
            if (u < 0.32 || u > 0.62) continue;
            const bi = synTopN + i;
            const thickBefore = synBase[i * 3 + 2]! - synBase[bi * 3 + 2]!;
            const thickAfter = synArr[i * 3 + 2]! - synArr[bi * 3 + 2]!;
            maxThickDelta = Math.max(maxThickDelta, Math.abs(thickAfter - thickBefore));
            pairs++;
        }
        expect(pairs).toBeGreaterThanOrEqual(200);
        // f32 composition noise sits on the 0.05 boundary (±1 ulp).
        expect(maxThickDelta).toBeLessThanOrEqual(0.05 + 1e-4);
        // Default.glb: ultra-close pairs (≤0.05 mm) must also hold.
        const mod = applyBaseModifiers(baseGeo, field({ archHeightMm: 18 }), 0);
        const modArr = copyPositions(mod);
        const hash = buildBottomHash(baseArr, frame);
        let closePairs = 0;
        let closeMax = 0;
        for (let i = 0; i < frame.topN; i++) {
            const u = (baseArr[i * 3 + frame.lengthAxis]! - frame.lenMin) / frame.lenSize;
            if (u < 0.32 || u > 0.62) continue;
            const bi = nearestBottom(
                hash,
                baseArr,
                frame,
                baseArr[i * 3 + frame.lengthAxis]!,
                baseArr[i * 3 + frame.widthAxis]!,
                0.05,
            );
            if (bi < 0) continue;
            if (baseArr[bi * 3 + frame.thickAxis]! > PLANTAR_Z_MAX_MM) continue;
            const thickBefore = baseArr[i * 3 + frame.thickAxis]! - baseArr[bi * 3 + frame.thickAxis]!;
            const thickAfter = modArr[i * 3 + frame.thickAxis]! - modArr[bi * 3 + frame.thickAxis]!;
            closeMax = Math.max(closeMax, Math.abs(thickAfter - thickBefore));
            closePairs++;
        }
        expect(closePairs).toBeGreaterThan(0);
        expect(closeMax).toBeLessThanOrEqual(0.05);
        synMod.dispose();
        syn.dispose();
        mod.dispose();
    });

    test("rim closure: max rim ΔZ gap ≤ 0.05mm across arch + depth sweeps", () => {
        const configs: Partial<SideCorrections>[] = [
            {},
            { archHeightMm: 8 },
            { archHeightMm: 18 },
            { archHeightMm: 28 },
            { heelCupDepthMm: 5 },
            { heelCupDepthMm: 15 },
            { archHeightMm: 18, heelCupDepthMm: 8 },
            { archHeightMm: 28, apexMoveMm: 8 },
        ];
        for (const patch of configs) {
            const mod = applyBaseModifiers(baseGeo, field(patch), 0);
            const modArr = copyPositions(mod);
            const gap = maxRimGapMm(baseArr, modArr, frame, rimIdx);
            expect(gap).toBeLessThanOrEqual(0.05);
            mod.dispose();
        }
    });

    test("ground contact: where F≈0 (forefoot u≥0.80) plantar Z unchanged under arch-only", () => {
        // Arch bump(u, 0.42, 0.36) bleeds into u≈0.06–0.78, so heel u≤0.30 is
        // NOT F≈0 on this height field. Assert the true F≈0 ground band
        // (anterior forefoot) and that arch plantar does lift.
        const mod = applyBaseModifiers(baseGeo, field({ archHeightMm: 18 }), 0);
        const modArr = copyPositions(mod);
        let maxFore = 0;
        for (let i = frame.topN; i < frame.count; i++) {
            if (baseArr[i * 3 + frame.thickAxis]! > PLANTAR_Z_MAX_MM) continue;
            const u = (baseArr[i * 3 + frame.lengthAxis]! - frame.lenMin) / frame.lenSize;
            if (u < 0.8) continue;
            const d = Math.abs(modArr[i * 3 + frame.thickAxis]! - baseArr[i * 3 + frame.thickAxis]!);
            maxFore = Math.max(maxFore, d);
        }
        expect(maxFore).toBeLessThan(BASE_BOTTOM_DELTA_TOLERANCE_MM);
        let maxArchPlantar = 0;
        for (let i = frame.topN; i < frame.count; i++) {
            if (baseArr[i * 3 + frame.thickAxis]! > PLANTAR_Z_MAX_MM) continue;
            const u = (baseArr[i * 3 + frame.lengthAxis]! - frame.lenMin) / frame.lenSize;
            if (u < 0.35 || u > 0.55) continue;
            maxArchPlantar = Math.max(
                maxArchPlantar,
                modArr[i * 3 + frame.thickAxis]! - baseArr[i * 3 + frame.thickAxis]!,
            );
        }
        expect(maxArchPlantar).toBeGreaterThan(1);
        mod.dispose();
    });

    test("crease scan: no new bottom dihedral > 15° on clamp-straddle edges @ arch 18", () => {
        const mod = applyBaseModifiers(baseGeo, field({ archHeightMm: 18 }), 0);
        const modArr = copyPositions(mod);
        // Only edges that straddle the local outline (one vert deep-exterior,
        // one interior) — isolates clamp-boundary creases from dome curvature.
        const added = maxNewBottomDihedralDeg(baseGeo, baseArr, modArr, frame, "straddle");
        expect(added).toBeLessThanOrEqual(15);
        mod.dispose();
    });

    test("wedged + arched: bottom thick delta matches top F composition", () => {
        // Coincident synthetic mesh — same F path for wedge+arch composition.
        const syn = makeCoincidentMultiMesh();
        const synThick = deriveNativeShellThicknessDatum(syn)!.nativeMinClearanceMm;
        const synBase = copyPositions(syn);
        const patch = {
            archHeightMm: 12,
            rearfootWedge: { side: "medial" as const, value: 4, unit: "mm" as const },
        };
        const mod = applyBaseModifiers(syn, field(patch, synThick), 0);
        const modArr = copyPositions(mod);
        const topN = (syn.userData as { topVertexCount: number }).topVertexCount;
        let checked = 0;
        let maxPairDiff = 0;
        for (let i = 0; i < topN; i++) {
            const u = synBase[i * 3]! / 260;
            if (u < 0.35 || u > 0.55) continue;
            const bi = topN + i;
            const dTop = modArr[i * 3 + 2]! - synBase[i * 3 + 2]!;
            const dBot = modArr[bi * 3 + 2]! - synBase[bi * 3 + 2]!;
            maxPairDiff = Math.max(maxPairDiff, Math.abs(dTop - dBot));
            checked++;
        }
        expect(checked).toBeGreaterThan(50);
        expect(maxPairDiff).toBeLessThanOrEqual(0.05 + 1e-4);
        mod.dispose();
        syn.dispose();
    });

    test("extreme arch 28 + apexMove 8: rim gap ≤ 0.05mm", () => {
        const mod = applyBaseModifiers(baseGeo, field({ archHeightMm: 28, apexMoveMm: 8 }), 0);
        const modArr = copyPositions(mod);
        expect(maxRimGapMm(baseArr, modArr, frame, rimIdx)).toBeLessThanOrEqual(0.05);
        // No top-sheet / bottom-wall Z inversion in arch band (heuristic SI).
        let inversions = 0;
        const hash = buildBottomHash(baseArr, frame);
        for (let i = 0; i < frame.topN; i += 20) {
            const u = (baseArr[i * 3 + frame.lengthAxis]! - frame.lenMin) / frame.lenSize;
            if (u < 0.32 || u > 0.62) continue;
            const bi = nearestBottom(
                hash,
                baseArr,
                frame,
                baseArr[i * 3 + frame.lengthAxis]!,
                baseArr[i * 3 + frame.widthAxis]!,
            );
            if (bi < 0) continue;
            if (modArr[bi * 3 + frame.thickAxis]! > modArr[i * 3 + frame.thickAxis]! + 0.5) {
                inversions++;
            }
        }
        expect(inversions).toBe(0);
        mod.dispose();
    });
});
