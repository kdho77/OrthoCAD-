// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useThree } from "@react-three/fiber";
import { useCallback, useEffect } from "react";
import * as THREE from "three";
import { AFO_DESIGN_MARKERS } from "@/lib/geometry/afo/defaults";
import { nearestVertex } from "@/lib/geometry/afo/mesh-ops";
import { isCloseClick } from "@/lib/geometry/afo/trim-loop";
import { applyCameraViewPreset, type CameraViewControls } from "@/lib/geometry/viewport-side-layout";
import { getAfoState, patchAfoState, refreshAfoWorkingMesh, useAfoStore } from "@/stores/afo-store";
import { type CameraView, useDesignStore } from "@/stores/design-store";

function viewForMarker(side: "left" | "right", view: "medial" | "lateral" | "bottom"): CameraView {
    if (view === "bottom") return "bottom";
    if (view === "medial") return side === "left" ? "right" : "left";
    return side === "left" ? "left" : "right";
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
        applyView(viewForMarker(afo.side, marker.view));
    }, [placingIndex, placingTrim, afo.side, applyView]);

    useEffect(() => {
        const hitWorking = (
            clientX: number,
            clientY: number,
        ): { point: THREE.Vector3; index: number } | null => {
            if (!working) return null;
            const rect = gl.domElement.getBoundingClientRect();
            const ndc = new THREE.Vector2(
                ((clientX - rect.left) / rect.width) * 2 - 1,
                -((clientY - rect.top) / rect.height) * 2 + 1,
            );
            raycaster.setFromCamera(ndc, camera);
            const targets: THREE.Object3D[] = [];
            scene.traverse((obj) => {
                if ((obj as THREE.Mesh).isMesh && (obj.userData?.isAfoCast || obj.userData?.isScanMesh)) {
                    targets.push(obj);
                }
            });
            const hits = raycaster.intersectObjects(targets, false);
            const first = hits[0];
            if (!first) return null;
            const mesh = first.object as THREE.Mesh;
            const local = mesh.worldToLocal(first.point.clone());
            const snap = nearestVertex(working, { x: local.x, y: local.y, z: local.z });
            return {
                point: new THREE.Vector3(
                    working.positions[snap.index * 3] ?? local.x,
                    working.positions[snap.index * 3 + 1] ?? local.y,
                    working.positions[snap.index * 3 + 2] ?? local.z,
                ),
                index: snap.index,
            };
        };

        const hitHandle = (clientX: number, clientY: number): number | null => {
            const rect = gl.domElement.getBoundingClientRect();
            const ndc = new THREE.Vector2(
                ((clientX - rect.left) / rect.width) * 2 - 1,
                -((clientY - rect.top) / rect.height) * 2 + 1,
            );
            raycaster.setFromCamera(ndc, camera);
            const handles: THREE.Object3D[] = [];
            scene.traverse((obj) => {
                if ((obj as THREE.Mesh).isMesh && obj.userData?.isAfoTrimHandle) handles.push(obj);
            });
            const hits = raycaster.intersectObjects(handles, false);
            const idx = hits[0]?.object.userData?.trimIndex;
            return typeof idx === "number" ? idx : null;
        };

        const onDown = (ev: PointerEvent) => {
            if (!working) return;
            if (placingTrim || afo.trimPoints.length > 0) {
                const handle = hitHandle(ev.clientX, ev.clientY);
                if (handle != null && !afo.trimConfirmed) {
                    if (placingTrim && handle === 0 && afo.trimPoints.length >= 3) {
                        patchAfoState({ trimClosed: true }, "afo-trim-close");
                        ev.preventDefault();
                        return;
                    }
                    setDragging(handle);
                    ev.preventDefault();
                    return;
                }
            }

            const hit = hitWorking(ev.clientX, ev.clientY);
            if (!hit) return;
            const point = { x: hit.point.x, y: hit.point.y, z: hit.point.z };

            if (placingTrim) {
                const first = afo.trimPoints[0];
                if (first && isCloseClick(first.point, point) && afo.trimPoints.length >= 3) {
                    patchAfoState({ trimClosed: true }, "afo-trim-close");
                    return;
                }
                patchAfoState(
                    { trimPoints: [...afo.trimPoints, { point, vertexIndex: hit.index }], trimClosed: false },
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
            if (upcoming) applyView(viewForMarker(afo.side, upcoming.view));
        };

        const onMove = (ev: PointerEvent) => {
            const drag = useAfoStore.getState().draggingTrimIndex;
            if (drag == null) return;
            const hit = hitWorking(ev.clientX, ev.clientY);
            if (!hit) return;
            const current = useDesignStore.getState().design.afo ?? getAfoState();
            const next = current.trimPoints.slice();
            if (!next[drag]) return;
            next[drag] = {
                point: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
                vertexIndex: hit.index,
            };
            patchAfoState({ trimPoints: next, trimConfirmed: false }, "afo-trim-drag");
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
