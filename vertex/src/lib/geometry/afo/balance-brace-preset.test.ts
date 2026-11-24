// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { medialSign } from "@/lib/geometry/handedness";
import type { Side } from "@/types";
import { BALANCE_BRACE_PRESET, buildBalanceBracePreset } from "./balance-brace-preset";
import { defaultAfoDesignState } from "./defaults";
import { alignScanToPlantarFrame } from "./landmark-frame";
import { meshProjector } from "./mesh-ops";
import { buildLiveFrameLeg, buildSyntheticLegMesh } from "./synthetic-leg";
import { polylineSelfIntersects } from "./trim-loop";
import type { AfoDesignState, AfoTriMesh, AfoVec3 } from "./types";

const P = BALANCE_BRACE_PRESET;

function onCast(mesh: AfoTriMesh, guess: AfoVec3): AfoVec3 {
    return meshProjector(mesh).closest(guess).point;
}

function withMarkers(
    side: Side,
    mesh: AfoTriMesh,
    fh: boolean,
): { afo: AfoDesignState; marks: Record<string, AfoVec3> } {
    const med = medialSign(side);
    const lat = -med;
    const marks = {
        mm: onCast(mesh, { x: 36, y: med * 40, z: 78 }),
        lm: onCast(mesh, { x: 30, y: lat * 40, z: 68 }),
        fh: onCast(mesh, { x: 28, y: lat * 36, z: 200 }),
        m1: onCast(mesh, { x: 130, y: med * 36, z: 14 }),
        m5: onCast(mesh, { x: 124, y: lat * 36, z: 14 }),
        hc: onCast(mesh, { x: 12, y: 0, z: 10 }),
        tt: onCast(mesh, { x: 168, y: 0, z: 22 }),
        nav: onCast(mesh, { x: 78, y: med * 36, z: 16 }),
        fifth: onCast(mesh, { x: 96, y: lat * 36, z: 16 }),
    };
    const afo = defaultAfoDesignState(side);
    afo.scanWorkflow = {
        ...afo.scanWorkflow,
        alignmentApplied: false,
        matrixElements: null,
        plantar: { heel: marks.hc, m1p: marks.m1, m5p: marks.m5 },
        landmarks: {
            medial_malleolus: marks.mm,
            lateral_malleolus: marks.lm,
            ...(fh ? { fibular_head: marks.fh } : {}),
            m1_mpj: marks.m1,
            m5_mpj: marks.m5,
            posterior_calcaneus: marks.hc,
            toe_tip: marks.tt,
            navicular: marks.nav,
            fifth_met_base: marks.fifth,
        },
    };
    return { afo, marks };
}

function openCurve(curve: AfoVec3[]): AfoVec3[] {
    if (curve.length > 2 && dist(curve[0]!, curve[curve.length - 1]!) < 0.2) return curve.slice(0, -1);
    return curve;
}

function dist(a: AfoVec3, b: AfoVec3): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function nearestOnSide(curve: AfoVec3[], z: number, sideY: number): AfoVec3 {
    let best = curve[0]!;
    let bestD = Infinity;
    for (const p of curve) {
        if (p.y * sideY <= 0) continue;
        const d = Math.abs(p.z - z);
        if (d < bestD) {
            bestD = d;
            best = p;
        }
    }
    return best;
}

