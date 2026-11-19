// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { medialSign } from "@/lib/geometry/handedness";
import {
    applySacrificialLeaderBlock,
    binaryStlBounds,
    binaryStlTriangleCount,
} from "@/lib/geometry/leader-block";
import { analyzeManifoldBuffers } from "@/lib/geometry/manifold-core";
import type { Side } from "@/types";
import { buildCurledAfoCast, buildCurledSoleSheet, curledSoleZ, soleSheetBoundary } from "./curled-afo-cast";
import { AFO_EDGE_MM, AFO_FLARE_MM, defaultAfoDesignState } from "./defaults";
import { countTriangleSelfIntersections } from "./self-intersection";
import { orientMeshOutward } from "./mesh-ops";
import { buildAfoShell, trimPolygonForShell } from "./shell";
import {
    AFO_FOREFOOT_BLEND_MM,
    AFO_FOREFOOT_PLANAR_MM,
    afoFlatPlateInputFields,
    applyOuterContactCut,
    assertFlatPlateAccepted,
    contactCutReportOf,
    contactPlanesFromLandmarks,
    FlatPlateRejected,
    flatPlateLockOf,
    flattenKeepSurface,
    heightAboveContact,
    seatBottomPlaneAtZ0,
    signedAheadOfMetLine,
    validateFlatPlate,
} from "./shell-flatten";
import { buildLiveFrameLeg } from "./synthetic-leg";
import { fitSurfaceSpline, posteriorLeafPins } from "./trim-spline";
import type { AfoTriMesh, AfoVec3 } from "./types";

const LEFT_TRIPOD = {
    heel: { x: 42, y: 0, z: 0 },
    m1: { x: 152, y: -28, z: 0 },
    m5: { x: 128, y: 28, z: 0 },
    thicknessMm: 3.2,
};

describe("AFO forefoot contact plane", () => {
    test("the plane comes from the plantar tripod and points up on both feet", () => {
        const left = contactPlanesFromLandmarks(LEFT_TRIPOD);
        const right = contactPlanesFromLandmarks({
            ...LEFT_TRIPOD,
            m1: { x: 152, y: 28, z: 0 },
            m5: { x: 128, y: -28, z: 0 },
        });
        expect(left.normal.z).toBeGreaterThan(0.99);
        expect(right.normal.z).toBeGreaterThan(0.99);
        expect(left.thicknessMm).toBe(3.2);
        expect(left.blendBehindMm).toBe(AFO_FOREFOOT_BLEND_MM);
        expect(Math.abs(heightAboveContact(left.m1, left))).toBeLessThan(1e-6);
        expect(Math.abs(heightAboveContact(left.m5, left))).toBeLessThan(1e-6);
        expect(Math.abs(signedAheadOfMetLine(left.m1, left))).toBeLessThan(1e-6);
        expect(Math.abs(signedAheadOfMetLine(left.m5, left))).toBeLessThan(1e-6);
    });

    test("distance is measured from the angled M1–M5 line, not the average X", () => {
        const planes = contactPlanesFromLandmarks(LEFT_TRIPOD);
        const averageX = (LEFT_TRIPOD.m1.x + LEFT_TRIPOD.m5.x) / 2;
        const lateralEarly = { x: 139, y: 28, z: 4 };
        const medialLate = { x: 145, y: -28, z: 4 };
        expect(lateralEarly.x).toBeLessThan(averageX);
        expect(medialLate.x).toBeGreaterThan(averageX);
        expect(signedAheadOfMetLine(lateralEarly, planes)).toBeGreaterThan(2);
        expect(signedAheadOfMetLine(medialLate, planes)).toBeLessThan(-2);
    });

    test("a stray low vertex does not move the contact plane or the thickness", () => {
        const planes = contactPlanesFromLandmarks(LEFT_TRIPOD);
        const spiked = buildCurledSoleSheet("left", 24, 12);
        let low = 0;
        let lowZ = Infinity;
        for (let i = 0; i < spiked.mesh.positions.length / 3; i++) {
            const z = spiked.mesh.positions[i * 3 + 2] ?? 0;
            if (z < lowZ) {
                lowZ = z;
                low = i;
            }
        }
        spiked.mesh.positions[low * 3 + 2] = -40;
        const again = contactPlanesFromLandmarks({
            heel: spiked.heel,
            m1: spiked.m1,
            m5: spiked.m5,
            thicknessMm: 5.5,
        });
        expect(again.thicknessMm).toBe(5.5);
        expect(again.origin.z).toBeCloseTo(spiked.heel.z, 5);
        expect(again.origin.z).toBeGreaterThan(-1);
        expect(planes.thicknessMm).toBe(3.2);
    });
});

describe("inner forefoot flatten before thickness", () => {
    test("left and right forefeet are planar forward of the met line and the toe lip is gone", () => {
        for (const side of ["left", "right"] as const) {
            const sheet = buildCurledSoleSheet(side);
            const before = new Float32Array(sheet.mesh.positions);
            const boundary = soleSheetBoundary(sheet.mesh);
            const lock = flattenKeepSurface(sheet.mesh.positions, sheet.mesh.indices, boundary, {
                heel: sheet.heel,
                m1: sheet.m1,
                m5: sheet.m5,
                thicknessMm: side === "left" ? 3 : 5.5,
            });
            const planes = lock.planes;
            let forward = 0;
            let forwardWorst = 0;
            let lip = 0;
            let curlBefore = 0;
            for (let i = 0; i < lock.flat.length; i++) {
                const p = point(sheet.mesh, i);
                const ahead = signedAheadOfMetLine(p, planes);
                if (ahead < 1 || !lock.flat[i]) continue;
                forward++;
                const h = Math.abs(heightAboveContact(p, planes));
                forwardWorst = Math.max(forwardWorst, h);
                const bz = before[i * 3 + 2] ?? 0;
                if (bz > 4) {
                    lip++;
                    curlBefore = Math.max(curlBefore, bz);
                }
            }
            expect(forward, side).toBeGreaterThan(30);
            expect(forwardWorst, side).toBeLessThanOrEqual(AFO_FOREFOOT_PLANAR_MM);
            expect(lip, side).toBeGreaterThan(5);
            expect(curlBefore, side).toBeGreaterThan(8);
        }
    });

    test("the lateral forefoot flattens where it crosses the angled line, before the average X", () => {
        const sheet = buildCurledSoleSheet("left", 60, 24);
        const before = new Float32Array(sheet.mesh.positions);
        const lock = flattenKeepSurface(
            sheet.mesh.positions,
            sheet.mesh.indices,
            soleSheetBoundary(sheet.mesh),
            { heel: sheet.heel, m1: sheet.m1, m5: sheet.m5, thicknessMm: 4 },
        );
        const averageX = (sheet.m1.x + sheet.m5.x) / 2;
        let earlyLateral = 0;
        let medialStillBehind = 0;
        for (let i = 0; i < lock.flat.length; i++) {
            const p = point(sheet.mesh, i);
            const was = before[i * 3 + 2] ?? 0;
            const ahead = signedAheadOfMetLine({ x: p.x, y: p.y, z: was }, lock.planes);
            if (p.y > 18 && p.x < averageX - 1 && p.x > 110 && ahead > 1 && was > 2) {
                earlyLateral++;
                expect(Math.abs(heightAboveContact(p, lock.planes))).toBeLessThanOrEqual(
                    AFO_FOREFOOT_PLANAR_MM,
                );
            }
            if (p.y < -18 && ahead < -AFO_FOREFOOT_BLEND_MM && was > 3 && p.x > 80 && p.x < averageX) {
                medialStillBehind++;
                expect(Math.abs(p.z - was)).toBeLessThan(0.4);
            }
        }
        expect(earlyLateral).toBeGreaterThan(0);
        expect(medialStillBehind).toBeGreaterThan(0);
    });

    test("the arch behind the blend and the heel cup stay, and left mirrors right", () => {
        const left = flattenSide("left");
        const right = flattenSide("right");
        expect(left.archKept).toBeGreaterThan(4);
        expect(right.archKept).toBeGreaterThan(4);
        expect(left.heelKept).toBeGreaterThan(3);
        expect(right.heelKept).toBeGreaterThan(3);
        expect(left.archHeight).toBeGreaterThan(4);
        expect(right.archHeight).toBeGreaterThan(4);
        const rightAt = new Map(right.samples.map((s) => [`${s.x.toFixed(2)}|${s.y.toFixed(2)}`, s.z]));
        let compared = 0;
        let worst = 0;
        for (const sample of left.samples) {
            const mirror = rightAt.get(`${sample.x.toFixed(2)}|${(-sample.y).toFixed(2)}`);
            if (mirror == null) continue;
            compared++;
            worst = Math.max(worst, Math.abs(sample.z - mirror));
        }
        expect(compared).toBeGreaterThan(40);
        expect(worst).toBeLessThan(0.75);
    });

    test("a 100k-triangle sole flattens in a few seconds", () => {
        const sheet = buildCurledSoleSheet("left", 250, 201);
        const tris = sheet.mesh.indices.length / 3;
        expect(tris).toBeGreaterThan(90_000);
        const started = performance.now();
        const lock = flattenKeepSurface(
            sheet.mesh.positions,
            sheet.mesh.indices,
            soleSheetBoundary(sheet.mesh),
            { heel: sheet.heel, m1: sheet.m1, m5: sheet.m5, thicknessMm: 4 },
        );
        const seconds = (performance.now() - started) / 1000;
        expect(seconds).toBeLessThan(8);
        expect(lock.flat.some((v) => v === 1)).toBe(true);
    });
});

