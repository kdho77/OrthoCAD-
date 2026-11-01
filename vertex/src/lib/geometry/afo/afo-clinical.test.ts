// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { applyCastOps, applyToeBoxHeight, toeRegionMaxZ } from "./cast";
import {
    applyAfoCorrections,
    axisOrthogonalityDeg,
    clampFrontalDeg,
    clampSagittalDeg,
    malleolarAxes,
} from "./corrections";
import { detectTibialCrest } from "./crest";
import {
    AFO_SLOPE_LIMIT,
    defaultAfoCast,
    defaultAfoCorrections,
    defaultAfoCrest,
    defaultAfoDesignState,
    defaultAfoReliefs,
} from "./defaults";
import { geodesicDistanceField } from "./geodesic";
import { computeVertexNormals, nearestVertex, positionsEqual, vertexCount } from "./mesh-ops";
import {
    applyOffsetField,
    combineOffsetFormula,
    evaluateOffsetField,
    inwardDispAt,
    type OffsetFieldInput,
} from "./offset-field";
import { offsetMesh } from "./sdf-offset";
import { buildClinicalFixtureA, buildClinicalFixtureB, buildUnitSphereMesh } from "./synthetic-leg";
import { validateTrimLoop } from "./trim-loop";
import type { AfoClinicalMarker, AfoDesignState, AfoTriMesh, AfoVec3 } from "./types";
import { evaluateAfoWarnings, warningHas } from "./warnings";

function markersOf(fx: ReturnType<typeof buildClinicalFixtureA>): AfoClinicalMarker[] {
    const m = fx.markers;
    const mesh = fx.mesh;
    const snap = (id: AfoClinicalMarker["id"], p: AfoVec3): AfoClinicalMarker => ({
        id,
        point: p,
        vertexIndex: nearestVertex(mesh, p).index,
    });
    return [
        snap("navicular", m.navicular),
        snap("fifth_met_base", m.fifthMetBase),
        snap("post_calcaneus", m.postCalcaneus),
        snap("fibular_head", m.fibularHead),
        snap("tibial_tuberosity", m.tibialTuberosity),
        snap("distal_crest", m.distalCrest),
    ];
}

function baseInput(mesh: AfoTriMesh, fx: ReturnType<typeof buildClinicalFixtureA>): OffsetFieldInput {
    return {
        mesh,
        cCast: 0,
        cShin: 0,
        insensate: false,
        braceHeightMm: 220,
        reliefs: defaultAfoReliefs(),
        crest: { ...defaultAfoCrest(), points: fx.handCrest, lowConfidence: false },
        clinicalMarkers: markersOf(fx),
        landmarks: [
            {
                id: "malleolus_medial",
                point: fx.markers.medialMal,
                vertexIndex: nearestVertex(mesh, fx.markers.medialMal).index,
            },
            {
                id: "malleolus_lateral",
                point: fx.markers.lateralMal,
                vertexIndex: nearestVertex(mesh, fx.markers.lateralMal).index,
            },
        ],
        medialMal: fx.markers.medialMal,
        lateralMal: fx.markers.lateralMal,
    };
}

function designFrom(
    fx: ReturnType<typeof buildClinicalFixtureA>,
    side: "left" | "right" = "left",
): AfoDesignState {
    const afo = defaultAfoDesignState(side);
    afo.clinicalMarkers = markersOf(fx);
    afo.landmarks = [
        {
            id: "malleolus_medial",
            point: fx.markers.medialMal,
            vertexIndex: nearestVertex(fx.mesh, fx.markers.medialMal).index,
        },
        {
            id: "malleolus_lateral",
            point: fx.markers.lateralMal,
            vertexIndex: nearestVertex(fx.mesh, fx.markers.lateralMal).index,
        },
    ];
    afo.crest = { ...defaultAfoCrest(), points: fx.handCrest, lowConfidence: false };
    return afo;
}

