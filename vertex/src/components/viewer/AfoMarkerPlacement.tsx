// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import { AFO_DESIGN_MARKERS, AFO_TRIM_CLOSE_PX } from "@/lib/geometry/afo/defaults";
import { cameraViewForAfoMarkerId } from "@/lib/geometry/afo/marker-side";
import { nearestVertex } from "@/lib/geometry/afo/mesh-ops";
import { registerTrimClick } from "@/lib/geometry/afo/trim-loop";
import { isAfoCastTrimPick } from "@/lib/geometry/afo/trim-preview";
import { fitSurfaceSpline, type SurfaceSpline, trimPinFromHit } from "@/lib/geometry/afo/trim-spline";
import type { AfoVec3 } from "@/lib/geometry/afo/types";
import { applyCameraViewPreset, type CameraViewControls } from "@/lib/geometry/viewport-side-layout";
import { getAfoState, patchAfoState, refreshAfoWorkingMesh, useAfoStore } from "@/stores/afo-store";
import { type CameraView, useDesignStore } from "@/stores/design-store";

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
    const spanRef = useRef<AfoVec3[][] | null>(null);

    const applyView = useCallback(
        (view: CameraView) => {
            setView({ view });
            applyCameraViewPreset(controls as CameraViewControls | undefined, view);
        },
        [controls, setView],
    );

    useEffect(() => {
        if (placingTrim) return;
        const marker = AFO_DESIGN_MARKERS[Math.min(placingIndex, AFO_DESIGN_MARKERS.length - 1)];
        if (!marker) return;
        applyView(cameraViewForAfoMarkerId(marker.id, afo.side));
    }, [placingIndex, placingTrim, afo.side, applyView]);

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
            if (!working) return null;
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
            const first = hits.find((hit) => {
                const face = hit.face?.normal;
                if (!face) return true;
                const worldN = face.clone().transformDirection(pick.matrixWorld);
                return worldN.dot(raycaster.ray.direction) < 0;
            });
            if (!first) return null;
            pick.updateWorldMatrix(true, false);
            const local = pick.worldToLocal(first.point.clone());
            const pin = trimPinFromHit(working, { x: local.x, y: local.y, z: local.z });
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

        if (!placingTrim) {
            if (useAfoStore.getState().trimHover) useAfoStore.getState().setTrimHover(null);
        } else if (lastClient.current) {
            publishHover(lastClient.current.x, lastClient.current.y);
        }

        const onDown = (ev: PointerEvent) => {
            lastClient.current = { x: ev.clientX, y: ev.clientY };
            if (!working) return;
            if (placingTrim || afo.trimPoints.length > 0) {
                const near = nearestPinPx(ev.clientX, ev.clientY);
                if (near && near.px <= AFO_TRIM_CLOSE_PX && !afo.trimConfirmed) {
                    if (placingTrim && near.index === 0 && afo.trimPoints.length >= 3) {
                        const fit = fitSurfaceSpline(
                            working,
                            afo.trimPoints.map((p) => p.point),
                            { closed: true, previousSegments: spanRef.current ?? undefined },
                        );
                        rememberFit(fit);
                        useAfoStore.getState().setLastError(fit.ok ? null : fit.reasons.join(" "));
                        patchAfoState(
                            { trimClosed: true, trimCurve: fit.curve, trimConfirmed: false },
                            "afo-trim-close",
                        );
                        ev.preventDefault();
                        return;
                    }
                    setDragging(near.index);
                    ev.preventDefault();
                    return;
                }
            }

            const hit = hitWorking(ev.clientX, ev.clientY);
            if (!hit) return;
            const point = { x: hit.point.x, y: hit.point.y, z: hit.point.z };

            if (placingTrim) {
                const firstPx = afo.trimPoints[0]
                    ? pinScreenPx(afo.trimPoints[0].point, ev.clientX, ev.clientY)
                    : null;
                const registered = registerTrimClick(
                    afo.trimPoints.map((p) => p.point),
                    point,
                    firstPx,
                );
                if (registered.closed) {
                    const fit = fitSurfaceSpline(working, registered.pins, { closed: true });
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
                        ? fitSurfaceSpline(working, registered.pins, { closed: false, quick: true })
                        : null;
                rememberFit(fit);
                if (fit && !fit.ok && fit.reasons.length)
                    useAfoStore.getState().setLastError(fit.reasons.join(" "));
                patchAfoState(
                    {
                        trimPoints: registered.pins.map((p) => ({
                            point: p,
                            vertexIndex: nearestVertex(working, p).index,
                        })),
                        trimCurve: fit?.curve ?? [],
                        trimClosed: false,
                        trimConfirmed: false,
                    },
                    "afo-trim-point",
                );
                return;
            }

            if (placingClinicalId) {
                const rest = afo.clinicalMarkers.filter((m) => m.id !== placingClinicalId);
                patchAfoState(
                    {
                        clinicalMarkers: [...rest, { id: placingClinicalId, point, vertexIndex: hit.index }],
                    },
                    "afo-clinical-marker",
                );
                useAfoStore.getState().setPlacingClinicalId(null);
                refreshAfoWorkingMesh();
                return;
            }

            const marker = AFO_DESIGN_MARKERS[placingIndex];
            if (!marker) return;
            const rest = afo.landmarks.filter((l) => l.id !== marker.id);
            patchAfoState(
                { landmarks: [...rest, { id: marker.id, point, vertexIndex: hit.index }] },
                "afo-landmark",
            );
            const next = placingIndex + 1;
            setPlacing(next);
            const upcoming = AFO_DESIGN_MARKERS[Math.min(next, AFO_DESIGN_MARKERS.length - 1)];
            if (upcoming) applyView(cameraViewForAfoMarkerId(upcoming.id, afo.side));
        };

        const onMove = (ev: PointerEvent) => {
            lastClient.current = { x: ev.clientX, y: ev.clientY };
            if (useAfoStore.getState().placingTrim) publishHover(ev.clientX, ev.clientY);
            const drag = useAfoStore.getState().draggingTrimIndex;
            if (drag == null) return;
            const hit = hitWorking(ev.clientX, ev.clientY);
            if (!hit) return;
            const current = useDesignStore.getState().design.afo ?? getAfoState();
            const next = current.trimPoints.slice();
            if (!next[drag]) return;
            const point = { x: hit.point.x, y: hit.point.y, z: hit.point.z };
            next[drag] = { point, vertexIndex: nearestVertex(working, point).index };
            const fit = fitSurfaceSpline(
                working,
                next.map((p) => p.point),
                {
                    closed: current.trimClosed,
                    dragIndex: drag,
                    previousSegments: spanRef.current ?? undefined,
                    quick: !current.trimClosed,
                },
            );
            rememberFit(fit);
            if (fit.reasons.length) useAfoStore.getState().setLastError(fit.reasons.join(" "));
            else useAfoStore.getState().setLastError(null);
            patchAfoState(
                {
                    trimPoints: next,
                    trimCurve: fit.curve,
                    trimConfirmed: false,
                },
                "afo-trim-drag",
            );
        };

        const onUp = () => setDragging(null);

        gl.domElement.addEventListener("pointerdown", onDown);
        gl.domElement.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        return () => {
            gl.domElement.removeEventListener("pointerdown", onDown);
            gl.domElement.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
        };
    }, [
        afo.clinicalMarkers,
        afo.landmarks,
        afo.side,
        afo.trimConfirmed,
        afo.trimPoints,
        camera,
        gl,
        placingIndex,
        placingClinicalId,
        placingTrim,
        raycaster,
        scene,
        setDragging,
        setPlacing,
        applyView,
        working,
    ]);

    return null;
}
