// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { ZERO_SCAN_OFFSET } from "@/lib/geometry/scan-display";
import { useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import { usePerformanceStore } from "@/stores/performance-store";
import { useScanStore } from "@/stores/scan-store";

const DRAG_THRESHOLD_PX = 3;

/**
 * Set when a scan is picked so Canvas `onPointerMissed` does not immediately
 * clear the selection (R3F treats meshes without handlers as misses).
 */
let suppressScanMissDeselect = false;

export function consumeScanMissDeselectSuppression(): boolean {
    if (!suppressScanMissDeselect) return false;
    suppressScanMissDeselect = false;
    return true;
}

export function suppressNextScanMissDeselect(): void {
    suppressScanMissDeselect = true;
}

/**
 * Select a foot scan, then drag on the footprint plane or nudge with arrow keys.
 * Disabled during marker placement, plane slice, and trimline/trim edit.
 */
export function ScanTransformTool() {
    const placementMode = useScanStore((s) => s.placementMode);
    const sliceDraft = useScanStore((s) => s.sliceDraft);
    const rotateDraft = useScanStore((s) => s.rotateDraft);
    const selectedScanId = useScanStore((s) => s.selectedScanId);
    const selectScan = useScanStore((s) => s.selectScan);
    const setManualOffset = useScanStore((s) => s.setManualOffset);
    const nudgeManualOffset = useScanStore((s) => s.nudgeManualOffset);
    const selectElement = useDesignStore((s) => s.selectElement);
    const editMode = useMeshEditStore((s) => s.editMode);
    const setInteracting = usePerformanceStore((s) => s.setInteracting);
    const { gl, camera, raycaster, scene, controls } = useThree();

    const dragRef = useRef<{
        scanId: string;
        pointerId: number;
        startClientX: number;
        startClientY: number;
        dragging: boolean;
        plane: THREE.Plane;
        parentInv: THREE.Matrix4;
        originLocal: THREE.Vector3;
        startOffset: { x: number; y: number; z: number };
    } | null>(null);

    const blocked =
        placementMode != null ||
        sliceDraft != null ||
        rotateDraft != null ||
        editMode === "edit-trimline" ||
        editMode === "trim";

    const pickScan = useCallback(
        (
            clientX: number,
            clientY: number,
        ): { scanId: string; mesh: THREE.Mesh; worldPoint: THREE.Vector3 } | null => {
            const rect = gl.domElement.getBoundingClientRect();
            const ndc = new THREE.Vector2(
                ((clientX - rect.left) / rect.width) * 2 - 1,
                -((clientY - rect.top) / rect.height) * 2 + 1,
            );
            raycaster.setFromCamera(ndc, camera);

            const targets: THREE.Object3D[] = [];
            scene.traverse((obj) => {
                if (!(obj as THREE.Mesh).isMesh) return;
                if (obj.userData?.isScanPickMesh || obj.userData?.isScanMesh) targets.push(obj);
            });
            if (targets.length === 0) return null;
            const hits = raycaster.intersectObjects(targets, false);
            const first = hits[0];
            if (!first) return null;
            const mesh = first.object as THREE.Mesh;
            const scanId = mesh.userData?.scanId as string | undefined;
            if (!scanId) return null;
            return { scanId, mesh, worldPoint: first.point.clone() };
        },
        [gl.domElement, camera, raycaster, scene],
    );

    const intersectDragPlane = useCallback(
        (clientX: number, clientY: number, plane: THREE.Plane): THREE.Vector3 | null => {
            const rect = gl.domElement.getBoundingClientRect();
            const ndc = new THREE.Vector2(
                ((clientX - rect.left) / rect.width) * 2 - 1,
                -((clientY - rect.top) / rect.height) * 2 + 1,
            );
            raycaster.setFromCamera(ndc, camera);
            const hit = new THREE.Vector3();
            if (!raycaster.ray.intersectPlane(plane, hit)) return null;
            return hit;
        },
        [gl.domElement, camera, raycaster],
    );

    const onPointerDown = useCallback(
        (e: PointerEvent) => {
            if (blocked || e.button !== 0) return;
            const hit = pickScan(e.clientX, e.clientY);
            if (!hit) return;

            e.stopPropagation();
            e.preventDefault();

            suppressScanMissDeselect = true;
            selectElement(null);
            selectScan(hit.scanId);

            const parent = hit.mesh.parent;
            if (!parent) return;
            parent.updateWorldMatrix(true, false);

            // Footprint plane through the hit; parent-local +Z is base height.
            const worldNormal = new THREE.Vector3(0, 0, 1)
                .applyMatrix3(new THREE.Matrix3().getNormalMatrix(parent.matrixWorld))
                .normalize();
            const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(worldNormal, hit.worldPoint);
            const parentInv = parent.matrixWorld.clone().invert();
            const originLocal = hit.worldPoint.clone().applyMatrix4(parentInv);
            const startOffset = useScanStore.getState().manualOffsetByScanId[hit.scanId] ?? {
                ...ZERO_SCAN_OFFSET,
            };

            dragRef.current = {
                scanId: hit.scanId,
                pointerId: e.pointerId,
                startClientX: e.clientX,
                startClientY: e.clientY,
                dragging: false,
                plane,
                parentInv,
                originLocal,
                startOffset: { ...startOffset },
            };
            gl.domElement.setPointerCapture(e.pointerId);
        },
        [blocked, pickScan, selectElement, selectScan, gl.domElement],
    );

    const onPointerMove = useCallback(
        (e: PointerEvent) => {
            const drag = dragRef.current;
            if (!drag || drag.pointerId !== e.pointerId) return;

            const dist = Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY);
            if (!drag.dragging && dist < DRAG_THRESHOLD_PX) return;

            if (!drag.dragging) {
                drag.dragging = true;
                if (controls) (controls as OrbitControlsImpl).enabled = false;
                setInteracting(true, "gizmo");
            }

            const world = intersectDragPlane(e.clientX, e.clientY, drag.plane);
            if (!world) return;
            const local = world.applyMatrix4(drag.parentInv);
            setManualOffset(drag.scanId, {
                x: drag.startOffset.x + (local.x - drag.originLocal.x),
                y: drag.startOffset.y + (local.y - drag.originLocal.y),
                z: drag.startOffset.z,
            });
        },
        [controls, setInteracting, intersectDragPlane, setManualOffset],
    );

    const endDrag = useCallback(
        (e: PointerEvent) => {
            const drag = dragRef.current;
            if (!drag || drag.pointerId !== e.pointerId) return;
            if (drag.dragging) {
                if (controls) (controls as OrbitControlsImpl).enabled = true;
                setInteracting(false);
            }
            dragRef.current = null;
            try {
                gl.domElement.releasePointerCapture(e.pointerId);
            } catch {
                /* already released */
            }
        },
        [controls, setInteracting, gl.domElement],
    );

    useEffect(() => {
        if (blocked) {
            if (dragRef.current?.dragging && controls) {
                (controls as OrbitControlsImpl).enabled = true;
                setInteracting(false);
            }
            dragRef.current = null;
            return;
        }
        const el = gl.domElement;
        el.addEventListener("pointerdown", onPointerDown);
        el.addEventListener("pointermove", onPointerMove);
        el.addEventListener("pointerup", endDrag);
        el.addEventListener("pointercancel", endDrag);
        return () => {
            el.removeEventListener("pointerdown", onPointerDown);
            el.removeEventListener("pointermove", onPointerMove);
            el.removeEventListener("pointerup", endDrag);
            el.removeEventListener("pointercancel", endDrag);
        };
    }, [blocked, gl.domElement, onPointerDown, onPointerMove, endDrag, controls, setInteracting]);

    // Arrow-key nudge in base-local footprint axes (X length / AP, Y width / ML).
    useEffect(() => {
        if (blocked || !selectedScanId) return;

        const onKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable)
                return;

            const step = e.altKey ? 5 : e.shiftKey ? 0.25 : 1;
            let dx = 0;
            let dy = 0;
            let dz = 0;
            switch (e.key) {
                case "ArrowUp":
                    dx = step;
                    break;
                case "ArrowDown":
                    dx = -step;
                    break;
                case "ArrowLeft":
                    dy = step;
                    break;
                case "ArrowRight":
                    dy = -step;
                    break;
                case "PageUp":
                    dz = step;
                    break;
                case "PageDown":
                    dz = -step;
                    break;
                default:
                    return;
            }
            e.preventDefault();
            nudgeManualOffset(selectedScanId, dx, dy, dz);
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [blocked, selectedScanId, nudgeManualOffset]);

    return null;
}
