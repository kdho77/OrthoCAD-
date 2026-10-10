// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import type { HermiteStation } from "./loft";
import {
    adjustPatternForClearance,
    allowedLeanRad,
    assertPostLoftGates,
    assertPreLoftStations,
    columnInsetSkew,
    fairedPlantarFromStock,
    LEAN_INSET_MM,
    LEAN_MAX_DEG,
    MIN_INSET_FLOOR_MM,
    minInsetForLeanMm,
    POSTLOFT_DIHEDRAL_MAX_DEG,
    shiftPatternByRimFollow,
    signedRimInsetMm,
    stockTargetsForFairedPattern,
} from "./station-gates";

function oval(rx: number, ry: number, n = 48): Array<{ x: number; y: number; z: number }> {
    return Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2;
        return { x: rx * Math.cos(a), y: ry * Math.sin(a), z: 0 };
    });
}

function station(
    R: { x: number; y: number; z: number },
    B: { x: number; y: number; z: number },
): HermiteStation {
    const dx = B.x - R.x;
    const dy = B.y - R.y;
    const len = Math.hypot(dx, dy) || 1;
    return {
        outline: B,
        rim: R,
        n: { x: dx / len, y: dy / len },
        u: 0,
    };
}

describe("station-gates", () => {
    test("min inset is 1 mm and shrinks when lean is allowed", () => {
        const vertical = minInsetForLeanMm(0.5, 2, 0);
        const leaned = minInsetForLeanMm(0.5, 2, allowedLeanRad(LEAN_INSET_MM + 1));
        expect(vertical).toBeCloseTo(2.5, 5);
        expect(leaned).toBeLessThan(vertical);
        expect(leaned).toBeGreaterThanOrEqual(MIN_INSET_FLOOR_MM);
        expect((allowedLeanRad(LEAN_INSET_MM + 0.1) * 180) / Math.PI).toBeCloseTo(LEAN_MAX_DEG, 5);
        expect(allowedLeanRad(LEAN_INSET_MM)).toBe(0);
    });

    test("stock targets keep insets >8 mm and pull outside points in", () => {
        const rim = oval(40, 20);
        const stock = oval(42, 22).map((p, i) => (i === 8 ? { x: 20, y: 0, z: 0 } : p));
        const targets = stockTargetsForFairedPattern(stock, rim, 0.5, 0.7);
        expect(signedRimInsetMm(targets[8]!, rim)).toBeGreaterThan(8);
        let outside = 0;
        for (const p of targets) {
            if (signedRimInsetMm(p, rim) < 0) outside++;
        }
        expect(outside).toBe(0);
    });

    test("faired stock plantar stays inside the rim by the floor inset", () => {
        const rim = oval(40, 20, 64);
        const stock = oval(44, 24, 64);
        const samples = fairedPlantarFromStock({
            stock,
            rim,
            r1: 0.5,
            r2: 0.7,
        });
        expect(samples.length).toBeGreaterThan(80);
        let minIn = Infinity;
        for (const p of samples) minIn = Math.min(minIn, signedRimInsetMm(p, rim));
        expect(minIn).toBeGreaterThanOrEqual(MIN_INSET_FLOOR_MM - 1e-3);
    });

    test("PRE-LOFT names the failing station", () => {
        const rim = oval(30, 16, 12);
        const goodB = oval(26, 13, 12);
        const stations = rim.map((R, i) => station({ ...R, z: 8 }, { ...goodB[i]!, z: 0 }));
        stations[3]!.outline = { ...rim[3]!, x: rim[3]!.x + 4, z: 0 };
        expect(() => assertPreLoftStations(stations, 0.5, 0.7)).toThrow(/\[S1-PRELOFT\].*\[3\]/);
    });

    test("POST-LOFT fails on dihedral, crossings, or inward faces", () => {
        const ok = {
            maxSignedFoldDeg: 20,
            columnCrossings: 0,
            inwardWallFaces: 0,
        };
        expect(() => assertPostLoftGates(ok as Parameters<typeof assertPostLoftGates>[0])).not.toThrow();
        expect(() =>
            assertPostLoftGates({
                ...ok,
                maxSignedFoldDeg: POSTLOFT_DIHEDRAL_MAX_DEG + 1,
            } as Parameters<typeof assertPostLoftGates>[0]),
        ).toThrow(/\[S1-POSTLOFT\].*signed-dihedral/);
        expect(() =>
            assertPostLoftGates({ ...ok, columnCrossings: 2 } as Parameters<typeof assertPostLoftGates>[0]),
        ).toThrow(/crossings=2/);
        expect(() =>
            assertPostLoftGates({ ...ok, inwardWallFaces: 1 } as Parameters<typeof assertPostLoftGates>[0]),
        ).toThrow(/inward-faces=1/);
    });

    test("column inset is positive when B sits inside the outward rim normal", () => {
        const R = { x: 10, y: 0, z: 4 };
        const B = { x: 7, y: 0, z: 0 };
        const { insetMm, skewMm } = columnInsetSkew(R, B, { x: 1, y: 0 });
        expect(insetMm).toBeCloseTo(3, 6);
        expect(skewMm).toBeCloseTo(0, 6);
    });

    test("clearance QP names the violating stations and leaves a valid loop alone", () => {
        const rim = oval(40, 20, 48);
        const ok = oval(30, 14, 48);
        const clean = adjustPatternForClearance({ pattern: ok, rim, r1: 0.5, r2: 0.7 });
        expect(clean.adjusted).toBe(false);
        expect(clean.flag).toBeNull();
        const tight = oval(39.6, 19.6, 48);
        const hit = adjustPatternForClearance({ pattern: tight, rim, r1: 0.5, r2: 0.7 });
        expect(hit.adjusted).toBe(true);
        expect(hit.stations.length).toBeGreaterThan(0);
        expect(hit.flag).toMatch(/^pattern adjusted for clearance at /);
        let minIn = Infinity;
        for (const p of hit.loop) minIn = Math.min(minIn, signedRimInsetMm(p, rim));
        expect(minIn).toBeGreaterThanOrEqual(MIN_INSET_FLOOR_MM - 1e-3);
    });

    test("followFactor 0 keeps B fixed and 1 tracks the rim plan displacement", () => {
        const rim = oval(40, 20, 32);
        const pattern = oval(30, 15, 32);
        const rimAfter = rim.map((p) => ({ x: p.x + 3, y: p.y - 1, z: 0 }));
        const frozen = shiftPatternByRimFollow(pattern, rim, rimAfter, 0);
        expect(frozen[0]!.x).toBeCloseTo(pattern[0]!.x, 6);
        expect(frozen[0]!.y).toBeCloseTo(pattern[0]!.y, 6);
        const linked = shiftPatternByRimFollow(pattern, rim, rimAfter, 1);
        expect(linked[0]!.x).toBeCloseTo(pattern[0]!.x + 3, 5);
        expect(linked[0]!.y).toBeCloseTo(pattern[0]!.y - 1, 5);
        const half = shiftPatternByRimFollow(pattern, rim, rimAfter, 0.5);
        expect(half[4]!.x).toBeCloseTo(pattern[4]!.x + 1.5, 5);
    });
});
