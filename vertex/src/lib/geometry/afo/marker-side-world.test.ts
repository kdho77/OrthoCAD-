// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { Euler, Group, PerspectiveCamera, Vector3 } from "three";
import { OrbitControls } from "three-stdlib";
import { afoFrameSide } from "@/features/afo/afo-scan-markers";
import { medialSign } from "@/lib/geometry/handedness";
import { cameraForView } from "@/lib/geometry/viewport-side-layout";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import type { Side } from "@/types";
import { alignScanToPlantarFrame, invertMatrixElements, transformAfoPoint } from "./landmark-frame";
import { cameraViewForAfoMarkerId } from "./marker-side";
import type { AfoTriMesh, AfoVec3 } from "./types";

function viewerWorld(point: AfoVec3): Vector3 {
    const group = new Group();
    group.rotation.copy(new Euler(-Math.PI / 2, 0, 0));
    group.updateMatrixWorld(true);
    return new Vector3(point.x, point.y, point.z).applyMatrix4(group.matrixWorld);
}

function cameraSpaceZ(view: "left" | "right", world: Vector3): number {
    return world.clone().applyMatrix4(cameraForView(view).matrixWorldInverse).z;
}

function faces(view: "left" | "right", target: Vector3, other: Vector3): boolean {
    return cameraSpaceZ(view, target) > cameraSpaceZ(view, other);
}

function leg(side: Side) {
    const sign = medialSign(side);
    const heel: AfoVec3 = { x: 0, y: 0, z: 0 };
    const m1: AfoVec3 = { x: 140, y: 36 * sign, z: 2 };
    const m5: AfoVec3 = { x: 128, y: -40 * sign, z: 1 };
    const medialMal: AfoVec3 = { x: 42, y: 28 * sign, z: 78 };
    const lateralMal: AfoVec3 = { x: 36, y: -30 * sign, z: 68 };
    const mesh: AfoTriMesh = {
        positions: new Float32Array([
            heel.x,
            heel.y,
            heel.z,
            m1.x,
            m1.y,
            m1.z,
            m5.x,
            m5.y,
            m5.z,
            medialMal.x,
            medialMal.y,
            medialMal.z,
            lateralMal.x,
            lateralMal.y,
            lateralMal.z,
        ]),
        indices: new Uint32Array([0, 1, 2]),
    };
    return { heel, m1, m5, medialMal, lateralMal, mesh };
}

describe("OrbitControls preset", () => {
    test("damping update keeps a left preset on +Z", () => {
        const camera = new PerspectiveCamera(40, 1, 1, 5000);
        camera.position.set(220, 200, 260);
        const controls = new OrbitControls(camera);
        controls.enableDamping = true;
        controls.dampingFactor = 0.1;
        controls.target.set(0, 0, 0);
        controls.update();
        camera.position.set(0, 40, 360);
        camera.up.set(0, 1, 0);
        controls.target.set(0, 0, 0);
        controls.update();
        expect(camera.position.z).toBeGreaterThan(100);
        expect(Math.abs(camera.position.x)).toBeLessThan(50);
    });
});

describe("AFO marker camera in world space", () => {
    test("chosen view is closer to the anatomical side than the opposite side", () => {
        for (const side of ["left", "right"] as const) {
            const { heel, m1, m5, medialMal, lateralMal, mesh } = leg(side);
            const aligned = alignScanToPlantarFrame(mesh, { heel, m1p: m1, m5p: m5 }, side);
            const orient = (p: AfoVec3) => transformAfoPoint(p, aligned.matrixElements);
            const medialWorld = viewerWorld(orient(medialMal));
            const lateralWorld = viewerWorld(orient(lateralMal));
            const placed = { medial: orient(m1), lateral: orient(m5) };
            const medialView = cameraViewForAfoMarkerId("medial_malleolus", side, placed);
            const lateralView = cameraViewForAfoMarkerId("lateral_malleolus", side, placed);
            const navView = cameraViewForAfoMarkerId("navicular", side, placed);
            const fifthView = cameraViewForAfoMarkerId("fifth_met_base", side, placed);
            for (const view of [medialView, lateralView, navView, fifthView]) {
                expect(view === "left" || view === "right").toBe(true);
            }
            if (medialView !== "left" && medialView !== "right") continue;
            if (lateralView !== "left" && lateralView !== "right") continue;
            if (navView !== "left" && navView !== "right") continue;
            if (fifthView !== "left" && fifthView !== "right") continue;
            expect(faces(medialView, medialWorld, lateralWorld)).toBe(true);
            expect(faces(lateralView, lateralWorld, medialWorld)).toBe(true);
            expect(
                faces(
                    navView,
                    viewerWorld(orient({ x: 70, y: 24 * medialSign(side), z: 28 })),
                    viewerWorld(orient({ x: 78, y: -26 * medialSign(side), z: 18 })),
                ),
            ).toBe(true);
            expect(
                faces(
                    fifthView,
                    viewerWorld(orient({ x: 78, y: -26 * medialSign(side), z: 18 })),
                    viewerWorld(orient({ x: 70, y: 24 * medialSign(side), z: 28 })),
                ),
            ).toBe(true);
            const inverse = invertMatrixElements(aligned.matrixElements);
            const roundTrip = transformAfoPoint(orient(medialMal), inverse);
            expect(roundTrip.y).toBeCloseTo(medialMal.y, 3);
        }
    });

    test("a stale insole editing foot must not flip the scan's medial camera", () => {
        useClinicalWorkflowStore.setState({ elementPlacementFoot: "right" });
        const side = afoFrameSide("left");
        const { heel, m1, m5, medialMal, lateralMal, mesh } = leg("left");
        const aligned = alignScanToPlantarFrame(mesh, { heel, m1p: m1, m5p: m5 }, "left");
        const orient = (p: AfoVec3) => transformAfoPoint(p, aligned.matrixElements);
        const placed = { medial: orient(m1), lateral: orient(m5) };
        const view = cameraViewForAfoMarkerId("navicular", side, placed);
        const medialWorld = viewerWorld(orient(medialMal));
        const lateralWorld = viewerWorld(orient(lateralMal));
        expect(view === "left" || view === "right").toBe(true);
        if (view === "left" || view === "right") {
            expect(faces(view, medialWorld, lateralWorld)).toBe(true);
        }
        const ignoredSide = cameraViewForAfoMarkerId("medial_malleolus", "right", placed);
        expect(ignoredSide === "left" || ignoredSide === "right").toBe(true);
        if (ignoredSide === "left" || ignoredSide === "right") {
            expect(faces(ignoredSide, medialWorld, lateralWorld)).toBe(true);
        }
    });
});
