// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import {
    assertFilletStation,
    assertT0ClearsSheet,
    bLoopOutwardNormal,
    buildBezierColumns,
    CHORD_RISE_MAX_DEG,
    COLUMN_PLANARITY_LIMIT_MM,
    COS_T_MIN,
    canonicalRoundPhi,
    clampLastFilletOutboard,
    columnHeading,
    constructArcLineArc,
    constructFillet,
    constructSweepRule,
    DPHI_L_MAX_DEG,
    evalCubicBezier,
    FILLET_R_CAP_MM,
    FILLET_STEP_MAX_DEG,
    filletCenterAndF,
    G1_MAX_DEG,
    HEADING_MAX_DEG,
    headingAllowanceDeg,
    incidentFaceTangent,
    initColumnFrames,
    LAST_FILLET_S_MIN_MM,
    LAST_FILLET_Z_MIN_MM,
    lastFilletCMinMm,
    lastFilletDLRad,
    lastFilletPhis,
    lastFilletR2MinMm,
    MERGE_ROW_MM,
    MIN_LINE_MM,
    MIN_ROUND_R_MM,
    nTopFromSheetSlope,
    offPlaneMm,
    R_CHANGE_MAX_PCT,
    R_SMOOTH_FRAC,
    R2_CHANGE_MAX_PCT,
    R2_RATE_LIMIT_PCT,
    ROUND_SWEEP_SPLIT_DEG,
    r1ForSheetSlope,
    rateLimitClosed,
    rateLimitClosedDown,
    rimOverhangMm,
    rotateColumnAboutB,
    rowPieceId,
    SCALAR_SMOOTH_SIGMA_MM,
    STEEP_SHEET_DEG,
    sampleArcLineArc,
    sampleByArcLength,
    sampleInPlaneSlope,
    sheetSlopeFromNormal,
    sizedArcRows,
    slopeFromSheetPlane,
    smoothStationHeadings,
    squareHeadingToB,
    summarizeWallBands,
    T0_LEAD_DROP_MM,
    TOP_CLEARANCE_DEG,
    t0FromSheetSlope,
    t0TargetRad,
    topRoundRowCount,
    wallStartTiltRad,
} from "./bezier-column";
import type { WallRegionDefaults } from "./defaults";
import type { HermiteStation } from "./loft";

function defaults(): WallRegionDefaults {
    const flare = {
        heelPosterior: 24,
        heelMedial: 28,
        heelLateral: 28,
        medialArch: 23,
        lateralMidfoot: 41,
    };
    return {
        flareDeg: flare,
        flareCurvature: {
            heelPosterior: 0,
            heelMedial: 0,
            heelLateral: 0,
            medialArch: 0,
            lateralMidfoot: 0,
        },
        wallFilletTopMm: 0.5,
        wallFilletBottomMm: 1.2,
        cupBowlFactor: 0.6,
        lateralFlangeHeightMm: 0,
        lateralFlangeLengthMm: 40,
        lateralFlangeAngleDeg: 10,
        report: [],
        flareDiagnostics: [],
        medialYSign: 1,
    };
}

function station(x: number, y: number, rz: number, n: { x: number; y: number }): HermiteStation {
    return {
        outline: { x, y, z: 0 },
        rim: { x: x + n.x * 2, y: y + n.y * 2, z: rz },
        n,
        u: Math.max(0, Math.min(1, (x + 40) / 80)),
    };
}

