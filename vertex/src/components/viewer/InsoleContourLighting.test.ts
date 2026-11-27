// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { PerspectiveCamera, Vector3 } from "three";
import {
    INSOLE_KEY_CAMERA_OFFSET,
    insoleFillLightPosition,
    insoleKeyLightAngleFromNormalDeg,
    insoleKeyLightOffAxisDistanceMm,
    insoleKeyLightPosition,
    insoleLightTowardSurface,
    PRINT_EXPORT_AMBIENT_INTENSITY,
    PRINT_EXPORT_KEY_INTENSITY,
} from "./InsoleContourLighting";

describe("print/export contour lighting", () => {
    test("contour preset lowers ambient and raises key vs standard", () => {
        expect(PRINT_EXPORT_AMBIENT_INTENSITY).toBeLessThan(0.6);
        expect(PRINT_EXPORT_KEY_INTENSITY).toBeGreaterThan(1.1);
    });

    test("Viewer3D selects contour lighting on Print/Export solid", () => {
        const src = readFileSync(resolve("vertex/src/components/viewer/Viewer3D.tsx"), "utf8");
        expect(src).toMatch(/contourLighting/);
        expect(src).toMatch(/InsoleContourLighting/);
        expect(src).toMatch(/printExportSolid/);
    });

    test("camera-anchored directional lights do not cast shadows", () => {
        const src = readFileSync(resolve("vertex/src/components/viewer/InsoleContourLighting.tsx"), "utf8");
        expect(src).not.toMatch(/castShadow/);
        expect(src).not.toMatch(/keyCastShadow/);
    });
});

function topBottomCameras(): { label: string; cam: PerspectiveCamera; faceNormal: Vector3 }[] {
    const setups: { label: string; position: Vector3; faceNormal: Vector3 }[] = [
        { label: "Top", position: new Vector3(0, 420, 0), faceNormal: new Vector3(0, 1, 0) },
        { label: "Bottom", position: new Vector3(0, -420, 0), faceNormal: new Vector3(0, -1, 0) },
    ];
    return setups.map(({ label, position, faceNormal }) => {
        const cam = new PerspectiveCamera(40, 1, 1, 5000);
        cam.position.copy(position);
        cam.up.set(1, 0, 0);
        cam.lookAt(0, 0, 0);
        cam.updateMatrixWorld();
        return { label, cam, faceNormal };
    });
}

describe("camera-anchored insole directional lights", () => {
    test("key light is off the view axis (raking, not headlight)", () => {
        for (const { cam } of topBottomCameras()) {
            const key = insoleKeyLightPosition(cam.position, cam.matrixWorld, new Vector3());
            const viewDir = new Vector3();
            cam.getWorldDirection(viewDir);
            const offAxis = insoleKeyLightOffAxisDistanceMm(cam.position, viewDir, key);
            const minOffset = Math.min(
                Math.abs(INSOLE_KEY_CAMERA_OFFSET.up),
                Math.abs(INSOLE_KEY_CAMERA_OFFSET.right),
            );
            expect(offAxis).toBeGreaterThan(minOffset * 0.85);
        }
    });

    test("key light illuminates viewed face with grazing angle from Top and Bottom cameras", () => {
        const origin = new Vector3(0, 0, 0);
        for (const { label, cam, faceNormal } of topBottomCameras()) {
            const key = insoleKeyLightPosition(cam.position, cam.matrixWorld, new Vector3());
            const towardLight = insoleLightTowardSurface(origin, key, new Vector3());
            expect(towardLight.dot(faceNormal)).toBeGreaterThan(0.05);

            const angleDeg = insoleKeyLightAngleFromNormalDeg(towardLight, faceNormal);
            expect(angleDeg).toBeGreaterThan(35);
            expect(angleDeg).toBeLessThan(88);

            const viewDir = new Vector3();
            cam.getWorldDirection(viewDir);
            const offAxis = insoleKeyLightOffAxisDistanceMm(cam.position, viewDir, key);
            expect(offAxis).toBeGreaterThan(80);

            if (label === "Bottom") {
                expect(key.y).toBeLessThan(origin.y);
            }
            if (label === "Top") {
                expect(key.y).toBeGreaterThan(origin.y);
            }
        }
    });

    test("fill light opposes the key on the camera-right axis", () => {
        const top = topBottomCameras().find((v) => v.label === "Top");
        if (!top) throw new Error("missing Top camera fixture");
        const { cam } = top;
        const key = insoleKeyLightPosition(cam.position, cam.matrixWorld, new Vector3());
        const fill = insoleFillLightPosition(cam.position, cam.matrixWorld, new Vector3());
        const right = new Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
        const keyAlongRight = key.clone().sub(cam.position).dot(right);
        const fillAlongRight = fill.clone().sub(cam.position).dot(right);
        expect(keyAlongRight).toBeGreaterThan(fillAlongRight);
    });
});
