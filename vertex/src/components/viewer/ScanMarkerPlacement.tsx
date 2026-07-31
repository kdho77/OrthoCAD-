// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import { getScanRegistrationMatrix, type MarkerId, useScanStore } from "@/stores/scan-store";

/**
 * Raycast marker placement / drag on the scan mesh only.
 * OrbitControls remain enabled; misses do not capture the pointer.
 */
export function ScanMarkerPlacement() {
    const placementMode = useScanStore((s) => s.placementMode);
    const setMarker = useScanStore((s) => s.setMarker);
    const scans = useScanStore((s) => s.scans);
    const registrationByScanId = useScanStore((s) => s.registrationByScanId);
    const { gl, camera, raycaster, scene } = useThree();

    const dragging = useRef<MarkerId | null>(null);
    const scanIdRef = useRef<string | null>(null);
    scanIdRef.current = placementMode?.scanId ?? null;

    const hitScanLocal = useCallback(
        (clientX: number, clientY: number, scanId: string): THREE.Vector3 | null => {
            if (!scans.find((s) => s.id === scanId)) return null;

            const rect = gl.domElement.getBoundingClientRect();
            const ndc = new THREE.Vector2(
                ((clientX - rect.left) / rect.width) * 2 - 1,
                -((clientY - rect.top) / rect.height) * 2 + 1,
            );
            raycaster.setFromCamera(ndc, camera);

            const targets: THREE.Object3D[] = [];
            scene.traverse((obj) => {
                if (
                    (obj as THREE.Mesh).isMesh &&
                    obj.userData?.isScanMesh &&
                    obj.userData.scanId === scanId
                ) {
                    targets.push(obj);
                }
            });
            if (targets.length === 0) return null;

            const hits = raycaster.intersectObjects(targets, false);
            if (hits.length === 0) return null;
            const hit = hits[0]!;
            const mesh = hit.object as THREE.Mesh;
            const local = hit.point.clone();
            mesh.worldToLocal(local);
            // worldToLocal includes registration on the mesh — undo so markers
            // stay in raw scan coordinates.
            const reg = getScanRegistrationMatrix(registrationByScanId[scanId]);
            if (reg) {
                local.applyMatrix4(reg.clone().invert());
            }
            return local;
        },
        [scans, gl.domElement, camera, raycaster, scene, registrationByScanId],
    );

    const onPointerDown = useCallback(
        (e: PointerEvent) => {
            if (!placementMode) return;
            const local = hitScanLocal(e.clientX, e.clientY, placementMode.scanId);
            if (!local) return;
            e.stopPropagation();
            e.preventDefault();
            const markers = useScanStore.getState().markersByScanId[placementMode.scanId];
            let target: MarkerId = placementMode.next;
            if (markers) {
                const thresh = 8;
                for (const id of ["M1", "M2", "M3"] as MarkerId[]) {
                    const p = markers[id];
                    if (p && p.distanceTo(local) < thresh) {
                        target = id;
                        break;
                    }
                }
            }
            dragging.current = target;
            setMarker(placementMode.scanId, target, local);
            gl.domElement.setPointerCapture(e.pointerId);
        },
        [placementMode, hitScanLocal, setMarker, gl.domElement],
    );

    const onPointerMove = useCallback(
        (e: PointerEvent) => {
            if (!dragging.current || !scanIdRef.current) return;
            const local = hitScanLocal(e.clientX, e.clientY, scanIdRef.current);
            if (!local) return; // clamp: keep last on-surface point
            setMarker(scanIdRef.current, dragging.current, local);
        },
        [hitScanLocal, setMarker],
    );

    const onPointerUp = useCallback(
        (e: PointerEvent) => {
            if (!dragging.current) return;
            dragging.current = null;
            try {
                gl.domElement.releasePointerCapture(e.pointerId);
            } catch {
                /* already released */
            }
        },
        [gl.domElement],
    );

    useEffect(() => {
        if (!placementMode) return;
        const el = gl.domElement;
        el.addEventListener("pointerdown", onPointerDown);
        el.addEventListener("pointermove", onPointerMove);
        el.addEventListener("pointerup", onPointerUp);
        el.addEventListener("pointercancel", onPointerUp);
        return () => {
            el.removeEventListener("pointerdown", onPointerDown);
            el.removeEventListener("pointermove", onPointerMove);
            el.removeEventListener("pointerup", onPointerUp);
            el.removeEventListener("pointercancel", onPointerUp);
        };
    }, [placementMode, gl.domElement, onPointerDown, onPointerMove, onPointerUp]);

    return null;
}