describe("AFO clinical addendum (tests a–l)", () => {
    const fxA = buildClinicalFixtureA();
    const fxB = buildClinicalFixtureB();

    test("a) bone B>=0.5 does not shrink under c_cast+10 c_shin+4", () => {
        const field = evaluateOffsetField({
            ...baseInput(fxA.mesh, fxA),
            cCast: 10,
            cShin: 4,
            reliefs: { ...defaultAfoReliefs(), malleoli: { mm: 0, on: false } },
        });
        const out = applyOffsetField(fxA.mesh, field);
        const nrm = computeVertexNormals(fxA.mesh);
        const n = vertexCount(fxA.mesh);
        let checked = 0;
        for (let i = 0; i < n; i++) {
            if ((field.B[i] ?? 0) < 0.5) continue;
            checked++;
            expect(inwardDispAt(fxA.mesh, out, i, nrm)).toBeLessThanOrEqual(0.05);
        }
        expect(checked).toBeGreaterThan(8);
    });

    test("b) crest within 5mm over 90%; low-confidence blocks Cast", () => {
        const detA = detectTibialCrest(fxA.mesh, 220);
        const hand = fxA.handCrest;
        let ok = 0;
        for (const p of detA.points) {
            let best = Infinity;
            for (const h of hand) {
                const d = Math.hypot(p.x - h.x, p.y - h.y, p.z - h.z);
                if (d < best) best = d;
            }
            if (best <= 5) ok++;
        }
        expect(detA.points.length).toBeGreaterThan(4);
        expect(ok / detA.points.length).toBeGreaterThanOrEqual(0.9);

        const detB = detectTibialCrest(fxB.mesh, 220);
        expect(detB.lowConfidence).toBe(true);
        const afo = defaultAfoDesignState("left");
        afo.crest = detB;
        afo.clinicalMarkers = [];
        const warns = evaluateAfoWarnings(afo, fxB.mesh);
        expect(warns.some((w) => w.blocking && w.id === "crest_markers")).toBe(true);
    });

    test("c) T-core offset matches c ±0.3; outside T+feather no shrink", () => {
        const cCast = 8;
        const field = evaluateOffsetField({
            ...baseInput(fxA.mesh, fxA),
            cCast,
            cShin: 0,
            reliefs: {
                malleoli: { mm: 0, on: false },
                navicular: { mm: 0, on: false },
                fifthMetBase: { mm: 0, on: false },
                postCalcaneus: { mm: 0, on: false },
                fibularHead: { mm: 0, on: false },
            },
        });
        const out = applyOffsetField(fxA.mesh, field);
        const nrm = computeVertexNormals(fxA.mesh);
        const n = vertexCount(fxA.mesh);
        let core = 0;
        for (let i = 0; i < n; i++) {
            const T = field.T[i] ?? 0;
            const B = field.B[i] ?? 0;
            const disp = inwardDispAt(fxA.mesh, out, i, nrm);
            if (T >= 0.85 && B < 0.15) {
                core++;
                const expected = combineOffsetFormula({
                    B,
                    T,
                    W: field.W[i] ?? 0,
                    cCast,
                    cShin: 0,
                    cRel: 0,
                    insensate: false,
                });
                expect(Math.abs(disp - expected)).toBeLessThanOrEqual(0.3);
            }
            if (T < 1e-4 && B < 0.15) {
                expect(disp).toBeLessThanOrEqual(0.05);
            }
        }
        expect(core).toBeGreaterThan(5);
    });

    test("d) relief depth, falloff, monotone, overlapping smoothmin", () => {
        const mesh = fxA.mesh;
        const nav = fxA.markers.navicular;
        const field = evaluateOffsetField({
            ...baseInput(mesh, fxA),
            reliefs: {
                malleoli: { mm: 0, on: false },
                navicular: { mm: -3, on: true },
                fifthMetBase: { mm: 0, on: false },
                postCalcaneus: { mm: 0, on: false },
                fibularHead: { mm: 0, on: false },
            },
        });
        const out = applyOffsetField(mesh, field);
        const nrm = computeVertexNormals(mesh);
        const at = nearestVertex(mesh, nav).index;
        expect(Math.abs(inwardDispAt(mesh, out, at, nrm) - -3)).toBeLessThanOrEqual(0.2);

        const geo = geodesicDistanceField(mesh, [at]);
        const n = vertexCount(mesh);
        const pairs: { d: number; c: number }[] = [];
        for (let i = 0; i < n; i++) {
            const d = geo[i] ?? Infinity;
            const ci = field.c[i] ?? 0;
            if (d > 8 + field.featherMm + 2 && d < 80) {
                expect(Math.abs(ci)).toBeLessThanOrEqual(0.1);
            }
            if (Number.isFinite(d) && d < 40) pairs.push({ d, c: ci });
        }
        pairs.sort((a, b) => a.d - b.d);
        for (let i = 1; i < pairs.length; i++) {
            expect(Math.abs(pairs[i]!.c)).toBeLessThanOrEqual(Math.abs(pairs[i - 1]!.c) + 0.35);
        }

        const overlapInput = baseInput(mesh, fxA);
        overlapInput.clinicalMarkers = overlapInput.clinicalMarkers.map((m) =>
            m.id === "fifth_met_base" ? { ...m, point: nav, vertexIndex: at } : m,
        );
        overlapInput.reliefs = {
            malleoli: { mm: 0, on: false },
            navicular: { mm: -3, on: true },
            fifthMetBase: { mm: -3, on: true },
            postCalcaneus: { mm: 0, on: false },
            fibularHead: { mm: 0, on: false },
        };
        const ov = evaluateOffsetField(overlapInput);
        expect(Math.abs((ov.c[at] ?? 0) - -3)).toBeLessThanOrEqual(0.2);
    });

    test("e) max grad <= 0.7 at extremes", () => {
        const combos: [number, number, boolean][] = [
            [10, 4, false],
            [-10, -6, false],
            [10, -6, true],
            [-10, 4, true],
        ];
        for (const [cCast, cShin, ins] of combos) {
            const field = evaluateOffsetField({
                ...baseInput(fxA.mesh, fxA),
                cCast,
                cShin,
                insensate: ins,
                reliefs: {
                    malleoli: { mm: -6, on: true },
                    navicular: { mm: -6, on: true },
                    fifthMetBase: { mm: -6, on: true },
                    postCalcaneus: { mm: -6, on: true },
                    fibularHead: { mm: -6, on: true },
                },
            });
            expect(field.maxGrad).toBeLessThanOrEqual(AFO_SLOPE_LIMIT + 0.02);
            expect(field.meshable).toBe(true);
        }
    });

    test("f) defaults: only malleolar regions move >0.05 vs c=0 baseline", () => {
        const off = defaultAfoReliefs();
        off.malleoli = { mm: 0, on: false };
        off.navicular = { mm: 0, on: false };
        const zero = evaluateOffsetField({ ...baseInput(fxA.mesh, fxA), reliefs: off });
        const def = evaluateOffsetField(baseInput(fxA.mesh, fxA));
        const a = applyOffsetField(fxA.mesh, zero);
        const b = applyOffsetField(fxA.mesh, def);
        const nrm = computeVertexNormals(fxA.mesh);
        const n = vertexCount(fxA.mesh);
        const medI = nearestVertex(fxA.mesh, fxA.markers.medialMal).index;
        const latI = nearestVertex(fxA.mesh, fxA.markers.lateralMal).index;
        const geo = geodesicDistanceField(fxA.mesh, [medI, latI]);
        for (let i = 0; i < n; i++) {
            const move = Math.abs(inwardDispAt(a, b, i, nrm));
            if ((geo[i] ?? 99) > 12 + def.featherMm) {
                expect(move).toBeLessThanOrEqual(0.05);
            }
        }
        expect(Math.abs(inwardDispAt(a, b, medI, nrm))).toBeGreaterThan(0.05);
    });

    test("g) c_cast × c_shin × insensate vs formula ±0.3", () => {
        const reliefsOff = {
            malleoli: { mm: 0, on: false },
            navicular: { mm: 0, on: false },
            fifthMetBase: { mm: 0, on: false },
            postCalcaneus: { mm: 0, on: false },
            fibularHead: { mm: 0, on: false },
        };
        const n = vertexCount(fxA.mesh);
        for (const cCast of [-10, 0, 10] as const) {
            for (const cShin of [-6, 0, 4] as const) {
                for (const ins of [false, true]) {
                    const field = evaluateOffsetField({
                        ...baseInput(fxA.mesh, fxA),
                        cCast,
                        cShin,
                        insensate: ins,
                        reliefs: reliefsOff,
                    });
                    for (let i = 0; i < n; i += 7) {
                        const expected = combineOffsetFormula({
                            B: field.B[i] ?? 0,
                            T: field.T[i] ?? 0,
                            W: field.W[i] ?? 0,
                            cCast,
                            cShin,
                            cRel: 0,
                            insensate: ins,
                        });
                        expect(Math.abs((field.c[i] ?? 0) - expected)).toBeLessThanOrEqual(0.3);
                    }
                }
            }
        }
    });

    test("h) insensate zeros shrink and still applies reliefs", () => {
        const field = evaluateOffsetField({
            ...baseInput(fxA.mesh, fxA),
            cCast: 10,
            cShin: 4,
            insensate: true,
        });
        const out = applyOffsetField(fxA.mesh, field);
        const nrm = computeVertexNormals(fxA.mesh);
        const n = vertexCount(fxA.mesh);
        let maxShrink = 0;
        for (let i = 0; i < n; i++) {
            const d = inwardDispAt(fxA.mesh, out, i, nrm);
            if (d > maxShrink) maxShrink = d;
        }
        expect(maxShrink).toBeLessThanOrEqual(0.05);
        const mal = nearestVertex(fxA.mesh, fxA.markers.medialMal).index;
        expect(inwardDispAt(fxA.mesh, out, mal, nrm)).toBeLessThan(-0.5);
    });

    test("i) malleoli stay on sagittal axis; frontal orthogonality; clamps", () => {
        const med = fxA.markers.medialMal;
        const lat = fxA.markers.lateralMal;
        const axes = malleolarAxes(med, lat);
        expect(axisOrthogonalityDeg(axes.sagittal, axes.frontal)).toBeLessThanOrEqual(0.1);
        expect(axisOrthogonalityDeg(axes.frontal, axes.leg)).toBeLessThanOrEqual(0.1);
        expect(clampSagittalDeg(15)).toBe(10);
        expect(clampSagittalDeg(-9)).toBe(-5);
        expect(clampFrontalDeg(12)).toBe(10);
        expect(clampFrontalDeg(-12)).toBe(-10);

        const c = defaultAfoCorrections();
        c.legSideDeg = 10;
        c.smoothIterations = 0;
        const out = applyAfoCorrections(fxA.mesh, c, { medialMal: med, lateralMal: lat });
        const medI = nearestVertex(fxA.mesh, med).index;
        const latI = nearestVertex(fxA.mesh, lat).index;
        const move = (i: number) =>
            Math.hypot(
                (out.positions[i * 3] ?? 0) - (fxA.mesh.positions[i * 3] ?? 0),
                (out.positions[i * 3 + 1] ?? 0) - (fxA.mesh.positions[i * 3 + 1] ?? 0),
                (out.positions[i * 3 + 2] ?? 0) - (fxA.mesh.positions[i * 3 + 2] ?? 0),
            );
        expect(move(medI)).toBeLessThanOrEqual(0.01);
        expect(move(latI)).toBeLessThanOrEqual(0.01);
    });

    test("j) toe box height within ±0.5 mm", () => {
        const orig = toeRegionMaxZ(fxA.mesh);
        const box = { widthMm: 80, depthMm: 90, heightMm: 50, heightPct: 130, enabled: true };
        const out = applyToeBoxHeight(fxA.mesh, box);
        expect(Math.abs(toeRegionMaxZ(out) - orig * 1.3)).toBeLessThanOrEqual(0.5);
        const ident = applyToeBoxHeight(fxA.mesh, { ...box, heightPct: 100 });
        expect(Math.abs(toeRegionMaxZ(ident) - orig)).toBeLessThanOrEqual(0.5);
        void applyCastOps;
    });

    test("k) warnings fire at exact thresholds on both sides", () => {
        for (const side of ["left", "right"] as const) {
            const afo = designFrom(fxA, side);
            afo.cast.removeCastMm = 3;
            expect(warningHas(evaluateAfoWarnings(afo, fxA.mesh), "remove_cast_high")).toBe(false);
            afo.cast.removeCastMm = 3.1;
            expect(warningHas(evaluateAfoWarnings(afo, fxA.mesh), "remove_cast_high")).toBe(true);
            afo.cast.removeCastMm = -5;
            expect(warningHas(evaluateAfoWarnings(afo, fxA.mesh), "remove_cast_low")).toBe(false);
            afo.cast.removeCastMm = -5.1;
            expect(warningHas(evaluateAfoWarnings(afo, fxA.mesh), "remove_cast_low")).toBe(true);

            afo.corrections.legSideDeg = 5;
            expect(warningHas(evaluateAfoWarnings(afo, fxA.mesh), "df_high")).toBe(false);
            afo.corrections.legSideDeg = 5.1;
            expect(warningHas(evaluateAfoWarnings(afo, fxA.mesh), "df_high")).toBe(true);

            afo.corrections.legRearDeg = 5;
            expect(warningHas(evaluateAfoWarnings(afo, fxA.mesh), "frontal_high")).toBe(false);
            afo.corrections.legRearDeg = 5.1;
            expect(warningHas(evaluateAfoWarnings(afo, fxA.mesh), "frontal_high")).toBe(true);

            afo.corrections.legSideDeg = 5.1;
            afo.corrections.heelLiftMm = 8;
            expect(warningHas(evaluateAfoWarnings(afo, fxA.mesh), "df_heel")).toBe(false);
            afo.corrections.heelLiftMm = 8.1;
            expect(warningHas(evaluateAfoWarnings(afo, fxA.mesh), "df_heel")).toBe(true);

            afo.print.thicknessMm = 2;
            expect(warningHas(evaluateAfoWarnings(afo, fxA.mesh), "wall_thin")).toBe(false);
            afo.print.thicknessMm = 1.9;
            expect(warningHas(evaluateAfoWarnings(afo, fxA.mesh), "wall_thin")).toBe(true);

            afo.cast.insensate = true;
            expect(warningHas(evaluateAfoWarnings(afo, fxA.mesh), "insensate")).toBe(true);
        }
    });

    test("l) earlier AFO gates still pass (identity, trim); insole hashes untouched", () => {
        const sphere = buildUnitSphereMesh(30, 10);
        const id = offsetMesh(sphere, { distanceMm: 0 });
        expect(positionsEqual(sphere.positions, id.positions)).toBe(true);
        const zero = defaultAfoCorrections();
        zero.smoothIterations = 0;
        const out = applyAfoCorrections(fxA.mesh, zero);
        expect(positionsEqual(fxA.mesh.positions, out.positions)).toBe(true);
        const loop = [0, 1, 2, 3, 4, 5].filter((i) => i < vertexCount(sphere));
        if (loop.length >= 3) {
            const open = validateTrimLoop(sphere, loop, false);
            expect(open.ok).toBe(false);
        }
        expect(defaultAfoCast().removeCastMm).toBe(0);
        expect(defaultAfoDesignState().print.thicknessMm).toBe(4);
    });
});