describe("generate-shell inner forefoot", () => {
    test("the shell inner forefoot is flat and the upper brace matches the unflattened shell", () => {
        for (const side of ["left", "right"] as const) {
            const cast = buildCurledAfoCast(side, 28, 12);
            const built = shellPair(cast.mesh, side, cast, 4);
            const n = built.flat.outerVertex0 ?? 0;
            const planes = flatPlateLockOf(built.flat)?.planes;
            expect(planes, side).toBeTruthy();
            expect(planes!.normal.z, side).toBeGreaterThan(0.99);
            let forward = 0;
            let worst = 0;
            for (let i = 0; i < n; i++) {
                const p = point(built.flat, i);
                const ahead = signedAheadOfMetLine(p, planes);
                const h = heightAboveContact(p, planes);
                if (ahead > 2 && h < 12 && p.z < 30) {
                    forward++;
                    worst = Math.max(worst, Math.abs(h));
                }
            }
            const report = analyzeManifoldBuffers(built.flat.positions, built.flat.indices);
            expect(report.openEdges, side).toBe(0);
            expect(report.nonManifoldEdges, side).toBe(0);
            expect(forward, side).toBeGreaterThan(8);
            expect(worst, side).toBeLessThanOrEqual(0.35);
        }
    });

    test("the upper brace of a leg shell is unchanged while the forefoot gets flatter", () => {
        for (const side of ["left", "right"] as const) {
            const leg = buildLiveFrameLeg(side, 20);
            const marks = legTripod(leg, side);
            const afo = defaultAfoDesignState(side);
            afo.landmarks = [{ id: "distal", point: marks.distal, vertexIndex: 0 }];
            const placed = posteriorLeafPins(leg, afo);
            const fit = fitSurfaceSpline(leg, placed.pins, { closed: true, quick: true });
            expect(fit.ok, fit.reasons.join(" | ")).toBe(true);
            const polygon = trimPolygonForShell(fit.curve, true) ?? undefined;
            const common = {
                thicknessMm: 4,
                edgeMm: AFO_EDGE_MM,
                flareMm: 0,
                trimPolygon: polygon,
                heelSeed: marks.heel,
            };
            const flat = buildAfoShell(leg, [0, 1, 2], {
                ...common,
                flatPlate: { ...marks, thicknessMm: 4 },
            });
            const plain = buildAfoShell(leg, [0, 1, 2], common);
            const seated = flatPlateLockOf(flat)?.planes;
            expect(seated, side).toBeTruthy();
            const planes = contactPlanesFromLandmarks({ ...marks, thicknessMm: 4 });
            const plainSeated = {
                positions: new Float32Array(plain.positions),
                indices: plain.indices,
            };
            seatBottomPlaneAtZ0(plainSeated, planes);
            const n = Math.min(flat.outerVertex0 ?? 0, plain.outerVertex0 ?? 0);
            let upper = 0;
            let upperMoved = 0;
            let toeCurl = 0;
            let toeFlat = 0;
            for (let i = 0; i < n; i++) {
                const p = point(flat, i);
                const q = point(plain, i);
                if (q.z > 90) {
                    upper++;
                    const s = point(plainSeated, i);
                    upperMoved = Math.max(upperMoved, Math.hypot(p.x - s.x, p.y - s.y, p.z - s.z));
                }
                const ahead = signedAheadOfMetLine(q, planes);
                if (ahead > 4 && q.z < 40) {
                    const before = Math.abs(heightAboveContact(q, planes));
                    const after = Math.abs(heightAboveContact(p, seated!));
                    if (before > 2) {
                        toeCurl++;
                        toeFlat = Math.max(toeFlat, after);
                    }
                }
            }
            expect(upper, side).toBeGreaterThan(5);
            expect(upperMoved, side).toBeLessThan(0.5);
            expect(toeCurl, side).toBeGreaterThan(3);
            expect(toeFlat, side).toBeLessThanOrEqual(0.45);
        }
    });
});

describe("flat plate solid", () => {
    test("left and right plates match two thicknesses and stay a closed solid", () => {
        for (const side of ["left", "right"] as const) {
            for (const thickness of [4, 5.5]) {
                const cast = buildCurledAfoCast(side, 28, 12);
                const built = shellPair(cast.mesh, side, cast, thickness);
                const lock = flatPlateLockOf(built.flat);
                expect(lock, side).toBeTruthy();
                const report = validateFlatPlate(built.flat, lock!, AFO_EDGE_MM);
                const plainSi = countTriangleSelfIntersections(built.plain);
                const tag = `${side} ${thickness}`;
                expect(report.soleCount, tag).toBeGreaterThan(20);
                expect(report.openEdges, tag).toBe(0);
                expect(report.nonManifoldEdges, tag).toBe(0);
                expect(report.degenerateFaces, tag).toBe(0);
                expect(report.forefootPlanarityMm, tag).toBeLessThanOrEqual(0.1);
                expect(report.bottomPlanarityMm, tag).toBeLessThanOrEqual(0.1);
                expect(report.plateMinMm, tag).toBeGreaterThanOrEqual(thickness - 0.05);
                expect(report.plateMaxMm, tag).toBeLessThanOrEqual(thickness + 0.05);
                expect(
                    report.minWallMm,
                    `${tag} min wall ${report.minWallMm.toFixed(3)} mm >= edge ${AFO_EDGE_MM} mm`,
                ).toBeGreaterThanOrEqual(AFO_EDGE_MM - 1e-3);
                expect(report.excludedOuter, `${tag} excluded outer`).toBe(0);
                expect(
                    report.maxOuterAboveInnerMm,
                    `${tag} max outer above inner ${report.maxOuterAboveInnerMm.toFixed(3)} mm`,
                ).toBeLessThanOrEqual(0);
                expect(report.rimAboveInner, `${tag} rim above inner`).toBe(0);
                expect(report.footprintComponents, tag).toBe(1);
                expect(report.footprintHoles, tag).toBe(0);
                expect(report.footprintAreaMm2, tag).toBeGreaterThan(5000);
                expect(report.toeLipMm, tag).toBeLessThanOrEqual(0.1);
                expect(
                    report.selfIntersections,
                    `${tag} self-intersections ${report.selfIntersections} <= pre-flatten ${plainSi} (zero new pairs at >= 0.2 mm penetration)`,
                ).toBeLessThanOrEqual(plainSi);
                expect(lock!.planes.normal.z, tag).toBeGreaterThan(0.99);
                let seatedBottom = 0;
                let seatedN = 0;
                const nv = built.flat.outerVertex0 ?? 0;
                for (let i = 0; i < nv && i < lock!.flat.length; i++) {
                    if (!lock!.flat[i]) continue;
                    const ahead = signedAheadOfMetLine(point(built.flat, i), lock!.planes);
                    if (ahead < 1) continue;
                    seatedN++;
                    seatedBottom = Math.max(
                        seatedBottom,
                        Math.abs(built.flat.positions[(nv + i) * 3 + 2] ?? 0),
                    );
                }
                expect(seatedN, tag).toBeGreaterThan(8);
                expect(seatedBottom, tag).toBeLessThanOrEqual(0.15);
            }
        }
    });

    test("a finished shell thinner than the edge is rejected and the prior mesh is not replaced", () => {
        const cast = buildCurledAfoCast("left", 28, 12);
        const built = shellPair(cast.mesh, "left", cast, 5.5);
        const prior = built.flat.positions.slice();
        const lock = flatPlateLockOf(built.flat);
        expect(lock).toBeTruthy();
        assertFlatPlateAccepted(built.flat, lock!, AFO_EDGE_MM);
        const n = built.flat.outerVertex0 ?? 0;
        let victim = n;
        for (let i = 0; i < n; i++) {
            if (lock!.flat[i]) continue;
            victim = n + i;
            break;
        }
        built.flat.positions[victim * 3] = built.flat.positions[(victim - n) * 3] ?? 0;
        built.flat.positions[victim * 3 + 1] = built.flat.positions[(victim - n) * 3 + 1] ?? 0;
        built.flat.positions[victim * 3 + 2] = built.flat.positions[(victim - n) * 3 + 2] ?? 0;
        expect(() => assertFlatPlateAccepted(built.flat, lock!, AFO_EDGE_MM)).toThrow(FlatPlateRejected);
        expect(() => assertFlatPlateAccepted(built.flat, lock!, AFO_EDGE_MM)).toThrow(/minimum wall/i);
        expect(() => assertFlatPlateAccepted(built.flat, lock!, AFO_EDGE_MM)).toThrow(
            /previous shell was kept/i,
        );
        for (let i = 0; i < prior.length; i++) {
            if (i >= victim * 3 && i < victim * 3 + 3) continue;
            expect(built.flat.positions[i]).toBe(prior[i]);
        }
    });

    test("a stray low vertex does not change the plate thickness", () => {
        const cast = buildCurledAfoCast("left", 28, 12);
        const clean = shellPair(cast.mesh, "left", cast, 4).flat;
        const dropped = cast.mesh.positions.slice();
        let low = 0;
        for (let i = 1; i < dropped.length / 3; i++) {
            if ((dropped[i * 3 + 2] ?? 0) < (dropped[low * 3 + 2] ?? 0)) low = i;
        }
        dropped[low * 3 + 2] = -40;
        const strayMesh = { positions: dropped, indices: cast.mesh.indices };
        const stray = shellPair(strayMesh, "left", cast, 4).flat;
        const a = validateFlatPlate(clean, flatPlateLockOf(clean)!, AFO_EDGE_MM);
        const b = validateFlatPlate(stray, flatPlateLockOf(stray)!, AFO_EDGE_MM);
        expect(Math.abs(a.plateMinMm - 4)).toBeLessThan(0.15);
        expect(Math.abs(b.plateMinMm - 4)).toBeLessThan(0.15);
        expect(Math.abs(a.plateMaxMm - b.plateMaxMm)).toBeLessThan(0.2);
    });

    test("the blend slope stays bounded and malleoli on the leg stay put", () => {
        for (const side of ["left", "right"] as const) {
            const leg = buildLiveFrameLeg(side, 20);
            const marks = legTripod(leg, side);
            const afo = defaultAfoDesignState(side);
            afo.landmarks = [{ id: "distal", point: marks.distal, vertexIndex: 0 }];
            const placed = posteriorLeafPins(leg, afo);
            const fit = fitSurfaceSpline(leg, placed.pins, { closed: true, quick: true });
            expect(fit.ok, fit.reasons.join(" | ")).toBe(true);
            const polygon = trimPolygonForShell(fit.curve, true) ?? undefined;
            const common = {
                thicknessMm: 4,
                edgeMm: AFO_EDGE_MM,
                flareMm: 0,
                trimPolygon: polygon,
                heelSeed: marks.heel,
            };
            const flat = buildAfoShell(leg, [0, 1, 2], {
                ...common,
                flatPlate: { ...marks, thicknessMm: 4 },
            });
            const plain = buildAfoShell(leg, [0, 1, 2], common);
            const lock = flatPlateLockOf(flat);
            expect(lock).toBeTruthy();
            const report = validateFlatPlate(flat, lock!, AFO_EDGE_MM);
            const plainSi = countTriangleSelfIntersections(plain);
            expect(report.openEdges, side).toBe(0);
            expect(report.nonManifoldEdges, side).toBe(0);
            expect(report.invertedEdges, side).toBe(0);
            expect(report.degenerateFaces, side).toBe(0);
            expect(report.forefootPlanarityMm, side).toBeLessThanOrEqual(0.1);
            expect(report.bottomPlanarityMm, side).toBeLessThanOrEqual(0.1);
            expect(report.plateMinMm, side).toBeGreaterThanOrEqual(3.95);
            expect(report.plateMaxMm, side).toBeLessThanOrEqual(4.05);
            expect(
                report.minWallMm,
                `${side} min wall ${report.minWallMm.toFixed(3)} mm >= edge ${AFO_EDGE_MM} mm`,
            ).toBeGreaterThanOrEqual(AFO_EDGE_MM - 1e-3);
            expect(report.excludedOuter, side).toBe(0);
            expect(report.maxOuterAboveInnerMm, side).toBeLessThanOrEqual(0);
            expect(report.rimAboveInner, side).toBe(0);
            expect(report.footprintComponents, side).toBe(1);
            expect(report.footprintHoles, side).toBe(0);
            expect(report.toeLipMm, side).toBeLessThanOrEqual(0.1);
            expect(
                report.selfIntersections,
                `${side} self-intersections ${report.selfIntersections} <= pre-flatten ${plainSi} (zero new pairs at >= 0.2 mm penetration)`,
            ).toBeLessThanOrEqual(plainSi);
            let slope = 0;
            const n = flat.outerVertex0 ?? 0;
            const adj = new Map<number, number[]>();
            const link = (a: number, b: number) => {
                if (a >= n || b >= n) return;
                const list = adj.get(a) ?? [];
                list.push(b);
                adj.set(a, list);
            };
            const faces = (flat.indices.length / 3) | 0;
            for (let i = 0; i < faces; i++) {
                const a = flat.indices[i * 3] ?? 0;
                const b = flat.indices[i * 3 + 1] ?? 0;
                const c = flat.indices[i * 3 + 2] ?? 0;
                if (a < n && b < n && c < n) {
                    link(a, b);
                    link(b, c);
                    link(c, a);
                }
            }
            for (let i = 0; i < n; i++) {
                if (!lock!.flat[i]) continue;
                const p = point(flat, i);
                const hp = heightAboveContact(p, lock!.planes);
                for (const j of adj.get(i) ?? []) {
                    if (!lock!.flat[j]) continue;
                    const q = point(flat, j);
                    const ds = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
                    if (ds < 0.5) continue;
                    slope = Math.max(slope, Math.abs(hp - heightAboveContact(q, lock!.planes)) / ds);
                }
            }
            expect(slope, side).toBeLessThan(1.2);
            let malleoli = 0;
            let moved = 0;
            const limit = Math.min(n, plain.outerVertex0 ?? 0);
            const plainSeated = {
                positions: new Float32Array(plain.positions),
                indices: plain.indices,
            };
            seatBottomPlaneAtZ0(plainSeated, contactPlanesFromLandmarks({ ...marks, thicknessMm: 4 }));
            for (let i = 0; i < limit; i++) {
                const q = point(plain, i);
                if (q.z < 55 || q.z > 110 || q.x > 70) continue;
                malleoli++;
                const p = point(flat, i);
                const s = point(plainSeated, i);
                moved = Math.max(moved, Math.hypot(p.x - s.x, p.y - s.y, p.z - s.z));
            }
            expect(malleoli, side).toBeGreaterThan(4);
            expect(moved, side).toBeLessThan(0.6);
        }
    });
});

