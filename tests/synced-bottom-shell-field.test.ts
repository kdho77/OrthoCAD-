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
    BASE_REFERENCE_THICKNESS_MM,
    PLANTAR_Z_MAX_MM,
    correctionDeltaAt,
    detectArchSideSign,
} from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import {
    extractOrderedBoundaryLoopWithIndices,
    submeshByVertexRange,
} from "@/lib/geometry/mesh-close";
import { extractMergedGeometry, loadGlbFromBuffer } from "@/lib/library/loaders";
import type { SideCorrections } from "@/types";

const FIXTURE = resolve(process.cwd(), "tests/fixtures/Default.glb");

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

function field(patch: Partial<SideCorrections>): HeightFieldParams {
    return {
        side: "right",
        lengthMm: 266,
        widthMm: 95,
        thicknessMm: 3,
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
                    const d = Math.hypot(
                        base[bi * 3 + f.lengthAxis]! - lx,
                        base[bi * 3 + f.widthAxis]! - wy,
                    );
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
                const d = Math.hypot(
                    base[bi * 3 + f.lengthAxis]! - len,
                    base[bi * 3 + f.widthAxis]! - wid,
                );
                if (d < bestD) {
                    bestD = d;
                    best = bi;
                }
            }
        }
    }
    return bestD <= tol ? best : -1;
}