describe("balance brace preset trimline", () => {
    test("the parameter table keeps the expert's numbers", () => {
        expect(P.anteriorOffsetAtMalleolusMm).toBe(10);
        expect(P.anteriorBlendAboveMalleolusMm).toBe(40);
        expect(P.tibialCrestClearanceMm).toBe(15);
        expect(P.lateralBrimBelowFhMm).toBe(25);
        expect(P.medialBrimDropMm).toBe(10);
        expect(P.posteriorMidlineDropMm).toBe(5);
        expect(P.brimCornerRadiusMm).toBe(12);
        expect(P.fhFallbackAboveAjcMm).toBe(110);
        expect(P.wallHeelMm).toBe(15);
        expect(P.wallMetMm).toBe(8);
        expect(P.wallToeMm).toBe(3);
        expect(P.navDipMm).toBe(10);
        expect(P.navRecoverMm).toBe(12);
        expect(P.navRecoverFraction).toBeCloseTo(0.55);
        expect(P.fifthMetDipMm).toBe(8);
        expect(P.lateralOutsideM5Mm).toBe(3);
        expect(P.toeRoundRadiusMm).toBe(15);
        expect(P.sampleMm).toBe(2);
        expect(P.maxTurnDeg).toBe(20);
    });

    test("both feet get one smooth closed loop from the synthetic demo leg", () => {
        for (const side of ["left", "right"] as const) {
            const mesh = buildLiveFrameLeg(side, 22);
            const { afo, marks } = withMarkers(side, mesh, true);
            const result = buildBalanceBracePreset(mesh, afo);
            const open = openCurve(result.curve);
            expect(result.placed, result.flags.map((flag) => flag.message).join(" | ")).toBe(true);
            expect(open.length).toBeGreaterThan(12);
            expect(dist(result.curve[0]!, result.curve[result.curve.length - 1]!)).toBeLessThan(0.5);
            expect(polylineSelfIntersects(open), `${side} self-intersection`).toBe(false);

            const medSign = medialSign(side);
            const medialEdge = nearestOnSide(open, marks.mm.z, medSign);
            const lateralEdge = nearestOnSide(open, marks.lm.z, -medSign);
            expect(Math.abs(medialEdge.z - marks.mm.z), `${side} medial sample`).toBeLessThanOrEqual(
                P.sampleMm,
            );
            expect(Math.abs(lateralEdge.z - marks.lm.z), `${side} lateral sample`).toBeLessThanOrEqual(
                P.sampleMm,
            );
            expect(Math.abs(medialEdge.x - (marks.mm.x + P.anteriorOffsetAtMalleolusMm))).toBeLessThanOrEqual(
                1,
            );
            expect(
                Math.abs(lateralEdge.x - (marks.lm.x + P.anteriorOffsetAtMalleolusMm)),
            ).toBeLessThanOrEqual(1);

            const zLat = marks.fh.z - P.lateralBrimBelowFhMm;
            const zMed = zLat - P.medialBrimDropMm;
            const zPost = (zLat + zMed) * 0.5 - P.posteriorMidlineDropMm;
            const lateralBrim = nearestOnSide(open, zLat, -medSign);
            const medialBrim = nearestOnSide(open, zMed, medSign);
            expect(
                Math.abs(lateralBrim.z - zLat),
                `${side} lateral brim ${lateralBrim.z} vs ${zLat}`,
            ).toBeLessThanOrEqual(1);
            expect(
                Math.abs(medialBrim.z - zMed),
                `${side} medial brim ${medialBrim.z} vs ${zMed}`,
            ).toBeLessThanOrEqual(1);
            let posterior = open[0]!;
            let posteriorScore = Infinity;
            for (const p of open) {
                if (p.z < zPost - 30) continue;
                const score = Math.abs(p.y) + Math.abs(p.z - zPost);
                if (score < posteriorScore) {
                    posteriorScore = score;
                    posterior = p;
                }
            }
            expect(
                Math.abs(posterior.z - zPost),
                `${side} posterior brim ${posterior.z} vs ${zPost}`,
            ).toBeLessThanOrEqual(1);

            const ajcX = (marks.mm.x + marks.lm.x) * 0.5;
            const posteriorCuts = open.filter(
                (p) => Math.abs(p.y) < 6 && p.x < ajcX - 8 && p.z < zPost - 12 && p.z > marks.hc.z + 28,
            );
            expect(posteriorCuts, `${side} posterior cut`).toEqual([]);

            expect(result.maxTurnDeg, `${side} turn ${result.maxTurnDeg}`).toBeLessThanOrEqual(P.maxTurnDeg);
            expect(result.controlsPerSide.medial).toBeGreaterThanOrEqual(20);
            expect(result.controlsPerSide.medial).toBeLessThanOrEqual(30);
            expect(result.controlsPerSide.lateral).toBeGreaterThanOrEqual(20);
            expect(result.controlsPerSide.lateral).toBeLessThanOrEqual(30);

            const distal = open.reduce((best, p) => (p.x > best.x ? p : best));
            expect(distal.x).toBeGreaterThanOrEqual(marks.tt.x + (afo.cast.toeBox.extraLengthMm ?? 15) - 1);
        }
    });

    test("Load synthetic demo leg keeps a closed loop after plantar alignment", () => {
        const mesh = buildSyntheticLegMesh(18);
        const heel = onCast(mesh, { x: 0, y: 12, z: 2 });
        const m1p = onCast(mesh, { x: 40, y: 140, z: 8 });
        const m5p = onCast(mesh, { x: -40, y: 140, z: 8 });
        const aligned = alignScanToPlantarFrame(mesh, { heel, m1p, m5p }, "left");
        const marks = {
            posterior_calcaneus: onCast(mesh, { x: 0, y: 4, z: 16 }),
            m1_mpj: onCast(mesh, { x: 26, y: 155, z: 18 }),
            m5_mpj: onCast(mesh, { x: -26, y: 145, z: 16 }),
            navicular: onCast(mesh, { x: 28, y: 85, z: 18 }),
            fifth_met_base: onCast(mesh, { x: -28, y: 100, z: 16 }),
            medial_malleolus: onCast(mesh, { x: 30, y: 40, z: 72 }),
            lateral_malleolus: onCast(mesh, { x: -28, y: 34, z: 62 }),
            fibular_head: onCast(mesh, { x: -22, y: 40, z: 185 }),
            toe_tip: onCast(mesh, { x: 0, y: 172, z: 20 }),
        };
        const afo = defaultAfoDesignState("left");
        afo.scanWorkflow = {
            ...afo.scanWorkflow,
            alignmentApplied: true,
            matrixElements: aligned.matrixElements,
            plantar: { heel, m1p, m5p },
            landmarks: marks,
        };
        const result = buildBalanceBracePreset(aligned.mesh, afo);
        expect(
            result.placed,
            result.popup?.message ?? result.flags.map((flag) => flag.message).join(" | "),
        ).toBe(true);
        const open = openCurve(result.curve);
        expect(dist(result.curve[0]!, result.curve[result.curve.length - 1]!)).toBeLessThan(0.5);
        expect(polylineSelfIntersects(open)).toBe(false);
        expect(result.maxTurnDeg).toBeLessThanOrEqual(P.maxTurnDeg);
    });

    test("a missing fibular head opens the popup path and does not throw", () => {
        const side: Side = "left";
        const mesh = buildLiveFrameLeg(side, 16);
        const { afo } = withMarkers(side, mesh, false);
        expect(() => buildBalanceBracePreset(mesh, afo)).not.toThrow();
        const blocked = buildBalanceBracePreset(mesh, afo);
        expect(blocked.placed).toBe(false);
        expect(blocked.popup).not.toBeNull();
        expect(blocked.popup?.issues.some((issue) => issue.id === "fibular_head")).toBe(true);
        expect(blocked.popup?.canContinue).toBe(true);
        expect(blocked.curve).toEqual([]);

        const continued = buildBalanceBracePreset(mesh, afo, { continueWithFallbacks: true });
        expect(continued.placed).toBe(true);
        expect(continued.flags.some((flag) => flag.id === "fh-fallback")).toBe(true);
        expect(polylineSelfIntersects(openCurve(continued.curve))).toBe(false);
    });
});
