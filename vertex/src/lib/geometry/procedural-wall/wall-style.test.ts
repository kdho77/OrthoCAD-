// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import {
    closestCubicT,
    cubicHasInflection,
    cubicRowCountByTurning,
    cubicRowCountByUniformT,
    evalCubicHermite,
    g1OfCubic,
    hermiteControls,
    hybridBulgeAt,
    lambdaFromTheta,
    midStyleLambda,
    planAngleDeg,
    planBoundsOf,
    resolveWallStyleParams,
    sampleCubicByTurning,
    sampleCubicUniformT,
    sampleWallMidStyle,
    stationBeta,
    stationBulge,
    thetaFromSagitta,
    uniformMidTValues,
    WALL_BETA_ARCH,
    WALL_BETA_H_CAP,
    WALL_BETA_HEEL,
    WALL_BULGE_OFFSET_MAX_MM,
    WALL_LAMBDA_MIN,
    WALL_MID_TURN_MAX_DEG,
    wallBetaAt,
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

    test("lambda is 1/3 at theta 0 and follows the circular-arc handle", () => {
        expect(lambdaFromTheta(0)).toBeCloseTo(WALL_LAMBDA_MIN, 6);
        expect(midStyleLambda(20, 0)).toBeCloseTo(WALL_LAMBDA_MIN, 6);
        const th = thetaFromSagitta(0.15, 1);
        expect(lambdaFromTheta(th)).toBeCloseTo(2 / (3 * (1 + Math.cos(th / 2))), 6);
        expect(wallBetaAt(0)).toBeCloseTo(WALL_BETA_HEEL, 6);
        expect(wallBetaAt(0.7)).toBeCloseTo(WALL_BETA_ARCH, 6);
        expect(stationBeta(resolveWallStyleParams({ style: "straight" }), 0.6, 1, 250)).toBe(0);
        expect(stationBeta(resolveWallStyleParams({ style: "hybrid" }), 0.05, 1, 250)).toBeLessThan(1e-6);
    });

    test("uniform-t samples sit on the Hermite parameter", () => {
        const E = { x: 0, y: 0, z: 10 };
        const F = { x: 0, y: 0, z: 0 };
        const tE = { x: 1, y: 0, z: -1 };
        const tF = { x: -1, y: 0, z: -1 };
        const ctrl = hermiteControls(E, F, tE, tF, lambdaFromTheta(thetaFromSagitta(0.15, 10)));
        const pts = sampleCubicUniformT(ctrl.P0, ctrl.P1, ctrl.P2, ctrl.P3, 4);
        expect(pts).toHaveLength(4);
        expect(pts[3]!.z).toBeCloseTo(0, 6);
        const mid = sampleCubicUniformT(ctrl.P0, ctrl.P1, ctrl.P2, ctrl.P3, 2)[0]!;
        expect(mid.x).toBeGreaterThan(0);
        expect(uniformMidTValues(4)).toEqual([0.25, 0.5, 0.75, 1]);
        const p = evalCubicHermite(ctrl.P0, ctrl.P1, ctrl.P2, ctrl.P3, 0.4);
        expect(closestCubicT(ctrl.P0, ctrl.P1, ctrl.P2, ctrl.P3, p)).toBeCloseTo(0.4, 3);
        const nU = cubicRowCountByUniformT(ctrl.P0, ctrl.P1, ctrl.P2, ctrl.P3, tE, tF, WALL_MID_TURN_MAX_DEG);
        const uni = [E, ...sampleCubicUniformT(ctrl.P0, ctrl.P1, ctrl.P2, ctrl.P3, nU)];
        let maxU = 0;
        for (let i = 1; i < uni.length - 1; i++) {
            const a = uni[i]!;
            const b = uni[i - 1]!;
            const c = uni[i + 1]!;
            const u = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
            const v = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
            const du = Math.hypot(u.x, u.y, u.z) || 1;
            const dv = Math.hypot(v.x, v.y, v.z) || 1;
            const ang =
                (Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y + u.z * v.z) / (du * dv)))) *
                    180) /
                Math.PI;
            maxU = Math.max(maxU, Math.min(ang, 180 - ang));
        }
        expect(maxU).toBeLessThanOrEqual(WALL_MID_TURN_MAX_DEG + 0.05);
    });

    test("cubic Hermite is G1 at E and F even when the tangent rays are skew", () => {
        const E = { x: 0, y: 0, z: 10 };
        const F = { x: 0, y: 2, z: 2 };
        const tE = { x: 1, y: 0, z: -1 };
        const tF = { x: 0, y: 1, z: -1 };
        const mid = sampleWallMidStyle(
            E,
            F,
            tE,
            tF,
            { x: 0, y: 0, z: 12 },
            8,
            14,
            { x: 1, y: 0 },
            resolveWallStyleParams({ style: "round", bulge: 0.6, planOutMm: 2 }),
            0.6,
        );
        const g1 = g1OfCubic(E, mid.P1, mid.P2, F, tE, tF);
        expect(g1.e).toBeLessThan(1e-6);
        expect(g1.f).toBeLessThan(1e-6);
        expect(mid.g1EDeg ?? 1).toBeLessThan(0.1);
        expect(mid.g1FDeg ?? 1).toBeLessThan(0.1);
        expect(mid.flagged).toBeFalsy();
        const dE = { x: mid.P1.x - E.x, y: mid.P1.y - E.y, z: mid.P1.z - E.z };
        const dF = { x: F.x - mid.P2.x, y: F.y - mid.P2.y, z: F.z - mid.P2.z };
        expect(g1OfCubic(E, mid.P1, mid.P2, F, dE, dF).e).toBeLessThan(1e-5);
        expect(g1OfCubic(E, mid.P1, mid.P2, F, dE, dF).f).toBeLessThan(1e-5);
    });

    test("P1 and P2 stay on the end-tangent rays; bounds only shrink lambda", () => {
        const E = { x: 0, y: 0, z: 14 };
        const F = { x: 0, y: 0, z: 2 };
        const tE = { x: 1, y: 0, z: -1 };
        const tF = { x: -1, y: 0, z: -1 };
        const mid = sampleWallMidStyle(
            E,
            F,
            tE,
            tF,
            { x: 0, y: 0, z: 16 },
            8,
            14,
            { x: 1, y: 0 },
            resolveWallStyleParams({ style: "round", bulge: 0.6, planOutMm: 4 }),
            0.6,
        );
        const eDir = { x: mid.P1.x - E.x, y: mid.P1.y - E.y, z: mid.P1.z - E.z };
        const fDir = { x: F.x - mid.P2.x, y: F.y - mid.P2.y, z: F.z - mid.P2.z };
        expect(g1OfCubic(E, mid.P1, mid.P2, F, tE, tF).e).toBeLessThan(1e-6);
        expect(g1OfCubic(E, mid.P1, mid.P2, F, tE, tF).f).toBeLessThan(1e-6);
        expect(Math.hypot(eDir.y, fDir.y)).toBeLessThan(1e-9);
        expect(mid.lambda).toBeGreaterThanOrEqual(WALL_LAMBDA_MIN - 1e-9);
        expect(mid.planOffsetMm ?? 0).toBeLessThanOrEqual(4 + 1e-6);
        const bound = Math.min(WALL_BETA_H_CAP * 12, WALL_BULGE_OFFSET_MAX_MM);
        expect(mid.chordOffsetMm ?? 0).toBeLessThanOrEqual(bound + 1e-6);
        const plan = planBoundsOf(mid.pts, { x: 0, y: 0, z: 16 }, F, { x: 1, y: 0 }, 4);
        expect(plan.insetMin).toBeGreaterThanOrEqual(-1e-6);
        expect(plan.offsetMax).toBeLessThanOrEqual(4 + 1e-6);
    });

    test("parallel end tangents still build a cubic (no chord fallback)", () => {
        const E = { x: 0, y: 0, z: 10 };
        const F = { x: 0, y: 0, z: 2 };
        const tE = { x: 0, y: 0, z: -1 };
        const tF = { x: 0, y: 0, z: -1 };
        const mid = sampleWallMidStyle(
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
        expect(mid.P1.z).toBeLessThan(E.z);
        expect(mid.P2.z).toBeGreaterThan(F.z);
        expect(mid.flagged).toBeFalsy();
        expect(mid.g1EDeg ?? 1).toBeLessThan(0.1);
        expect(mid.g1FDeg ?? 1).toBeLessThan(0.1);
    });

    test("cubic rows densify until turning is <= 4 deg", () => {
        const E = { x: 0, y: 0, z: 14 };
        const F = { x: 0, y: 0, z: 2 };
        const tE = { x: 1, y: 0, z: -1 };
        const tF = { x: -1, y: 0, z: -1 };
        const ctrl = hermiteControls(E, F, tE, tF, 0.5);
        const n = cubicRowCountByTurning(ctrl.P0, ctrl.P1, ctrl.P2, ctrl.P3, tE, tF, WALL_MID_TURN_MAX_DEG);
        expect(n).toBeGreaterThan(4);
        const pts = [E, ...sampleCubicByTurning(ctrl.P0, ctrl.P1, ctrl.P2, ctrl.P3, n)];
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
        expect(cubicHasInflection(ctrl.P0, ctrl.P1, ctrl.P2, ctrl.P3, tE, tF, { x: 1, y: 0 })).toBe(false);
    });

    test("straight mid-piece stays a ruled line", () => {
        const E = { x: 0, y: 0, z: 10 };
        const F = { x: 1, y: 0, z: 2 };
        const mid = sampleWallMidStyle(
            E,
            F,
            { x: 0, y: 0, z: -1 },
            { x: 0, y: 0, z: -1 },
            { x: 0, y: 0, z: 12 },
            4,
            12,
            { x: 1, y: 0 },
            resolveWallStyleParams({ style: "straight" }),
            0.6,
        );
        expect(mid.lambda).toBeCloseTo(WALL_LAMBDA_MIN, 6);
        expect(mid.pts).toHaveLength(4);
        expect(mid.pts[1]!.x).toBeCloseTo(0.5, 6);
        expect(mid.pts[1]!.z).toBeCloseTo(6, 6);
    });

    test("tiny nearly-straight wiggle is not [RND-INFL]; a two-sided lobe is", () => {
        const E = { x: 133.837, y: 42.692, z: 7.923 };
        const F = { x: 134.021, y: 40.423, z: 1.08 };
        const tE = { x: 0.05, y: -0.3264, z: -0.9439 };
        const tF = { x: 0.0801, y: -0.3007, z: -0.9504 };
        const tiny = hermiteControls(E, F, tE, tF, WALL_LAMBDA_MIN);
        expect(cubicHasInflection(tiny.P0, tiny.P1, tiny.P2, tiny.P3, tE, tF, { x: 1, y: 0 })).toBe(false);
        const A = { x: 0, y: 0, z: 10 };
        const B = { x: 0, y: 0, z: 0 };
        const sE = { x: 1, y: 0, z: -0.3 };
        const sF = { x: 1, y: 0, z: -0.3 };
        const ess = hermiteControls(A, B, sE, sF, 0.55);
        expect(cubicHasInflection(ess.P0, ess.P1, ess.P2, ess.P3, sE, sF, { x: 1, y: 0 })).toBe(true);
    });

    test("plan angle is the xy angle between tE and tF", () => {
        expect(planAngleDeg({ x: 1, y: 0, z: -1 }, { x: 0, y: 1, z: -1 })).toBeCloseTo(90, 4);
        expect(planAngleDeg({ x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: -4 })).toBeCloseTo(0, 4);
    });

    test("stationBulge is 0 on straight and ramps on hybrid", () => {
        const straight = resolveWallStyleParams({ style: "straight" });
        const hybrid = resolveWallStyleParams({ style: "hybrid", bulge: 0.6 });
        expect(stationBulge(straight, 0.8, 1, 250)).toBe(0);
        expect(stationBulge(hybrid, 0.05, 1, 250)).toBeLessThan(1e-6);
        expect(stationBulge(hybrid, 0.7, 1, 250)).toBeCloseTo(0.6, 6);
    });
});
