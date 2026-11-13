// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import { markerPlacementBlocked } from "@/features/measure/exclusive-mode";
import { AFO_DESIGN_MARKERS, AFO_TRIM_CLOSE_PX } from "@/lib/geometry/afo/defaults";
import {
    type AfoOrientedSides,
    cameraViewForAfoMarkerId,
    orientedPlantarSides,
} from "@/lib/geometry/afo/marker-side";
import { nearestVertex } from "@/lib/geometry/afo/mesh-ops";
import {
    beginTrimPinPress,
    markTrimDragHistory,
    releaseTrimDragPointer,
    type TrimPinGesture,
    trimDragMovePlan,
} from "@/lib/geometry/afo/trim-drag";
import { registerTrimClick } from "@/lib/geometry/afo/trim-loop";
import {
    AFO_TRIM_CLICK_PX,
    AFO_TRIM_NO_MESH,
    designLandmarkPlacementActive,
    isAfoCastTrimPick,
    trimPointerIsClick,
} from "@/lib/geometry/afo/trim-preview";
import { fitSurfaceSpline, type SurfaceSpline, trimPinFromHit } from "@/lib/geometry/afo/trim-spline";
import type { AfoVec3 } from "@/lib/geometry/afo/types";
import { applyCameraViewPreset, type CameraViewControls } from "@/lib/geometry/viewport-side-layout";
import { getAfoState, patchAfoState, refreshAfoWorkingMesh, useAfoStore } from "@/stores/afo-store";
import { type CameraView, useDesignStore } from "@/stores/design-store";
import { measureToolArmed } from "@/stores/measure-store";

/** Same matrix and M1/M5 values share one key, even when the arrays are new objects. */
export function orientedSidesKey(
    matrix: number[] | null | undefined,
    m1: AfoVec3 | undefined,
    m5: AfoVec3 | undefined,
): string {
    const nums = matrix ? matrix.map((n) => (Number.isFinite(n) ? n.toFixed(5) : "")).join(",") : "";
    const p = (v: AfoVec3 | undefined) => (v ? `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}` : "");
    return `${nums}|${p(m1)}|${p(m5)}`;
}

/** Stable medial/lateral axis. A new object every render was retriggering the camera. */
export function useOrientedPlantarSides(
    matrix: number[] | null | undefined,
    m1: AfoVec3 | undefined,
    m5: AfoVec3 | undefined,
): AfoOrientedSides | undefined {
    const key = orientedSidesKey(matrix, m1, m5);
    const cache = useRef<{ key: string; value: AfoOrientedSides | undefined } | null>(null);
    if (!cache.current || cache.current.key !== key) {
        cache.current = { key, value: orientedPlantarSides(matrix, m1, m5) };
    }
    return cache.current.value;
}

