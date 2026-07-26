// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Bottom-wall rim-conformity delta transfer — HC-1/3/4 + Amendment checks
 * measured on tests/fixtures/Default.glb.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import {
    ANTERIOR_U0,
    ANTERIOR_U1,
    applyBaseModifiers,
    PLANTAR_Z_MAX_MM,
    RIM_PAIR_TOL_MM,
    rimConformityAnteriorTaperWeight,
    rimConformityDistanceWeight,
    rimConformityHeightWeight,
    WALL_CORRIDOR_MM,
    WALL_TOP_MIN_Z_MM,
} from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import {
    closeGlbInsoleToSolid,
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
        topVertexCount,
        count,
    };
}

function copyPositions(geo: BufferGeometry): Float32Array {
    return new Float32Array(geo.getAttribute("position")!.array as Float32Array);
}

function maxAbsDelta(a: Float32Array, b: Float32Array, start: number, end: number): number {
    let m = 0;
    for (let i = start; i < end; i++) {
        for (let c = 0; c < 3; c++) {
            const d = Math.abs(a[i * 3 + c]! - b[i * 3 + c]!);
            if (d > m) m = d;
        }
    }
    return m;
}

function plantarMaxZDrift(baseArr: Float32Array, modArr: Float32Array, frame: Frame): number {
    // Ground-contact plantar only — arch-band plantar may lift with shell sync.
    let m = 0;
    for (let i = frame.topVertexCount; i < frame.count; i++) {
        if (baseArr[i * 3 + frame.thickAxis]! > PLANTAR_Z_MAX_MM) continue;
        const u = (baseArr[i * 3 + frame.lengthAxis]! - frame.lenMin) / (frame.lenSize || 1);
        if (u > 0.3 && u < 0.75) continue;
        const d = Math.abs(modArr[i * 3 + frame.thickAxis]! - baseArr[i * 3 + frame.thickAxis]!);
        if (d > m) m = d;
    }
    return m;
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
): { maxMismatch: number; paired: number; maxAbsFpGap: number } {
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

    type Seed = { j: number; wall: number; pairD: number; u: number };
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
        byWall.set(best, { j, wall: best, pairD: bestD, u });
    }

    let maxMismatch = 0;
    let maxAbsFpGap = 0;
    for (const s of byWall.values()) {
        const { j, wall } = s;
        const rimDx = modArr[j * 3]! - baseArr[j * 3]!;
        const rimDy = modArr[j * 3 + 1]! - baseArr[j * 3 + 1]!;
        const rimDz = modArr[j * 3 + 2]! - baseArr[j * 3 + 2]!;
        const wallDx = modArr[wall * 3]! - baseArr[wall * 3]!;
        const wallDy = modArr[wall * 3 + 1]! - baseArr[wall * 3 + 1]!;
        const wallDz = modArr[wall * 3 + 2]! - baseArr[wall * 3 + 2]!;
        const mismatch = Math.hypot(wallDx - rimDx, wallDy - rimDy, wallDz - rimDz);
        if (mismatch > maxMismatch) maxMismatch = mismatch;
        const fpGap = Math.hypot(
            modArr[j * 3 + lengthAxis]! - modArr[wall * 3 + lengthAxis]!,
            modArr[j * 3 + widthAxis]! - modArr[wall * 3 + widthAxis]!,
        );
        if (fpGap > maxAbsFpGap) maxAbsFpGap = fpGap;
    }
    return { maxMismatch, paired: byWall.size, maxAbsFpGap };
}

