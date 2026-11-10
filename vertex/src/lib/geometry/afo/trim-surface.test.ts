// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { afoPrintShellInput } from "@/features/afo/AfoPrintPanel";
import { analyzeManifoldBuffers } from "@/lib/geometry/manifold-core";
import { designSettingsEnvelope, readStoredDesignSettings } from "../../../../shared/design-settings";
import { AFO_TRIM_SAMPLE_MAX_MM, defaultAfoDesignState } from "./defaults";
import { meshProjector, nearestVertex, positionsEqual } from "./mesh-ops";
import { buildAfoShell, resolveShellTrimLoop, trimPolygonForShell } from "./shell";
import { buildSyntheticLegMesh, buildUnitSphereMesh } from "./synthetic-leg";
import {
    countDistinctPoints,
    polylineSelfIntersects,
    registerTrimClick,
    validateTrimLoop,
} from "./trim-loop";
import {
    afoDesignBaseLabel,
    afoEditExclusive,
    closedTrimPreviewReady,
    enterAfoEdit,
    isAfoCastTrimPick,
} from "./trim-preview";
import {
    acceptTrimHit,
    affectedTrimSegments,
    balanceBracePins,
    fitSurfaceSpline,
    posteriorLeafPins,
    reprojectTrimPins,
} from "./trim-spline";
import type { AfoTriMesh, AfoVec3 } from "./types";

function dist(a: AfoVec3, b: AfoVec3): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function flatQuad(): AfoTriMesh {
    return {
        positions: new Float32Array([-20, -20, 0, 20, -20, 0, 20, 20, 0, -20, 20, 0]),
        indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    };
}

function ringPins(z: number, radius: number, count = 8): AfoVec3[] {
    const pins: AfoVec3[] = [];
    for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        pins.push({ x: Math.cos(a) * radius, y: Math.sin(a) * radius, z });
    }
    return pins;
}

function maxDeviationFromPolyline(curve: AfoVec3[], pins: AfoVec3[]): number {
    let dev = 0;
    for (const p of curve) {
        let best = Infinity;
        for (let i = 0; i < pins.length; i++) {
            const a = pins[i]!;
            const b = pins[(i + 1) % pins.length]!;
            const abx = b.x - a.x;
            const aby = b.y - a.y;
            const abz = b.z - a.z;
            const apx = p.x - a.x;
            const apy = p.y - a.y;
            const apz = p.z - a.z;
            const denom = abx * abx + aby * aby + abz * abz || 1;
            const t = Math.min(1, Math.max(0, (apx * abx + apy * aby + apz * abz) / denom));
            best = Math.min(best, Math.hypot(a.x + abx * t - p.x, a.y + aby * t - p.y, a.z + abz * t - p.z));
        }
        dev = Math.max(dev, best);
    }
    return dev;
}

