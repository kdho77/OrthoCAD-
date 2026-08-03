// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Bottom-mesh arch-wall falloff — detects hard vertical rim-delta pull vs
 * smooth concave falloff mirroring the top-mesh convex arch dome.
 * Also re-checks PR #110/#111 gap/protrusion pins after the inward-weight fix.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import {
    ANTERIOR_U0,
    applyBaseModifiers,
    applyBaseModifiersWithSidewall,
    PLANTAR_Z_MAX_MM,
    RIM_INWARD_SPAN_FRAC,
    RIM_INWARD_SPAN_MAX_MM,
    RIM_INWARD_SPAN_MIN_MM,
    RIM_PAIR_TOL_MM,
    rimConformityInwardWeight,
    WALL_CORRIDOR_MM,
    WALL_TOP_MIN_Z_MM,
} from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import {
    extractOrderedBoundaryLoopWithIndices,
    submeshByVertexRange,
    validateManifold,
} from "@/lib/geometry/mesh-close";
import { extractMergedGeometry, loadGlbFromBuffer } from "@/lib/library/loaders";
import type { SideCorrections } from "@/types";

const FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/Default.glb");

function neutralCorrections(): SideCorrections {
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

function correctionField(patch: Partial<SideCorrections>): HeightFieldParams {
    return {
        side: "right",
        lengthMm: 266,
        widthMm: 95,
        thicknessMm: 3,
        corrections: { ...neutralCorrections(), ...patch },
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
    widCenter: number;
    widSize: number;
    topVertexCount: number;
    count: number;
}

function resolveFrame(geo: BufferGeometry): Frame {
    const pos = geo.getAttribute("position")!;
    const arr = pos.array as Float32Array;
    const count = pos.count;
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
    const userData = geo.userData as { topVertexCount?: number };
    const topVertexCount =
        typeof userData.topVertexCount === "number" && userData.topVertexCount > 0
            ? userData.topVertexCount
            : count;
    return {
        lengthAxis,
        widthAxis,
        thickAxis,
        lenMin: min[lengthAxis]!,
        lenSize: max[lengthAxis]! - min[lengthAxis]! || 1,
        widCenter: (min[widthAxis]! + max[widthAxis]!) / 2,
        widSize: max[widthAxis]! - min[widthAxis]! || 1,
        topVertexCount,
        count,
    };
}

function copyPositions(geo: BufferGeometry): Float32Array {
    return new Float32Array(geo.getAttribute("position")!.array as Float32Array);
}

function topRimIndices(geo: BufferGeometry, topVertexCount: number): number[] {
    const topSub = submeshByVertexRange(geo, 0, topVertexCount);
    try {
        return extractOrderedBoundaryLoopWithIndices(topSub).indices;
    } finally {
        topSub.dispose();
    }
}

/** Max ‖Δ_wall − Δ_rim‖ over deduped heel wall-top seeds (u≤U0, d≤1, Z≥2). */
function maxDeltaMismatchMm(
    baseArr: Float32Array,
    modArr: Float32Array,
    frame: Frame,
    rimIdx: number[],
): number {
    const { lengthAxis, widthAxis, thickAxis, topVertexCount, count, lenMin, lenSize } = frame;
    const HQ = 20;
    const hash = new Map<string, number[]>();
    for (let i = topVertexCount; i < count; i++) {
        const k = `${Math.round(baseArr[i * 3 + lengthAxis]! * HQ)},${Math.round(baseArr[i * 3 + widthAxis]! * HQ)}`;
        let list = hash.get(k);
        if (!list) {
            list = [];
            hash.set(k, list);
        }
        list.push(i);
    }

    type Seed = { j: number; wall: number; pairD: number };
    const byWall = new Map<number, Seed>();
    for (const j of rimIdx) {
        const u = (baseArr[j * 3 + lengthAxis]! - lenMin) / lenSize;
        if (u > ANTERIOR_U0) continue;
        const lx = baseArr[j * 3 + lengthAxis]!;
        const wy = baseArr[j * 3 + widthAxis]!;
        const bins = Math.ceil(RIM_PAIR_TOL_MM * HQ) + 2;
        const cx = Math.round(lx * HQ);
        const cy = Math.round(wy * HQ);
        let best = -1;
        let bestZ = -Infinity;
        let bestD = Infinity;
        for (let dx = -bins; dx <= bins; dx++) {
            for (let dy = -bins; dy <= bins; dy++) {
                const list = hash.get(`${cx + dx},${cy + dy}`);
                if (!list) continue;
                for (const bi of list) {
                    const bl = baseArr[bi * 3 + lengthAxis]!;
                    const bw = baseArr[bi * 3 + widthAxis]!;
                    const d = Math.hypot(bl - lx, bw - wy);
                    if (d > RIM_PAIR_TOL_MM) continue;
                    const z = baseArr[bi * 3 + thickAxis]!;
                    if (z < WALL_TOP_MIN_Z_MM) continue;
                    if (z > bestZ + 1e-9 || (Math.abs(z - bestZ) <= 1e-9 && d < bestD)) {
                        bestZ = z;
                        best = bi;
                        bestD = d;
                    }
                }
            }
        }
        if (best < 0) continue;
        const prev = byWall.get(best);
        if (prev && prev.pairD <= bestD) continue;
        byWall.set(best, { j, wall: best, pairD: bestD });
    }

    let maxMismatch = 0;
    for (const s of byWall.values()) {
        const { j, wall } = s;
        const mismatch = Math.hypot(
            modArr[wall * 3]! - baseArr[wall * 3]! - (modArr[j * 3]! - baseArr[j * 3]!),
            modArr[wall * 3 + 1]! - baseArr[wall * 3 + 1]! - (modArr[j * 3 + 1]! - baseArr[j * 3 + 1]!),
            modArr[wall * 3 + 2]! - baseArr[wall * 3 + 2]! - (modArr[j * 3 + 2]! - baseArr[j * 3 + 2]!),
        );
        if (mismatch > maxMismatch) maxMismatch = mismatch;
    }
    return maxMismatch;
}

interface ArchSample {
    u: number;
    d: number;
    h: number;
    dThick: number;
    mag: number;
}

/** Arch-band bottom wall samples with NN distance to top rim (spatial-hashed). */
function sampleArchWall(
    baseArr: Float32Array,
    modArr: Float32Array,
    frame: Frame,
    rimIdx: number[],
): ArchSample[] {
    const { lengthAxis, widthAxis, thickAxis, topVertexCount, count, lenMin, lenSize } = frame;
    let botMinZ = Infinity;
    let botMaxZ = -Infinity;
    for (let i = topVertexCount; i < count; i++) {
        const z = baseArr[i * 3 + thickAxis]!;
        if (z < botMinZ) botMinZ = z;
        if (z > botMaxZ) botMaxZ = z;
    }

    const cell = RIM_PAIR_TOL_MM;
    const rimHash = new Map<string, number[]>();
    const rimKey = (len: number, wid: number) => `${Math.floor(len / cell)},${Math.floor(wid / cell)}`;
    for (const j of rimIdx) {
        const k = rimKey(baseArr[j * 3 + lengthAxis]!, baseArr[j * 3 + widthAxis]!);
        let list = rimHash.get(k);
        if (!list) {
            list = [];
            rimHash.set(k, list);
        }
        list.push(j);
    }
    const bins = Math.ceil(WALL_CORRIDOR_MM / cell) + 1;

    const samples: ArchSample[] = [];
    for (let i = topVertexCount; i < count; i++) {
        const z0 = baseArr[i * 3 + thickAxis]!;
        if (z0 <= PLANTAR_Z_MAX_MM) continue;
        const u = (baseArr[i * 3 + lengthAxis]! - lenMin) / lenSize;
        if (u < 0.28 || u > 0.55) continue;

        const len = baseArr[i * 3 + lengthAxis]!;
        const wid = baseArr[i * 3 + widthAxis]!;
        const cx = Math.floor(len / cell);
        const cy = Math.floor(wid / cell);
        let bestD = Infinity;
        for (let dx = -bins; dx <= bins; dx++) {
            for (let dy = -bins; dy <= bins; dy++) {
                const list = rimHash.get(`${cx + dx},${cy + dy}`);
                if (!list) continue;
                for (const j of list) {
                    const d = Math.hypot(
                        baseArr[j * 3 + lengthAxis]! - len,
                        baseArr[j * 3 + widthAxis]! - wid,
                    );
                    if (d < bestD) bestD = d;
                }
            }
        }
        if (bestD >= WALL_CORRIDOR_MM) continue;

        // Approximate h from global bottom Z range (wall-top ≈ botMaxZ).
        const denom = botMaxZ - botMinZ;
        const h = denom > 1e-9 ? (z0 - botMinZ) / denom : 0;
        const dThick = modArr[i * 3 + thickAxis]! - baseArr[i * 3 + thickAxis]!;
        const mag = Math.hypot(
            modArr[i * 3]! - baseArr[i * 3]!,
            modArr[i * 3 + 1]! - baseArr[i * 3 + 1]!,
            modArr[i * 3 + 2]! - baseArr[i * 3 + 2]!,
        );
        if (mag < 0.05 && Math.abs(dThick) < 0.05) continue;
        samples.push({ u, d: bestD, h, dThick, mag });
    }
    return samples;
}

/** Max |second difference| of thick-delta along a u-sorted wall-top medial transect. */
function maxSecondDiffAlongU(samples: ArchSample[]): { maxSecond: number; n: number } {
    const wallTop = samples.filter((s) => s.h > 0.85 && s.d <= RIM_PAIR_TOL_MM);
    // Bin by u (0.02 steps) taking mean dThick.
    const bins = new Map<number, number[]>();
    for (const s of wallTop) {
        const key = Math.round(s.u / 0.02);
        let list = bins.get(key);
        if (!list) {
            list = [];
            bins.set(key, list);
        }
        list.push(s.dThick);
    }
    const series = [...bins.entries()]
        .map(([k, vals]) => ({
            u: k * 0.02,
            dThick: vals.reduce((a, b) => a + b, 0) / vals.length,
        }))
        .sort((a, b) => a.u - b.u);
    let maxSecond = 0;
    for (let i = 1; i < series.length - 1; i++) {
        const second = series[i + 1]!.dThick - 2 * series[i]!.dThick + series[i - 1]!.dThick;
        if (Math.abs(second) > maxSecond) maxSecond = Math.abs(second);
    }
    return { maxSecond, n: series.length };
}

describe("rimConformityInwardWeight (unit)", () => {
    const halfW = 47.5;

    test("full weight in wall-top seed band d≤RIM_PAIR_TOL", () => {
        expect(rimConformityInwardWeight(0, halfW)).toBe(1);
        expect(rimConformityInwardWeight(RIM_PAIR_TOL_MM, halfW)).toBe(1);
        expect(rimConformityInwardWeight(0.5, halfW)).toBe(1);
    });

    test("attenuates inside corridor beyond seed band", () => {
        const mid = rimConformityInwardWeight(2.5, halfW);
        expect(mid).toBeGreaterThan(0);
        expect(mid).toBeLessThan(1);
        expect(rimConformityInwardWeight(WALL_CORRIDOR_MM, halfW)).toBe(0);
        expect(RIM_INWARD_SPAN_FRAC).toBeGreaterThan(0);
        expect(RIM_INWARD_SPAN_MIN_MM).toBeLessThanOrEqual(RIM_INWARD_SPAN_MAX_MM);
    });
});

describe("bottom-mesh arch-wall falloff (Default.glb)", () => {
    let baseGeo: BufferGeometry;
    let frame: Frame;
    let rimIdx: number[];
    let baseArr: Float32Array;

    beforeAll(async () => {
        expect(existsSync(FIXTURE_PATH)).toBe(true);
        const buf = readFileSync(FIXTURE_PATH);
        const group = await loadGlbFromBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        const merged = extractMergedGeometry(group);
        expect(merged).not.toBeNull();
        baseGeo = merged!.geometry;
        frame = resolveFrame(baseGeo);
        expect(frame.topVertexCount).toBe(42134);
        rimIdx = topRimIndices(baseGeo, frame.topVertexCount);
        baseArr = copyPositions(baseGeo);
    });

    for (const archHeightMm of [4, 10, 18] as const) {
        test(`arch=${archHeightMm}: corridor softens vs wall-top (no hard pull)`, () => {
            const mod = applyBaseModifiers(baseGeo, correctionField({ archHeightMm }));
            const modArr = copyPositions(mod);
            const samples = sampleArchWall(baseArr, modArr, frame, rimIdx);
            expect(samples.length).toBeGreaterThan(50);

            const wallTop = samples.filter((s) => s.h > 0.85 && s.d <= RIM_PAIR_TOL_MM);
            const corridor = samples.filter((s) => s.h > 0.5 && s.d > 1.5 && s.d < 4.0);
            expect(wallTop.length).toBeGreaterThan(10);
            expect(corridor.length).toBeGreaterThan(10);

            const avgTop = wallTop.reduce((s, x) => s + x.mag, 0) / wallTop.length;
            const avgCor = corridor.reduce((s, x) => s + x.mag, 0) / corridor.length;
            console.log(
                `[ARCH-WALL] arch=${archHeightMm} avgTopMag=${avgTop.toFixed(3)} avgCorridorMag=${avgCor.toFixed(3)} ratio=${(avgCor / Math.max(1e-9, avgTop)).toFixed(3)}`,
            );
            // Hard-pull detector: corridor must not track wall-top 1:1.
            expect(avgCor).toBeLessThan(avgTop * 0.85);
            mod.dispose();
        });

        test(`arch=${archHeightMm}: wall-top u-transect is smooth (low second-diff)`, () => {
            const mod = applyBaseModifiers(baseGeo, correctionField({ archHeightMm }));
            const modArr = copyPositions(mod);
            const samples = sampleArchWall(baseArr, modArr, frame, rimIdx);
            const { maxSecond, n } = maxSecondDiffAlongU(samples);
            console.log(`[ARCH-WALL] arch=${archHeightMm} maxSecondDiff=${maxSecond.toFixed(4)} bins=${n}`);
            expect(n).toBeGreaterThan(5);
            // Graded dome — reject a spike/step along the arch apex transect.
            // Clinical arch second-diff on Default.glb rim data was ~0.77 (docs);
            // allow headroom but fail on hard discontinuities (>2 mm/bin²).
            expect(maxSecond).toBeLessThan(2.0);
            mod.dispose();
        });
    }

    test("mirror: bottom wall-top thick-Δ(u) tracks medial top-rim arch shape", () => {
        const archHeightMm = 12;
        const mod = applyBaseModifiers(baseGeo, correctionField({ archHeightMm }));
        const modArr = copyPositions(mod);
        const { lengthAxis, thickAxis, lenMin, lenSize, topVertexCount } = frame;

        // Top rim thick delta vs u (arch band) — keep medial contributors only
        // (upper half of |dThick|) so lateral rim zeros don't dilute the peak.
        const rimAll: { u: number; dThick: number }[] = [];
        for (const j of rimIdx) {
            const u = (baseArr[j * 3 + lengthAxis]! - lenMin) / lenSize;
            if (u < 0.28 || u > 0.55) continue;
            rimAll.push({
                u,
                dThick: modArr[j * 3 + thickAxis]! - baseArr[j * 3 + thickAxis]!,
            });
        }
        expect(rimAll.length).toBeGreaterThan(20);
        const rimSorted = [...rimAll].sort((a, b) => b.dThick - a.dThick);
        const medialRim = rimSorted.slice(0, Math.max(8, Math.floor(rimSorted.length * 0.35)));

        const wallSamples = sampleArchWall(baseArr, modArr, frame, rimIdx).filter(
            (s) => s.h > 0.85 && s.d <= RIM_PAIR_TOL_MM,
        );
        expect(wallSamples.length).toBeGreaterThan(20);

        const bin = (series: { u: number; dThick: number }[]) => {
            const m = new Map<number, number[]>();
            for (const s of series) {
                const k = Math.round(s.u / 0.03);
                let list = m.get(k);
                if (!list) {
                    list = [];
                    m.set(k, list);
                }
                list.push(s.dThick);
            }
            return [...m.entries()]
                .map(([k, vals]) => ({
                    u: k * 0.03,
                    dThick: vals.reduce((a, b) => a + b, 0) / vals.length,
                }))
                .sort((a, b) => a.u - b.u);
        };
        const rimB = bin(medialRim);
        const wallB = bin(wallSamples);
        let peakRim = rimB[0]!;
        let peakWall = wallB[0]!;
        for (const s of rimB) if (s.dThick > peakRim.dThick) peakRim = s;
        for (const s of wallB) if (s.dThick > peakWall.dThick) peakWall = s;
        console.log(
            `[ARCH-WALL] mirror peakRim u=${peakRim.u.toFixed(3)} dZ=${peakRim.dThick.toFixed(3)} peakWall u=${peakWall.u.toFixed(3)} dZ=${peakWall.dThick.toFixed(3)}`,
        );
        // Peaks align along the arch apex; magnitudes match within 20% (medial rim).
        expect(Math.abs(peakRim.u - peakWall.u)).toBeLessThan(0.08);
        expect(peakWall.dThick).toBeGreaterThan(peakRim.dThick * 0.8);
        expect(peakWall.dThick).toBeLessThan(peakRim.dThick * 1.2);

        expect(topVertexCount).toBe(42134);
        expect(mod.getAttribute("position")!.count).toBe(frame.count);
        mod.dispose();
    });

    test("regression: gap/protrusion Δ_wall≈Δ_rim with arch+width+depth", () => {
        const configs: Partial<SideCorrections>[] = [
            { archHeightMm: 12 },
            { archHeightMm: 18 },
            { heelCupWidthMm: 5, heelCupDepthMm: 5, archHeightMm: 10, apexMoveMm: 5 },
        ];
        for (const patch of configs) {
            const mod = applyBaseModifiers(baseGeo, correctionField(patch));
            const modArr = copyPositions(mod);
            const mismatch = maxDeltaMismatchMm(baseArr, modArr, frame, rimIdx);
            console.log(`[ARCH-WALL] gap-check ${JSON.stringify(patch)} mismatch=${mismatch.toFixed(4)}`);
            expect(mismatch).toBeLessThan(0.1);
            mod.dispose();
        }
    });

    test("HC-1: plantar drift < 0.05mm with max arch", () => {
        const mod = applyBaseModifiers(
            baseGeo,
            correctionField({ archHeightMm: 18, heelCupWidthMm: 5, heelCupDepthMm: 5 }),
        );
        const modArr = copyPositions(mod);
        let maxDrift = 0;
        for (let i = frame.topVertexCount; i < frame.count; i++) {
            if (baseArr[i * 3 + frame.thickAxis]! > PLANTAR_Z_MAX_MM) continue;
            const d = Math.abs(modArr[i * 3 + frame.thickAxis]! - baseArr[i * 3 + frame.thickAxis]!);
            if (d > maxDrift) maxDrift = d;
        }
        console.log(`[ARCH-WALL] HC-1 plantar maxDrift=${maxDrift.toFixed(4)}`);
        expect(maxDrift).toBeLessThan(0.05);
        mod.dispose();
    });

    test("export path: arch+depth+width closes solid (IdeaFormer proxy)", () => {
        const field = correctionField({
            archHeightMm: 10,
            heelCupDepthMm: 4,
            heelCupWidthMm: 5,
        });
        field.thicknessMm = 8;
        console.log("[ARCH-WALL-QA] export start", {
            topN: frame.topVertexCount,
            arch: 10,
            depth: 4,
            width: 5,
        });
        const closed = applyBaseModifiersWithSidewall(baseGeo, field);
        const v = validateManifold(closed);
        const count = closed.getAttribute("position")!.count;
        console.log("[ARCH-WALL-QA] export result", {
            vertexCount: count,
            topVertexCount: frame.topVertexCount,
            openEdges: v.openEdges,
            isWatertight: v.isWatertight,
        });
        expect(frame.topVertexCount).toBe(42134);
        expect(count).toBe(frame.count);
        expect(v.openEdges).toBe(0);
        closed.dispose();
    });
});
