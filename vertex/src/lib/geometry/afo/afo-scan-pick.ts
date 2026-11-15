// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import * as THREE from "three";
import { invertMatrixElements, transformAfoPoint } from "@/lib/geometry/afo/landmark-frame";
import type { AfoVec3 } from "@/lib/geometry/afo/types";
import { worldHitToScanLocal } from "@/lib/geometry/scan-display";
import { refineHitOnFullMesh } from "@/lib/geometry/scan-pick-mesh";

/** Ensure matrixWorld matches mesh.matrix before raycast inverse transforms. */
export function meshWorldMatrix(mesh: THREE.Mesh): THREE.Matrix4 {
    mesh.updateMatrixWorld(true);
    return mesh.matrixWorld.clone();
}

/**
 * World-space point on the scan mesh surface for a stored Stage-1 plantar marker (mm, geometry local × scale).
 */
export function plantarMarkerWorldFromMm(
    pointMm: AfoVec3,
    displayScale: number,
    meshMatrix: THREE.Matrix4,
): THREE.Vector3 {
    const scale = displayScale > 0 ? displayScale : 1;
    const local = new THREE.Vector3(pointMm.x / scale, pointMm.y / scale, pointMm.z / scale);
    return local.applyMatrix4(meshMatrix);
}

/** Convert a world-space raycast hit on the registered scan mesh to stored plantar mm. */
export function plantarMmFromScanMeshHit(
    worldPoint: THREE.Vector3,
    mesh: THREE.Mesh,
    displayScale: number,
): AfoVec3 {
    const local = worldHitToScanLocal(worldPoint, meshWorldMatrix(mesh));
    const scale = displayScale > 0 ? displayScale : 1;
    return { x: local.x * scale, y: local.y * scale, z: local.z * scale };
}

/** Convert a world hit on the oriented AFO cast / align pick mesh to stored scan-local mm. */
export function scanMmFromOrientedMeshHit(
    worldPoint: THREE.Vector3,
    mesh: THREE.Mesh,
    alignmentMatrixElements: number[],
): AfoVec3 {
    const local = worldPoint.clone();
    mesh.updateMatrixWorld(true);
    mesh.worldToLocal(local);
    return transformAfoPoint(
        { x: local.x, y: local.y, z: local.z },
        invertMatrixElements(alignmentMatrixElements),
    );
}

export type AfoScanPickHit = {
    point: AfoVec3;
    scanId: string;
    displayScale: number;
    world: THREE.Vector3;
};

export function resolveAfoScanRaycastHit(
    raycaster: THREE.Raycaster,
    hits: THREE.Intersection[],
    opts: {
        alignmentApplied: boolean;
        alignmentMatrixElements: number[] | null;
        scanIdForOriented: string | null;
        displayScaleForOriented: number;
    },
): { mesh: THREE.Mesh; world: THREE.Vector3; scanId: string; displayScale: number } | null {
    const hit = hits[0];
    if (!hit) return null;
    const mesh = hit.object as THREE.Mesh;

    if (mesh.userData?.isAfoAlignPick || mesh.userData?.isAfoCast) {
        if (!opts.alignmentMatrixElements || !opts.scanIdForOriented) return null;
        return {
            mesh,
            world: hit.point.clone(),
            scanId: opts.scanIdForOriented,
            displayScale: opts.displayScaleForOriented,
        };
    }

    const scanId = mesh.userData?.scanId as string | undefined;
    if (!scanId) return null;

    let worldPoint = hit.point.clone();
    if (mesh.userData?.isScanPickMesh && mesh.userData.fullGeometry) {
        const fullGeo = mesh.userData.fullGeometry as THREE.BufferGeometry;
        const localRay = raycaster.ray.clone();
        mesh.updateMatrixWorld(true);
        const inv = meshWorldMatrix(mesh).invert();
        localRay.applyMatrix4(inv);
        const coarseLocal = hit.point.clone();
        mesh.worldToLocal(coarseLocal);
        const refinedLocal = refineHitOnFullMesh(localRay, fullGeo, coarseLocal);
        if (!refinedLocal) return null;
        worldPoint = refinedLocal.clone();
        mesh.localToWorld(worldPoint);
    }

    return { mesh, world: worldPoint, scanId, displayScale: 1 };
}

export function afoScanPickToStoredMm(
    pick: { mesh: THREE.Mesh; world: THREE.Vector3; scanId: string; displayScale: number },
    alignmentApplied: boolean,
    alignmentMatrixElements: number[] | null,
    displayScale: number,
): AfoScanPickHit {
    const scale = displayScale > 0 ? displayScale : pick.displayScale;
    if (pick.mesh.userData?.isAfoAlignPick || pick.mesh.userData?.isAfoCast) {
        if (!alignmentMatrixElements) {
            throw new Error("Missing alignment matrix for oriented pick");
        }
        return {
            point: scanMmFromOrientedMeshHit(pick.world, pick.mesh, alignmentMatrixElements),
            scanId: pick.scanId,
            displayScale: scale,
            world: pick.world,
        };
    }
    return {
        point: plantarMmFromScanMeshHit(pick.world, pick.mesh, scale),
        scanId: pick.scanId,
        displayScale: scale,
        world: pick.world,
    };
}