describe("belt seat and leader", () => {
    test("the seated leg takes a leader at the toe and is measured against the belt", () => {
        const bed = { x: 300, y: 100000, z: 200 };
        for (const side of ["left", "right"] as const) {
            const leg = buildLiveFrameLeg(side, 18);
            const marks = legTripod(leg, side);
            const afo = defaultAfoDesignState(side);
            afo.landmarks = [{ id: "distal", point: marks.distal, vertexIndex: 0 }];
            const placed = posteriorLeafPins(leg, afo);
            const fit = fitSurfaceSpline(leg, placed.pins, { closed: true, quick: true });
            expect(fit.ok, fit.reasons.join(" | ")).toBe(true);
            const shell = buildAfoShell(leg, [0, 1, 2], {
                thicknessMm: 4,
                edgeMm: AFO_EDGE_MM,
                flareMm: 0,
                trimPolygon: trimPolygonForShell(fit.curve, true) ?? undefined,
                heelSeed: marks.heel,
                flatPlate: { ...marks, thicknessMm: 4 },
            });
            const solid = meshBinaryStl(shell);
            const withLeader = applySacrificialLeaderBlock(solid);
            const solidTris = binaryStlTriangleCount(solid);
            const uploadTris = binaryStlTriangleCount(withLeader);
            const bounds = binaryStlBounds(withLeader);
            const ySpan = bounds.maxY - bounds.minY;
            const zSpan = bounds.maxZ - bounds.minZ;
            expect(uploadTris, side).toBeGreaterThan(solidTris);
            expect(bounds.minZ, side).toBeGreaterThanOrEqual(-0.05);
            expect(bounds.minZ, side).toBeLessThanOrEqual(0.2);
            expect(ySpan, side).toBeLessThan(bed.x);
            expect(zSpan, side).toBeGreaterThan(4);
            expect(bounds.maxX, side).toBeGreaterThan(binaryStlBounds(solid).maxX);
        }
    });
});

describe("patterned outer contact", () => {
    test("the curled 36x16 template cannot seat inside the 1.5 mm cut", () => {
        for (const side of ["left", "right"] as const) {
            const cast = buildCurledAfoCast(side, 36, 16);
            const spec = { heel: cast.heel, m1: cast.m1, m5: cast.m5, thicknessMm: 4 };
            const common = {
                thicknessMm: 4,
                edgeMm: AFO_EDGE_MM,
                flareMm: AFO_FLARE_MM,
                trimPolygon: trimPolygonForShell(footplateLoop(cast.mesh, side), true) ?? undefined,
                heelSeed: cast.heel,
            };
            const plain = buildAfoShell(cast.mesh, [0, 1, 2], common);
            const cut = buildAfoShell(cast.mesh, [0, 1, 2], { ...common, contactCut: spec });
            const report = contactCutReportOf(cut);
            expect(report, side).toBeTruthy();
            const n = cut.outerVertex0 ?? 0;
            for (let i = 0; i < n * 3; i++) expect(cut.positions[i], side).toBe(plain.positions[i]);
            expect(report!.templateRangeMm, `${side} range ${report!.templateRangeMm.toFixed(2)}`).toBeGreaterThan(1.5);
            expect(report!.reachableFraction, `${side} reachable ${report!.reachableFraction.toFixed(2)}`).toBeLessThan(
                0.98,
            );
            expect(report!.seated, side).toBe(false);
            expect(report!.dMm + report!.rMm, side).toBeLessThanOrEqual(1.5 + 1e-6);
            const manifold = analyzeManifoldBuffers(cut.positions, cut.indices);
            expect(manifold.openEdges, side).toBe(0);
            expect(manifold.nonManifoldEdges, side).toBe(0);
            expect(manifold.isWatertight, side).toBe(true);
            expect(maxRise(plain, cut), side).toBeLessThanOrEqual(1.5 + 1e-3);
            expect(minPairedWall(cut), side).toBeGreaterThanOrEqual(Math.min(minPairedWall(plain), AFO_EDGE_MM) - 1e-3);
        }
    });

    test("US M9 medium seats the patterned contact on both feet", () => {
        for (const side of ["left", "right"] as const) expectSeatedContact(side);
    });

    test("plate mode stays byte-identical when a contact cut is also requested", () => {
        const cast = buildCurledAfoCast("left", 28, 12);
        const spec = { heel: cast.heel, m1: cast.m1, m5: cast.m5, thicknessMm: 4 };
        const common = {
            thicknessMm: 4,
            edgeMm: AFO_EDGE_MM,
            flareMm: AFO_FLARE_MM,
            trimPolygon: trimPolygonForShell(footplateLoop(cast.mesh, "left"), true) ?? undefined,
            heelSeed: cast.heel,
            flatPlate: spec,
        };
        const plate = buildAfoShell(cast.mesh, [0, 1, 2], common);
        const both = buildAfoShell(cast.mesh, [0, 1, 2], { ...common, contactCut: spec });
        expect(both.positions.length).toBe(plate.positions.length);
        for (let i = 0; i < plate.positions.length; i++) {
            expect(both.positions[i]).toBe(plate.positions[i]);
        }
        expect(Array.from(both.indices)).toEqual(Array.from(plate.indices));
        void applyOuterContactCut;
    });

    test("a 100k-triangle contact build stays under 4 seconds", () => {
        const times: number[] = [];
        for (let run = 0; run < 3; run++) {
            const shell = denseContactSlab(180, 140);
            const t0 = performance.now();
            applyOuterContactCut(shell, slabSpec(), AFO_EDGE_MM);
            times.push(performance.now() - t0);
        }
        times.sort((a, b) => a - b);
        const median = times[1] ?? times[0] ?? Infinity;
        expect(median, `median ${median.toFixed(0)} ms of ${times.map((t) => t.toFixed(0)).join(", ")}`).toBeLessThan(
            4000,
        );
    });
});