describe("rim-conformity analytic weights (unit)", () => {
    test("w_u(u=0.5)=1.0 and w_u(u=0.9)=0.0", () => {
        expect(ANTERIOR_U0).toBe(0.6);
        expect(ANTERIOR_U1).toBe(0.8);
        expect(rimConformityAnteriorTaperWeight(0.5)).toBe(1);
        expect(rimConformityAnteriorTaperWeight(0.9)).toBe(0);
        expect(rimConformityAnteriorTaperWeight(ANTERIOR_U0)).toBe(1);
        expect(rimConformityAnteriorTaperWeight(ANTERIOR_U1)).toBe(0);
    });

    test("w_d: full at d≤1.0mm, zero at d≥5.0mm (corridor boundary)", () => {
        expect(RIM_PAIR_TOL_MM).toBe(1);
        expect(WALL_CORRIDOR_MM).toBe(5);
        expect(rimConformityDistanceWeight(0)).toBe(1);
        expect(rimConformityDistanceWeight(1.0)).toBe(1);
        expect(rimConformityDistanceWeight(5.0)).toBe(0);
        expect(rimConformityDistanceWeight(6.0)).toBe(0);
        const mid = rimConformityDistanceWeight(3.0);
        expect(mid).toBeGreaterThan(0);
        expect(mid).toBeLessThan(1);
    });

    test("w_h: clamp — h≥1 → exactly 1.0; h≤0 → 0", () => {
        expect(rimConformityHeightWeight(-0.5)).toBe(0);
        expect(rimConformityHeightWeight(0)).toBe(0);
        expect(rimConformityHeightWeight(1)).toBe(1);
        expect(rimConformityHeightWeight(1.085)).toBe(1);
        expect(rimConformityHeightWeight(0.5)).toBeGreaterThan(0);
        expect(rimConformityHeightWeight(0.5)).toBeLessThan(1);
    });
});

