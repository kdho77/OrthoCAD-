// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { afoFrameSide, scanForAfoWorkflow } from "@/features/afo/afo-scan-markers";
import {
    AFO_CAMERA_TWEEN_MS,
    AFO_PLACE_ADVANCE_MS,
    type AfoMarkerKey,
    activeAfoTarget,
    afoPlacementComplete,
    afoScanAutoFrameAllowed,
    cameraViewForAfoMarker,
} from "@/features/afo/afo-scan-ui";
import { defaultAfoScanWorkflow } from "@/lib/geometry/afo/defaults";
import { afoScanBottomAnchoredFraming } from "@/lib/geometry/afo/landmark-frame";
import { orientedPlantarSides } from "@/lib/geometry/afo/marker-side";
import { applyCameraViewPreset, VIEW_CAMERA_POS, viewCameraUp } from "@/lib/geometry/viewport-side-layout";
import { useAfoStore } from "@/stores/afo-store";
import type { CameraView } from "@/stores/design-store";
import { useDesignStore } from "@/stores/design-store";

export function useAfoScanCameraFrame(controls: React.RefObject<OrbitControlsImpl | null>) {
    const workflow = useDesignStore((s) => s.design.afo?.scanWorkflow) ?? defaultAfoScanWorkflow();
    const placement = useAfoStore((s) => s.scanPlacement);
    const autoFrame = useAfoStore((s) => s.scanAutoFrame);
    const suppressed = useAfoStore((s) => s.scanAutoFrameSuppressed);
    const setView = useDesignStore((s) => s.setViewer);
    const placementComplete = afoPlacementComplete(workflow);
    const prevPlacement = useRef(placement);

    const targetId = activeAfoTarget(workflow, placement?.redo ?? null);

    useEffect(() => {
        const ctrl = controls.current;
        if (!ctrl || !autoFrame || suppressed) return;
        if (!afoScanAutoFrameAllowed(workflow)) return;
        const duringPlacement = placement != null;
        const justFinished = prevPlacement.current != null && placement == null && placementComplete;
        prevPlacement.current = placement;
        if (!duringPlacement && !justFinished) return;
        if (duringPlacement && !targetId) return;
        const scan = scanForAfoWorkflow();
        const side = afoFrameSide(scan?.side ?? "left");
        const oriented = orientedPlantarSides(
            workflow.matrixElements,
            workflow.plantar.m1p,
            workflow.plantar.m5p,
        );
        const view =
            duringPlacement && targetId
                ? cameraViewForAfoMarker(targetId as AfoMarkerKey, side, oriented)
                : (useDesignStore.getState().viewer.view ?? "left");
        const delay = duringPlacement ? AFO_PLACE_ADVANCE_MS : 0;
        const timer = window.setTimeout(() => {
            const mesh = useAfoStore.getState().sourceMesh;
            tweenAfoScanCameraView(ctrl, view, mesh, () => setView({ view }));
        }, delay);
        return () => window.clearTimeout(timer);
    }, [targetId, placement, placementComplete, autoFrame, suppressed, controls, setView, workflow]);

    useEffect(() => {
        const ctrl = controls.current;
        if (!ctrl || !placement) return;
        const onStart = () => useAfoStore.getState().setScanAutoFrameSuppressed(true);
        ctrl.addEventListener("start", onStart);
        return () => ctrl.removeEventListener("start", onStart);
    }, [controls, placement]);
}

export function recenterAfoScanCamera(controls: OrbitControlsImpl | null): void {
    if (!controls) return;
    useAfoStore.getState().setScanAutoFrameSuppressed(false);
    const workflow = useDesignStore.getState().design.afo?.scanWorkflow ?? defaultAfoScanWorkflow();
    const placement = useAfoStore.getState().scanPlacement;
    const targetId = activeAfoTarget(workflow, placement?.redo ?? null);
    if (!targetId) {
        applyCameraViewPreset(controls, "iso");
        useDesignStore.getState().setViewer({ view: "iso" });
        return;
    }
    const scan = scanForAfoWorkflow();
    const side = afoFrameSide(scan?.side ?? "left");
    const oriented = orientedPlantarSides(
        workflow.matrixElements,
        workflow.plantar.m1p,
        workflow.plantar.m5p,
    );
    const view = cameraViewForAfoMarker(targetId as AfoMarkerKey, side, oriented);
    const mesh = useAfoStore.getState().sourceMesh;
    tweenAfoScanCameraView(controls, view, mesh, () => useDesignStore.getState().setViewer({ view }));
}

export function applyAfoBottomAnchoredViewPreset(
    controls: OrbitControlsImpl | null | undefined,
    view: CameraView,
    mesh: ReturnType<typeof useAfoStore.getState>["sourceMesh"],
): boolean {
    if (!controls?.object || !controls.target) return false;
    const camera = controls.object;
    if (!(camera instanceof THREE.PerspectiveCamera)) {
        return applyCameraViewPreset(controls, view);
    }
    clearCameraViewOffset(camera);
    const dest = afoScanFramingTarget(view, mesh, camera);
    controls.object.position.copy(dest.position);
    controls.target.copy(dest.target);
    controls.object.up.set(...viewCameraUp(view));
    controls.update();
    return true;
}

function afoScanFramingTarget(
    view: CameraView,
    mesh: ReturnType<typeof useAfoStore.getState>["sourceMesh"],
    camera: THREE.PerspectiveCamera,
): { position: THREE.Vector3; target: THREE.Vector3 } {
    if (!mesh) {
        return {
            position: new THREE.Vector3(...VIEW_CAMERA_POS[view]),
            target: new THREE.Vector3(0, 0, 0),
        };
    }
    const aspect = camera.aspect > 0 ? camera.aspect : 1;
    const frame = afoScanBottomAnchoredFraming(mesh, view, aspect, camera.fov);
    return {
        position: frame.target.clone().add(frame.cameraOffset),
        target: frame.target.clone(),
    };
}

function clearCameraViewOffset(camera: THREE.Camera): void {
    if (!("clearViewOffset" in camera) || typeof camera.clearViewOffset !== "function") return;
    camera.clearViewOffset();
}

function tweenAfoScanCameraView(
    controls: OrbitControlsImpl,
    view: CameraView,
    mesh: ReturnType<typeof useAfoStore.getState>["sourceMesh"],
    onDone: () => void,
): void {
    const camera = controls.object;
    if (!(camera instanceof THREE.PerspectiveCamera)) {
        applyCameraViewPreset(controls, view);
        onDone();
        return;
    }
    clearCameraViewOffset(camera);
    const destUp = new THREE.Vector3(...viewCameraUp(view));
    const dest = afoScanFramingTarget(view, mesh, camera);
    const startPos = controls.object.position.clone();
    const startUp = controls.object.up.clone();
    const startTarget = controls.target.clone();
    const t0 = performance.now();
    const tick = (now: number) => {
        const t = Math.min(1, (now - t0) / AFO_CAMERA_TWEEN_MS);
        const eased = t * (2 - t);
        controls.object.position.lerpVectors(startPos, dest.position, eased);
        controls.object.up.lerpVectors(startUp, destUp, eased).normalize();
        controls.target.lerpVectors(startTarget, dest.target, eased);
        controls.update();
        if (t < 1) requestAnimationFrame(tick);
        else onDone();
    };
    requestAnimationFrame(tick);
}