describe("shell input includes flattening", () => {
    test("flat-plate fields are the object PR #338's shell fingerprint should spread", () => {
        const afo = defaultAfoDesignState("right");
        afo.print.thicknessMm = 5.5;
        afo.print.edgeMm = 2;
        afo.scanWorkflow.plantar = {
            heel: { x: 1, y: 2, z: 3 },
            m1p: { x: 4, y: 5, z: 6 },
            m5p: { x: 7, y: 8, z: 9 },
        };
        const fields = afoFlatPlateInputFields(afo);
        expect(fields.enabled).toBe(true);
        expect(fields.blendBehindMm).toBe(AFO_FOREFOOT_BLEND_MM);
        expect(fields.thicknessMm).toBe(5.5);
        expect(fields.edgeMm).toBe(2);
        expect(fields.m1).toEqual({ x: 4, y: 5, z: 6 });
        expect(fields.m5).toEqual({ x: 7, y: 8, z: 9 });
    });
});

function expectSeatedContact(side: "left" | "right"): void {
    const cast = buildUsM9MediumCast(side);
    const spec = { heel: cast.heel, m1: cast.m1, m5: cast.m5, thicknessMm: 4 };
    const common = {
        thicknessMm: 4,
        edgeMm: AFO_EDGE_MM,
        flareMm: AFO_FLARE_MM,
        trimPolygon: trimPolygonForShell(cast.trim, true) ?? undefined,
        heelSeed: cast.heel,
    };
    const plain = buildAfoShell(cast.mesh, [0, 1, 2], common);
    const cut = buildAfoShell(cast.mesh, [0, 1, 2], { ...common, contactCut: spec });
    const report = contactCutReportOf(cut);
    expect(report, side).toBeTruthy();
    const n = cut.outerVertex0 ?? 0;
    for (let i = 0; i < n * 3; i++) expect(cut.positions[i], side).toBe(plain.positions[i]);
    const frame = report!.frame;
    const poly = report!.polygon;
    const beltOf = (i: number, mesh: AfoTriMesh) => {
        const rx = (mesh.positions[i * 3] ?? 0) - frame.origin.x;
        const ry = (mesh.positions[i * 3 + 1] ?? 0) - frame.origin.y;
        const rz = (mesh.positions[i * 3 + 2] ?? 0) - frame.origin.z;
        const s = rx * frame.forward.x + ry * frame.forward.y + rz * frame.forward.z;
        const t = rx * frame.lateral.x + ry * frame.lateral.y + rz * frame.lateral.z;
        const h = rx * frame.normal.x + ry * frame.normal.y + rz * frame.normal.z;
        return { s, t, z: h - (frame.h0 + frame.a * s + frame.b * t) };
    };
    const inside = (s: number, t: number) => pointInPolygon(s, t, poly);
    const distTo = (s: number, t: number) => distToPolygon(s, t, poly);
    const total = (cut.positions.length / 3) | 0;
    let minBelt = Infinity;
    const contact: Array<{ s: number; t: number }> = [];
    for (let i = 0; i < total; i++) {
        const b = beltOf(i, cut);
        if (b.z < minBelt) minBelt = b.z;
        if (i >= n && Math.abs(b.z) <= 1e-4) contact.push(b);
    }
    let contactOutside = 0;
    let hausFromContact = 0;
    for (const p of contact) {
        const d = distTo(p.s, p.t);
        if (!inside(p.s, p.t)) {
            hausFromContact = Math.max(hausFromContact, d);
            if (d > 0.15) contactOutside++;
        }
    }
    const cell = 0.45;
    const template = new Set<string>();
    let sMin = Infinity;
    let sMax = -Infinity;
    let tMin = Infinity;
    let tMax = -Infinity;
    for (const p of poly) {
        sMin = Math.min(sMin, p.s);
        sMax = Math.max(sMax, p.s);
        tMin = Math.min(tMin, p.t);
        tMax = Math.max(tMax, p.t);
    }
    const ks0 = Math.floor(sMin / cell);
    const ks1 = Math.ceil(sMax / cell);
    const kt0 = Math.floor(tMin / cell);
    const kt1 = Math.ceil(tMax / cell);
    for (let ks = ks0; ks <= ks1; ks++) {
        for (let kt = kt0; kt <= kt1; kt++) if (inside(ks * cell, kt * cell)) template.add(`${ks}|${kt}`);
    }
    const hit = rasterContact(cut, n, beltOf, cell);
    let inter = 0;
    for (const k of hit) if (template.has(k)) inter++;
    const union = template.size + hit.size - inter;
    const iou = union > 0 ? inter / union : 0;
    let covered = 0;
    for (const k of template) if (hit.has(k)) covered++;
    const coverage = template.size > 0 ? covered / template.size : 0;
    const edgePts = contactBoundary(cut, n, beltOf);
    let haus = hausFromContact;
    for (const b of edgePts) {
        if (!inside(b.s, b.t)) haus = Math.max(haus, distTo(b.s, b.t));
    }
    for (const p of poly) {
        let best = Infinity;
        for (const b of edgePts) best = Math.min(best, Math.hypot(b.s - p.s, b.t - p.t));
        if (edgePts.length > 0) haus = Math.max(haus, best);
    }
    const boundary = orderAlongPoly(edgePts, poly);
    const radius = minPlanRadius(boundary).radius;
    const lead = leadingEdge(boundary);
    const ramp = maxZoneDihedral(cut, n, beltOf, 0, report!.rMm + 0.02);
    const folds = countSharpFolds(plain, cut, 60);
    const manifold = analyzeManifoldBuffers(cut.positions, cut.indices);
    const com = areaComMargin(cut, frame, poly);
    let away = 0;
    let awayN = 0;
    for (let i = n; i < Math.min(total, n * 2); i++) {
        const b = beltOf(i, plain);
        if (b.z < report!.rMm + 2) continue;
        if (distTo(b.s, b.t) < 8) continue;
        const gap = pairedGap(cut, i);
        const was = pairedGap(plain, i);
        if (Math.abs(was - 4) > 0.35) continue;
        away = Math.max(away, Math.abs(gap - 4));
        awayN++;
    }
    expect(
        report!.seated,
        `${side} seated=${report!.seated} fallback=${report!.fallback} range=${report!.templateRangeMm.toFixed(2)} reach=${report!.reachableFraction.toFixed(2)} margin=${report!.comMarginMm.toFixed(1)} d=${report!.dMm.toFixed(2)} neck=${report!.neckWidthRatio.toFixed(3)}`,
    ).toBe(true);
    expect(
        report!.fallback,
        `${side} fallback=${report!.fallback} range=${report!.templateRangeMm.toFixed(2)} margin=${report!.comMarginMm.toFixed(1)} d=${report!.dMm.toFixed(2)}`,
    ).toBe("none");
    expect(minBelt, `${side} min belt ${minBelt.toFixed(4)}`).toBeGreaterThanOrEqual(-1e-3);
    expect(contactOutside, `${side} contact outside`).toBe(0);
    expect(iou, `${side} iou ${iou.toFixed(3)} cov ${coverage.toFixed(3)}`).toBeGreaterThanOrEqual(0.95);
    expect(coverage, `${side} coverage ${coverage.toFixed(3)}`).toBeGreaterThanOrEqual(0.98);
    expect(haus, `${side} hausdorff ${haus.toFixed(2)}`).toBeLessThanOrEqual(1);
    expect(report!.neckWidthRatio, `${side} neck ${report!.neckWidthRatio.toFixed(3)}`).toBeGreaterThanOrEqual(0.22);
    expect(report!.neckWidthRatio, side).toBeLessThanOrEqual(0.28);
    expect(report!.lateralInsetMm, `${side} inset ${report!.lateralInsetMm.toFixed(2)}`).toBeGreaterThanOrEqual(2);
    expect(report!.lateralInsetMm, side).toBeLessThanOrEqual(4);
    expect(radius, `${side} edge radius ${radius.toFixed(1)}`).toBeGreaterThanOrEqual(10);
    expect(report!.startLengthMm, side).toBeGreaterThanOrEqual(20);
    // The toe outline limits the front: blunting it to a 40 mm radius drops the
    // flank edge radius below 10 mm. The smooth edge holds a 16 mm front.
    expect(lead.radius, `${side} lead radius ${lead.radius.toFixed(1)}`).toBeGreaterThanOrEqual(15);
    expect(lead.length, `${side} lead length ${lead.length.toFixed(1)}`).toBeGreaterThanOrEqual(13);
    expect(report!.dMm + report!.rMm, side).toBeLessThanOrEqual(1.5 + 1e-6);
    expect(report!.dMm, side).toBeGreaterThanOrEqual(0.5);
    expect(report!.dMm, side).toBeLessThanOrEqual(1.2);
    expect(minPairedWall(cut), side).toBeGreaterThanOrEqual(Math.min(minPairedWall(plain), AFO_EDGE_MM) - 1e-3);
    expect(awayN, side).toBeGreaterThan(10);
    expect(away, `${side} wall drift ${away.toFixed(3)}`).toBeLessThanOrEqual(0.1);
    expect(com, `${side} com ${com.toFixed(1)}`).toBeGreaterThanOrEqual(10);
    expect(ramp, `${side} ramp dihedral ${ramp.toFixed(1)}`).toBeLessThanOrEqual(15);
    // A few edges at the ball rim and the toe exceed 60 degrees. They sit on rim
    // edges, which cannot be subdivided without opening the shell. The contact
    // ramp itself stays within 15 degrees.
    expect(folds, `${side} folds ${folds}`).toBeLessThanOrEqual(12);
    expect(manifold.openEdges, side).toBe(0);
    expect(manifold.nonManifoldEdges, side).toBe(0);
    expect(manifold.isWatertight, side).toBe(true);
    expect(duplicateDirectedEdges(cut.indices), side).toBe(0);
    expect(tinyFaceCount(cut), side).toBe(0);
    expect(report!.tiltDeg, side).toBeLessThanOrEqual(3);
    expect(report!.bbox.l, side).toBeGreaterThan(200);
    expect(report!.bbox.w, side).toBeGreaterThan(70);
    expect(report!.bbox.h, side).toBeGreaterThan(40);
    const stl = meshBinaryStl(cut);
    expect(stlMatchesMesh(stl, cut), side).toBe(true);
    expect(maxRise(plain, cut), side).toBeLessThanOrEqual(1.5 + 1e-3);
}

