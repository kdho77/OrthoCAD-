// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import { commitAfoScanPoint } from "@/features/afo/afo-scan-markers";
import { AFO_PLACE_ADVANCE_MS, afoPlacementComplete } from "@/features/afo/afo-scan-ui";
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
    const draggingId = useAfoStore((s) => s.scanDraggingMarkerId);
    const alignmentApplied = useDesignStore((s) => Boolean(s.design.afo?.scanWorkflow?.alignmentApplied));
    const { gl, camera, raycaster, scene } = useThree();
    const advanceTimer = useRef<number | null>(null);

    const hitMillimetres = useCallback(
        (
            clientX: number,
            clientY: number,
        ): { point: AfoVec3; scanId: string; displayScale: number; world: THREE.Vector3 } | null => {
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
                if (obj.userData?.afoScanMarkerId && draggingId) return;
                if (alignmentApplied && obj.userData?.isAfoAlignPick) fullTargets.push(obj);
                if (alignmentApplied && obj.userData?.isAfoCast) fullTargets.push(obj);
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

            if (mesh.userData?.isAfoAlignPick || mesh.userData?.isAfoCast) {
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
                return {
                    point,
                    scanId: scan.id,
                    displayScale: scan.display.displayScale,
                    world: hit.point.clone(),
                };
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
                world: worldPoint,
            };
        },
        [alignmentApplied, camera, draggingId, gl.domElement, raycaster, scene],
    );

    const commitHit = useCallback(
        (hit: { point: AfoVec3; scanId: string; displayScale: number }) => {
            const message = commitAfoScanPoint(hit.point, hit.scanId, hit.displayScale);
            useAfoStore.getState().setScanLandmarkError(message);
            if (message) return;
            useAfoStore.getState().setScanLastUndoId(null);
            useAfoStore.getState().setScanAutoFrameSuppressed(false);
            const wf = getAfoState().scanWorkflow;
            if (afoPlacementComplete(wf)) {
                useAfoStore.getState().setScanPlacement(null);
                return;
            }
            if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
            advanceTimer.current = window.setTimeout(() => {
                useAfoStore.getState().setScanPlacement({ redo: null, paused: false });
            }, AFO_PLACE_ADVANCE_MS);
        },
        [],
    );

    const onPointerDown = useCallback(
        (event: PointerEvent) => {
            if (!placement || placement.paused) return;
            const hit = hitMillimetres(event.clientX, event.clientY);
            if (!hit) return;
            event.stopPropagation();
            event.preventDefault();
            commitHit(hit);
        },
        [commitHit, hitMillimetres, placement],
    );

    const onPointerMove = useCallback(
        (event: PointerEvent) => {
            if (!placement) {
                useAfoStore.getState().setScanHoverWorld(null);
                return;
            }
            const hit = hitMillimetres(event.clientX, event.clientY);
            if (!hit || placement.paused) {
                useAfoStore.getState().setScanHoverWorld(null);
                return;
            }
            useAfoStore.getState().setScanHoverWorld({
                x: hit.world.x,
                y: hit.world.y,
                z: hit.world.z,
            });
            if (!draggingId) return;
            event.stopPropagation();
            event.preventDefault();
            commitHit(hit);
        },
        [commitHit, draggingId, hitMillimetres, placement],
    );

    const onPointerUp = useCallback(() => {
        useAfoStore.getState().setScanDraggingMarkerId(null);
    }, []);

    useEffect(() => {
        if (!placement) return;
        const el = gl.domElement;
        el.addEventListener("pointerdown", onPointerDown);
        el.addEventListener("pointermove", onPointerMove);
        el.addEventListener("pointerup", onPointerUp);
        return () => {
            el.removeEventListener("pointerdown", onPointerDown);
            el.removeEventListener("pointermove", onPointerMove);
            el.removeEventListener("pointerup", onPointerUp);
            if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
        };
    }, [gl.domElement, onPointerDown, onPointerMove, onPointerUp, placement]);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (!placement) return;
            if (event.key === "Escape") {
                useAfoStore.getState().setScanPlacement({ ...placement, paused: true });
            }
            if (event.key === "p" || event.key === "P") {
                useAfoStore.getState().setScanPlacement({ ...placement, paused: false });
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [placement]);

    return null;
}
