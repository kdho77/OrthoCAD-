// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import {
    assertInversionOk,
    buildSplineDensityTable,
    columnChordsOk,
    controlPointsSpaced,
    curveSTFromPolyline,
    enforceMonotoneF,
    evalClampedCubic,
    invertDensityW,
    jointDensityTable,
    midArcKappaMaxMean,
    midArcKappaRatio,
    minSOfSamples,
    printSplineGates,
    qOnNormalizedArc,
    SPLINE_CHORD_MIN_MM,
    SPLINE_FLAT_EB_MM,
    SPLINE_G_HI_FRAC,
    SPLINE_KAPPA_MAX_MEAN,
    SPLINE_KNOTS,
    SPLINE_KNOTS_5,
    SPLINE_N_MAX,
    SPLINE_S_MIN_MM,
    type SplineStationInput,
    samplePolylineAtArcFractions,
    sampleSplineRingByW,
    solveSplineStation,
    splineBetaAt,
    stationGates,
    stationSampleNeed,
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
        heightMm: H,
        r1: 0.5,
    };
}

function printCorner(name: string, sol: ReturnType<typeof solveSplineStation>): void {
    const row = {
        a: Number(sol.a.toFixed(4)),
        g: Number(sol.g.toFixed(4)),
        beta: Number(sol.beta.toFixed(4)),
        eb: Number(sol.eb.toFixed(4)),
        sag: Number(sol.sagitta.toFixed(4)),
        sagFrac: Number(sol.sagFrac.toFixed(4)),
        sMin: Number(sol.sMin.toFixed(4)),
        kappaRatio: Number(sol.kappaRatio.toFixed(3)),
        kappaE: Number(sol.kappaE.toFixed(4)),
        convex: sol.convex,
        infl: sol.inflCount,
        poly: sol.fallbackStraight,
    };
    console.log(`[RND-SOLVE] ${name}`, JSON.stringify(row));
}