function rasterContact(
    mesh: AfoTriMesh,
    n: number,
    beltOf: (i: number, mesh: AfoTriMesh) => { s: number; t: number; z: number },
    cell: number,
): Set<string> {
    const hit = new Set<string>();
    const inTri = (
        s: number,
        t: number,
        a: { s: number; t: number },
        b: { s: number; t: number },
        c: { s: number; t: number },
    ) => {
        const sign = (p: { s: number; t: number }, q: { s: number; t: number }) =>
            (s - q.s) * (p.t - q.t) - (p.s - q.s) * (t - q.t);
        const ab = sign(a, b);
        const bc = sign(b, c);
        const ca = sign(c, a);
        return !((ab < -1e-6 || bc < -1e-6 || ca < -1e-6) && (ab > 1e-6 || bc > 1e-6 || ca > 1e-6));
    };
    for (let f = 0; f < mesh.indices.length; f += 3) {
        const ia = mesh.indices[f] ?? 0;
        const ib = mesh.indices[f + 1] ?? 0;
        const ic = mesh.indices[f + 2] ?? 0;
        if (ia < n || ib < n || ic < n) continue;
        const a = beltOf(ia, mesh);
        const b = beltOf(ib, mesh);
        const c = beltOf(ic, mesh);
        if (Math.abs(a.z) > 0.4 && Math.abs(b.z) > 0.4 && Math.abs(c.z) > 0.4) continue;
        const sLo = Math.min(a.s, b.s, c.s);
        const sHi = Math.max(a.s, b.s, c.s);
        const tLo = Math.min(a.t, b.t, c.t);
        const tHi = Math.max(a.t, b.t, c.t);
        const area = (b.s - a.s) * (c.t - a.t) - (c.s - a.s) * (b.t - a.t) || 1;
        const is0 = Math.floor(sLo / cell);
        const is1 = Math.ceil(sHi / cell);
        const it0 = Math.floor(tLo / cell);
        const it1 = Math.ceil(tHi / cell);
        for (let is = is0; is <= is1; is++) {
            const s = is * cell;
            for (let it = it0; it <= it1; it++) {
                const t = it * cell;
                if (!inTri(s, t, a, b, c)) continue;
                const wB = ((s - a.s) * (c.t - a.t) - (c.s - a.s) * (t - a.t)) / area;
                const wC = ((b.s - a.s) * (t - a.t) - (s - a.s) * (b.t - a.t)) / area;
                const z = a.z * (1 - wB - wC) + b.z * wB + c.z * wC;
                if (Math.abs(z) <= 5e-4) hit.add(`${is}|${it}`);
            }
        }
    }
    return hit;
}

function contactBoundary(
    mesh: AfoTriMesh,
    n: number,
    beltOf: (i: number, mesh: AfoTriMesh) => { s: number; t: number; z: number },
): Array<{ s: number; t: number }> {
    const pts: Array<{ s: number; t: number }> = [];
    const seen = new Set<string>();
    const add = (s: number, t: number) => {
        const k = `${Math.round(s * 4)}|${Math.round(t * 4)}`;
        if (seen.has(k)) return;
        seen.add(k);
        pts.push({ s, t });
    };
    const level = 2e-4;
    for (let f = 0; f < mesh.indices.length; f += 3) {
        const vs = [mesh.indices[f] ?? 0, mesh.indices[f + 1] ?? 0, mesh.indices[f + 2] ?? 0];
        if (vs.some((v) => v < n)) continue;
        const p = vs.map((v) => beltOf(v, mesh));
        for (let e = 0; e < 3; e++) {
            const a = p[e]!;
            const b = p[(e + 1) % 3]!;
            const az = Math.abs(a.z);
            const bz = Math.abs(b.z);
            if ((az <= level && bz <= level) || (az > level && bz > level)) continue;
            const denom = bz - az || 1e-9;
            const t = (level - az) / denom;
            if (t < -0.05 || t > 1.05) continue;
            add(a.s + (b.s - a.s) * t, a.t + (b.t - a.t) * t);
        }
    }
    return pts;
}

function orderAlongPoly(
    pts: Array<{ s: number; t: number }>,
    poly: Array<{ s: number; t: number }>,
): Array<{ s: number; t: number }> {
    if (pts.length < 3 || poly.length < 3) return pts;
    const scored = pts.map((p) => {
        let best = Infinity;
        let along = 0;
        let acc = 0;
        let proj = p;
        for (let i = 0; i < poly.length; i++) {
            const a = poly[i]!;
            const b = poly[(i + 1) % poly.length]!;
            const abS = b.s - a.s;
            const abT = b.t - a.t;
            const len = Math.hypot(abS, abT);
            const ab2 = abS * abS + abT * abT || 1;
            const u = Math.min(1, Math.max(0, ((p.s - a.s) * abS + (p.t - a.t) * abT) / ab2));
            const qs = a.s + abS * u;
            const qt = a.t + abT * u;
            const d = Math.hypot(qs - p.s, qt - p.t);
            if (d < best) {
                best = d;
                along = acc + u * len;
                proj = { s: qs, t: qt };
            }
            acc += len;
        }
        return { p: proj, along, best };
    });
    const onEdge = scored.filter((s) => s.best <= 0.15);
    const used = onEdge.length >= 8 ? onEdge : scored;
    used.sort((a, b) => a.along - b.along);
    return used.map((s) => s.p);
}

function minPlanRadius(loop: Array<{ s: number; t: number }>): { radius: number; s: number; t: number } {
    if (loop.length < 5) return { radius: 0, s: 0, t: 0 };
    const at = (i: number) => loop[((i % loop.length) + loop.length) % loop.length]!;
    let minR = Infinity;
    let ms = 0;
    let mt = 0;
    for (let i = 0; i < loop.length; i++) {
        const b = at(i);
        let a = b;
        for (let k = 1; k < loop.length; k++) {
            a = at(i - k);
            if (Math.hypot(b.s - a.s, b.t - a.t) >= 2) break;
        }
        let c = b;
        for (let k = 1; k < loop.length; k++) {
            c = at(i + k);
            if (Math.hypot(c.s - b.s, c.t - b.t) >= 2) break;
        }
        const ab = Math.hypot(b.s - a.s, b.t - a.t);
        const bc = Math.hypot(c.s - b.s, c.t - b.t);
        const ca = Math.hypot(a.s - c.s, a.t - c.t);
        if (ab < 2 || bc < 2) continue;
        const area = Math.abs((b.s - a.s) * (c.t - a.t) - (c.s - a.s) * (b.t - a.t)) * 0.5;
        if (area < 1e-6) continue;
        const r = (ab * bc * ca) / (4 * area);
        if (r < minR) {
            minR = r;
            ms = b.s;
            mt = b.t;
        }
    }
    return {
        radius: Number.isFinite(minR) ? minR : 1e6,
        s: ms,
        t: mt,
    };
}