describe("AFO trim surface contour", () => {
    test("each click adds a distinct hit point instead of collapsing to one vertex", () => {
        const mesh = flatQuad();
        const hits = [
            { x: -6, y: -4, z: 0.2 },
            { x: 6, y: -4, z: 0.2 },
            { x: 6, y: 5, z: 0.2 },
            { x: -5, y: 6, z: 0.2 },
        ];
        let pins: AfoVec3[] = [];
        for (const hit of hits) {
            const accepted = acceptTrimHit(mesh, hit);
            expect(accepted).not.toBeNull();
            const next = registerTrimClick(pins, accepted!);
            expect(next.added).toBe(true);
            pins = next.pins;
        }
        expect(pins).toHaveLength(4);
        expect(countDistinctPoints(pins)).toBe(4);
        expect(dist(pins[0]!, pins[1]!)).toBeGreaterThan(1);
        const again = registerTrimClick(pins, { ...pins[3]!, x: pins[3]!.x + 0.4 });
        expect(again.added).toBe(false);
        expect(again.pins).toHaveLength(4);
        const indices = pins.map(() => 0);
        const collapsed = validateTrimLoop(mesh, indices, true, { skipGeodesic: true });
        expect(collapsed.ok).toBe(false);
        expect(collapsed.reasons.some((r) => /distinct vertices/i.test(r))).toBe(true);
        const byHit = validateTrimLoop(mesh, indices, true, { skipGeodesic: true, points: pins });
        expect(byHit.reasons.some((r) => /distinct vertices/i.test(r))).toBe(false);
        expect(byHit.ok).toBe(true);
    });

    test("the curve stays on the mesh and is smoother than the pin polyline", () => {
        const sphere = buildUnitSphereMesh(40, 14);
        const pins = ringPins(8, 28, 8);
        const fit = fitSurfaceSpline(sphere, pins, { spacingMm: 0.5, closed: true });
        expect(fit.curve.length).toBeGreaterThan(pins.length * 2);
        expect(fit.maxSurfaceErrorMm).toBeLessThanOrEqual(0.1);
        expect(fit.ok).toBe(true);
        const snapped = pins.map((p) => meshProjector(sphere).closest(p).point);
        expect(maxDeviationFromPolyline(fit.curve, snapped)).toBeGreaterThan(0.4);
        expect(fit.maxTurnDeg).toBeLessThan(25);
        let step = 0;
        for (let i = 1; i < fit.curve.length; i++)
            step = Math.max(step, dist(fit.curve[i - 1]!, fit.curve[i]!));
        expect(step).toBeLessThanOrEqual(1.05);
    });

    test("the loop closes on the first pin and a short open stroke is not a closed preview", () => {
        const pins = ringPins(0, 30, 4);
        expect(closedTrimPreviewReady(2)).toBe(false);
        expect(closedTrimPreviewReady(3)).toBe(true);
        const open = registerTrimClick(pins.slice(0, 2), pins[0]!, 4);
        expect(open.closed).toBe(false);
        const closed = registerTrimClick(pins, { ...pins[0]!, x: pins[0]!.x + 2 }, null);
        expect(closed.closed).toBe(true);
        expect(closed.added).toBe(false);
        expect(closed.pins).toHaveLength(4);
        const screen = registerTrimClick(pins, { x: 0, y: 0, z: 80 }, 9);
        expect(screen.closed).toBe(true);
    });

    test("a closed trim polygon is the shell inner boundary", () => {
        const sphere = buildUnitSphereMesh(40, 12);
        const pins = ringPins(18, 26, 8);
        const fit = fitSurfaceSpline(sphere, pins, { spacingMm: 1, closed: true });
        const polygon = trimPolygonForShell(fit.curve, true);
        expect(polygon).not.toBeNull();
        expect(trimPolygonForShell(fit.curve, false)).toBeNull();
        const fallback = [0, 1, 2, 3];
        const loop = resolveShellTrimLoop(sphere, fallback, polygon!);
        expect(loop.length).toBeGreaterThanOrEqual(3);
        let z = 0;
        for (const i of loop) z += sphere.positions[i * 3 + 2] ?? 0;
        expect(z / loop.length).toBeGreaterThan(8);
        const shell = buildAfoShell(sphere, fallback, {
            thicknessMm: 4,
            edgeMm: 2.5,
            flareMm: 2.5,
            trimPolygon: polygon!,
            heelSeed: { x: 0, y: 0, z: -40 },
        });
        expect(shell.indices.length).toBeGreaterThan(12);
        let near = Infinity;
        const sample = polygon![Math.floor(polygon!.length / 2)]!;
        for (let i = 0; i < shell.positions.length / 3; i++) {
            near = Math.min(
                near,
                Math.hypot(
                    (shell.positions[i * 3] ?? 0) - sample.x,
                    (shell.positions[i * 3 + 1] ?? 0) - sample.y,
                    (shell.positions[i * 3 + 2] ?? 0) - sample.z,
                ),
            );
        }
        expect(near).toBeLessThan(8);
    });

    test("markers and trimline cannot both be the edit mode", () => {
        expect(enterAfoEdit("trim")).toEqual({ placingTrim: true, markersOn: false });
        expect(enterAfoEdit("markers")).toEqual({ placingTrim: false, markersOn: true });
        expect(afoEditExclusive({ placingTrim: true, placingLandmarks: true, placingClinical: true })).toBe(
            "trim",
        );
        expect(afoEditExclusive({ placingTrim: false, placingLandmarks: true, placingClinical: false })).toBe(
            "markers",
        );
    });

    test("the trim pick is the AFO cast, not SAMPLE_Top", () => {
        expect(isAfoCastTrimPick({ isAfoTrimPick: true, isAfoCast: true })).toBe(true);
        expect(isAfoCastTrimPick({ isAfoTrimPick: true, isAfoCast: true, visible: false })).toBe(true);
        expect(isAfoCastTrimPick({ isScanMesh: true, scanId: "scan-1", baseName: "SAMPLE_Top" })).toBe(false);
        expect(isAfoCastTrimPick({ isAfoTrimPick: true, isAfoCast: true, isSampleTop: true })).toBe(false);
        expect(isAfoCastTrimPick({ isAfoCast: true })).toBe(false);
        expect(afoDesignBaseLabel(true, "SAMPLE_Top")).toBe("AFO cast");
        expect(afoDesignBaseLabel(false, "SAMPLE_Top")).toBe("SAMPLE_Top");
    });

    test("dragging recomputes the local 4-pin span and stored pins reproject", () => {
        const sphere = buildUnitSphereMesh(40, 12);
        const pins = ringPins(6, 28, 8);
        const first = fitSurfaceSpline(sphere, pins, { spacingMm: 1, closed: true });
        const moved = pins.map((p) => ({ ...p }));
        moved[0] = { ...moved[0]!, x: moved[0]!.x + 3 };
        const second = fitSurfaceSpline(sphere, moved, {
            spacingMm: 1,
            closed: true,
            dragIndex: 0,
            previousSegments: first.segments,
            quick: true,
        });
        const opposite = 4;
        expect(affectedTrimSegments(8, 0, true)).not.toContain(opposite);
        expect(second.segments[opposite]).toBe(first.segments[opposite]);
        const quad = flatQuad();
        const lifted = reprojectTrimPins(quad, [{ point: { x: 1, y: 2, z: 2 }, vertexIndex: 0 }]);
        expect(Math.abs(lifted[0]!.point.z)).toBeLessThanOrEqual(0.1);
        const afo = defaultAfoDesignState("left");
        afo.trimPoints = [{ point: { x: 4, y: 5, z: 6 }, vertexIndex: 2 }];
        afo.trimClosed = false;
        const back = readStoredDesignSettings(designSettingsEnvelope({ productType: "afo", afo })) as {
            afo: typeof afo;
        };
        expect(back.afo.side).toBe("left");
        expect(back.afo.trimPoints[0]?.point).toEqual({ x: 4, y: 5, z: 6 });
    });

    test("a hit farther than 5 mm is rejected and a 4 mm miss uses a local plane", () => {
        const patch: AfoTriMesh = {
            positions: new Float32Array([0, 0, 0, 3, 0, 0, 0, 3, 0]),
            indices: new Uint32Array([0, 1, 2]),
        };
        expect(acceptTrimHit(patch, { x: 0.4, y: 0.4, z: 6 })).toBeNull();
        const plane = acceptTrimHit(patch, { x: 0.4, y: 0.4, z: 4 });
        expect(plane).not.toBeNull();
        expect(Math.abs(plane!.z)).toBeLessThan(0.5);
        const on = acceptTrimHit(patch, { x: 0.4, y: 0.4, z: 0.2 });
        expect(on).not.toBeNull();
        expect(meshProjector(patch).closest(on!).errorMm).toBeLessThanOrEqual(0.1);
    });
});

