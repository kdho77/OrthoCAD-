// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import {
    buildSplineDensityTable,
    denseCPrime0,
    enforceMonotoneF,
    evalClampedCubic,
    g1CPrime0Deg,
    invertDensityW,
    printSplineGates,
    SPLINE_KNOTS,
    type SplineStationInput,
    sampleSplineRingByW,
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

function printCorner(name: string, sol: ReturnType<typeof solveSplineStation>): void {
    const row = {
        o: Number(sol.o.toFixed(4)),
        zy: Number(sol.zy.toFixed(4)),
        zx: Number(sol.zx.toFixed(4)),
        a: Number(sol.a.toFixed(4)),
        sag: Number(sol.sagitta.toFixed(4)),
        sagH: Number(sol.sagFrac.toFixed(4)),
        peakH: Number(sol.peakZFrac.toFixed(4)),
        plan: Number(sol.planOffset.toFixed(4)),
        convex: sol.convex,
        infl: sol.inflCount,
        tRAngle: Number(sol.tRAngleDeg.toFixed(3)),
        steep: sol.steep,
        poly: sol.fallbackStraight,
    };
    console.log(`[RND-CORNER] ${name}`, JSON.stringify(row));
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
        const c0 = denseCPrime0(P);
        expect(c0.x * e.x + c0.y * e.y + c0.z * e.z).toBeGreaterThan(0);
        expect(g1CPrime0Deg(P, { x: -1, y: 0, z: -1 }, { x: 1, y: 0 })).toBeLessThan(1);
    });

    test("corner-cut box expected: H12/Ls2 15% and H8 20%", () => {
        const h12 = solveSplineStation(station(0, 1, 12, 2, { s: -1, z: -0.2 }));
        printCorner("H12-Ls2-15", h12);
        expect(h12.o).toBeCloseTo(1.11, 1);
        expect(h12.sagitta).toBeCloseTo(1.8, 1);
        expect(h12.peakZFrac).toBeCloseTo(0.45, 1);
        expect(h12.planOffset).toBeCloseTo(1.06, 1);

        const h8In = station(0.55, 1, 8, 2, { s: -1, z: -0.2 });
        h8In.targetSagMm = 0.2 * 8;
        const h8 = solveSplineStation(h8In);
        printCorner("H8-20", h8);
        expect(h8.o).toBeCloseTo(0.99, 1);
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
            printCorner(c.name, sol);
            if (!g.pass) misses.push(`${c.name}: ${g.misses.join(",")}`);
        }
        expect(misses).toEqual([]);
    });

    test("W(u) table inverts k/N and keeps endpoints", () => {
        const sol = solveSplineStation(station(0.35, 1, 12, 2.6, { s: -1, z: -0.18 }));
        const table = buildSplineDensityTable(sol.poly);
        expect(table.W[0]).toBe(0);
        expect(table.W[table.W.length - 1]).toBe(1);
        expect(table.L).toBeGreaterThan(1);
        const N = 20;
        const f = enforceMonotoneF(
            Array.from({ length: N + 1 }, (_, k) => k / N),
            N,
        );
        expect(f[0]).toBe(0);
        expect(f[N]).toBe(1);
        for (let k = 1; k <= N; k++) expect(f[k]!).toBeGreaterThanOrEqual(f[k - 1]! + 0.25 / N - 1e-12);
        const u0 = invertDensityW(table, 0);
        const u1 = invertDensityW(table, 1);
        expect(u0).toBe(0);
        expect(u1).toBe(1);
        const ring = sampleSplineRingByW([sol.poly, sol.poly], N, [sol.pts[0]!, sol.pts[0]!]);
        expect(ring.pts[0]!.length).toBe(N + 1);
        expect(ring.pts[0]![0]!.z).toBeCloseTo(sol.poly[0]!.z, 9);
        expect(ring.pts[0]![N]!.z).toBeCloseTo(sol.poly[sol.poly.length - 1]!.z, 9);
        expect(Math.abs(ring.f[0]![5]! - ring.f[1]![5]!)).toBeLessThanOrEqual(0.02);
    });
});