/** Max new dihedral (degrees) on bottom mesh faces vs base, for crease scan. */
function maxNewBottomDihedralDeg(
    geo: BufferGeometry,
    baseArr: Float32Array,
    modArr: Float32Array,
    f: Frame,
): number {
    const index = geo.index;
    if (!index) return 0;
    const idx = index.array as ArrayLike<number>;
    // Face normals for triangles wholly in the bottom range.
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
    for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t]!;
        const b = idx[t + 1]!;
        const c = idx[t + 2]!;
        if (a < f.topN || b < f.topN || c < f.topN) continue;
        const nb = faceNormal(baseArr, a, b, c);
        const nm = faceNormal(modArr, a, b, c);
        facesBase.push({ a, b, c, ...nb });
        facesMod.push({ a, b, c, ...nm });
    }
    // Edge → face adjacency
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
    for (const [, flist] of edgeFaces) {
        if (flist.length !== 2) continue;
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
        expect(frame.topN).toBeGreaterThan(1000);
        expect(frame.count).toBeGreaterThan(frame.topN);
    });

    test("SYNC-0: top mesh bit-identical to correctionDeltaAt (arch 0/8/18/28)", () => {
        // Top thick-axis delta must equal scalar F at each top vert (depth=0,
        // width=0) — proves the field refactor did not alter the top path.
        for (const arch of [0, 8, 18, 28]) {
            const f = field({ archHeightMm: arch });
            const neutral: HeightFieldParams = {
                ...f,
                thicknessMm: BASE_REFERENCE_THICKNESS_MM,
                corrections: {
                    ...neu(),
                    rearfootWedge: undefined,
                    forefootWedge: undefined,
                },
                elements: [],
                includeElements: false,
                includeSkives: true,
                trimline: null,
            };
            const mod = applyBaseModifiers(baseGeo, f, 0);
            const modArr = copyPositions(mod);
            const medialSign = 1; // right
            const widthSign = -(detectArchSideSign(baseGeo) * medialSign);
            let maxDiff = 0;
            for (let i = 0; i < frame.topN; i++) {
                const lenCoord = baseArr[i * 3 + frame.lengthAxis]!;
                const widCoord = baseArr[i * 3 + frame.widthAxis]!;
                const u = Math.max(0, Math.min(1, (lenCoord - frame.lenMin) / frame.lenSize));
                const vSigned = Math.max(
                    -1,
                    Math.min(1, (widthSign * (widCoord - frame.widCenter)) / (frame.widSize / 2)),
                );
                const expected = correctionDeltaAt(u, vSigned, f, neutral);
                const got = modArr[i * 3 + frame.thickAxis]! - baseArr[i * 3 + frame.thickAxis]!;
                maxDiff = Math.max(maxDiff, Math.abs(got - expected));
            }
            expect(maxDiff).toBeLessThan(1e-5);
            mod.dispose();
        }
    });

    test("zero-correction identity: both meshes bit-identical (HC-1 extended)", () => {
        const mod = applyBaseModifiers(baseGeo, field({}), 0);
        const modArr = copyPositions(mod);
        expect(maxAbsRange(baseArr, modArr, 0, frame.count)).toBe(0);
        mod.dispose();
    });

    test("thickness invariance: |Δthickness| ≤ 0.05mm over ≥200 arch-band pairs @ arch 18", () => {
        const mod = applyBaseModifiers(baseGeo, field({ archHeightMm: 18 }), 0);
        const modArr = copyPositions(mod);
        const hash = buildBottomHash(baseArr, frame);
        let pairs = 0;
        let maxThickDelta = 0;
        const step = Math.max(1, Math.floor(frame.topN / 800));
        for (let i = 0; i < frame.topN; i += step) {
            const u = (baseArr[i * 3 + frame.lengthAxis]! - frame.lenMin) / frame.lenSize;
            if (u < 0.32 || u > 0.62) continue;
            const len = baseArr[i * 3 + frame.lengthAxis]!;
            const wid = baseArr[i * 3 + frame.widthAxis]!;
            const bi = nearestBottom(hash, baseArr, frame, len, wid);
            if (bi < 0) continue;
            const thickBefore =
                baseArr[i * 3 + frame.thickAxis]! - baseArr[bi * 3 + frame.thickAxis]!;
            const thickAfter = modArr[i * 3 + frame.thickAxis]! - modArr[bi * 3 + frame.thickAxis]!;
            maxThickDelta = Math.max(maxThickDelta, Math.abs(thickAfter - thickBefore));
            pairs++;
        }
        expect(pairs).toBeGreaterThanOrEqual(200);
        expect(maxThickDelta).toBeLessThanOrEqual(0.05);
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

    test("ground contact: heel u≤0.30 + forefoot u≥0.75 Z unchanged under arch-only", () => {
        const mod = applyBaseModifiers(baseGeo, field({ archHeightMm: 18 }), 0);
        const modArr = copyPositions(mod);
        let maxHeel = 0;
        let maxFore = 0;
        for (let i = frame.topN; i < frame.count; i++) {
            if (baseArr[i * 3 + frame.thickAxis]! > PLANTAR_Z_MAX_MM) continue;
            const u = (baseArr[i * 3 + frame.lengthAxis]! - frame.lenMin) / frame.lenSize;
            const d = Math.abs(modArr[i * 3 + frame.thickAxis]! - baseArr[i * 3 + frame.thickAxis]!);
            if (u <= 0.3) maxHeel = Math.max(maxHeel, d);
            if (u >= 0.75) maxFore = Math.max(maxFore, d);
        }
        expect(maxHeel).toBeLessThan(BASE_BOTTOM_DELTA_TOLERANCE_MM);
        expect(maxFore).toBeLessThan(BASE_BOTTOM_DELTA_TOLERANCE_MM);
        // Arch plantar must actually lift (sanity that sync is active).
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

    test("crease scan: no new bottom dihedral > 15° at arch 18", () => {
        const mod = applyBaseModifiers(baseGeo, field({ archHeightMm: 18 }), 0);
        const modArr = copyPositions(mod);
        const added = maxNewBottomDihedralDeg(baseGeo, baseArr, modArr, frame);
        expect(added).toBeLessThanOrEqual(15);
        mod.dispose();
    });

    test("wedged + arched: bottom thick delta matches top F composition", () => {
        const patch = {
            archHeightMm: 12,
            rearfootWedge: { side: "medial" as const, value: 4, unit: "mm" as const },
        };
        const f = field(patch);
        const mod = applyBaseModifiers(baseGeo, f, 0);
        const modArr = copyPositions(mod);
        // Spot-check: at arch midfoot, bottom lift ≈ top lift for NN pairs (same F).
        const hash = buildBottomHash(baseArr, frame);
        let checked = 0;
        let maxPairDiff = 0;
        const step = Math.max(1, Math.floor(frame.topN / 400));
        for (let i = 0; i < frame.topN; i += step) {
            const u = (baseArr[i * 3 + frame.lengthAxis]! - frame.lenMin) / frame.lenSize;
            if (u < 0.35 || u > 0.55) continue;
            const bi = nearestBottom(
                hash,
                baseArr,
                frame,
                baseArr[i * 3 + frame.lengthAxis]!,
                baseArr[i * 3 + frame.widthAxis]!,
            );
            if (bi < 0) continue;
            const dTop = modArr[i * 3 + frame.thickAxis]! - baseArr[i * 3 + frame.thickAxis]!;
            const dBot = modArr[bi * 3 + frame.thickAxis]! - baseArr[bi * 3 + frame.thickAxis]!;
            maxPairDiff = Math.max(maxPairDiff, Math.abs(dTop - dBot));
            checked++;
        }
        expect(checked).toBeGreaterThan(50);
        expect(maxPairDiff).toBeLessThanOrEqual(0.05);
        mod.dispose();
    });

    test("extreme arch 28 + apexMove 8: rim gap ≤ 0.05mm", () => {
        const mod = applyBaseModifiers(
            baseGeo,
            field({ archHeightMm: 28, apexMoveMm: 8 }),
            0,
        );
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