function maxStep(curve: AfoVec3[]): number {
    let step = 0;
    for (let i = 1; i < curve.length; i++) step = Math.max(step, dist(curve[i - 1]!, curve[i]!));
    return step;
}

function nearestOn(mesh: AfoTriMesh, p: AfoVec3): number {
    let best = Infinity;
    for (let i = 0; i < mesh.positions.length / 3; i++) {
        best = Math.min(
            best,
            Math.hypot(
                (mesh.positions[i * 3] ?? 0) - p.x,
                (mesh.positions[i * 3 + 1] ?? 0) - p.y,
                (mesh.positions[i * 3 + 2] ?? 0) - p.z,
            ),
        );
    }
    return best;
}

/** The old XY-only predicate. Uprights that only cross in plan view used to fail here. */
function xySegmentsCross(points: AfoVec3[]): boolean {
    const orient = (p: AfoVec3, q: AfoVec3, r: AfoVec3) =>
        Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
    const n = points.length;
    for (let i = 0; i < n; i++) {
        const a = points[i]!;
        const b = points[(i + 1) % n]!;
        for (let j = i + 2; j < n; j++) {
            if (i === 0 && j === n - 1) continue;
            const c = points[j]!;
            const d = points[(j + 1) % n]!;
            const o1 = orient(a, b, c);
            const o2 = orient(a, b, d);
            const o3 = orient(c, d, a);
            const o4 = orient(c, d, b);
            if (o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && o1 !== o2 && o3 !== o4) return true;
        }
    }
    return false;
}

