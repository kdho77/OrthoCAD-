// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import * as THREE from "three";
import {
    afoScanPickToStoredMm,
    meshWorldMatrix,
    plantarMarkerWorldFromMm,
    plantarMmFromScanMeshHit,
    resolveAfoScanRaycastHit,
} from "./afo-scan-pick";

describe("afo scan pick", () => {
    test("stored plantar mm matches raycast surface hit within 0.5 mm on a transformed mesh", () => {
        const geometry = new THREE.PlaneGeometry(200, 200, 1, 1);
        geometry.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
        mesh.matrixAutoUpdate = false;
        const meshMatrix = new THREE.Matrix4().compose(
            new THREE.Vector3(40, -15, 120),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(0.15, -0.35, 0.08)),
            new THREE.Vector3(1.05, 1.05, 1.05),
        );
        mesh.matrix.copy(meshMatrix);
        mesh.updateMatrixWorld(true);

        const raycaster = new THREE.Raycaster();
        const origin = new THREE.Vector3(40, 200, 120);
        const dir = new THREE.Vector3(0, -1, 0);
        raycaster.set(origin, dir.normalize());

        const hits = raycaster.intersectObject(mesh, false);
        expect(hits.length).toBeGreaterThan(0);
        const worldHit = hits[0]!.point.clone();

        const displayScale = 1.12;
        const stored = plantarMmFromScanMeshHit(worldHit, mesh, displayScale);
        const recovered = plantarMarkerWorldFromMm(stored, displayScale, meshWorldMatrix(mesh));
        expect(recovered.distanceTo(worldHit)).toBeLessThanOrEqual(0.5);
    });

    test("resolveAfoScanRaycastHit uses the nearest intersection first", () => {
        const near = new THREE.Mesh(
            new THREE.PlaneGeometry(50, 50).rotateX(-Math.PI / 2),
            new THREE.MeshBasicMaterial(),
        );
        near.position.set(0, 0, 0);
        near.userData = { scanId: "foot", isScanMesh: true };
        near.updateMatrixWorld(true);

        const far = new THREE.Mesh(
            new THREE.PlaneGeometry(50, 50).rotateX(-Math.PI / 2),
            new THREE.MeshBasicMaterial(),
        );
        far.position.set(0, 0, -80);
        far.userData = { scanId: "foot", isScanMesh: true };
        far.updateMatrixWorld(true);

        const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 50, 0), new THREE.Vector3(0, -1, 0));
        const hits = raycaster.intersectObjects([far, near], false);
        expect(hits[0]?.object).toBe(near);

        const resolved = resolveAfoScanRaycastHit(raycaster, hits, {
            alignmentApplied: false,
            alignmentMatrixElements: null,
            scanIdForOriented: null,
            displayScaleForOriented: 1,
        });
        expect(resolved?.mesh).toBe(near);
        const stored = afoScanPickToStoredMm({ ...resolved!, displayScale: 1 }, false, null, 1);
        expect(stored.world.distanceTo(hits[0]!.point)).toBeLessThan(1e-4);
    });
});
