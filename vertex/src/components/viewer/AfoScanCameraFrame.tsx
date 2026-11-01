// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useEffect } from "react";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import {
    AFO_CAMERA_TWEEN_MS,
    AFO_PLACE_ADVANCE_MS,
    activeAfoTarget,
    cameraViewForAfoMarker,
    type AfoMarkerKey,
} from "@/features/afo/afo-scan-ui";
import { afoFrameSide, scanForAfoWorkflow } from "@/features/afo/afo-scan-markers";
import {
    applyCameraViewPreset,
    VIEW_CAMERA_POS,
    viewCameraUp,
} from "@/lib/geometry/viewport-side-layout";
import { defaultAfoScanWorkflow } from "@/lib/geometry/afo/defaults";
import type { CameraView } from "@/stores/design-store";
import { useAfoStore } from "@/stores/afo-store";
import { useDesignStore } from "@/stores/design-store";
import * as THREE from "three";

export function useAfoScanCameraFrame(controls: React.RefObject<OrbitControlsImpl | null>) {
    const workflow = useDesignStore((s) => s.design.afo?.scanWorkflow) ?? defaultAfoScanWorkflow();
    const placement = useAfoStore((s) => s.scanPlacement);
    const autoFrame = useAfoStore((s) => s.scanAutoFrame);
    const suppressed = useAfoStore((s) => s.scanAutoFrameSuppressed);
    const setView = useDesignStore((s) => s.setViewer);

    const targetId = activeAfoTarget(workflow, placement?.redo ?? null);

    useEffect(() => {
        const ctrl = controls.current;
        if (!ctrl || !placement || !targetId || !autoFrame || suppressed) return;
        const scan = scanForAfoWorkflow();
        const side = afoFrameSide(scan?.side ?? "left");
        const view = cameraViewForAfoMarker(targetId as AfoMarkerKey, side);
        const timer = window.setTimeout(() => {
            tweenCameraView(ctrl, view, () => setView({ view }));
        }, AFO_PLACE_ADVANCE_MS);
        return () => window.clearTimeout(timer);
    }, [targetId, placement, autoFrame, suppressed, controls, setView, workflow.alignmentApplied]);

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
    const view = cameraViewForAfoMarker(targetId as AfoMarkerKey, side);
    tweenCameraView(controls, view, () => useDesignStore.getState().setViewer({ view }));
}

function tweenCameraView(
    controls: OrbitControlsImpl,
    view: CameraView,
    onDone: () => void,
): void {
    const destPos = new THREE.Vector3(...VIEW_CAMERA_POS[view]);
    const destUp = new THREE.Vector3(...viewCameraUp(view));
    const startPos = controls.object.position.clone();
    const startUp = controls.object.up.clone();
    const startTarget = controls.target.clone();
    const destTarget = new THREE.Vector3(0, 0, 0);
    const t0 = performance.now();
    const tick = (now: number) => {
        const t = Math.min(1, (now - t0) / AFO_CAMERA_TWEEN_MS);
        const eased = t * (2 - t);
        controls.object.position.lerpVectors(startPos, destPos, eased);
        controls.object.up.lerpVectors(startUp, destUp, eased).normalize();
        controls.target.lerpVectors(startTarget, destTarget, eased);
        controls.update();
        if (t < 1) requestAnimationFrame(tick);
        else onDone();
    };
    requestAnimationFrame(tick);
}
