// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import {
    chordOffsetAtMid,
    clampWeightForChordOffset,
    conicRowCountByTurning,
    evalRationalQuadratic,
    g1ControlPoint,
    g1OfConic,
    hybridBulgeAt,
    intersectTangentLines,
    midStyleWeight,
    planBoundsOf,
    resolveWallStyleParams,
    sampleConicByArcLength,
    sampleWallMidStyle,
    stationBulge,
    WALL_BULGE_OFFSET_FRAC,
    WALL_BULGE_OFFSET_MAX_MM,
    WALL_MID_TURN_MAX_DEG,
    WALL_W_MAX,
} from "./wall-style";

describe("wall style mid-piece", () => {
    test("resolveWallStyleParams clamps bulge and planOut", () => {
        const p = resolveWallStyleParams({ style: "round", bulge: 1.4, planOutMm: 9 });
        expect(p.bulge).toBe(1);
        expect(p.planOutMm).toBe(4);
        expect(p.forefootRound).toBe(true);
    });

    test("hybrid bulge is 0 at the heel and full after the switch", () => {
        expect(hybridBulgeAt(0.05, 1, 250, 0.6)).toBeLessThan(1e-6);
        expect(hybridBulgeAt(0.55, 1, 250, 0.6)).toBeCloseTo(0.6, 6);
        expect(hybridBulgeAt(0.05, -1, 250, 0.6)).toBeLessThan(1e-6);
        expect(hybridBulgeAt(0.29, -1, 250, 0.6)).toBeGreaterThan(hybridBulgeAt(0.29, 1, 250, 0.6));
    });

    test("mid-style weight is 0 on short walls and capped at 0.9", () => {
        expect(midStyleWeight(2, 0.6)).toBe(0);
        expect(midStyleWeight(20, 1)).toBe(WALL_W_MAX);
        expect(midStyleWeight(12, 0.6)).toBeCloseTo(WALL_W_MAX, 6);
    });

    test("rational quadratic is G1 at E and F when M is the tangent intersection", () => {
        const E = { x: 0, y: 0, z: 8 };
        const F = { x: 0, y: 0, z: 2 };
        const tE = { x: 1, y: 0, z: -1 };
        const tF = { x: -1, y: 0, z: -1 };
        const M = intersectTangentLines(E, tE, F, tF);
        expect(M).not.toBeNull();
        const a = evalRationalQuadratic(E, M!, F, 0.6, 0.02);
        const b = evalRationalQuadratic(E, M!, F, 0.6, 0.98);
        const dE = { x: a.x - E.x, y: a.y - E.y, z: a.z - E.z };
        const dF = { x: F.x - b.x, y: F.y - b.y, z: F.z - b.z };
        const ang = (u: typeof dE, v: typeof tE): number => {
            const du = Math.hypot(u.x, u.y, u.z) || 1;
            const dv = Math.hypot(v.x, v.y, v.z) || 1;
            const c = (u.x * v.x + u.y * v.y + u.z * v.z) / (du * dv);
            return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
        };
        expect(ang(dE, tE)).toBeLessThan(1);
        expect(ang(dF, tF)).toBeLessThan(1);
    });

    test("chord offset cap and plan bound shrink w", () => {
        const E = { x: 0, y: 0, z: 10 };
        const F = { x: 0, y: 0, z: 2 };
        const M = { x: 8, y: 0, z: 6 };
        const maxOff = Math.min(WALL_BULGE_OFFSET_FRAC * 8, WALL_BULGE_OFFSET_MAX_MM);
        const w = clampWeightForChordOffset(E, M, F, 0.9, maxOff);
        expect(chordOffsetAtMid(E, M, F, w)).toBeLessThanOrEqual(maxOff + 1e-6);
        const pts = sampleWallMidStyle(
            E,
            F,
            { x: 1, y: 0, z: 0 },
            { x: -1, y: 0, z: 0 },
            { x: 0, y: 0, z: 12 },
            6,
            12,
            { x: 1, y: 0 },
            resolveWallStyleParams({ style: "round", bulge: 0.6, planOutMm: 2 }),
            0.6,
        );
        const bound = planBoundsOf(pts.pts, { x: 0, y: 0, z: 12 }, F, { x: 1, y: 0 }, 2);
        expect(bound.insetMin).toBeGreaterThanOrEqual(-1e-6);
        expect(bound.offsetMax).toBeLessThanOrEqual(2 + 1e-6);
    });

    test("parallel end tangents stay G1 and do not invent an off-tangent M", () => {
        const E = { x: 0, y: 0, z: 10 };
        const F = { x: 0, y: 0, z: 2 };
        const tE = { x: 0, y: 0, z: -1 };
        const tF = { x: 0, y: 0, z: 1 };
        const pts = sampleWallMidStyle(
            E,
            F,
            tE,
            tF,
            { x: 0, y: 0, z: 12 },
            6,
            14,
            { x: 1, y: 0 },
            resolveWallStyleParams({ style: "round", bulge: 0.6, planOutMm: 2 }),
            0.6,
        );
        const ctrl = g1ControlPoint(E, tE, F, tF);
        expect(ctrl).not.toBeNull();
        const g1 = g1OfConic(E, ctrl!.M, F, tE, tF);
        expect(g1.e).toBeLessThan(1);
        expect(pts.M).not.toBeNull();
        expect(g1OfConic(E, pts.M!, F, tE, tF).e).toBeLessThan(1);
    });

    test("G1 M stays on the E/F tangents; bounds shrink w only", () => {
        const E = { x: 0, y: 0, z: 14 };
        const F = { x: 0, y: 0, z: 2 };
        const tE = { x: 1, y: 0, z: -1 };
        const tF = { x: 1, y: 0, z: 1 };
        const ctrl = g1ControlPoint(E, tE, F, tF);
        expect(ctrl).not.toBeNull();
        const pts = sampleWallMidStyle(
            E,
            F,
            tE,
            tF,
            { x: 0, y: 0, z: 16 },
            8,
            14,
            { x: 1, y: 0 },
            resolveWallStyleParams({ style: "round", bulge: 0.6, planOutMm: 2 }),
            0.6,
        );
        expect(pts.M).not.toBeNull();
        const g1 = g1OfConic(E, pts.M!, F, tE, tF);
        expect(g1.e).toBeLessThan(1);
        expect(g1.f).toBeLessThan(1);
        expect(pts.planOffsetMm ?? 0).toBeLessThanOrEqual(2 + 1e-6);
        const bound = Math.min(WALL_BULGE_OFFSET_FRAC * 12, WALL_BULGE_OFFSET_MAX_MM);
        expect(pts.chordOffsetMm ?? 0).toBeLessThanOrEqual(bound + 1e-6);
    });

    test("conic rows densify until turning is <= 4 deg", () => {
        const E = { x: 0, y: 0, z: 14 };
        const F = { x: 0, y: 0, z: 2 };
        const M = { x: 6, y: 0, z: 8 };
        const n = conicRowCountByTurning(E, M, F, 0.9, WALL_MID_TURN_MAX_DEG);
        expect(n).toBeGreaterThan(4);
        const pts = [{ x: 0, y: 0, z: 14 }, ...sampleConicByArcLength(E, M, F, 0.9, n)];
        let max = 0;
        for (let i = 1; i < pts.length - 1; i++) {
            const a = pts[i]!;
            const b = pts[i - 1]!;
            const c = pts[i + 1]!;
            const u = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
            const v = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
            const du = Math.hypot(u.x, u.y, u.z) || 1;
            const dv = Math.hypot(v.x, v.y, v.z) || 1;
            const ang =
                (Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y + u.z * v.z) / (du * dv)))) *
                    180) /
                Math.PI;
            max = Math.max(max, Math.min(ang, 180 - ang));
        }
        expect(max).toBeLessThanOrEqual(WALL_MID_TURN_MAX_DEG + 0.05);
    });

    test("stationBulge is 0 on straight and ramps on hybrid", () => {
        const straight = resolveWallStyleParams({ style: "straight" });
        const hybrid = resolveWallStyleParams({ style: "hybrid", bulge: 0.6 });
        expect(stationBulge(straight, 0.8, 1, 250)).toBe(0);
        expect(stationBulge(hybrid, 0.05, 1, 250)).toBeLessThan(1e-6);
        expect(stationBulge(hybrid, 0.7, 1, 250)).toBeCloseTo(0.6, 6);
    });
});
