// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { Euler, type Matrix4, PerspectiveCamera, Vector3 } from "three";
import { afoScanLandmarkLitSurfaceSpec } from "./AfoSurfaceMaterial";
import {
    AFO_SCAN_LANDMARK_AMBIENT_INTENSITY,
    AFO_SCAN_LANDMARK_KEY_CAMERA_OFFSET,
    afoScanLandmarkFillLightPosition,
    afoScanLandmarkKeyLightOffAxisDistanceMm,
    afoScanLandmarkKeyLightPosition,
} from "./afo-scan-landmark-lighting-config";

describe("AFO scan landmark lighting", () => {
    test("ambient is reduced below the old headlight wash", () => {
        expect(AFO_SCAN_LANDMARK_AMBIENT_INTENSITY).toBeGreaterThanOrEqual(0.12);
        expect(AFO_SCAN_LANDMARK_AMBIENT_INTENSITY).toBeLessThanOrEqual(0.18);
        expect(AFO_SCAN_LANDMARK_AMBIENT_INTENSITY).toBeLessThan(0.35);
    });

    test("key light sits off the camera view axis for every preset orientation", () => {
        const cam = new PerspectiveCamera(40, 1, 1, 5000);
        const views: Euler[] = [
            new Euler(0, 0, 0),
            new Euler(0, Math.PI / 2, 0),
            new Euler(0, -Math.PI / 2, 0),
            new Euler(0, Math.PI, 0),
            new Euler(-Math.PI / 2, 0, 0),
            new Euler(Math.PI / 2, 0, 0),
        ];
        const viewDir = new Vector3();
        const keyPos = new Vector3();
        for (const rot of views) {
            cam.rotation.copy(rot);
            cam.position.set(320, -180, 240);
            cam.updateMatrixWorld();
            afoScanLandmarkKeyLightPosition(cam.position, cam.matrixWorld, keyPos);
            cam.getWorldDirection(viewDir);
            const offAxis = afoScanLandmarkKeyLightOffAxisDistanceMm(cam.position, viewDir, keyPos);
            const minOffset = Math.min(
                Math.abs(AFO_SCAN_LANDMARK_KEY_CAMERA_OFFSET.up),
                Math.abs(AFO_SCAN_LANDMARK_KEY_CAMERA_OFFSET.right),
            );
            expect(offAxis).toBeGreaterThan(minOffset * 0.85);
        }
    });

    test("fill light opposes the key on the camera-right axis", () => {
        const cam = new PerspectiveCamera(40, 1, 1, 5000);
        cam.position.set(100, 50, 200);
        cam.rotation.set(-0.4, 0.6, 0.1);
        cam.updateMatrixWorld();
        const key = afoScanLandmarkKeyLightPosition(cam.position, cam.matrixWorld, new Vector3());
        const fill = afoScanLandmarkFillLightPosition(cam.position, cam.matrixWorld, new Vector3());
        const right = new Vector3().setFromMatrixColumn(cam.matrixWorld as Matrix4, 0);
        expect(key.dot(right)).toBeGreaterThan(fill.dot(right));
    });
});

describe("AFO scan landmark surface material", () => {
    test("marker placement uses opaque lit surface, not points or transparency", () => {
        const spec = afoScanLandmarkLitSurfaceSpec(false);
        expect(spec.materialKind).toBe("afo-lit-surface");
        expect(spec.opacity).toBe(1);
        expect(spec.transparent).toBe(false);
        expect(spec.materialKind).not.toBe("points");
        expect(spec.roughness).toBeGreaterThanOrEqual(0.6);
        expect(spec.roughness).toBeLessThanOrEqual(0.8);
    });
});
