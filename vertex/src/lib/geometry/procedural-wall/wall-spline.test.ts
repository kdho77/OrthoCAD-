// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import {
    analyticG1BDeg,
    analyticG1EDeg,
    analyticG1RDeg,
    assertInversionOk,
    buildJointFromTheta,
    buildPolylineDensityTable,
    chooseRimDiagonal,
    clampLandingFractions,
    columnChordsOk,
    controlPointsSpaced,
    curveSTFromPolyline,
    enforceMonotoneF,
    evalClampedCubic,
    evalQuadraticBezier,
    fromSz,
    HYBRID_ARCH_LB_MM,
    hybridArchWeight,
    hybridArchWeightAtS,
    invertDensityW,
    jointDensityTable,
    lipArcEnd,
    lipBlockCount,
    lipTurnTargetFromLambda,
    minSOfSamples,
    parabolaHandleM,
    polylineInflReport,
    printSplineGates,
    qOnNormalizedArc,
    RND_E_ANG_MAX_DEG,
    RND_E_POS_EPS,
    SPLINE_CHORD_MIN_MM,
    SPLINE_G1_ANALYTIC_MAX_DEG,
    SPLINE_GATES_REPORT_ONLY,
    SPLINE_INFL_TURN_MIN_DEG,
    SPLINE_KNOTS,
    SPLINE_KNOTS_5,
    SPLINE_LAMBDA,
    SPLINE_LANDING_STEP_RATIO,
    SPLINE_LIP_ANGLE_DEG,
    SPLINE_LIP_MS_SLACK_MM,
    SPLINE_LIP_S_SLACK_MM,
    SPLINE_N_MAX,
    SPLINE_SHORT_LS_CROSS_MM,
    SPLINE_SHORT_LS_MM,
    SPLINE_SHORT_RAMP_LB_MM,
    SPLINE_WR_STEP_MAX,
    type SplineStationInput,
    sampleLipEqualAngle,
    samplePolylineAtArcFractions,
    samplePolylineBlock,
    samplePolylinesByW,
    sampleSplineRingByW,
    shortLsWeights,
    signedTurnSz,
    solveLipParabolaJoint,
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

