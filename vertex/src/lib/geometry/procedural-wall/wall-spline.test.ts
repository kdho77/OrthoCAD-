// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import {
    assertInversionOk,
    buildSplineDensityTable,
    columnChordsOk,
    controlPointsSpaced,
    denseCPrime0,
    enforceMonotoneF,
    evalClampedCubic,
    g1CPrime0Deg,
    invertDensityW,
    printSplineGates,
    SPLINE_FLAT_MM,
    SPLINE_KNOTS,
    type SplineStationInput,
    sampleSplineRingByW,
    solveSplineStation,
    splineOTarget,
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

    test("o is driven: heel 0.15 k(H) H 0.6, arch 0.20; H<3 is zero", () => {
        expect(splineOTarget(0, 12)).toBeCloseTo(1.08, 6);
        expect(splineOTarget(0.55, 8)).toBeCloseTo(0.2 * (5 / 9) ** 2 * (3 - 10 / 9) * 8 * 0.6, 6);
        expect(splineOTarget(0.9, 2)).toBe(0);

        const h12 = solveSplineStation(station(0, 1, 12, 2, { s: -1, z: -0.2 }));
        printCorner("H12-Ls2-15", h12);
        expect(h12.o).toBeCloseTo(1.08, 2);
        expect(h12.peakZFrac).toBeGreaterThanOrEqual(0.5 - 0.05);
        expect(h12.peakZFrac).toBeLessThanOrEqual(0.5 + 0.05);
        expect(h12.o).toBeLessThanOrEqual(2);

        const h8 = solveSplineStation(station(0.55, 1, 8, 2, { s: -1, z: -0.2 }));
        printCorner("H8-20", h8);
        expect(h8.o).toBeCloseTo(splineOTarget(0.55, 8), 2);
        expect(h8.o).toBeGreaterThan(0.05);
        expect(h8.a).toBeGreaterThan(0.05);

        const toe = solveSplineStation(station(0.9, 1, 2, 1, { s: -1, z: -0.1 }));
        printCorner("H2-toe", toe);
        expect(toe.o).toBeLessThan(SPLINE_FLAT_MM);
        expect(toe.a).toBeLessThan(SPLINE_FLAT_MM);
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
            const peakOnly = g.misses.every((m) => m.startsWith("peak"));
            const zyMaxed = sol.zy >= 0.6 - 1e-6;
            if (!g.pass && !(peakOnly && zyMaxed)) misses.push(`${c.name}: ${g.misses.join(",")}`);
        }
        expect(misses).toEqual([]);
    });

    test("W(u) table is strictly increasing and invert is not u = f", () => {
        const sol = solveSplineStation(station(0.35, 1, 12, 2.6, { s: -1, z: -0.18 }));
        const table = buildSplineDensityTable(sol.poly);
        expect(table.W[0]).toBe(0);
        expect(table.W[table.W.length - 1]!).toBeGreaterThan(table.W[table.W.length - 2]!);
        expect(table.W[table.W.length - 1]!).toBeCloseTo(1, 2);
        for (let i = 1; i < table.W.length; i++) {
            expect(table.W[i]!).toBeGreaterThan(table.W[i - 1]!);
        }
        expect(table.L).toBeGreaterThan(1);
        expect(table.maxR).toBeLessThanOrEqual(4.5 + 1e-6);
        const N = 20;
        const f = enforceMonotoneF(
            Array.from({ length: N + 1 }, (_, k) => k / N),
            N,
        );
        expect(f[0]).toBe(0);
        expect(f[N]).toBe(1);
        const u0 = invertDensityW(table, 0);
        const u1 = invertDensityW(table, 1);
        expect(u0).toBe(0);
        expect(u1).toBe(1);
        let offUniform = 0;
        for (let k = 1; k < N; k++) {
            const uk = invertDensityW(table, f[k]!);
            expect(uk).toBeGreaterThan(0);
            expect(uk).toBeLessThan(1);
            if (Math.abs(uk - f[k]!) > 1e-4) offUniform++;
        }
        expect(offUniform).toBeGreaterThan(0);
        const ring = sampleSplineRingByW([sol.poly, sol.poly], N, [sol.pts[0]!, sol.pts[0]!]);
        expect(ring.pts[0]!.length).toBe(N + 1);
        expect(ring.pts[0]![0]!.z).toBeCloseTo(sol.poly[0]!.z, 9);
        expect(ring.pts[0]![N]!.z).toBeCloseTo(sol.poly[sol.poly.length - 1]!.z, 9);
        expect(Math.abs(ring.f[0]![5]! - ring.f[1]![5]!)).toBeLessThanOrEqual(0.02);
    });

    test("density cap water-fills r to <= 4.5", () => {
        const sol = solveSplineStation(station(0, 1, 12, 2, { s: -1, z: -0.2 }));
        const table = buildSplineDensityTable(sol.poly);
        expect(table.maxR).toBeLessThanOrEqual(4.5 + 1e-6);
        expect(table.W[0]).toBe(0);
        expect(table.W[table.W.length - 1]!).toBeCloseTo(1, 2);
        expect(table.fillPasses).toBeGreaterThan(0);
        expect(table.fillPasses).toBeLessThanOrEqual(20);
        expect(table.alpha === 0 || table.alpha === 0.75).toBe(true);
    });

    test("invertDensityW lerps the W table, never u = k/N", () => {
        const table = {
            u: [0, 0.25, 0.5, 0.75, 1],
            S: [0, 1, 2, 3, 4],
            T: [0, 0, 0, 0, 0],
            W: [0, 0.1, 0.2, 0.8, 1],
            L: 4,
            Theta: 0,
            alpha: 0,
        };
        const u = invertDensityW(table, 0.5);
        expect(u).toBeCloseTo(0.5 + (0.75 - 0.5) * ((0.5 - 0.2) / (0.8 - 0.2)), 8);
        expect(Math.abs(u - 0.5)).toBeGreaterThan(0.1);
    });

    test("healthy invert N=48 keeps chords; short chords throw [RND-INV]", () => {
        const heel = solveSplineStation(station(0, 1, 12, 2, { s: -1, z: -0.2 }));
        expect(heel.o).toBeGreaterThan(0.05);
        expect(heel.a).toBeGreaterThan(0.05);
        const N = 48;
        const ring = sampleSplineRingByW([heel.poly], N, [heel.poly[0]!]);
        const pts = ring.pts[0]!;
        const L = ring.L[0]!;
        const need = (0.2 * L) / N;
        let lo = Number.POSITIVE_INFINITY;
        let hi = 0;
        for (let k = 1; k < pts.length; k++) {
            const e = Math.hypot(
                pts[k]!.x - pts[k - 1]!.x,
                pts[k]!.y - pts[k - 1]!.y,
                pts[k]!.z - pts[k - 1]!.z,
            );
            expect(e).toBeGreaterThanOrEqual(need);
            if (e > 1e-12) {
                lo = Math.min(lo, e);
                hi = Math.max(hi, e);
            }
        }
        console.log(
            "[RND-INV-PROBE]",
            JSON.stringify({
                o: Number(heel.o.toFixed(4)),
                a: Number(heel.a.toFixed(4)),
                L: Number(L.toFixed(4)),
                N,
                need: Number(need.toFixed(4)),
                lo: Number(lo.toFixed(4)),
                hi: Number(hi.toFixed(4)),
                stepRatio: Number((hi / lo).toFixed(4)),
            }),
        );
        expect(() => assertInversionOk(pts, L, N, 0)).not.toThrow();
        expect(
            (() => {
                try {
                    assertInversionOk(
                        [
                            { x: 0, y: 0, z: 0 },
                            { x: 0.001, y: 0, z: 0 },
                            { x: 10, y: 0, z: 0 },
                        ],
                        10,
                        10,
                        7,
                    );
                    return "";
                } catch (e) {
                    return e instanceof Error ? e.message : String(e);
                }
            })(),
        ).toMatch(/\[RND-INV\].*"i":7.*"k":/);
        expect(
            controlPointsSpaced([
                { x: 0, y: 0, z: 10 },
                { x: 0, y: 0, z: 10 },
            ]),
        ).toBe(false);
        expect(
            columnChordsOk(
                [
                    { x: 0, y: 0, z: 0 },
                    { x: 0.001, y: 0, z: 0 },
                ],
                10,
                10,
            ),
        ).toBe(false);
    });

    test("inactive station skips spline evaluation", () => {
        const sol = solveSplineStation(station(0.35, 1, 12, 2.6, { s: -1, z: -0.18 }));
        const N = 8;
        const ring = sampleSplineRingByW([sol.poly], N, [sol.poly[0]!], [false]);
        expect(ring.pts[0]![1]!.x).toBe(sol.poly[0]!.x);
        expect(ring.pts[0]![1]!.z).toBe(sol.poly[0]!.z);
        expect(ring.pts[0]![N]!.z).toBe(sol.poly[sol.poly.length - 1]!.z);
    });
});
