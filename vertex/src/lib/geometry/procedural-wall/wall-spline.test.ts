// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import {
    evalClampedCubic,
    printSplineGates,
    SPLINE_KNOTS,
    type SplineStationInput,
    solveSplineStation,
    stationGates,
} from "./wall-spline";

function station(
    u: number,
    side: 1 | -1,
    H: number,
    Ls: number,
    tR: { s: number; z: number },
): SplineStationInput {
    const hl = Math.hypot(tR.s, tR.z) || 1;
    return {
        R: { x: 0, y: 40 * side, z: H },
        B: { x: Ls, y: 40 * side, z: 0 },
        h: { x: 1, y: 0 },
        tR: { x: tR.s / hl, y: 0, z: tR.z / hl },
        u,
        sideSign: side,
        planOutMm: 2,
        heightMm: H,
    };
}

describe("clamped cubic wall spline", () => {
    test("clamped cubic hits P0 at 0 and P5 at 1; G1 along P0P1", () => {
        const P = [
            { x: 0, y: 0, z: 10 },
            { x: -1, y: 0, z: 9 },
            { x: -2, y: 0, z: 7 },
            { x: -2, y: 0, z: 3 },
            { x: 1, y: 0, z: 0 },
            { x: 2, y: 0, z: 0 },
        ];
        const a = evalClampedCubic(P, 0, SPLINE_KNOTS);
        const b = evalClampedCubic(P, 1, SPLINE_KNOTS);
        expect(a.z).toBeCloseTo(10, 6);
        expect(b.z).toBeCloseTo(0, 6);
        expect(a.x).toBeCloseTo(0, 6);
        expect(b.x).toBeCloseTo(2, 6);
        const near = evalClampedCubic(P, 1e-3, SPLINE_KNOTS);
        const d = { x: near.x - a.x, y: near.y - a.y, z: near.z - a.z };
        const e = { x: P[1]!.x - P[0]!.x, y: P[1]!.y - P[0]!.y, z: P[1]!.z - P[0]!.z };
        const den = Math.hypot(d.x, d.y, d.z) * Math.hypot(e.x, e.y, e.z) || 1;
        expect((d.x * e.x + d.y * e.y + d.z * e.z) / den).toBeGreaterThan(0.99);
    });

    test("three Default-like stations: heel 0.12 med, arch 0.35 med, lat mid 0.55", () => {
        const cases: Array<{ name: string; input: SplineStationInput }> = [
            { name: "heel-med-u0.12", input: station(0.12, 1, 12, 2.2, { s: -1, z: -0.2 }) },
            { name: "arch-med-u0.35", input: station(0.35, 1, 12, 2.6, { s: -1, z: -0.18 }) },
            { name: "lat-mid-u0.55", input: station(0.55, -1, 8, 1.8, { s: -1, z: -0.2 }) },
        ];
        const misses: string[] = [];
        for (const c of cases) {
            const sol = solveSplineStation(c.input);
            const g = stationGates(sol, c.input.u, c.input.sideSign);
            printSplineGates({ ...g, u: c.input.u });
            console.log(
                `[RND-STATION-NAME] ${c.name}`,
                JSON.stringify({
                    gamma: Number(sol.gamma.toFixed(4)),
                    asym: Number(sol.asym.toFixed(4)),
                    a: Number(sol.a.toFixed(4)),
                    sagFrac: Number(sol.sagFrac.toFixed(4)),
                    peak: Number(sol.peakZFrac.toFixed(4)),
                    g1R: Number(sol.g1RDeg.toFixed(4)),
                    seamB: Number(sol.seamBDeg.toFixed(4)),
                    infl: sol.infl,
                    convex: sol.convex,
                    inset: Number(sol.insetMin.toFixed(4)),
                    plan: Number(sol.planOffset.toFixed(4)),
                    turn: Number(sol.maxTurnDeg.toFixed(3)),
                    poly: sol.fallbackStraight,
                    misses: g.misses,
                }),
            );
            if (!g.pass) misses.push(`${c.name}: ${g.misses.join(",")}`);
        }
        expect(misses).toEqual([]);
    });
});