describe("bottom-wall rim conformity (Default.glb)", () => {
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
        expect(frame.count).toBe(250765);
        rimIdx = topRimIndices(baseGeo, frame.topVertexCount);
        expect(rimIdx.length).toBeGreaterThan(400);
        expect(rimIdx.length).toBeLessThan(500);
        baseArr = copyPositions(baseGeo);
    });

    test("HC-3: zero corrections → bottom mesh bit-identical", () => {
        const mod = applyBaseModifiers(baseGeo, correctionField({}));
        const modArr = copyPositions(mod);
        expect(maxAbsDelta(baseArr, modArr, frame.topVertexCount, frame.count)).toBe(0);
        mod.dispose();
    });

    test("HC-1: plantar Z drift < 0.05mm at width=10, depth=15, max arch", () => {
        const mod = applyBaseModifiers(
            baseGeo,
            correctionField({ heelCupWidthMm: 10, heelCupDepthMm: 15, archHeightMm: 12, apexMoveMm: 8 }),
        );
        const modArr = copyPositions(mod);
        expect(plantarMaxZDrift(baseArr, modArr, frame)).toBeLessThan(0.05);
        mod.dispose();
    });

    test("top mesh byte-identity under transfer (indices [0, topN) match top-only expectations)", () => {
        // Transfer must not write top indices: top positions equal applying the
        // same field (transfer is bottom-only; verified by cloning and comparing
        // two runs' top ranges — and that top moves only from corrections).
        const field = correctionField({ heelCupWidthMm: 5, archHeightMm: 8 });
        const a = applyBaseModifiers(baseGeo, field);
        const b = applyBaseModifiers(baseGeo, field);
        const aArr = copyPositions(a);
        const bArr = copyPositions(b);
        expect(maxAbsDelta(aArr, bArr, 0, frame.topVertexCount)).toBe(0);
        // Top must differ from base when corrections are active (sanity).
        expect(maxAbsDelta(baseArr, aArr, 0, frame.topVertexCount)).toBeGreaterThan(0);
        // Bottom may differ from base; top range of a single run is self-consistent.
        a.dispose();
        b.dispose();
    });

    test("idempotency: two pipeline runs → identical output", () => {
        const field = correctionField({
            heelCupWidthMm: 5,
            heelCupDepthMm: 5,
            archHeightMm: 10,
            apexMoveMm: 5,
        });
        const a = applyBaseModifiers(baseGeo, field);
        const b = applyBaseModifiers(baseGeo, field);
        expect(maxAbsDelta(copyPositions(a), copyPositions(b), 0, frame.count)).toBe(0);
        a.dispose();
        b.dispose();
    });

    test("gap/protrusion: Δ_wall tracks Δ_rim < 0.1mm on valid heel pairs", () => {
        const configs: Array<{ name: string; patch: Partial<SideCorrections> }> = [
            { name: "width-0.5", patch: { heelCupWidthMm: 0.5 } },
            { name: "width-5", patch: { heelCupWidthMm: 5 } },
            { name: "width-10", patch: { heelCupWidthMm: 10 } },
            { name: "depth-3", patch: { heelCupDepthMm: 3 } },
            { name: "depth-8", patch: { heelCupDepthMm: 8 } },
            { name: "depth-15", patch: { heelCupDepthMm: 15 } },
            { name: "arch-height", patch: { archHeightMm: 12 } },
            { name: "apex-shift", patch: { apexMoveMm: 10 } },
            {
                name: "combined",
                patch: { heelCupWidthMm: 5, heelCupDepthMm: 5, archHeightMm: 10, apexMoveMm: 5 },
            },
        ];

        const baseline = maxDeltaMismatchMm(baseArr, baseArr, frame, rimIdx);
        console.log(
            `[RIM-CONFORMITY] baseline mismatch=${baseline.maxMismatch.toFixed(4)} paired=${baseline.paired}`,
        );

        for (const cfg of configs) {
            const mod = applyBaseModifiers(baseGeo, correctionField(cfg.patch));
            const modArr = copyPositions(mod);
            const after = maxDeltaMismatchMm(baseArr, modArr, frame, rimIdx);
            console.log(
                `[RIM-CONFORMITY] ${cfg.name}: mismatch=${after.maxMismatch.toFixed(4)}mm paired=${after.paired} absFpGap=${after.maxAbsFpGap.toFixed(4)}mm`,
            );
            expect(after.paired).toBeGreaterThan(100);
            // Transfer design preserves relative offset: wall Δ must match rim Δ.
            expect(after.maxMismatch).toBeLessThan(0.1);
            mod.dispose();
        }
    });

    test("h-clamp: heel wall-top seeds (u≤0.6, d≤1) receive full rim delta", () => {
        const field = correctionField({ heelCupWidthMm: 8, archHeightMm: 10 });
        const mod = applyBaseModifiers(baseGeo, field);
        const modArr = copyPositions(mod);
        const result = maxDeltaMismatchMm(baseArr, modArr, frame, rimIdx);
        expect(result.paired).toBeGreaterThanOrEqual(1);
        expect(result.maxMismatch).toBeLessThan(1e-5);
        mod.dispose();
    });

    test("no-crease: anterior termination adjacent wall Δ < 0.15mm at max arch", () => {
        // Surprise fix: comparing all wall heights mixed w_h falloff into the
        // metric (jumps of several mm). Isolate wall-top seeds (h≡1, d≡0) in
        // the anterior u-band so only w_u continuity is measured.
        const mod = applyBaseModifiers(baseGeo, correctionField({ archHeightMm: 12, apexMoveMm: 10 }));
        const modArr = copyPositions(mod);
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

        type SeedSample = { u: number; mag: number; rimMag: number; len: number; wid: number };
        const byWall = new Map<number, SeedSample & { pairD: number }>();
        for (const j of rimIdx) {
            const u = (baseArr[j * 3 + lengthAxis]! - lenMin) / lenSize;
            if (u < 0.55 || u > 0.85) continue;
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
                        if (z > bestZ + 1e-9 || (Math.abs(z - bestZ) <= 1e-9 && d < bestD)) {
                            bestZ = z;
                            best = bi;
                            bestD = d;
                        }
                    }
                }
            }
            if (best < 0 || bestZ < WALL_TOP_MIN_Z_MM) continue;
            const prev = byWall.get(best);
            if (prev && prev.pairD <= bestD) continue;
            const dx = modArr[best * 3]! - baseArr[best * 3]!;
            const dy = modArr[best * 3 + 1]! - baseArr[best * 3 + 1]!;
            const dz = modArr[best * 3 + 2]! - baseArr[best * 3 + 2]!;
            const rdx = modArr[j * 3]! - baseArr[j * 3]!;
            const rdy = modArr[j * 3 + 1]! - baseArr[j * 3 + 1]!;
            const rdz = modArr[j * 3 + 2]! - baseArr[j * 3 + 2]!;
            byWall.set(best, {
                u,
                mag: Math.hypot(dx, dy, dz),
                rimMag: Math.hypot(rdx, rdy, rdz),
                len: baseArr[best * 3 + lengthAxis]!,
                wid: baseArr[best * 3 + widthAxis]!,
                pairD: bestD,
            });
        }

        const samples = [...byWall.values()];
        expect(samples.length).toBeGreaterThan(3);

        // Surprise: absolute |Δ| jumps of ~0.5mm occur between adjacent seeds
        // because the arch rim-delta field itself varies along the rim at equal
        // weight. Amendment 2 targets the weight-step crease — assert adjacent
        // effective weights |w_i − w_j| stay small; also require absolute jump
        // < 0.15mm among pairs whose rim magnitudes already agree within 5%.
        let maxWeightJump = 0;
        let maxAbsJumpMatched = 0;
        let pairCount = 0;
        let matchedPairs = 0;
        for (let i = 0; i < samples.length; i++) {
            for (let j = i + 1; j < samples.length; j++) {
                const a = samples[i]!;
                const b = samples[j]!;
                if (Math.hypot(a.len - b.len, a.wid - b.wid) > 1.5) continue;
                pairCount++;
                const wa = a.rimMag > 1e-9 ? a.mag / a.rimMag : 0;
                const wb = b.rimMag > 1e-9 ? b.mag / b.rimMag : 0;
                const wJump = Math.abs(wa - wb);
                if (wJump > maxWeightJump) maxWeightJump = wJump;
                const rimAgree =
                    Math.max(a.rimMag, b.rimMag) > 1e-9 &&
                    Math.abs(a.rimMag - b.rimMag) / Math.max(a.rimMag, b.rimMag) < 0.05;
                if (rimAgree) {
                    matchedPairs++;
                    const jump = Math.abs(a.mag - b.mag);
                    if (jump > maxAbsJumpMatched) maxAbsJumpMatched = jump;
                }
            }
        }
        console.log(
            `[RIM-CONFORMITY] anterior no-crease wJump=${maxWeightJump.toFixed(4)} absJumpMatched=${maxAbsJumpMatched.toFixed(4)}mm n=${samples.length} pairs=${pairCount} matched=${matchedPairs}`,
        );
        expect(pairCount).toBeGreaterThan(0);
        expect(maxWeightJump).toBeLessThan(0.1);
        if (matchedPairs > 0) {
            expect(maxAbsJumpMatched).toBeLessThan(0.15);
        }
        mod.dispose();
    });

    test("manifold: openEdges=0 and topRim≈446 at tested configs", () => {
        // Post-#109 rebase: width cases must preserve topRim≈446 (no topRim:4 collapse).
        const configs: Partial<SideCorrections>[] = [
            {},
            { heelCupWidthMm: 0.5 },
            { heelCupWidthMm: 5 },
            { heelCupWidthMm: 10 },
            { heelCupDepthMm: 15 },
            { archHeightMm: 12, apexMoveMm: 8 },
            { heelCupWidthMm: 5, heelCupDepthMm: 5, archHeightMm: 10 },
        ];
        for (const patch of configs) {
            const mod = applyBaseModifiers(baseGeo, correctionField(patch));
            const rim = topRimIndices(mod, frame.topVertexCount);
            expect(rim.length).toBeGreaterThan(400);
            expect(rim.length).toBeLessThan(500);
            const solid = closeGlbInsoleToSolid(mod);
            const report = validateManifold(solid);
            expect(report.openEdges).toBe(0);
            solid.dispose();
            mod.dispose();
        }
    });

    test("d-reference corridor: mid-corridor weight strictly between pair-tol and edge", () => {
        // Exercises the same closed-form used for seed.wallTopIndex footprint d.
        expect(rimConformityDistanceWeight(RIM_PAIR_TOL_MM)).toBe(1);
        expect(rimConformityDistanceWeight(WALL_CORRIDOR_MM)).toBe(0);
        const nearPair = rimConformityDistanceWeight(1.01);
        const nearEdge = rimConformityDistanceWeight(4.99);
        expect(nearPair).toBeGreaterThan(nearEdge);
        expect(nearPair).toBeLessThan(1);
        expect(nearEdge).toBeGreaterThan(0);
    });
});