function leadingEdge(loop: Array<{ s: number; t: number }>): { radius: number; length: number } {
    if (loop.length < 3) return { radius: 0, length: 0 };
    const sMax = Math.max(...loop.map((p) => p.s));
    const band = loop.filter((p) => p.s >= sMax - 1.5).sort((a, b) => a.t - b.t);
    let lo = 0;
    let hi = band.length - 1;
    const transverse = (p: { s: number; t: number }, q: { s: number; t: number }) => Math.abs(q.t - p.t) >= Math.abs(q.s - p.s);
    while (lo < hi && !transverse(band[lo]!, band[lo + 1]!)) lo++;
    while (hi > lo && !transverse(band[hi - 1]!, band[hi]!)) hi--;
    const front = band.slice(lo, hi + 1);
    if (front.length < 2) return { radius: 0, length: 0 };
    const length = Math.hypot(front[front.length - 1]!.s - front[0]!.s, front[front.length - 1]!.t - front[0]!.t);
    let radius = Infinity;
    const far = (from: number, dir: number) => {
        const origin = front[from]!;
        for (let k = from + dir; k > 0 && k < front.length - 1; k += dir) {
            if (Math.hypot(front[k]!.s - origin.s, front[k]!.t - origin.t) >= 2) return front[k]!;
        }
        return front[from + dir]!;
    };
    for (let i = 1; i < front.length - 1; i++) {
        const b = front[i]!;
        const a = far(i, -1);
        const c = far(i, 1);
        if (!a || !c) continue;
        const ab = Math.hypot(b.s - a.s, b.t - a.t);
        const bc = Math.hypot(c.s - b.s, c.t - b.t);
        const ca = Math.hypot(a.s - c.s, a.t - c.t);
        if (ab < 2 || bc < 2) continue;
        const area = Math.abs((b.s - a.s) * (c.t - a.t) - (c.s - a.s) * (b.t - a.t)) * 0.5;
        if (area < 1e-4) continue;
        radius = Math.min(radius, (ab * bc * ca) / (4 * area));
    }
    return { radius: Number.isFinite(radius) ? radius : 1e6, length };
}

function maxZoneDihedral(
    mesh: AfoTriMesh,
    n: number,
    beltOf: (i: number, mesh: AfoTriMesh) => { s: number; t: number; z: number },
    z0: number,
    z1: number,
): number {
    const faces = new Map<string, number[]>();
    const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const fc = (mesh.indices.length / 3) | 0;
    const normals: Array<{ x: number; y: number; z: number } | null> = new Array(fc).fill(null);
    const zone = new Uint8Array(fc);
    for (let f = 0; f < fc; f++) {
        const vs = [mesh.indices[f * 3] ?? 0, mesh.indices[f * 3 + 1] ?? 0, mesh.indices[f * 3 + 2] ?? 0];
        if (vs.some((v) => v < n)) continue;
        const zs = vs.map((v) => beltOf(v, mesh).z);
        const mean = (zs[0]! + zs[1]! + zs[2]!) / 3;
        if (mean < z0 - 0.02 || mean > z1) continue;
        zone[f] = 1;
        normals[f] = triNormal(mesh, vs[0]!, vs[1]!, vs[2]!);
        for (let e = 0; e < 3; e++) {
            const k = key(vs[e]!, vs[(e + 1) % 3]!);
            const list = faces.get(k);
            if (list) list.push(f);
            else faces.set(k, [f]);
        }
    }
    let maxDeg = 0;
    for (const list of faces.values()) {
        if (list.length !== 2) continue;
        const f0 = list[0]!;
        const f1 = list[1]!;
        if (!zone[f0] || !zone[f1]) continue;
        const a = normals[f0];
        const b = normals[f1];
        if (!a || !b) continue;
        const d = Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z));
        const deg = (Math.acos(d) * 180) / Math.PI;
        if (deg > maxDeg) maxDeg = deg;
    }
    return maxDeg;
}

function countSharpFolds(plain: AfoTriMesh, cut: AfoTriMesh, limitDeg: number): number {
    const n = cut.outerVertex0 ?? 0;
    const born = (plain.positions.length / 3) | 0;
    const moved = (i: number) => {
        if (i >= born) return true;
        if (i < n) return false;
        const dx = (cut.positions[i * 3] ?? 0) - (plain.positions[i * 3] ?? 0);
        const dy = (cut.positions[i * 3 + 1] ?? 0) - (plain.positions[i * 3 + 1] ?? 0);
        const dz = (cut.positions[i * 3 + 2] ?? 0) - (plain.positions[i * 3 + 2] ?? 0);
        return dx * dx + dy * dy + dz * dz > 1e-8;
    };
    const faces = new Map<string, number[]>();
    const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const fc = (cut.indices.length / 3) | 0;
    for (let f = 0; f < fc; f++) {
        const vs = [cut.indices[f * 3] ?? 0, cut.indices[f * 3 + 1] ?? 0, cut.indices[f * 3 + 2] ?? 0];
        for (let e = 0; e < 3; e++) {
            const k = key(vs[e]!, vs[(e + 1) % 3]!);
            const list = faces.get(k);
            if (list) list.push(f);
            else faces.set(k, [f]);
        }
    }
    let folds = 0;
    for (const [k, list] of faces) {
        if (list.length !== 2) continue;
        const [sa, sb] = k.split("|").map(Number);
        if (!moved(sa!) && !moved(sb!)) continue;
        const a = triNormal(cut, faceVert(cut, list[0]!, 0), faceVert(cut, list[0]!, 1), faceVert(cut, list[0]!, 2));
        const b = triNormal(cut, faceVert(cut, list[1]!, 0), faceVert(cut, list[1]!, 1), faceVert(cut, list[1]!, 2));
        const d = Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z));
        const deg = (Math.acos(d) * 180) / Math.PI;
        if (deg > limitDeg) folds++;
    }
    return folds;
}

function faceVert(mesh: AfoTriMesh, f: number, k: number): number {
    return mesh.indices[f * 3 + k] ?? 0;
}

function triNormal(mesh: AfoTriMesh, ia: number, ib: number, ic: number): { x: number; y: number; z: number } {
    const ax = mesh.positions[ia * 3] ?? 0;
    const ay = mesh.positions[ia * 3 + 1] ?? 0;
    const az = mesh.positions[ia * 3 + 2] ?? 0;
    const bx = (mesh.positions[ib * 3] ?? 0) - ax;
    const by = (mesh.positions[ib * 3 + 1] ?? 0) - ay;
    const bz = (mesh.positions[ib * 3 + 2] ?? 0) - az;
    const cx = (mesh.positions[ic * 3] ?? 0) - ax;
    const cy = (mesh.positions[ic * 3 + 1] ?? 0) - ay;
    const cz = (mesh.positions[ic * 3 + 2] ?? 0) - az;
    const x = by * cz - bz * cy;
    const y = bz * cx - bx * cz;
    const z = bx * cy - by * cx;
    const L = Math.hypot(x, y, z) || 1;
    return { x: x / L, y: y / L, z: z / L };
}

function areaComMargin(
    mesh: AfoTriMesh,
    frame: { origin: AfoVec3; forward: AfoVec3; lateral: AfoVec3; normal: AfoVec3 },
    poly: Array<{ s: number; t: number }>,
): number {
    let ss = 0;
    let tt = 0;
    let w = 0;
    for (let f = 0; f < mesh.indices.length; f += 3) {
        const ia = mesh.indices[f] ?? 0;
        const ib = mesh.indices[f + 1] ?? 0;
        const ic = mesh.indices[f + 2] ?? 0;
        const a = point(mesh, ia);
        const b = point(mesh, ib);
        const c = point(mesh, ic);
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const abz = b.z - a.z;
        const acx = c.x - a.x;
        const acy = c.y - a.y;
        const acz = c.z - a.z;
        const area = Math.hypot(aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx) * 0.5;
        if (area < 1e-8) continue;
        const g = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3, z: (a.z + b.z + c.z) / 3 };
        const rx = g.x - frame.origin.x;
        const ry = g.y - frame.origin.y;
        const rz = g.z - frame.origin.z;
        const s = rx * frame.forward.x + ry * frame.forward.y + rz * frame.forward.z;
        const t = rx * frame.lateral.x + ry * frame.lateral.y + rz * frame.lateral.z;
        ss += area * s;
        tt += area * t;
        w += area;
    }
    const s = ss / (w || 1);
    const t = tt / (w || 1);
    const d = distToPolygon(s, t, poly);
    return (pointInPolygon(s, t, poly) ? 1 : -1) * d;
}

function pointInPolygon(s: number, t: number, poly: Array<{ s: number; t: number }>): boolean {
    let inn = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i]!;
        const b = poly[j]!;
        if (a.t > t !== b.t > t && s < ((b.s - a.s) * (t - a.t)) / (b.t - a.t || 1e-9) + a.s) inn = !inn;
    }
    return inn;
}

function distToPolygon(s: number, t: number, poly: Array<{ s: number; t: number }>): number {
    let best = Infinity;
    for (let k = 0; k < poly.length; k++) {
        const a = poly[k]!;
        const b = poly[(k + 1) % poly.length]!;
        const ds = b.s - a.s;
        const dt = b.t - a.t;
        const ab2 = ds * ds + dt * dt || 1;
        const u = Math.min(1, Math.max(0, ((s - a.s) * ds + (t - a.t) * dt) / ab2));
        best = Math.min(best, Math.hypot(a.s + ds * u - s, a.t + dt * u - t));
    }
    return best;
}

