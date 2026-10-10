// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import {
    assertT0ClearsSheet,
    BEZIER_HANDLE_FRAC,
    buildBezierColumns,
    COLUMN_PLANARITY_LIMIT_MM,
    evalCubicBezier,
    FILLET_R_CAP_MM,
    filletCenterAndF,
    HANDLE_CHORD_CAP,
    initColumnFrames,
    MERGE_ROW_MM,
    offPlaneMm,
    R_SMOOTH_FRAC,
    rimOverhangMm,
    sampleByArcLength,
    sampleInPlaneSlope,
    slopeFromSheetPlane,
    summarizeWallBands,
    T0_PIN_DEG,
    TOP_CLEARANCE_DEG,
    t0FromSheetSlope,
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

    test("handles are 0.35 of |R-F| and never exceed half the chord", () => {
        const stations = [
            station(-20, 0, 12, { x: 0, y: -1 }),
            station(0, 8, 14, { x: 0, y: 1 }),
            station(20, 0, 10, { x: 1, y: 0 }),
        ];
        const junctions = stations.map(() => ({ planeN: { x: 0, y: 0, z: 1 }, slopeRad: 0.2 }));
        const frames = initColumnFrames(stations, junctions, defaults(), [20, 23, 18]);
        for (const fr of frames) {
            const rf = Math.hypot(fr.R.x - fr.F.x, fr.R.y - fr.F.y, fr.R.z - fr.F.z);
            expect(fr.a).toBeLessThanOrEqual(HANDLE_CHORD_CAP * rf + 1e-9);
            expect(fr.b).toBeLessThanOrEqual(HANDLE_CHORD_CAP * rf + 1e-9);
            expect(fr.a).toBeCloseTo(Math.min(BEZIER_HANDLE_FRAC * rf, HANDLE_CHORD_CAP * rf), 6);
        }
    });

    test("R and B never move; columns stay plan-monotone toward B", () => {
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
        const built = buildBezierColumns(stations, junctions, defaults(), rimLoop, () => 12, 14);
        expect(built.planReversals).toBe(0);
        expect(built.maxOffPlaneMm).toBeLessThanOrEqual(COLUMN_PLANARITY_LIMIT_MM);
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
            for (const p of col) {
                expect(offPlaneMm(p, fr.R, fr.h)).toBeLessThanOrEqual(COLUMN_PLANARITY_LIMIT_MM);
            }
        }
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

    test("T0 is min(sheet_h-10, -45); short chord stays nearly vertical", () => {
        const sheet = (43 * Math.PI) / 180;
        const t0 = t0FromSheetSlope(sheet, false);
        expect((t0 * 180) / Math.PI).toBeCloseTo(T0_PIN_DEG, 5);
        expect(t0).toBeLessThanOrEqual(sheet - (TOP_CLEARANCE_DEG * Math.PI) / 180 + 1e-12);
        const descending = (-48 * Math.PI) / 180;
        expect((t0FromSheetSlope(descending, false) * 180) / Math.PI).toBeCloseTo(-58, 5);
        expect((t0FromSheetSlope(0, false) * 180) / Math.PI).toBeCloseTo(T0_PIN_DEG, 5);
        expect((t0FromSheetSlope(sheet, true) * 180) / Math.PI).toBeCloseTo(-80, 5);
    });

    test("slope is sampled along +h; T0 pins to -45 even if the lip rises along +h", () => {
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
        expect((fr.t0TiltRad * 180) / Math.PI).toBeCloseTo(T0_PIN_DEG, 0);
        expect(fr.t0TiltRad).toBeLessThanOrEqual(
            fr.sheetSlopeRad - (TOP_CLEARANCE_DEG * Math.PI) / 180 + 1e-9,
        );
        expect(() => assertT0ClearsSheet(frames)).not.toThrow();
        expect(() => assertT0ClearsSheet([{ ...fr, t0TiltRad: fr.sheetSlopeRad }])).toThrow(/\[S1-T0\]/);
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

    test("fillet radius smooths at most 5% per station", () => {
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
            14,
        );
        for (const fr of built.frames) {
            expect(fr.bandZ).toBeGreaterThanOrEqual(fr.B.z - 1e-6);
            expect(fr.arcEndZ).toBeGreaterThanOrEqual(fr.bandZ - 1e-6);
        }
    });
});
