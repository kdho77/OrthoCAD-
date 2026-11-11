// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import { commitAfoScanPoint } from "@/features/afo/afo-scan-markers";
import { AFO_PLACE_ADVANCE_MS, afoPlacementComplete } from "@/features/afo/afo-scan-ui";
import {
    afoScanPickToStoredMm,
    resolveAfoScanRaycastHit,
    type AfoScanPickHit,
} from "@/lib/geometry/afo/afo-scan-pick";
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
        ): AfoScanPickHit | null => {
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
            const wf = getAfoState().scanWorkflow;
            const scanId = wf.scanId;
            const scan = scanId
                ? useScanStore.getState().scans.find((item) => item.id === scanId)
                : undefined;
            const resolved = resolveAfoScanRaycastHit(raycaster, hits, {
                alignmentApplied,
                alignmentMatrixElements: wf.matrixElements,
                scanIdForOriented: scan?.id ?? scanId ?? null,
                displayScaleForOriented: scan?.display.displayScale ?? 1,
            });
            if (!resolved) return null;
            const scale =
                useScanStore.getState().scans.find((item) => item.id === resolved.scanId)?.display
                    .displayScale ?? 1;
            return afoScanPickToStoredMm(resolved, alignmentApplied, wf.matrixElements, scale);
        },
        [alignmentApplied, camera, draggingId, gl.domElement, raycaster, scene],
    );

    const commitHit = useCallback(
        (hit: { point: AfoVec3; scanId: string; displayScale: number }) => {
            const message = commitAfoScanPoint(hit.point, hit.scanId, hit.displayScale);
            useAfoStore.getState().setScanLandmarkError(message);
            if (message) return;
            useAfoStore.getState().setScanLastUndoId(null);
            const aligned = Boolean(getAfoState().scanWorkflow.alignmentApplied);
            if (aligned) useAfoStore.getState().setScanAutoFrameSuppressed(false);
            else useAfoStore.getState().setScanAutoFrameSuppressed(true);
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
