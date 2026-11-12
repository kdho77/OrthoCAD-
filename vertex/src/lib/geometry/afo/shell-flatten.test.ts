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
import { buildAfoShell, trimPolygonForShell } from "./shell";
import {
    AFO_FOREFOOT_BLEND_MM,
    AFO_FOREFOOT_PLANAR_MM,
    afoFlatPlateInputFields,
    assertFlatPlateAccepted,
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