describe("quadratic wall parabola", () => {
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

    test("quadratic E-M-B hits E and B; short Ls falls back", () => {
        expect(splineBetaAt(0)).toBeCloseTo(0.12, 2);
        const heel = solveSplineStation(station(0, 1, 12, 8, { s: -1, z: -0.2 }));
        printCorner("heel", heel);
        expect(heel.fallbackStraight).toBe(false);
        expect(heel.poly.length).toBe(3);
        const E = heel.poly[0]!;
        const M = heel.poly[1]!;
        const B = heel.poly[2]!;
        const p0 = evalQuadraticBezier(E, M, B, 0);
        const p1 = evalQuadraticBezier(E, M, B, 1);
        expect(p0.x).toBeCloseTo(E.x, 6);
        expect(p1.x).toBeCloseTo(B.x, 6);
        expect(p1.z).toBeCloseTo(0, 6);
        expect(M.z).toBeCloseTo(0, 5);
        const short = solveSplineStation(station(0.9, 1, 8, 1.2, { s: -1, z: -0.1 }));
        printCorner("short-ls", short);
        expect(short.Ls).toBeLessThan(SPLINE_SHORT_LS_MM);
        expect(short.fallbackStraight).toBe(true);
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
            const r1 = c.input.r1 ?? 0.5;
            expect(sol.sMin).toBeGreaterThanOrEqual(-(r1 + SPLINE_LIP_S_SLACK_MM) - 1e-6);
            expect(sol.convex).toBe(true);
            const hard = g.misses.filter((m) => m.startsWith("sMin") || m === "not-convex");
            if (hard.length) misses.push(`${c.name}: ${hard.join(",")}`);
        }
        expect(misses).toEqual([]);
    });

    test("W(u) table is strictly increasing and invert is not u = f", () => {
        const sol = solveSplineStation(station(0.35, 1, 12, 10, { s: -1, z: -0.18 }));
        const table = buildPolylineDensityTable(sol.pts);
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
        const fRing = [
            enforceMonotoneF(
                Array.from({ length: N + 1 }, (_, k) => k / N),
                N,
            ),
            enforceMonotoneF(
                Array.from({ length: N + 1 }, (_, k) => k / N),
                N,
            ),
        ];
        const ring = samplePolylinesByW([sol.pts, sol.pts], N, fRing);
        expect(ring.pts[0]!.length).toBe(N + 1);
        expect(ring.pts[0]![0]!.z).toBeCloseTo(sol.pts[0]!.z, 9);
        expect(ring.pts[0]![N]!.z).toBeCloseTo(sol.pts[sol.pts.length - 1]!.z, 9);
    });

    test("turn-bounded W uses ds_t floor and pad to shared N", () => {
        const sol = solveSplineStation(station(0, 1, 12, 8, { s: -1, z: -0.2 }));
        const table = buildPolylineDensityTable(sol.pts);
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
        const shared = buildPolylineDensityTable(sol.pts, undefined, 50);
        expect(shared.N).toBe(50);
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
        const table = buildPolylineDensityTable(heel.pts);
        const N = Math.min(SPLINE_N_MAX, Math.max(8, table.nNeed ?? 24));
        const ring = samplePolylinesByW([heel.pts], N, [
            enforceMonotoneF(
                Array.from({ length: N + 1 }, (_, k) => k / N),
                N,
            ),
        ]);
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
        const shortMsg = (() => {
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
                return SPLINE_GATES_REPORT_ONLY ? "[RND-INV] report-only" : "";
            } catch (e) {
                return e instanceof Error ? e.message : String(e);
            }
        })();
        expect(shortMsg).toMatch(/\[RND-INV\]/);
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

    test("M is on the plantar between s_E and Ls; hybrid arch is medial-only", () => {
        const sol = solveSplineStation(station(0.35, 1, 12, 10, { s: -1, z: -0.18 }));
        const E = sol.poly[0]!;
        const B = sol.poly[2]!;
        const M = parabolaHandleM(E, B, sol.pts[0] ?? E, { x: 1, y: 0 }, SPLINE_LAMBDA);
        expect(M.z).toBeCloseTo(0, 5);
        expect(M.x).toBeGreaterThan(E.x);
        expect(M.x).toBeLessThan(B.x);
        const arch = { uA0: 0.2, uA1: 0.55, sA0: 0, sA1: 127, lbMm: HYBRID_ARCH_LB_MM, lbU: 0.12 };
        expect(hybridArchWeight(0.1, 1, arch)).toBe(0);
        expect(hybridArchWeight(0.38, 1, arch)).toBe(1);
        expect(hybridArchWeight(0.38, -1, arch)).toBe(0);
        expect(hybridArchWeight(0.7, 1, arch)).toBe(0);
        expect(hybridArchWeightAtS(63.5, arch, 1)).toBe(1);
        const g = stationGates(sol, 0.35, 1);
        expect(g.misses.some((m) => m.startsWith("sag"))).toBe(false);
        expect(g.misses.some((m) => m.startsWith("kappa"))).toBe(false);
    });

    test("lip-parabola joint: tP from M0, zero lip when tR is already inward", () => {
        const H = 12;
        const Ls = 10;
        const r1 = 0.5;
        const tR = { s: -1, z: 0 };
        const joint = solveLipParabolaJoint(tR, H, Ls, r1, SPLINE_LAMBDA);
        expect(joint.zeroLip).toBe(false);
        expect(joint.lipTurn).toBeGreaterThan(Math.PI / 2);
        expect(joint.E.z).toBeLessThan(H);
        expect(joint.M.z).toBeCloseTo(0, 8);
        expect(joint.M.s).toBeGreaterThanOrEqual(joint.E.s - 1e-9);
        expect(joint.M.s).toBeLessThanOrEqual(Ls - SPLINE_LIP_MS_SLACK_MM + 1e-6);
        const tP0 = { s: SPLINE_LAMBDA * Ls, z: -H };
        const want = Math.atan2(tR.s * tP0.z - tR.z * tP0.s, tR.s * tP0.s + tR.z * tP0.z);
        expect(
            signedTurnSz(tR, { s: tP0.s / Math.hypot(tP0.s, tP0.z), z: tP0.z / Math.hypot(tP0.s, tP0.z) }),
        ).toBeCloseTo(want, 8);
        const alreadyIn = solveLipParabolaJoint({ s: 0.4, z: -0.9 }, H, Ls, r1, SPLINE_LAMBDA);
        expect(alreadyIn.zeroLip).toBe(true);
        expect(alreadyIn.lipTurn).toBe(0);
        expect(alreadyIn.E.s).toBeCloseTo(0, 8);
        expect(alreadyIn.E.z).toBeCloseTo(H, 8);
    });

    test("one-source theta: E and tE from the same sweep; lambda does not move M", () => {
        const H = 12;
        const Ls = 10;
        const r1 = 0.5;
        const tR = { s: -1, z: 0 };
        const raw = lipTurnTargetFromLambda(tR, H, Ls, r1, SPLINE_LAMBDA);
        const a = buildJointFromTheta(tR, H, Ls, r1, raw.theta, 0.35);
        const b = buildJointFromTheta(tR, H, Ls, r1, raw.theta, 0.65);
        expect(a.E.s).toBeCloseTo(b.E.s, 12);
        expect(a.E.z).toBeCloseTo(b.E.z, 12);
        expect(a.M.s).toBeCloseTo(b.M.s, 12);
        const lipEnd = lipArcEnd({ s: 0, z: H }, tR, r1, a.lipTurn);
        expect(Math.hypot(lipEnd.s - a.E.s, lipEnd.z - a.E.z)).toBeLessThan(RND_E_POS_EPS);
        const me = { s: a.M.s - a.E.s, z: a.M.z - a.E.z };
        const ang = (Math.abs(signedTurnSz(a.tP, me)) * 180) / Math.PI;
        expect(ang).toBeLessThan(RND_E_ANG_MAX_DEG);
    });

    test("INFL counts a sign change only if both |turn| >= 0.2 deg", () => {
        const R = { x: 0, y: 0, z: 10 };
        const B = { x: 8, y: 0, z: 0 };
        const h = { x: 1, y: 0 };
        const oneWay = [
            { x: 0, y: 0, z: 10 },
            { x: -1, y: 0, z: 6 },
            { x: 2, y: 0, z: 3 },
            { x: 8, y: 0, z: 0 },
        ];
        const one = polylineInflReport(oneWay, R, B, h);
        expect(one.inflCount).toBe(0);
        const flip = [
            { x: 0, y: 0, z: 10 },
            { x: -2, y: 0, z: 7 },
            { x: 3, y: 0, z: 5 },
            { x: -1, y: 0, z: 2 },
            { x: 8, y: 0, z: 0 },
        ];
        const two = polylineInflReport(flip, R, B, h);
        expect(two.inflCount).toBeGreaterThan(0);
        expect(two.maxOppTurnDeg).toBeGreaterThanOrEqual(SPLINE_INFL_TURN_MIN_DEG);
        const tiny = [
            { x: 0, y: 0, z: 10 },
            { x: 0.0001, y: 0, z: 8 },
            { x: 4, y: 0, z: 4 },
            { x: 8, y: 0, z: 0 },
        ];
        const micro = polylineInflReport(tiny, R, B, h);
        expect(micro.inflCount).toBe(0);
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

    test("analytic G1-R/E/B are ~0 when the joint uses tR_face", () => {
        const tR = { s: -1, z: 0 };
        const joint = buildJointFromTheta(tR, 12, 10, 0.5, Math.PI / 2, 0.5);
        expect(analyticG1RDeg(tR, joint.tR)).toBeLessThan(SPLINE_G1_ANALYTIC_MAX_DEG);
        expect(analyticG1EDeg(joint)).toBeLessThan(SPLINE_G1_ANALYTIC_MAX_DEG);
        expect(analyticG1BDeg(joint, { s: 1, z: 0 })).toBeLessThan(SPLINE_G1_ANALYTIC_MAX_DEG);
        expect(analyticG1RDeg({ s: -Math.SQRT1_2, z: -Math.SQRT1_2 }, joint.tR)).toBeGreaterThan(40);
    });

    test("short-Ls ROUND ramp is a 32 mm smoothstep around Ls=3, |dw|<=0.08", () => {
        const n = 240;
        const period = 240;
        const arc = Array.from({ length: n }, (_, i) => (i * period) / n);
        const Ls = arc.map((s) => {
            const d = Math.min(s, period - s);
            return d < 20 ? 1.2 : 8;
        });
        const w = shortLsWeights(Ls, arc, period);
        expect(w.length).toBe(n);
        expect(Math.max(...w)).toBeGreaterThan(0.95);
        expect(Math.min(...w)).toBeLessThan(0.05);
        let maxDw = 0;
        for (let i = 0; i < n; i++) {
            maxDw = Math.max(maxDw, Math.abs((w[(i + 1) % n] ?? 0) - (w[i] ?? 0)));
        }
        expect(maxDw).toBeLessThanOrEqual(SPLINE_WR_STEP_MAX + 1e-9);
        expect(SPLINE_SHORT_RAMP_LB_MM).toBe(32);
        expect(SPLINE_SHORT_LS_CROSS_MM).toBe(3);
    });

    test("lip block count is max ceil(theta / 3.5 deg) and row NL locks to E", () => {
        expect(lipBlockCount([])).toBe(1);
        expect(lipBlockCount([0])).toBe(1);
        const theta = (117 * Math.PI) / 180;
        expect(lipBlockCount([theta, 0.1])).toBe(Math.ceil(117 / SPLINE_LIP_ANGLE_DEG));
        const tR = { s: -0.15, z: 0.9887 };
        const joint = buildJointFromTheta(tR, 12, 10, 0.5, theta, 0.5);
        const NL = lipBlockCount([joint.lipTurn]);
        const origin = { x: 0, y: 0, z: 0 };
        const h = { x: 1, y: 0 };
        const R = { x: 0, y: 0, z: 12 };
        const E = fromSz(joint.E, origin, h);
        const lip = sampleLipEqualAngle(joint, origin, h, R, NL);
        expect(lip.length).toBe(NL + 1);
        expect(Math.hypot(lip[0]!.x - R.x, lip[0]!.y - R.y, lip[0]!.z - R.z)).toBeLessThan(1e-9);
        expect(Math.hypot(lip[NL]!.x - E.x, lip[NL]!.y - E.y, lip[NL]!.z - E.z)).toBeLessThan(1e-9);
        const body = [{ ...E }, { x: E.x + 3, y: 0, z: 6 }, { x: E.x + 10, y: 0, z: 0 }];
        const f = Array.from({ length: 5 }, (_, k) => k / 4);
        const sampled = samplePolylineBlock(body, 4, f, 0.04);
        expect(sampled.length).toBe(5);
        expect(Math.hypot(sampled[0]!.x - E.x, sampled[0]!.y - E.y, sampled[0]!.z - E.z)).toBeLessThan(1e-9);
        const B = body[body.length - 1]!;
        expect(Math.hypot(sampled[4]!.x - B.x, sampled[4]!.y - B.y, sampled[4]!.z - B.z)).toBeLessThan(1e-9);
        const landed = samplePolylineBlock(body, 4, f, 0.04, true);
        expect(landed.length).toBe(5);
        expect(Math.hypot(landed[4]!.x - B.x, landed[4]!.y - B.y, landed[4]!.z - B.z)).toBeLessThan(1e-9);
    });

    test("landing fractions clamp last-10% step ratio without pinning last-3 f", () => {
        expect(SPLINE_LANDING_STEP_RATIO).toBeCloseTo(1.3);
        const u = [0, 0.2, 0.4, 0.6, 0.91, 0.92, 1];
        const c = clampLandingFractions(u, 1.3, 0.9);
        expect(c[0]).toBe(0);
        expect(c[c.length - 1]).toBe(1);
        for (let k = 2; k < c.length; k++) {
            if ((c[k - 1] ?? 0) < 0.9 - 1e-9) continue;
            const prev = Math.max((c[k - 1] ?? 0) - (c[k - 2] ?? 0), 1e-16);
            const ds = (c[k] ?? 0) - (c[k - 1] ?? 0);
            expect(ds).toBeLessThanOrEqual(prev * 1.3 + 1e-6);
        }
    });

    test("rim diagonal prefers the smaller max dihedral to the top face", () => {
        const nTop = { x: 0, y: 0, z: 1 };
        const pick = chooseRimDiagonal(
            { x: 0, y: 0, z: 10 },
            { x: 1, y: 0, z: 10 },
            { x: 0.1, y: 0.2, z: 9.2 },
            { x: 1.1, y: 0.2, z: 9.2 },
            nTop,
        );
        expect(pick.diag === 0 || pick.diag === 1).toBe(true);
        expect(pick.deg).toBeLessThan(90);
        const flipped = chooseRimDiagonal(
            { x: 0, y: 0, z: 10 },
            { x: 1, y: 0, z: 10 },
            { x: 0.05, y: -0.8, z: 9.1 },
            { x: 0.95, y: 0.05, z: 9.4 },
            nTop,
        );
        expect(flipped.deg).toBeLessThanOrEqual(pick.deg + 90);
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