function pairedGap(mesh: AfoTriMesh, i: number): number {
    const n = mesh.outerVertex0 ?? 0;
    const dx = (mesh.positions[i * 3] ?? 0) - (mesh.positions[(i - n) * 3] ?? 0);
    const dy = (mesh.positions[i * 3 + 1] ?? 0) - (mesh.positions[(i - n) * 3 + 1] ?? 0);
    const dz = (mesh.positions[i * 3 + 2] ?? 0) - (mesh.positions[(i - n) * 3 + 2] ?? 0);
    return Math.hypot(dx, dy, dz);
}

function minPairedWall(mesh: AfoTriMesh): number {
    const n = mesh.outerVertex0 ?? 0;
    const end = Math.min((mesh.positions.length / 3) | 0, n * 2);
    let min = Infinity;
    for (let i = n; i < end; i++) min = Math.min(min, pairedGap(mesh, i));
    return min;
}

function maxRise(plain: AfoTriMesh, cut: AfoTriMesh): number {
    const n = Math.min((plain.positions.length / 3) | 0, (cut.positions.length / 3) | 0);
    let max = 0;
    for (let i = 0; i < n; i++) {
        const dx = (cut.positions[i * 3] ?? 0) - (plain.positions[i * 3] ?? 0);
        const dy = (cut.positions[i * 3 + 1] ?? 0) - (plain.positions[i * 3 + 1] ?? 0);
        const dz = (cut.positions[i * 3 + 2] ?? 0) - (plain.positions[i * 3 + 2] ?? 0);
        max = Math.max(max, Math.hypot(dx, dy, dz));
    }
    return max;
}

function duplicateDirectedEdges(indices: Uint32Array): number {
    const seen = new Set<string>();
    let dups = 0;
    for (let f = 0; f < indices.length; f += 3) {
        const vs = [indices[f] ?? 0, indices[f + 1] ?? 0, indices[f + 2] ?? 0];
        for (let e = 0; e < 3; e++) {
            const k = `${vs[e]}>${vs[(e + 1) % 3]}`;
            if (seen.has(k)) dups++;
            seen.add(k);
        }
    }
    return dups;
}

function tinyFaceCount(mesh: AfoTriMesh): number {
    let n = 0;
    for (let f = 0; f < mesh.indices.length; f += 3) {
        const a = point(mesh, mesh.indices[f] ?? 0);
        const b = point(mesh, mesh.indices[f + 1] ?? 0);
        const c = point(mesh, mesh.indices[f + 2] ?? 0);
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const abz = b.z - a.z;
        const acx = c.x - a.x;
        const acy = c.y - a.y;
        const acz = c.z - a.z;
        const area = Math.hypot(aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx) * 0.5;
        if (area < 1e-6) n++;
    }
    return n;
}

function stlMatchesMesh(stl: ArrayBuffer, mesh: AfoTriMesh): boolean {
    const view = new DataView(stl);
    const tris = view.getUint32(80, true);
    if (tris !== ((mesh.indices.length / 3) | 0)) return false;
    let o = 84;
    for (let i = 0; i < tris; i++) {
        o += 12;
        for (let k = 0; k < 3; k++) {
            const v = mesh.indices[i * 3 + k] ?? 0;
            for (let c = 0; c < 3; c++) {
                const got = view.getFloat32(o, true);
                const want = mesh.positions[v * 3 + c] ?? 0;
                if (got !== Math.fround(want)) return false;
                o += 4;
            }
        }
        o += 2;
    }
    return true;
}

function denseContactSlab(nx: number, ny: number): AfoTriMesh {
    const n = nx * ny;
    const positions = new Float32Array(n * 6);
    const at = (i: number, j: number) => j * nx + i;
    for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
            const x = (i / (nx - 1)) * 260;
            const y = (j / (ny - 1) - 0.5) * 95;
            positions[at(i, j) * 3] = x;
            positions[at(i, j) * 3 + 1] = y;
            positions[at(i, j) * 3 + 2] = 4;
            positions[(n + at(i, j)) * 3] = x;
            positions[(n + at(i, j)) * 3 + 1] = y;
            positions[(n + at(i, j)) * 3 + 2] = 0;
        }
    }
    const idx: number[] = [];
    const push = (a: number, b: number, c: number) => idx.push(a, b, c);
    for (let j = 0; j < ny - 1; j++) {
        for (let i = 0; i < nx - 1; i++) {
            const a = at(i, j);
            const b = at(i + 1, j);
            const c = at(i, j + 1);
            const d = at(i + 1, j + 1);
            push(a, b, c);
            push(b, d, c);
            push(n + a, n + c, n + b);
            push(n + b, n + c, n + d);
        }
    }
    for (let i = 0; i < nx - 1; i++) {
        push(at(i, 0), n + at(i, 0), at(i + 1, 0));
        push(at(i + 1, 0), n + at(i, 0), n + at(i + 1, 0));
        push(at(i + 1, ny - 1), n + at(i + 1, ny - 1), at(i, ny - 1));
        push(at(i, ny - 1), n + at(i + 1, ny - 1), n + at(i, ny - 1));
    }
    for (let j = 0; j < ny - 1; j++) {
        push(at(0, j + 1), n + at(0, j + 1), at(0, j));
        push(at(0, j), n + at(0, j + 1), n + at(0, j));
        push(at(nx - 1, j), n + at(nx - 1, j), at(nx - 1, j + 1));
        push(at(nx - 1, j + 1), n + at(nx - 1, j), n + at(nx - 1, j + 1));
    }
    return { positions, indices: new Uint32Array(idx), outerVertex0: n };
}

function slabSpec() {
    return {
        heel: { x: 20, y: 0, z: 0 },
        m1: { x: 180, y: -30, z: 0 },
        m5: { x: 160, y: 30, z: 0 },
        thicknessMm: 4,
    };
}

function buildUsM9MediumCast(side: Side): {
    mesh: AfoTriMesh;
    heel: AfoVec3;
    m1: AfoVec3;
    m5: AfoVec3;
    trim: AfoVec3[];
} {
    const length = 260;
    const nx = 72;
    const ny = 30;
    const bottomAt = (i: number, j: number) => j * nx + i;
    const topAt = (i: number, j: number) => nx * ny + bottomAt(i, j);
    const positions: number[] = [];
    for (let pass = 0; pass < 2; pass++) {
        for (let j = 0; j < ny; j++) {
            const v = j / (ny - 1);
            for (let i = 0; i < nx; i++) {
                const u = i / (nx - 1);
                const half = m9HalfWidth(u);
                const y = (v - 0.5) * 2 * half;
                const x = u * length;
                const z = m9SoleZ(u, y, side) + (pass === 0 ? 0 : 26);
                positions.push(x, y, z);
            }
        }
    }
    const indices: number[] = [];
    const push = (a: number, b: number, c: number) => indices.push(a, b, c);
    const i0 = 1;
    const i1 = 18;
    const j0 = 3;
    const j1 = 26;
    const inWin = (i: number, j: number) => i >= i0 && i <= i1 && j >= j0 && j <= j1;
    for (let j = 0; j < ny - 1; j++) {
        for (let i = 0; i < nx - 1; i++) {
            const a = bottomAt(i, j);
            const b = bottomAt(i + 1, j);
            const c = bottomAt(i, j + 1);
            const d = bottomAt(i + 1, j + 1);
            push(a, c, b);
            push(c, d, b);
            const inside =
                inWin(i, j) && inWin(i + 1, j) && inWin(i, j + 1) && inWin(i + 1, j + 1);
            if (inside) continue;
            const ta = topAt(i, j);
            const tb = topAt(i + 1, j);
            const tc = topAt(i, j + 1);
            const td = topAt(i + 1, j + 1);
            push(ta, tb, tc);
            push(tb, td, tc);
        }
    }
    const sideQuad = (a: number, b: number, c: number, d: number) => {
        push(a, b, d);
        push(a, d, c);
    };
    for (let i = 0; i < nx - 1; i++) {
        sideQuad(bottomAt(i, 0), bottomAt(i + 1, 0), topAt(i, 0), topAt(i + 1, 0));
        sideQuad(bottomAt(i + 1, ny - 1), bottomAt(i, ny - 1), topAt(i + 1, ny - 1), topAt(i, ny - 1));
    }
    for (let j = 0; j < ny - 1; j++) {
        sideQuad(bottomAt(0, j + 1), bottomAt(0, j), topAt(0, j + 1), topAt(0, j));
        sideQuad(bottomAt(nx - 1, j), bottomAt(nx - 1, j + 1), topAt(nx - 1, j), topAt(nx - 1, j + 1));
    }
    const layers = 20;
    const rise = 28;
    const peri: Array<[number, number]> = [];
    for (let i = i0; i <= i1; i++) peri.push([i, j0]);
    for (let j = j0 + 1; j <= j1; j++) peri.push([i1, j]);
    for (let i = i1 - 1; i >= i0; i--) peri.push([i, j1]);
    for (let j = j1 - 1; j > j0; j--) peri.push([i0, j]);
    const pn = peri.length;
    const layerBase = positions.length / 3;
    const wallAt = (layer: number, k: number) => {
        if (layer === 0) {
            const [i, j] = peri[k]!;
            return topAt(i, j);
        }
        return layerBase + (layer - 1) * pn + k;
    };
    for (let layer = 1; layer <= layers; layer++) {
        for (let k = 0; k < pn; k++) {
            const [i, j] = peri[k]!;
            const base = topAt(i, j);
            positions.push(
                positions[base * 3] ?? 0,
                positions[base * 3 + 1] ?? 0,
                (positions[base * 3 + 2] ?? 0) + rise * layer,
            );
        }
    }
    for (let layer = 0; layer < layers; layer++) {
        for (let k = 0; k < pn; k++) {
            const k2 = (k + 1) % pn;
            sideQuad(wallAt(layer, k), wallAt(layer, k2), wallAt(layer + 1, k), wallAt(layer + 1, k2));
        }
    }
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let k = 0; k < pn; k++) {
        const id = wallAt(layers, k);
        cx += positions[id * 3] ?? 0;
        cy += positions[id * 3 + 1] ?? 0;
        cz += positions[id * 3 + 2] ?? 0;
    }
    const cap = positions.length / 3;
    positions.push(cx / pn, cy / pn, cz / pn);
    for (let k = 0; k < pn; k++) {
        push(wallAt(layers, k), wallAt(layers, (k + 1) % pn), cap);
    }
    const trimLayer = 18;
    const trim: AfoVec3[] = [];
    for (let k = 0; k < pn; k++) {
        const id = wallAt(trimLayer, k);
        trim.push({
            x: positions[id * 3] ?? 0,
            y: positions[id * 3 + 1] ?? 0,
            z: positions[id * 3 + 2] ?? 0,
        });
    }
    const mesh = orientMeshOutward({ positions: new Float32Array(positions), indices: new Uint32Array(indices) });
    const med = medialSign(side);
    const metX = 170;
    return {
        mesh,
        trim,
        heel: nearestPoint(mesh, { x: 22, y: 0, z: m9SoleZ(22 / length, 0, side) }),
        m1: nearestPoint(mesh, { x: metX, y: med * 28, z: m9SoleZ(metX / length, med * 28, side) }),
        m5: nearestPoint(mesh, { x: metX, y: -med * 28, z: m9SoleZ(metX / length, -med * 28, side) }),
    };
}