describe("clamped cubic wall spline", () => {
    test("5-point cubic hits E at 0 and B at 1; 6-point still G1 along P0P1", () => {
        const P5 = [
            { x: 0.5, y: 0, z: 9.5 },
            { x: 1.2, y: 0, z: 8 },
            { x: 0.2, y: 0, z: 5 },
            { x: 1.5, y: 0, z: 0 },
            { x: 3, y: 0, z: 0 },
        ];
        const a = evalClampedCubic(P5, 0, SPLINE_KNOTS_5);
        const b = evalClampedCubic(P5, 1, SPLINE_KNOTS_5);
        expect(a.x).toBeCloseTo(0.5, 6);
        expect(b.x).toBeCloseTo(3, 6);
        expect(a.z).toBeCloseTo(9.5, 6);
        expect(b.z).toBeCloseTo(0, 6);

        const P = [
            { x: 0, y: 0, z: 10 },
            { x: -1, y: 0, z: 9 },
            { x: -2, y: 0, z: 7 },
            { x: -2, y: 0, z: 3 },
            { x: 1, y: 0, z: 0 },
            { x: 2, y: 0, z: 0 },
        ];
        const p0 = evalClampedCubic(P, 0, SPLINE_KNOTS);
        const p1 = evalClampedCubic(P, 1, SPLINE_KNOTS);
        expect(p0.z).toBeCloseTo(10, 6);
        expect(p1.x).toBeCloseTo(2, 6);
        const near = evalClampedCubic(P, 1e-3, SPLINE_KNOTS);
        const d = { x: near.x - p0.x, y: near.y - p0.y, z: near.z - p0.z };
        const e = { x: P[1]!.x - P[0]!.x, y: P[1]!.y - P[0]!.y, z: P[1]!.z - P[0]!.z };
        const den = Math.hypot(d.x, d.y, d.z) * Math.hypot(e.x, e.y, e.z) || 1;
        expect((d.x * e.x + d.y * e.y + d.z * e.z) / den).toBeGreaterThan(0.99);
    });

    test("beta is 0.12 heel, 0.18 arch/midfoot, 0.15 elsewhere; FLAT iff |EB|<2", () => {
        expect(splineBetaAt(0)).toBeCloseTo(0.12, 2);
        expect(splineBetaAt(0.4)).toBeCloseTo(0.18, 2);
        expect(splineBetaAt(0.9)).toBeCloseTo(0.15, 2);

        const heel = solveSplineStation(station(0, 1, 12, 8, { s: -1, z: -0.2 }));
        printCorner("heel", heel);
        expect(heel.fallbackStraight).toBe(false);
        expect(heel.poly.length).toBe(5);
        expect(heel.sMin).toBeGreaterThanOrEqual(SPLINE_S_MIN_MM - 1e-6);
        expect(heel.eb).toBeGreaterThan(SPLINE_FLAT_EB_MM);
        expect(heel.sagFrac).toBeGreaterThan(0.05);

        const flat = solveSplineStation(station(0.9, 1, 2, 1.2, { s: -1, z: -0.1 }));
        printCorner("flat-eb", flat);
        expect(flat.eb).toBeLessThan(SPLINE_FLAT_EB_MM);
        expect(flat.fallbackStraight).toBe(true);
    });

    test("three Default-like stations stay convex with s >= -0.1", () => {
        const cases: Array<{ name: string; input: SplineStationInput }> = [
            { name: "heel-med-u0.12", input: station(0.12, 1, 12, 8, { s: -1, z: -0.2 }) },
            { name: "arch-med-u0.35", input: station(0.35, 1, 12, 10, { s: -1, z: -0.18 }) },
            { name: "lat-mid-u0.55", input: station(0.55, -1, 8, 7, { s: -1, z: -0.2 }) },
        ];
        const misses: string[] = [];
        for (const c of cases) {
            const sol = solveSplineStation(c.input);
            const g = stationGates(sol, c.input.u, c.input.sideSign);
            printSplineGates({ ...g, u: c.input.u });
            printCorner(c.name, sol);
            expect(sol.sMin).toBeGreaterThanOrEqual(SPLINE_S_MIN_MM - 1e-6);
            expect(sol.convex).toBe(true);
            const hard = g.misses.filter((m) => m.startsWith("sMin") || m === "not-convex");
            if (hard.length) misses.push(`${c.name}: ${hard.join(",")}`);
        }
        expect(misses).toEqual([]);
    });

    test("W(u) table is strictly increasing and invert is not u = f", () => {
        const sol = solveSplineStation(station(0.35, 1, 12, 10, { s: -1, z: -0.18 }));
        const table = buildSplineDensityTable(sol.poly);
        expect(table.W[0]).toBe(0);
        expect(table.W[table.W.length - 1]!).toBeGreaterThan(table.W[table.W.length - 2]!);
        expect(table.W[table.W.length - 1]!).toBeCloseTo(1, 2);
        for (let i = 1; i < table.W.length; i++) {
            expect(table.W[i]!).toBeGreaterThan(table.W[i - 1]!);
        }
        expect(table.L).toBeGreaterThan(1);
        expect(table.nNeed ?? 0).toBeGreaterThan(0);
        expect(table.N ?? 0).toBeLessThanOrEqual(SPLINE_N_MAX);
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

    test("turn-bounded W uses ds_t floor and pad to shared N", () => {
        const sol = solveSplineStation(station(0, 1, 12, 8, { s: -1, z: -0.2 }));
        const table = buildSplineDensityTable(sol.poly);
        expect(table.W[0]).toBe(0);
        expect(table.W[table.W.length - 1]!).toBeCloseTo(1, 2);
        expect(table.fillPasses).toBe(0);
        expect(table.nNeed ?? 0).toBeGreaterThan(0);
        expect(table.N ?? 0).toBeLessThanOrEqual(SPLINE_N_MAX);
        const st = curveSTFromPolyline([
            { x: 0, y: 0, z: 10 },
            { x: 3, y: 0, z: 0 },
        ]);
        expect(stationSampleNeed(st.S, st.T).n).toBe(24);
        const shared = buildSplineDensityTable(sol.poly, undefined, 50);
        expect(shared.N).toBe(50);
        expect(midArcKappaRatio(sol.pts)).toBeGreaterThan(0);
        expect(
            minSOfSamples(sol.pts, sol.pts[0]!, sol.pts[sol.pts.length - 1]!, { x: 1, y: 0 }),
        ).toBeLessThan(2);
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

    test("healthy invert keeps chords >= 0.03 mm; short chords throw [RND-INV]", () => {
        const heel = solveSplineStation(station(0, 1, 12, 8, { s: -1, z: -0.2 }));
        expect(heel.fallbackStraight).toBe(false);
        expect(heel.a).toBeGreaterThan(0.05);
        const table = buildSplineDensityTable(heel.poly);
        const N = Math.min(SPLINE_N_MAX, Math.max(8, table.nNeed ?? 24));
        const ring = sampleSplineRingByW([heel.poly], N, [heel.poly[0]!]);
        const pts = ring.pts[0]!;
        const L = ring.L[0]!;
        const need = SPLINE_CHORD_MIN_MM;
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
                a: Number(heel.a.toFixed(4)),
                g: Number(heel.g.toFixed(4)),
                L: Number(L.toFixed(4)),
                N,
                nNeed: table.nNeed,
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

    test("kappa_max/mean is finite on the mid-body; old ratio stays report-only", () => {
        const sol = solveSplineStation(station(0.35, 1, 12, 10, { s: -1, z: -0.18 }));
        const km = midArcKappaMaxMean(sol.pts);
        expect(Number.isFinite(km)).toBe(true);
        expect(km).toBeGreaterThan(0);
        expect(sol.kappaMaxMean).toBeGreaterThan(0);
        expect(sol.g).toBeLessThanOrEqual(SPLINE_G_HI_FRAC * sol.eb + 1e-6);
        const g = stationGates(sol, 0.35, 1);
        expect(g.misses.some((m) => m.startsWith("kappa-ratio"))).toBe(false);
        if (sol.sagFrac + 1e-9 >= 0.12) {
            expect(sol.kappaMaxMean).toBeLessThanOrEqual(SPLINE_KAPPA_MAX_MEAN + 0.5);
        }
    });

    test("joint density samples both polylines at the same normalized-arc fractions", () => {
        const round = [
            { x: 0, y: 0, z: 10 },
            { x: -1, y: 0, z: 6 },
            { x: 2, y: 0, z: 0 },
        ];
        const straight = [
            { x: 0, y: 0, z: 10 },
            { x: 2, y: 0, z: 0 },
        ];
        const stR = curveSTFromPolyline(round);
        const stS = curveSTFromPolyline(straight);
        const qR = qOnNormalizedArc(stR.S, stR.T, 64);
        const qS = qOnNormalizedArc(stS.S, stS.T, 64);
        expect(qR.length).toBe(64);
        expect(qS.length).toBe(64);
        const table1 = jointDensityTable(stS, stR, 1, 16);
        const table0 = jointDensityTable(stS, stR, 0, 16);
        expect(table1.W[0]).toBe(0);
        expect(table1.W[table1.W.length - 1]).toBe(1);
        expect(table0.W[0]).toBe(0);
        const alphas = [0, invertDensityW(table1, 0.5), 1];
        const pts = samplePolylineAtArcFractions(round, alphas);
        expect(pts[0]!.z).toBeCloseTo(10, 9);
        expect(pts[2]!.z).toBeCloseTo(0, 9);
        expect(pts.length).toBe(3);
    });

    test("inactive station skips spline evaluation", () => {
        const sol = solveSplineStation(station(0.35, 1, 12, 10, { s: -1, z: -0.18 }));
        const N = 8;
        const ring = sampleSplineRingByW([sol.poly], N, [sol.poly[0]!], [false]);
        expect(ring.pts[0]![1]!.x).toBe(sol.poly[0]!.x);
        expect(ring.pts[0]![1]!.z).toBe(sol.poly[0]!.z);
        expect(ring.pts[0]![N]!.z).toBe(sol.poly[sol.poly.length - 1]!.z);
    });
});