describe("AFO trim confirmation and curve-accurate shell", () => {
    test("XY-only upright crossings do not reject a valid loop, and a real 3D crossing does", () => {
        const uprights = [
            { x: 20, y: 30, z: 170 },
            { x: 20, y: 50, z: 80 },
            { x: 16, y: 12, z: 14 },
            { x: 0, y: 40, z: 16 },
            { x: 40, y: 40, z: 18 },
            { x: -12, y: 14, z: 14 },
            { x: -20, y: 42, z: 90 },
            { x: 0, y: 18, z: 175 },
        ];
        expect(xySegmentsCross(uprights)).toBe(true);
        expect(polylineSelfIntersects(uprights)).toBe(false);
        const bowtie = [
            { x: 0, y: 0, z: 5 },
            { x: 12, y: 12, z: 6 },
            { x: 12, y: 0, z: 4 },
            { x: 0, y: 12, z: 7 },
        ];
        expect(polylineSelfIntersects(bowtie)).toBe(true);
    });

    test("sample spacing stays within the 1 mm cap and pin corners are exempt", () => {
        const quad = flatQuad();
        const sharp = [
            { x: -14, y: -10, z: 0 },
            { x: 14, y: -10, z: 0 },
            { x: 14, y: 10, z: 0 },
            { x: -14, y: 10, z: 0 },
        ];
        const fit = fitSurfaceSpline(quad, sharp, { spacingMm: 2, closed: true });
        expect(fit.reasons.join(" | ")).toBe("");
        expect(fit.ok).toBe(true);
        expect(maxStep(fit.curve)).toBeLessThanOrEqual(AFO_TRIM_SAMPLE_MAX_MM + 1e-3);
        for (const pin of sharp) {
            let best = Infinity;
            for (const p of fit.curve) best = Math.min(best, dist(p, pin));
            expect(best).toBeLessThanOrEqual(0.35);
        }
        expect(fit.maxTurnDeg).toBeLessThanOrEqual(25);
        expect(fit.maxChordErrorMm).toBeLessThanOrEqual(0.5);
    });

    test("a balance brace and a posterior leaf both confirm, and the contour passes through every pin", () => {
        const leg = buildSyntheticLegMesh();
        const afo = defaultAfoDesignState("left");
        for (const placed of [balanceBracePins(leg, afo), posteriorLeafPins(leg, afo)]) {
            const fit = fitSurfaceSpline(leg, placed.pins, { closed: true });
            expect(fit.reasons.join(" | ")).toBe("");
            expect(fit.ok).toBe(true);
            expect(maxStep(fit.curve)).toBeLessThanOrEqual(AFO_TRIM_SAMPLE_MAX_MM + 1e-3);
            const validation = validateTrimLoop(
                leg,
                placed.pins.map(() => 0),
                true,
                { skipGeodesic: true, points: placed.pins },
            );
            expect(validation.reasons.join(" | ")).toBe("");
            expect(validation.ok).toBe(true);
            for (const pin of placed.pins) {
                let best = Infinity;
                for (const p of fit.curve) best = Math.min(best, dist(pin, p));
                expect(best).toBeLessThanOrEqual(0.35);
            }
        }
    });

    test("the shell edge follows the trim curve, preview matches export, and flare lifts the inner rim", () => {
        const sphere = buildUnitSphereMesh(36, 10);
        const pins = ringPins(12, 30, 8);
        const fit = fitSurfaceSpline(sphere, pins, { spacingMm: 1, closed: true });
        expect(fit.ok).toBe(true);
        const polygon = trimPolygonForShell(fit.curve, true)!;
        const opts = {
            thicknessMm: 4,
            edgeMm: 2,
            flareMm: 0,
            trimPolygon: polygon,
            heelSeed: { x: 0, y: 0, z: -36 },
        };
        const preview = buildAfoShell(sphere, [0, 1, 2, 3], opts);
        const exported = buildAfoShell(sphere, [0, 1, 2, 3], opts);
        expect(positionsEqual(preview.positions, exported.positions)).toBe(true);
        const report = analyzeManifoldBuffers(exported.positions, exported.indices);
        expect(report.openEdges).toBe(0);
        expect(report.nonManifoldEdges).toBe(0);
        let worst = 0;
        let splitOffVertex = 0;
        for (const p of polygon) {
            worst = Math.max(worst, nearestOn(exported, p));
            if (Math.sqrt(nearestVertex(sphere, p).distSq) > 1 && nearestOn(exported, p) < 0.45)
                splitOffVertex++;
        }
        expect(worst).toBeLessThan(0.45);
        expect(splitOffVertex).toBeGreaterThan(0);
        const flared = buildAfoShell(sphere, [0, 1, 2, 3], { ...opts, flareMm: 1.5 });
        let lifted = 0;
        let onSkin = 0;
        for (const p of polygon) {
            const hit = meshProjector(sphere).closest(p);
            const raised = {
                x: p.x + hit.normal.x * 1.5,
                y: p.y + hit.normal.y * 1.5,
                z: p.z + hit.normal.z * 1.5,
            };
            if (nearestOn(flared, raised) < 0.75) lifted++;
            if (nearestOn(flared, p) > 0.8) onSkin++;
        }
        expect(lifted).toBeGreaterThan(polygon.length * 0.5);
        expect(onSkin).toBeGreaterThan(polygon.length * 0.5);
        const flaredReport = analyzeManifoldBuffers(flared.positions, flared.indices);
        expect(flaredReport.openEdges).toBe(0);
    });

    test("print builds the shell on the corrected mesh the trim was drawn on", () => {
        const corrected = buildUnitSphereMesh(30, 8);
        corrected.positions[0] = 42;
        const cast = buildUnitSphereMesh(30, 8);
        const chosen = afoPrintShellInput(corrected, cast);
        expect(chosen).toBe(corrected);
        expect(chosen?.positions[0]).toBe(42);
        expect(afoPrintShellInput(null, cast)).toBe(cast);
    });
});