describe("bezier column", () => {
    test("cubic Bezier endpoints stay at P0 and P3", () => {
        const P0 = { x: 0, y: 0, z: 10 };
        const P1 = { x: 1, y: 0, z: 8 };
        const P2 = { x: 2, y: 0, z: 2 };
        const P3 = { x: 3, y: 0, z: 0 };
        const a = evalCubicBezier(P0, P1, P2, P3, 0);
        const b = evalCubicBezier(P0, P1, P2, P3, 1);
        expect(a).toEqual(P0);
        expect(b).toEqual(P3);
    });

    test("arc-length sample keeps endpoints and merges rows closer than 0.3 mm", () => {
        const pts = [
            { x: 0, y: 0, z: 0 },
            { x: 0.1, y: 0, z: 0 },
            { x: 4, y: 0, z: 0 },
            { x: 8, y: 0, z: 0 },
        ];
        const sampled = sampleByArcLength(pts, 5);
        expect(sampled[0]).toEqual(pts[0]);
        expect(sampled[sampled.length - 1]).toEqual(pts[pts.length - 1]);
        expect(sampled.length).toBe(5);
        for (let i = 1; i < sampled.length - 1; i++) {
            const d = Math.hypot(
                sampled[i]!.x - sampled[i - 1]!.x,
                sampled[i]!.y - sampled[i - 1]!.y,
                sampled[i]!.z - sampled[i - 1]!.z,
            );
            expect(d).toBeGreaterThanOrEqual(MERGE_ROW_MM - 1e-6);
        }
    });

    test("ALA is exterior tangent with L >= 0.5 and no cubic", () => {
        const R = { x: 0, y: 0, z: 12 };
        const B = { x: 8, y: 0, z: 0 };
        const ala = constructArcLineArc(R, B, { x: 0, y: 0, z: 1 }, 0.5, 2, { x: 1, y: 0 }, 0);
        expect(ala.L).toBeGreaterThanOrEqual(MIN_LINE_MM);
        expect(ala.T1.x).toBeLessThan(ala.C1.x + 1e-6);
        expect(ala.T2.z).toBeGreaterThan(B.z);
        const dT = { x: ala.T2.x - ala.T1.x, y: ala.T2.y - ala.T1.y, z: ala.T2.z - ala.T1.z };
        expect(dT.x * ala.n.x + dT.y * ala.n.y + dT.z * ala.n.z).toBeCloseTo(0, 5);
        expect(ala.roundSweep).toBeGreaterThan(0);
        expect(ala.filletSweep).toBeGreaterThan(0);
        const tight = constructArcLineArc(
            R,
            { x: 0.2, y: 0, z: 6 },
            { x: 0, y: 0, z: 1 },
            3,
            3,
            { x: 1, y: 0 },
            0,
        );
        expect(tight.L).toBeGreaterThanOrEqual(MIN_LINE_MM);
        expect(tight.r1).toBeLessThan(3);
        expect(tight.r2).toBeGreaterThanOrEqual(lastFilletR2MinMm(1.5) - 1e-9);
        const zeroInset = constructArcLineArc(
            { x: 0, y: 0, z: 2 },
            { x: 0, y: 0, z: 0 },
            { x: 0, y: 0, z: 1 },
            3,
            3,
            { x: 1, y: 0 },
            0,
        );
        expect(zeroInset.L).toBeGreaterThanOrEqual(MIN_LINE_MM);
        expect(zeroInset.r1).toBeLessThan(3);
        expect(zeroInset.r2).toBeLessThan(3);
    });

    test("R and B never move; pieces stay in their own planes", () => {
        const n = 12;
        const stations: HermiteStation[] = [];
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            stations.push(
                station(30 * Math.cos(a), 18 * Math.sin(a), 12, {
                    x: Math.cos(a),
                    y: Math.sin(a),
                }),
            );
        }
        const junctions = stations.map(() => ({ planeN: { x: 0, y: 0, z: 1 }, slopeRad: 0.15 }));
        const rimLoop = stations.map((s) => s.rim);
        const built = buildBezierColumns(stations, junctions, defaults(), rimLoop, () => 12, 24);
        expect(built.planReversals).toBe(0);
        expect(built.maxOffPlaneMm).toBeLessThanOrEqual(COLUMN_PLANARITY_LIMIT_MM);
        expect(built.quality.columnCrossings).toBe(0);
        for (let i = 0; i < n; i++) {
            const col = built.xyz[i]!;
            const R = stations[i]!.rim;
            const B = stations[i]!.outline;
            const fr = built.frames[i]!;
            expect(col[0]!.x).toBeCloseTo(R.x, 9);
            expect(col[0]!.y).toBeCloseTo(R.y, 9);
            expect(col[0]!.z).toBeCloseTo(R.z, 9);
            const last = col[col.length - 1]!;
            expect(last.x).toBeCloseTo(B.x, 9);
            expect(last.y).toBeCloseTo(B.y, 9);
            expect(last.z).toBeCloseTo(B.z, 9);
            const nRnd = fr.nRoundFix;
            for (let k = 1; k <= nRnd && k < col.length - 1; k++) {
                const d =
                    (col[k]!.x - fr.R.x) * fr.nRoundPlane.x +
                    (col[k]!.y - fr.R.y) * fr.nRoundPlane.y +
                    (col[k]!.z - fr.R.z) * fr.nRoundPlane.z;
                expect(Math.abs(d)).toBeLessThanOrEqual(COLUMN_PLANARITY_LIMIT_MM);
            }
            expect(fr.g1EDeg).toBeLessThanOrEqual(G1_MAX_DEG + 0.5);
            expect(fr.g1FDeg).toBeLessThanOrEqual(G1_MAX_DEG + 0.5);
        }
    });

    test("sweep+rule fillet is square to B and G1 to the ruling", () => {
        const R = { x: 0, y: 1, z: 12 };
        const B = { x: 8, y: 0, z: 0 };
        const nB = { x: 1, y: 0 };
        const h = { x: 8, y: -1 };
        const hl = Math.hypot(h.x, h.y);
        const sw = constructSweepRule(
            R,
            B,
            { x: 0, y: 0, z: 1 },
            0.5,
            1.2,
            { x: h.x / hl, y: h.y / hl },
            nB,
            { x: 0, y: 1, z: 0 },
            0,
            0,
            1.3,
        );
        expect(sw.converged).toBe(true);
        expect(sw.g1EDeg).toBeLessThanOrEqual(G1_MAX_DEG + 1e-3);
        expect(sw.g1FDeg).toBeLessThanOrEqual(G1_MAX_DEG + 1e-3);
        const filOff = (sw.F.x - B.x) * -nB.y + (sw.F.y - B.y) * nB.x;
        expect(Math.abs(filOff)).toBeLessThan(1e-6);
        expect(Math.abs(sw.F.y - B.y)).toBeLessThan(1e-6);
    });

    test("locked φ1 re-solves the ruling and keeps G1 at E", () => {
        const R = { x: 0, y: 1, z: 12 };
        const B = { x: 8, y: 0, z: 0 };
        const nB = { x: 1, y: 0 };
        const h = { x: 8, y: -1 };
        const hl = Math.hypot(h.x, h.y);
        const free = constructSweepRule(
            R,
            B,
            { x: 0, y: 0, z: 1 },
            0.5,
            1.2,
            { x: h.x / hl, y: h.y / hl },
            nB,
            { x: 0, y: 1, z: 0 },
            0,
            0,
            1.3,
        );
        const locked = constructSweepRule(
            R,
            B,
            { x: 0, y: 0, z: 1 },
            0.5,
            1.2,
            { x: h.x / hl, y: h.y / hl },
            nB,
            { x: 0, y: 1, z: 0 },
            0,
            0,
            1.3,
            undefined,
            free.phiRound1 + Math.PI / 180,
        );
        expect(locked.phiRound1).toBeCloseTo(free.phiRound1 + Math.PI / 180, 5);
        expect(locked.g1EDeg).toBeLessThanOrEqual(G1_MAX_DEG + 1e-3);
        expect(locked.g1FDeg).toBeLessThanOrEqual(G1_MAX_DEG + 1e-3);
    });

    test("canonicalRoundPhi wraps to [0, 2π) without mirroring across eN", () => {
        expect(canonicalRoundPhi(Math.PI / 2)).toBeCloseTo(Math.PI / 2, 6);
        expect(canonicalRoundPhi(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 6);
        expect(canonicalRoundPhi(0)).toBeCloseTo(0, 6);
        expect(canonicalRoundPhi(Math.PI / 2 + Math.PI * 2)).toBeCloseTo(Math.PI / 2, 6);
        expect(canonicalRoundPhi(0.4)).toBeCloseTo(0.4, 6);
    });

    test("locked φ1 far from the free solve blends back so G1 stays ≤3", () => {
        const R = { x: 0, y: 1, z: 12 };
        const B = { x: 8, y: 0, z: 0 };
        const nB = { x: 1, y: 0 };
        const h = { x: 8, y: -1 };
        const hl = Math.hypot(h.x, h.y);
        const free = constructSweepRule(
            R,
            B,
            { x: 0, y: 0, z: 1 },
            0.5,
            1.2,
            { x: h.x / hl, y: h.y / hl },
            nB,
            { x: 0, y: 1, z: 0 },
            0,
            0,
            1.3,
        );
        const locked = constructSweepRule(
            R,
            B,
            { x: 0, y: 0, z: 1 },
            0.5,
            1.2,
            { x: h.x / hl, y: h.y / hl },
            nB,
            { x: 0, y: 1, z: 0 },
            0,
            0,
            1.3,
            undefined,
            0.2,
        );
        expect(locked.g1EDeg).toBeLessThanOrEqual(G1_MAX_DEG + 1e-3);
        expect(locked.g1FDeg).toBeLessThanOrEqual(G1_MAX_DEG + 1e-3);
        expect(Math.abs(locked.phiRound1 - free.phiRound1)).toBeLessThan(Math.abs(0.2 - free.phiRound1));
    });

    test("rim overhang is positive when the rim sits outside the outline", () => {
        const outline = [
            { x: -1, y: -1, z: 0 },
            { x: 1, y: -1, z: 0 },
            { x: 1, y: 1, z: 0 },
            { x: -1, y: 1, z: 0 },
        ];
        expect(rimOverhangMm({ x: 2, y: 0, z: 4 }, outline)).toBeGreaterThan(0);
        expect(rimOverhangMm({ x: 0, y: 0, z: 4 }, outline)).toBeLessThan(0);
    });

    test("T0 is -90+flare and clears the sheet; short chord stays nearly vertical", () => {
        const flare = (24 * Math.PI) / 180;
        expect((wallStartTiltRad(flare, false) * 180) / Math.PI).toBeCloseTo(-66, 5);
        const sheet = (43 * Math.PI) / 180;
        const t0 = t0TargetRad(sheet, false, true, flare);
        expect((t0 * 180) / Math.PI).toBeCloseTo(-66, 5);
        expect(t0).toBeLessThanOrEqual(sheet - (TOP_CLEARANCE_DEG * Math.PI) / 180 + 1e-12);
        const descending = (-48 * Math.PI) / 180;
        expect((t0FromSheetSlope(descending, false) * 180) / Math.PI).toBeCloseTo(-58, 5);
        expect((t0FromSheetSlope(sheet, true) * 180) / Math.PI).toBeCloseTo(-80, 5);
    });

    test("slope is sampled along +h; T0 is -90+flare even if the lip rises along +h", () => {
        const tan = Math.tan((43 * Math.PI) / 180);
        const R = { x: 0, y: 0, z: 10 };
        const h = { x: 1, y: 0 };
        const topZ = (x: number, _y: number): number | null => {
            if (x < -0.05) return null;
            return 10 + x * tan;
        };
        const slope = sampleInPlaneSlope(R, h, topZ);
        expect(slope.valid).toBe(true);
        expect((slope.slopeRad * 180) / Math.PI).toBeCloseTo(43, 0);
        const st: HermiteStation = {
            outline: { x: 5, y: 0, z: 0 },
            rim: { x: 0, y: 0, z: 10 },
            n: { x: -1, y: 0 },
            u: 0.1,
        };
        const frames = initColumnFrames(
            [st],
            [{ planeN: { x: 0, y: 0, z: 1 }, slopeRad: 0.75 }],
            defaults(),
            [24],
            topZ,
        );
        const fr = frames[0]!;
        expect((fr.sheetSlopeRad * 180) / Math.PI).toBeCloseTo(43, 0);
        expect(fr.lineTiltRad).toBeLessThanOrEqual(
            fr.sheetSlopeRad - (TOP_CLEARANCE_DEG * Math.PI) / 180 + 1e-9,
        );
        expect(() => assertT0ClearsSheet(frames)).not.toThrow();
        expect(() => assertT0ClearsSheet([{ ...fr, lineTiltRad: fr.sheetSlopeRad }])).not.toThrow();
    });

    test("missed rays use adjacent-face plane; never default to 0", () => {
        const R = { x: 0, y: 0, z: 10 };
        const h = { x: 1, y: 0 };
        const tan = Math.tan((43 * Math.PI) / 180);
        const planeN = { x: -tan, y: 0, z: 1 };
        const len = Math.hypot(planeN.x, planeN.z);
        const n = { x: planeN.x / len, y: 0, z: planeN.z / len };
        const face = slopeFromSheetPlane(n, h);
        expect(face).not.toBeNull();
        expect((face! * 180) / Math.PI).toBeCloseTo(43, 0);
        const missed = sampleInPlaneSlope(R, h, () => null, n);
        expect(missed.valid).toBe(true);
        expect((missed.slopeRad * 180) / Math.PI).toBeCloseTo(43, 0);
        const none = sampleInPlaneSlope(R, h, () => null);
        expect(none.valid).toBe(false);
        expect(Number.isNaN(none.slopeRad)).toBe(true);
    });

    test("wall-band summary buckets hits by u", () => {
        const rows = summarizeWallBands(
            [0.1, 0.12, 0.4, 0.9],
            [
                { u: 0.1, overhangMm: 2, heightMm: 10 },
                { u: 0.4, overhangMm: 1, heightMm: 12 },
                { u: 0.9, overhangMm: 0.5, heightMm: 8 },
            ],
        );
        expect(rows.find((r) => r.band === "heel")?.hits).toBe(2);
        expect(rows.find((r) => r.band === "arch")?.hits).toBe(1);
        expect(rows.find((r) => r.band === "forefoot")?.hits).toBe(1);
        expect(rows.find((r) => r.band === "heel")?.meanOverhangOverHeight).toBeCloseTo(0.2, 6);
    });

    test("fillet radius smooths with periodic Gaussian σ 8-15 mm", () => {
        expect(SCALAR_SMOOTH_SIGMA_MM).toBeGreaterThanOrEqual(8);
        expect(SCALAR_SMOOTH_SIGMA_MM).toBeLessThanOrEqual(15);
        expect(R_SMOOTH_FRAC).toBe(0.05);
    });

    test("circular fillet F is r inward and r up when the plantar is flat", () => {
        const B = { x: 5, y: 0, z: 0 };
        const h = { x: 1, y: 0 };
        const U = { x: 0, y: 0, z: 1 };
        const placed = filletCenterAndF(B, h, 2, U, 0);
        expect(placed.F.x).toBeCloseTo(3, 5);
        expect(placed.F.y).toBeCloseTo(0, 5);
        expect(placed.F.z).toBeCloseTo(2, 5);
        expect(placed.theta).toBeCloseTo(Math.PI / 2, 5);
        expect(FILLET_R_CAP_MM).toBe(3);
        const fil = constructFillet(B, h, 2, U, 0);
        expect(fil.Pp).toEqual(B);
        expect(fil.Pw.x).toBeCloseTo(3, 5);
        expect(fil.Pw.z).toBeCloseTo(2, 5);
        expect(fil.C.x).toBeCloseTo(5, 5);
        expect(fil.C.z).toBeCloseTo(2, 5);
        expect(fil.psi).toBeCloseTo(Math.PI / 2, 5);
        expect(() => assertFilletStation(fil)).not.toThrow();
    });

    test("top-edge round is outside R and T0 stays steep", () => {
        expect(T0_LEAD_DROP_MM).toBe(1);
        const st: HermiteStation = {
            outline: { x: 8, y: 0, z: 0 },
            rim: { x: 0, y: 0, z: 12 },
            n: { x: -1, y: 0 },
            u: 0.1,
        };
        const built = buildBezierColumns(
            [st],
            [{ planeN: { x: 0, y: 0, z: 1 }, slopeRad: 0 }],
            defaults(),
            [st.rim],
            () => 12,
            24,
        );
        const col = built.xyz[0]!;
        const R = col[0]!;
        const fr = built.frames[0]!;
        const wOutx = -fr.h.x;
        const wOuty = -fr.h.y;
        expect(col.slice(1, 7).some((p) => R.z - p.z > 0.05)).toBe(true);
        for (const p of col.slice(1, 5)) {
            expect((p.x - R.x) * wOutx + (p.y - R.y) * wOuty).toBeGreaterThanOrEqual(-1e-6);
        }
        expect((fr.leanRad * 180) / Math.PI).toBeGreaterThan(5);
        expect(built.maxOffPlaneMm).toBeLessThanOrEqual(COLUMN_PLANARITY_LIMIT_MM);
        expect(built.maxSidewaysMm).toBeLessThanOrEqual(2);
    });

    test("fillet samples never drop below the tangent band z", () => {
        const stations: HermiteStation[] = [];
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            stations.push(
                station(20 * Math.cos(a), 12 * Math.sin(a), 12, {
                    x: Math.cos(a),
                    y: Math.sin(a),
                }),
            );
        }
        const junctions = stations.map(() => ({ planeN: { x: 0, y: 0, z: 1 }, slopeRad: 0.1 }));
        const built = buildBezierColumns(
            stations,
            junctions,
            defaults(),
            stations.map((s) => s.rim),
            () => 12,
            24,
        );
        for (const fr of built.frames) {
            expect(fr.bandZ).toBeGreaterThanOrEqual(fr.B.z - 1e-6);
            expect(fr.arcEndZ).toBeGreaterThanOrEqual(fr.bandZ - 1e-6);
        }
    });

    test("round rows follow turning angle and split sweeps over 80°", () => {
        expect(ROUND_SWEEP_SPLIT_DEG).toBe(80);
        const sweep90 = (90 * Math.PI) / 180;
        const n90 = topRoundRowCount(sweep90, 0.5, 1.3);
        expect(n90).toBeGreaterThanOrEqual(Math.ceil(90 / 8));
        expect(90 / n90).toBeLessThanOrEqual(8 + 1e-6);
        const sweep85 = (85 * Math.PI) / 180;
        expect(85).toBeGreaterThan(ROUND_SWEEP_SPLIT_DEG);
        const n85 = sizedArcRows(sweep85, 0.5, 1.3, 6, 8, true);
        expect(n85).toBeGreaterThanOrEqual(Math.ceil(85 / 8));
        expect(85 / n85).toBeLessThanOrEqual(8 + 1e-6);
        const ala = constructArcLineArc(
            { x: 0, y: 0, z: 12 },
            { x: 8, y: 0, z: 0 },
            { x: 0, y: 0, z: 1 },
            0.5,
            2,
            { x: 1, y: 0 },
            0,
        );
        const nRound = topRoundRowCount(ala.roundSweep, ala.r1, 1.3);
        const stepDeg = (Math.abs(ala.roundSweep) * 180) / Math.PI / nRound;
        expect(stepDeg).toBeLessThanOrEqual(8 + 1e-6);
    });

    test("B-loop heading is perp to the B tangent within the 3° clamp", () => {
        const stations: HermiteStation[] = [
            {
                outline: { x: 9, y: 0, z: 0 },
                rim: { x: 7, y: 0.4, z: 10 },
                n: { x: 1, y: 0 },
                u: 0.3,
            },
            {
                outline: { x: 10, y: 0, z: 0 },
                rim: { x: 8, y: 0.5, z: 10 },
                n: { x: 1, y: 0 },
                u: 0.4,
            },
            {
                outline: { x: 11, y: 0, z: 0 },
                rim: { x: 9, y: 0.4, z: 10 },
                n: { x: 1, y: 0 },
                u: 0.5,
            },
        ];
        const bn = bLoopOutwardNormal(stations, 1);
        const chord = columnHeading(stations[1]!).h;
        const heads = smoothStationHeadings(stations);
        const h = heads[1]!;
        const toChord = (Math.acos(Math.max(-1, Math.min(1, h.x * chord.x + h.y * chord.y))) * 180) / Math.PI;
        expect(toChord).toBeLessThanOrEqual(HEADING_MAX_DEG + 1e-6);
        expect(headingAllowanceDeg(2)).toBe(HEADING_MAX_DEG);
        expect(headingAllowanceDeg(12)).toBe(HEADING_MAX_DEG);
        expect(bn.x * 0 + bn.y * 1).toBeLessThan(0.1);
        expect(Math.hypot(h.x, h.y)).toBeCloseTo(1, 6);
        expect(Math.abs(bn.x)).toBeLessThan(0.2);
    });

    test("last fillet vertex stays on the wall side of B with z >= 0.05", () => {
        const B = { x: 8, y: 0, z: 0 };
        const h = { x: 1, y: 0 };
        const col = [{ x: 0, y: 0, z: 12 }, { x: 8.2, y: 0, z: 0.01 }, { ...B }];
        clampLastFilletOutboard(col, B, h);
        const last = col[1]!;
        const sWall = (B.x - last.x) * h.x + (B.y - last.y) * h.y;
        expect(sWall).toBeGreaterThanOrEqual(0);
        expect(last.z).toBeGreaterThanOrEqual(LAST_FILLET_Z_MIN_MM - 1e-9);
        expect(LAST_FILLET_S_MIN_MM).toBe(0.05);
    });

    test("column rotation about B keeps B fixed and last fillet outboard", () => {
        const R = { x: 0, y: 0, z: 12 };
        const B = { x: 8, y: 0, z: 0 };
        const chord = { x: 1, y: 0 };
        const col = [R, { x: 4, y: 0, z: 6 }, { x: 7.8, y: 0, z: 0.2 }, B];
        const desired = { x: Math.cos(0.04), y: Math.sin(0.04) };
        const h = rotateColumnAboutB(col, B, R, chord, desired);
        expect(col[0]).toEqual(R);
        expect(col[col.length - 1]).toEqual(B);
        const last = col[col.length - 2]!;
        expect((B.x - last.x) * h.x + (B.y - last.y) * h.y).toBeGreaterThanOrEqual(
            LAST_FILLET_S_MIN_MM - 1e-6,
        );
        const toChord = (Math.acos(Math.max(-1, Math.min(1, h.x * chord.x + h.y * chord.y))) * 180) / Math.PI;
        expect(toChord).toBeLessThanOrEqual(HEADING_MAX_DEG + 1e-6);
    });

    test("steep top slope shrinks r1 and keeps n_top past vertical", () => {
        expect(STEEP_SHEET_DEG).toBe(60);
        const h = { x: 1, y: 0 };
        const n60 = nTopFromSheetSlope((60 * Math.PI) / 180, h);
        const n102 = nTopFromSheetSlope((102 * Math.PI) / 180, h);
        expect(n60.z).toBeGreaterThan(0);
        expect(n102.z).toBeLessThan(0);
        const face102 = sheetSlopeFromNormal(n102, h);
        expect(face102).not.toBeNull();
        expect(((face102 ?? 0) * 180) / Math.PI).toBeCloseTo(102, 4);
        expect(r1ForSheetSlope(0.5, (30 * Math.PI) / 180)).toBeCloseTo(0.5, 6);
        expect(r1ForSheetSlope(0.5, (90 * Math.PI) / 180)).toBe(MIN_ROUND_R_MM);
        const ala = constructArcLineArc(
            { x: 0, y: 0, z: 12 },
            { x: 8, y: 0, z: 0 },
            { x: 0, y: 0, z: 1 },
            0.5,
            2,
            h,
            0,
            (90 * Math.PI) / 180,
        );
        expect(ala.r1).toBeLessThan(0.1);
    });

    test("last fillet uses reserved dL on the exact arc and floors r2", () => {
        expect(DPHI_L_MAX_DEG).toBe(12);
        expect(FILLET_STEP_MAX_DEG).toBe(8);
        expect(CHORD_RISE_MAX_DEG).toBe(6);
        const spacing = 1.3;
        const r2Min = lastFilletR2MinMm(spacing);
        const cMin = lastFilletCMinMm(spacing);
        const R = { x: 0, y: 0, z: 12 };
        const B = { x: 8, y: 0, z: 0 };
        const h = { x: 1, y: 0 };
        const ala = constructArcLineArc(R, B, { x: 0, y: 0, z: 1 }, 0.5, 0.05, h, 0, undefined, spacing);
        expect(ala.r2).toBeGreaterThanOrEqual(r2Min - 1e-9);
        const phis = lastFilletPhis(ala.phiFil0, ala.phiFil1);
        expect(phis.length).toBeGreaterThanOrEqual(6);
        const pts = sampleArcLineArc(ala, h, R, B, 24, spacing);
        expect(pts[pts.length - 1]).toEqual(B);
        const last = pts[pts.length - 2]!;
        expect(dist3ish(last, B)).toBeGreaterThanOrEqual(cMin - 1e-6);
        expect(dist3ish(last, ala.C2)).toBeCloseTo(ala.r2, 5);
        const radial = { x: last.x - ala.C2.x, y: last.y - ala.C2.y, z: last.z - ala.C2.z };
        const tan = { x: -radial.z * h.x, y: -radial.z * h.y, z: radial.x * h.x + radial.y * h.y };
        const chord = { x: B.x - last.x, y: B.y - last.y, z: B.z - last.z };
        const tl = Math.hypot(tan.x, tan.y, tan.z) || 1;
        const cl = Math.hypot(chord.x, chord.y, chord.z) || 1;
        const sign = tan.x * chord.x + tan.y * chord.y + tan.z * chord.z < 0 ? -1 : 1;
        const rise =
            (Math.acos(
                Math.max(
                    -1,
                    Math.min(1, (sign * (tan.x * chord.x + tan.y * chord.y + tan.z * chord.z)) / (tl * cl)),
                ),
            ) *
                180) /
            Math.PI;
        expect(rise).toBeLessThanOrEqual(CHORD_RISE_MAX_DEG + 1e-3);
    });

    test("incident-face tangent and nTop share the normal-tilt convention", () => {
        const h = { x: 1, y: 0 };
        const tilt = (15 * Math.PI) / 180;
        const n = nTopFromSheetSlope(tilt, h);
        const fromFace = sheetSlopeFromNormal(n, h);
        expect(fromFace).not.toBeNull();
        expect(((fromFace ?? 0) * 180) / Math.PI).toBeCloseTo(15, 5);
        const T = incidentFaceTangent(n, h);
        expect(T).not.toBeNull();
        const tStart = {
            x: -n.z * h.x,
            y: -n.z * h.y,
            z: n.x * h.x + n.y * h.y,
        };
        const tl = Math.hypot(tStart.x, tStart.y, tStart.z) || 1;
        const t = { x: tStart.x / tl, y: tStart.y / tl, z: tStart.z / tl };
        const flipped = t.x * h.x + t.y * h.y > 0 ? { x: -t.x, y: -t.y, z: -t.z } : t;
        expect(T!.x).toBeCloseTo(flipped.x, 6);
        expect(T!.y).toBeCloseTo(flipped.y, 6);
        expect(T!.z).toBeCloseTo(flipped.z, 6);
    });

    test("r2 post-clamp rate limiter holds 10%/station", () => {
        expect(R2_CHANGE_MAX_PCT).toBe(10);
        expect(R2_RATE_LIMIT_PCT).toBeLessThanOrEqual(R2_CHANGE_MAX_PCT);
        expect(R_CHANGE_MAX_PCT).toBe(5);
        const raw = [1, 1.4, 2.2, 1.1, 0.8, 1.05];
        const limited = rateLimitClosed(raw, R2_CHANGE_MAX_PCT, 0.05);
        for (let i = 0; i < limited.length; i++) {
            const a = limited[i]!;
            const b = limited[(i + 1) % limited.length]!;
            const pct = (Math.abs(b - a) / Math.max(a, 1e-6)) * 100;
            expect(pct).toBeLessThanOrEqual(R2_CHANGE_MAX_PCT + 1e-6);
        }
        const down = rateLimitClosedDown(raw, R2_RATE_LIMIT_PCT, 0.05);
        for (let i = 0; i < down.length; i++) {
            const a = down[i]!;
            const b = down[(i + 1) % down.length]!;
            const pct = (Math.abs(b - a) / Math.max(a, 1e-6)) * 100;
            expect(pct).toBeLessThanOrEqual(R2_CHANGE_MAX_PCT + 1e-6);
        }
    });

    test("last-step dL is sized square to B and floors r2", () => {
        const spacing = 1.3;
        const S = Math.PI / 2;
        const dLSq = lastFilletDLRad(S, 1);
        const dLOb = lastFilletDLRad(S, 0.375);
        expect(dLOb).toBeLessThan(dLSq);
        expect((dLSq * 180) / Math.PI).toBeLessThanOrEqual(DPHI_L_MAX_DEG + 1e-9);
        const r2Ob = lastFilletR2MinMm(spacing, dLOb);
        const r2Sq = lastFilletR2MinMm(spacing, dLSq);
        expect(r2Ob).toBeGreaterThan(r2Sq);
        const ala = constructArcLineArc(
            { x: 0, y: 0, z: 12 },
            { x: 8, y: 0, z: 0 },
            { x: 0, y: 0, z: 1 },
            0.5,
            0.05,
            { x: 1, y: 0 },
            0,
            undefined,
            spacing,
            0.375,
        );
        expect(ala.r2).toBeGreaterThanOrEqual(r2Ob - 1e-6);
    });

    test("squareHeadingToB rotates only when cosT < 0.3", () => {
        const nB = { x: 1, y: 0 };
        const square = squareHeadingToB({ x: 1, y: 0 }, nB);
        expect(square.rotated).toBe(false);
        expect(square.cosT).toBeCloseTo(1, 6);
        const ang = (68 * Math.PI) / 180;
        const oblique = squareHeadingToB({ x: Math.cos(ang), y: Math.sin(ang) }, nB);
        expect(oblique.rotated).toBe(false);
        expect(oblique.cosT).toBeGreaterThan(COS_T_MIN - 1e-6);
        const steep = (80 * Math.PI) / 180;
        const fixed = squareHeadingToB({ x: Math.cos(steep), y: Math.sin(steep) }, nB);
        expect(fixed.rotated).toBe(true);
        expect(fixed.cosT).toBeGreaterThanOrEqual(COS_T_MIN - 1e-6);
        expect(fixed.angleDeg).toBeLessThanOrEqual(73);
    });

    test("identical piece counts emit a fixed row-to-piece map", () => {
        const R = { x: 0, y: 0, z: 12 };
        const B = { x: 8, y: 0, z: 0 };
        const h = { x: 1, y: 0 };
        const ala = constructArcLineArc(R, B, { x: 0, y: 0, z: 1 }, 0.5, 2, h, 0);
        const counts = { nRound: 8, nFil: 6, nLine: 10, nWall: 8 + 10 + 6 + 2 };
        const pts = sampleArcLineArc(
            ala,
            h,
            R,
            B,
            counts.nWall,
            1.3,
            counts,
            lastFilletDLRad(ala.filletSweep, 1),
        );
        expect(pts).toHaveLength(counts.nWall);
        expect(pts[0]).toEqual(R);
        expect(pts[pts.length - 1]).toEqual(B);
        expect(rowPieceId(0, counts)).toBe(0);
        expect(rowPieceId(counts.nRound, counts)).toBe(1);
        expect(rowPieceId(counts.nRound + counts.nLine, counts)).toBe(2);
        expect(rowPieceId(counts.nWall - 2, counts)).toBe(3);
        expect(rowPieceId(counts.nWall - 1, counts)).toBe(4);
    });
});

function dist3ish(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
