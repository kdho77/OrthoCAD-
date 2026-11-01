// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useThree } from "@react-three/fiber";
import { useCallback, useEffect } from "react";
import * as THREE from "three";
import { commitAfoScanPoint } from "@/features/afo/afo-scan-markers";
import { invertMatrixElements, transformAfoPoint } from "@/lib/geometry/afo/landmark-frame";
import type { AfoVec3 } from "@/lib/geometry/afo/types";
import { worldHitToScanLocal } from "@/lib/geometry/scan-display";
import { refineHitOnFullMesh } from "@/lib/geometry/scan-pick-mesh";
import { getAfoState, useAfoStore } from "@/stores/afo-store";
import { useDesignStore } from "@/stores/design-store";
import { useScanStore } from "@/stores/scan-store";

/**
 * Raycast the scan (Stage 1) or the oriented source (Stage 2) and store millimetre points.
 * Misses do not capture the pointer, so orbit still works.
 */
export function AfoScanLandmarkPlacement() {
    const placement = useAfoStore((s) => s.scanPlacement);
    const alignmentApplied = useDesignStore((s) => Boolean(s.design.afo?.scanWorkflow?.alignmentApplied));
    const { gl, camera, raycaster, scene } = useThree();

    const hitMillimetres = useCallback(
        (
            clientX: number,
            clientY: number,
        ): { point: AfoVec3; scanId: string; displayScale: number } | null => {
            const rect = gl.domElement.getBoundingClientRect();
            const ndc = new THREE.Vector2(
                ((clientX - rect.left) / rect.width) * 2 - 1,
                -((clientY - rect.top) / rect.height) * 2 + 1,
            );
            raycaster.setFromCamera(ndc, camera);
            const pickTargets: THREE.Object3D[] = [];
            const fullTargets: THREE.Object3D[] = [];
            scene.traverse((obj) => {
                if (!(obj as THREE.Mesh).isMesh) return;
                if (alignmentApplied && obj.userData?.isAfoAlignPick) fullTargets.push(obj);
                if (!alignmentApplied && obj.userData?.scanId) {
                    if (obj.userData?.isScanPickMesh) pickTargets.push(obj);
                    else if (obj.userData?.isScanMesh) fullTargets.push(obj);
                }
            });
            const targets = pickTargets.length > 0 ? pickTargets : fullTargets;
            if (targets.length === 0) return null;
            const hits = raycaster.intersectObjects(targets, false);
            const hit = hits[0];
            if (!hit) return null;
            const mesh = hit.object as THREE.Mesh;

            if (mesh.userData?.isAfoAlignPick) {
                const matrix = getAfoState().scanWorkflow.matrixElements;
                const scanId = getAfoState().scanWorkflow.scanId;
                const scan = useScanStore.getState().scans.find((item) => item.id === scanId);
                if (!matrix || !scan) return null;
                const local = hit.point.clone();
                mesh.worldToLocal(local);
                const point = transformAfoPoint(
                    { x: local.x, y: local.y, z: local.z },
                    invertMatrixElements(matrix),
                );
                return { point, scanId: scan.id, displayScale: scan.display.displayScale };
            }

            const scanId = mesh.userData?.scanId as string | undefined;
            if (!scanId) return null;
            const scan = useScanStore.getState().scans.find((item) => item.id === scanId);
            if (!scan) return null;
            let worldPoint = hit.point.clone();
            if (mesh.userData?.isScanPickMesh && mesh.userData.fullGeometry) {
                const fullGeo = mesh.userData.fullGeometry as THREE.BufferGeometry;
                const localRay = raycaster.ray.clone();
                const inv = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
                localRay.applyMatrix4(inv);
                const coarseLocal = hit.point.clone();
                mesh.worldToLocal(coarseLocal);
                const refinedLocal = refineHitOnFullMesh(localRay, fullGeo, coarseLocal);
                if (!refinedLocal) return null;
                worldPoint = refinedLocal.clone();
                mesh.localToWorld(worldPoint);
            }
            const local = worldHitToScanLocal(worldPoint, mesh.matrixWorld);
            const scale = scan.display.displayScale > 0 ? scan.display.displayScale : 1;
            return {
                point: { x: local.x * scale, y: local.y * scale, z: local.z * scale },
                scanId,
                displayScale: scale,
            };
        },
        [alignmentApplied, camera, gl.domElement, raycaster, scene],
    );

    const onPointerDown = useCallback(
        (event: PointerEvent) => {
            if (!placement) return;
            const hit = hitMillimetres(event.clientX, event.clientY);
            if (!hit) return;
            event.stopPropagation();
            event.preventDefault();
            const message = commitAfoScanPoint(hit.point, hit.scanId, hit.displayScale);
            useAfoStore.getState().setScanLandmarkError(message);
        },
        [hitMillimetres, placement],
    );

    useEffect(() => {
        if (!placement) return;
        const el = gl.domElement;
        el.addEventListener("pointerdown", onPointerDown);
        return () => el.removeEventListener("pointerdown", onPointerDown);
    }, [gl.domElement, onPointerDown, placement]);

    return null;
}