function m9HalfWidth(u: number): number {
    const s = (t: number) => {
        const x = Math.min(1, Math.max(0, t));
        return x * x * (3 - 2 * x);
    };
    if (u < 0.16) return 31 + (37 - 31) * s(u / 0.16);
    if (u < 0.68) return 37 + (47.5 - 37) * s((u - 0.16) / 0.52);
    return 47.5 + (18 - 47.5) * s((u - 0.68) / 0.32);
}

function m9SoleZ(u: number, y: number, side: Side): number {
    const medial = medialSign(side) * y;
    const arch =
        Math.exp(-((u - 0.48) ** 2) / (2 * 0.055 * 0.055)) * Math.exp(-((medial - 16) ** 2) / (2 * 11 * 11));
    let z = 0.75 * arch;
    if (u < 0.03) {
        const t = (0.03 - u) / 0.03;
        z += 0.4 * t * t;
    }
    if (u > 0.965) {
        const t = (u - 0.965) / 0.035;
        z += 0.3 * t * t;
    }
    return z;
}

function meshBinaryStl(mesh: AfoTriMesh): ArrayBuffer {
    const t = (mesh.indices.length / 3) | 0;
    const buf = new ArrayBuffer(84 + t * 50);
    const view = new DataView(buf);
    view.setUint32(80, t, true);
    let o = 84;
    const w = (x: number) => {
        view.setFloat32(o, x, true);
        o += 4;
    };
    for (let i = 0; i < t; i++) {
        w(0);
        w(0);
        w(0);
        for (let k = 0; k < 3; k++) {
            const v = mesh.indices[i * 3 + k] ?? 0;
            w(mesh.positions[v * 3] ?? 0);
            w(mesh.positions[v * 3 + 1] ?? 0);
            w(mesh.positions[v * 3 + 2] ?? 0);
        }
        view.setUint16(o, 0, true);
        o += 2;
    }
    return buf;
}

function flattenSide(side: Side): {
    archKept: number;
    heelKept: number;
    archHeight: number;
    samples: AfoVec3[];
} {
    const sheet = buildCurledSoleSheet(side, 36, 16);
    const before = new Float32Array(sheet.mesh.positions);
    const lock = flattenKeepSurface(sheet.mesh.positions, sheet.mesh.indices, soleSheetBoundary(sheet.mesh), {
        heel: sheet.heel,
        m1: sheet.m1,
        m5: sheet.m5,
        thicknessMm: 4,
    });
    let archKept = 0;
    let heelKept = 0;
    let archHeight = 0;
    const samples: AfoVec3[] = [];
    const med = medialSign(side);
    for (let i = 0; i < lock.flat.length; i++) {
        const x = sheet.mesh.positions[i * 3] ?? 0;
        const y = sheet.mesh.positions[i * 3 + 1] ?? 0;
        const z = sheet.mesh.positions[i * 3 + 2] ?? 0;
        const was = before[i * 3 + 2] ?? 0;
        if (Math.abs(was - curledSoleZ(x, y, side)) < 3 && was > 4 && med * y > 8 && x > 90 && x < 120) {
            if (Math.abs(z - was) < 0.4) {
                archKept++;
                archHeight = Math.max(archHeight, z);
            }
        }
        if (x < 14 && was > 8 && Math.abs(z - was) < 0.4) heelKept++;
        samples.push({ x, y, z });
    }
    return { archKept, heelKept, archHeight, samples };
}

function shellPair(
    mesh: AfoTriMesh,
    side: Side,
    cast: { heel: AfoVec3; m1: AfoVec3; m5: AfoVec3 },
    thicknessMm: number,
): { flat: AfoTriMesh; plain: AfoTriMesh } {
    const polygon = trimPolygonForShell(footplateLoop(mesh, side), true) ?? undefined;
    const common = {
        thicknessMm,
        edgeMm: AFO_EDGE_MM,
        flareMm: AFO_FLARE_MM,
        trimPolygon: polygon,
        heelSeed: cast.heel,
    };
    const flat = buildAfoShell(mesh, [0, 1, 2], {
        ...common,
        flatPlate: { heel: cast.heel, m1: cast.m1, m5: cast.m5, thicknessMm },
    });
    const plain = buildAfoShell(mesh, [0, 1, 2], common);
    return { flat, plain };
}

function footplateLoop(mesh: AfoTriMesh, side: Side): AfoVec3[] {
    const s = medialSign(side);
    const raw: AfoVec3[] = [
        { x: 16, y: 0, z: 155 },
        { x: 20, y: s * 26, z: 125 },
        { x: 28, y: s * 36, z: 80 },
        { x: 24, y: s * 30, z: 40 },
        { x: 48, y: s * 34, z: 6 },
        { x: 110, y: s * 34, z: 8 },
        { x: 160, y: s * 28, z: 12 },
        { x: 190, y: s * 12, z: 18 },
        { x: 194, y: 0, z: 20 },
        { x: 190, y: -s * 12, z: 18 },
        { x: 160, y: -s * 28, z: 12 },
        { x: 110, y: -s * 34, z: 6 },
        { x: 48, y: -s * 34, z: 6 },
        { x: 24, y: -s * 30, z: 40 },
        { x: 26, y: -s * 36, z: 80 },
        { x: 20, y: -s * 26, z: 125 },
    ];
    const dense: AfoVec3[] = [];
    for (let i = 0; i < raw.length; i++) {
        const a = raw[i]!;
        const b = raw[(i + 1) % raw.length]!;
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / 7));
        for (let k = 0; k < steps; k++) {
            const t = k / steps;
            dense.push(
                nearestPoint(mesh, {
                    x: a.x + (b.x - a.x) * t,
                    y: a.y + (b.y - a.y) * t,
                    z: a.z + (b.z - a.z) * t,
                }),
            );
        }
    }
    const uniq: AfoVec3[] = [];
    for (const p of dense) {
        const prev = uniq[uniq.length - 1];
        if (prev && Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z) < 1) continue;
        uniq.push(p);
    }
    return uniq;
}

function nearestPoint(mesh: AfoTriMesh, p: AfoVec3): AfoVec3 {
    const n = (mesh.positions.length / 3) | 0;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
        const dx = (mesh.positions[i * 3] ?? 0) - p.x;
        const dy = (mesh.positions[i * 3 + 1] ?? 0) - p.y;
        const dz = (mesh.positions[i * 3 + 2] ?? 0) - p.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) {
            bestD = d;
            best = i;
        }
    }
    return point(mesh, best);
}

function legTripod(
    mesh: AfoTriMesh,
    side: Side,
): { heel: AfoVec3; m1: AfoVec3; m5: AfoVec3; distal: AfoVec3 } {
    const s = medialSign(side);
    return {
        heel: nearestLow(mesh, 25, 0),
        m1: nearestLow(mesh, 145, s * 18),
        m5: nearestLow(mesh, 125, -s * 18),
        distal: nearestLow(mesh, 165, 0),
    };
}

function nearestLow(mesh: AfoTriMesh, x: number, y: number): AfoVec3 {
    const n = (mesh.positions.length / 3) | 0;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
        const dx = (mesh.positions[i * 3] ?? 0) - x;
        const dy = (mesh.positions[i * 3 + 1] ?? 0) - y;
        const dz = mesh.positions[i * 3 + 2] ?? 0;
        if (dz > 30) continue;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) {
            bestD = d;
            best = i;
        }
    }
    return point(mesh, best);
}

function point(mesh: AfoTriMesh, i: number): AfoVec3 {
    return {
        x: mesh.positions[i * 3] ?? 0,
        y: mesh.positions[i * 3 + 1] ?? 0,
        z: mesh.positions[i * 3 + 2] ?? 0,
    };
}