export function AfoMarkerPlacement() {
    const { gl, camera, raycaster, scene, controls } = useThree();
    const placingIndex = useAfoStore((s) => s.placingLandmarkIndex);
    const placingClinicalId = useAfoStore((s) => s.placingClinicalId);
    const placingTrim = useAfoStore((s) => s.placingTrim);
    const correctedMesh = useAfoStore((s) => s.correctedMesh);
    const castMesh = useAfoStore((s) => s.castMesh);
    const working = correctedMesh ?? castMesh;
    const afo = useDesignStore((s) => s.design.afo) ?? getAfoState();
    const setView = useDesignStore((s) => s.setViewer);
    const setPlacing = useAfoStore((s) => s.setPlacingLandmarkIndex);
    const setDragging = useAfoStore((s) => s.setDraggingTrimIndex);
    const lastClient = useRef<{ x: number; y: number } | null>(null);
    const orientedSides = useOrientedPlantarSides(
        afo.scanWorkflow.matrixElements,
        afo.scanWorkflow.plantar.m1p,
        afo.scanWorkflow.plantar.m5p,
    );
    const spanRef = useRef<AfoVec3[][] | null>(null);
    /** Survives the trimPoints update that used to restart this effect and drop the drag. */
    const gestureRef = useRef<TrimPinGesture | null>(null);
    const workingRef = useRef(working);
    workingRef.current = working;
    const orientedRef = useRef(orientedSides);
    orientedRef.current = orientedSides;
    const placingIndexRef = useRef(placingIndex);
    placingIndexRef.current = placingIndex;

    const applyView = useCallback(
        (view: CameraView) => {
            setView({ view });
            applyCameraViewPreset(controls as CameraViewControls | undefined, view);
        },
        [controls, setView],
    );
    const applyViewRef = useRef(applyView);
    applyViewRef.current = applyView;

    useEffect(() => {
        if (placingTrim) return;
        const marker = AFO_DESIGN_MARKERS[Math.min(placingIndex, AFO_DESIGN_MARKERS.length - 1)];
        if (!marker) return;
        applyView(cameraViewForAfoMarkerId(marker.id, afo.side, orientedSides));
    }, [placingIndex, placingTrim, afo.side, orientedSides, applyView]);

    useEffect(() => {
        if (!placingClinicalId) return;
        applyView(cameraViewForAfoMarkerId(placingClinicalId, afo.side, orientedSides));
    }, [placingClinicalId, afo.side, orientedSides, applyView]);

    useEffect(() => {
        const trimPick = (): THREE.Mesh | null => {
            let found: THREE.Mesh | null = null;
            scene.traverse((obj) => {
                const mesh = obj as THREE.Mesh;
                if (!mesh.isMesh || !isAfoCastTrimPick(mesh.userData)) return;
                found = mesh;
            });
            return found;
        };

        const hitWorking = (clientX: number, clientY: number): { point: AfoVec3; index: number } | null => {
            const mesh = workingRef.current;
            if (!mesh) return null;
            const rect = gl.domElement.getBoundingClientRect();
            if (rect.width < 1 || rect.height < 1) return null;
            const ndc = new THREE.Vector2(
                ((clientX - rect.left) / rect.width) * 2 - 1,
                -((clientY - rect.top) / rect.height) * 2 + 1,
            );
            raycaster.setFromCamera(ndc, camera);
            const pick = trimPick();
            if (!pick) return null;
            const hits = raycaster.intersectObject(pick, false);
            const first = hits[0];
            if (!first) return null;
            pick.updateWorldMatrix(true, false);
            const local = pick.worldToLocal(first.point.clone());
            const pin = trimPinFromHit(mesh, { x: local.x, y: local.y, z: local.z });
            if (!pin) return null;
            return { point: pin.point, index: pin.vertexIndex };
        };

        const pinScreenPx = (point: AfoVec3, clientX: number, clientY: number): number | null => {
            const pick = trimPick();
            const rect = gl.domElement.getBoundingClientRect();
            if (!pick || rect.width < 1 || rect.height < 1) return null;
            const v = new THREE.Vector3(point.x, point.y, point.z);
            pick.updateWorldMatrix(true, false);
            pick.localToWorld(v);
            v.project(camera);
            if (v.z < -1 || v.z > 1) return null;
            const sx = (v.x * 0.5 + 0.5) * rect.width;
            const sy = (-v.y * 0.5 + 0.5) * rect.height;
            return Math.hypot(sx - (clientX - rect.left), sy - (clientY - rect.top));
        };

        const nearestPinPx = (clientX: number, clientY: number): { index: number; px: number } | null => {
            const pins = (useDesignStore.getState().design.afo ?? getAfoState()).trimPoints;
            let best: { index: number; px: number } | null = null;
            pins.forEach((pin, index) => {
                const px = pinScreenPx(pin.point, clientX, clientY);
                if (px == null) return;
                if (!best || px < best.px) best = { index, px };
            });
            return best;
        };

        const rememberFit = (fit: SurfaceSpline | null) => {
            spanRef.current = fit?.segments ?? null;
        };

        const publishHover = (clientX: number, clientY: number) => {
            if (!useAfoStore.getState().placingTrim) return;
            const hit = hitWorking(clientX, clientY);
            useAfoStore
                .getState()
                .setTrimHover(hit ? { x: hit.point.x, y: hit.point.y, z: hit.point.z } : null);
        };

        if (!useAfoStore.getState().placingTrim) {
            if (useAfoStore.getState().trimHover) useAfoStore.getState().setTrimHover(null);
        } else if (lastClient.current) {
            publishHover(lastClient.current.x, lastClient.current.y);
        }

        const orbit = controls as {
            enabled?: boolean;
            addEventListener?: (type: string, fn: () => void) => void;
            removeEventListener?: (type: string, fn: () => void) => void;
        } | null;
        let down: { x: number; y: number } | null = null;
        let pointerDist = 0;
        let orbitMoved = false;
        const onOrbitChange = () => {
            if (pointerDist > AFO_TRIM_CLICK_PX) orbitMoved = true;
        };
        orbit?.addEventListener?.("change", onOrbitChange);

        const publishPinHover = (clientX: number, clientY: number) => {
            const near = nearestPinPx(clientX, clientY);
            const next = near && near.px <= AFO_TRIM_CLOSE_PX ? near.index : null;
            if (useAfoStore.getState().hoveredTrimIndex !== next) {
                useAfoStore.getState().setHoveredTrimIndex(next);
            }
        };

        const closeAtFirstPin = () => {
            const mesh = workingRef.current;
            const loop = getAfoState();
            if (!mesh) return;
            const fit = fitSurfaceSpline(
                mesh,
                loop.trimPoints.map((p) => p.point),
                { closed: true, previousSegments: spanRef.current ?? undefined },
            );
            rememberFit(fit);
            useAfoStore.getState().setLastError(fit.ok ? null : fit.reasons.join(" "));
            patchAfoState({ trimClosed: true, trimCurve: fit.curve, trimConfirmed: false }, "afo-trim-close");
        };

        const endPinGesture = (ev: PointerEvent | null) => {
            const gesture = gestureRef.current;
            if (gesture && ev) releaseTrimDragPointer(gl.domElement, gesture.pointerId);
            gestureRef.current = null;
            if (orbit) orbit.enabled = true;
            useAfoStore.getState().setTrimGestureActive(false);
            setDragging(null);
        };

        const onDown = (ev: PointerEvent) => {
            if (markerPlacementBlocked(measureToolArmed())) return;
            if (ev.button !== 0) return;
            lastClient.current = { x: ev.clientX, y: ev.clientY };
            down = { x: ev.clientX, y: ev.clientY };
            pointerDist = 0;
            orbitMoved = false;
            const loop = getAfoState();
            const placing = useAfoStore.getState().placingTrim;
            const near =
                workingRef.current && (placing || loop.trimPoints.length > 0)
                    ? nearestPinPx(ev.clientX, ev.clientY)
                    : null;
            const pinIndex = near && near.px <= AFO_TRIM_CLOSE_PX ? near.index : null;
            const press = beginTrimPinPress({
                pinIndex,
                trimConfirmed: loop.trimConfirmed,
                scanPlacementActive: useAfoStore.getState().scanPlacement != null,
                pointerId: ev.pointerId,
                x: ev.clientX,
                y: ev.clientY,
                element: gl.domElement,
            });
            gestureRef.current = press.gesture;
            if (!press.gesture) return;
            if (orbit) orbit.enabled = false;
            useAfoStore.getState().setTrimGestureActive(true);
            ev.preventDefault();
            ev.stopPropagation();
        };

        const onMove = (ev: PointerEvent) => {
            if (markerPlacementBlocked(measureToolArmed())) return;
            lastClient.current = { x: ev.clientX, y: ev.clientY };
            if (down) pointerDist = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
            const gesture = gestureRef.current;
            if (useAfoStore.getState().placingTrim && !gesture?.dragging)
                publishHover(ev.clientX, ev.clientY);
            if (!gesture || gesture.pointerId !== ev.pointerId) {
                if (!gesture) publishPinHover(ev.clientX, ev.clientY);
                return;
            }
            const plan = trimDragMovePlan(gesture, ev.clientX, ev.clientY);
            gestureRef.current = plan.gesture;
            if (!plan.gesture.dragging) return;
            if (plan.dragStarted) setDragging(plan.gesture.pinIndex);
            const mesh = workingRef.current;
            if (!mesh) return;
            const hit = hitWorking(ev.clientX, ev.clientY);
            if (!hit) return;
            const current = getAfoState();
            const next = current.trimPoints.slice();
            const pinIndex = plan.gesture.pinIndex;
            if (!next[pinIndex]) return;
            const point = { x: hit.point.x, y: hit.point.y, z: hit.point.z };
            next[pinIndex] = { point, vertexIndex: nearestVertex(mesh, point).index };
            const fit = fitSurfaceSpline(
                mesh,
                next.map((p) => p.point),
                {
                    closed: current.trimClosed,
                    dragIndex: pinIndex,
                    previousSegments: spanRef.current ?? undefined,
                    quick: !current.trimClosed,
                },
            );
            rememberFit(fit);
            if (fit.reasons.length) useAfoStore.getState().setLastError(fit.reasons.join(" "));
            else useAfoStore.getState().setLastError(null);
            patchAfoState({ trimPoints: next, trimCurve: fit.curve, shellReady: false }, "afo-trim-drag", {
                history: plan.writeHistory,
            });
            if (plan.writeHistory && gestureRef.current) {
                gestureRef.current = markTrimDragHistory(gestureRef.current);
            }
        };

        const onUp = (ev: PointerEvent) => {
            if (markerPlacementBlocked(measureToolArmed())) return;
            const gesture = gestureRef.current;
            const dragged = gesture?.dragging === true;
            const startedOnPin = gesture && !dragged ? gesture.pinIndex : null;
            if (gesture) endPinGesture(ev);
            else if (orbit) orbit.enabled = true;
            const dist = down
                ? Math.hypot(ev.clientX - down.x, ev.clientY - down.y)
                : Number.POSITIVE_INFINITY;
            const click = trimPointerIsClick(dist, orbitMoved);
            down = null;
            if (dragged || !click) return;
            const mesh = workingRef.current;
            const loop = getAfoState();
            if (!mesh) {
                useAfoStore.getState().setLastError(AFO_TRIM_NO_MESH);
                return;
            }
            const session = useAfoStore.getState();
            if (startedOnPin != null) {
                if (
                    session.placingTrim &&
                    startedOnPin === 0 &&
                    loop.trimPoints.length >= 3 &&
                    !loop.trimClosed
                ) {
                    closeAtFirstPin();
                }
                return;
            }
            const hit = hitWorking(ev.clientX, ev.clientY);
            if (!hit) return;
            const point = { x: hit.point.x, y: hit.point.y, z: hit.point.z };
            if (session.placingTrim) {
                const firstPx = loop.trimPoints[0]
                    ? pinScreenPx(loop.trimPoints[0].point, ev.clientX, ev.clientY)
                    : null;
                const registered = registerTrimClick(
                    loop.trimPoints.map((p) => p.point),
                    point,
                    firstPx,
                );
                if (registered.closed) {
                    const fit = fitSurfaceSpline(mesh, registered.pins, { closed: true });
                    rememberFit(fit);
                    useAfoStore.getState().setLastError(fit.ok ? null : fit.reasons.join(" "));
                    patchAfoState(
                        { trimClosed: true, trimCurve: fit.curve, trimConfirmed: false },
                        "afo-trim-close",
                    );
                    return;
                }
                if (!registered.added) return;
                const fit =
                    registered.pins.length >= 2
                        ? fitSurfaceSpline(mesh, registered.pins, { closed: false, quick: true })
                        : null;
                rememberFit(fit);
                if (fit && !fit.ok && fit.reasons.length)
                    useAfoStore.getState().setLastError(fit.reasons.join(" "));
                patchAfoState(
                    {
                        trimPoints: registered.pins.map((p) => ({
                            point: p,
                            vertexIndex: nearestVertex(mesh, p).index,
                        })),
                        trimCurve: fit?.curve ?? [],
                        trimClosed: false,
                        trimConfirmed: false,
                    },
                    "afo-trim-point",
                );
                return;
            }
            if (session.placingClinicalId) {
                const rest = loop.clinicalMarkers.filter((m) => m.id !== session.placingClinicalId);
                patchAfoState(
                    {
                        clinicalMarkers: [
                            ...rest,
                            { id: session.placingClinicalId, point, vertexIndex: hit.index },
                        ],
                    },
                    "afo-clinical-marker",
                );
                useAfoStore.getState().setPlacingClinicalId(null);
                refreshAfoWorkingMesh();
                return;
            }
            if (
                !designLandmarkPlacementActive({
                    placingTrim: session.placingTrim,
                    placingClinical: session.placingClinicalId != null,
                    placingDesignLandmarks: session.placingDesignLandmarks,
                })
            ) {
                return;
            }
            const marker = AFO_DESIGN_MARKERS[placingIndexRef.current];
            if (!marker) return;
            const rest = loop.landmarks.filter((l) => l.id !== marker.id);
            patchAfoState(
                { landmarks: [...rest, { id: marker.id, point, vertexIndex: hit.index }] },
                "afo-landmark",
            );
            const next = placingIndexRef.current + 1;
            setPlacing(next);
            if (next >= AFO_DESIGN_MARKERS.length) useAfoStore.getState().setPlacingDesignLandmarks(false);
            const upcoming = AFO_DESIGN_MARKERS[Math.min(next, AFO_DESIGN_MARKERS.length - 1)];
            if (upcoming)
                applyViewRef.current(cameraViewForAfoMarkerId(upcoming.id, loop.side, orientedRef.current));
        };

        gl.domElement.addEventListener("pointerdown", onDown, true);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointermove", onMove);
        return () => {
            orbit?.removeEventListener?.("change", onOrbitChange);
            const gesture = gestureRef.current;
            if (gesture) releaseTrimDragPointer(gl.domElement, gesture.pointerId);
            gestureRef.current = null;
            if (orbit) orbit.enabled = true;
            useAfoStore.getState().setTrimGestureActive(false);
            setDragging(null);
            gl.domElement.removeEventListener("pointerdown", onDown, true);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointermove", onMove);
        };
    }, [camera, controls, gl, raycaster, scene, setDragging, setPlacing]);

    return null;
}
