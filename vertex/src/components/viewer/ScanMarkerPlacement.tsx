// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import { worldHitToScanLocal } from "@/lib/geometry/scan-display";
import { resolveMarkerPlacementTarget } from "@/lib/geometry/scan-marker-target";
import { refineHitOnFullMesh } from "@/lib/geometry/scan-pick-mesh";
import { type MarkerId, useScanStore } from "@/stores/scan-store";

/**
 * Raycast marker placement / drag on the scan mesh only.
 * Large scans: raycast invisible decimated pick proxy, then refine on full mesh (K3).
 * OrbitControls remain enabled; misses do not capture the pointer.
 *
 * Clicks auto-progress M1 → M2 → M3 → ARCH. After M3, registration runs and the
 * insole is shown again while prompting for optional ARCH (Esc / Skip to omit).
 * Existing markers are only retargeted for drag-adjust after that slot is
 * already placed,
 * using a scale-aware proximity radius (raw scan units ≠ mm).
 */
export function ScanMarkerPlacement() {
    const placementMode = useScanStore((s) => s.placementMode);
    const setMarker = useScanStore((s) => s.setMarker);
    const scans = useScanStore((s) => s.scans);
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

            const pickTargets: THREE.Object3D[] = [];
            const fullTargets: THREE.Object3D[] = [];
            scene.traverse((obj) => {
                if (!(obj as THREE.Mesh).isMesh || obj.userData?.scanId !== scanId) return;
                if (obj.userData?.isScanPickMesh) pickTargets.push(obj);
                if (obj.userData?.isScanMesh) fullTargets.push(obj);
            });

            // Prefer pick proxy when present (large scans); else full mesh.
            const targets = pickTargets.length > 0 ? pickTargets : fullTargets;
            if (targets.length === 0) return null;

            const hits = raycaster.intersectObjects(targets, false);
            if (hits.length === 0) return null;
            const hit = hits[0]!;
            const mesh = hit.object as THREE.Mesh;

            let worldPoint = hit.point.clone();

            // Refine against full geometry when we hit the decimated proxy.
            // Never place on the proxy surface — refine miss ⇒ no hit (L2).
            if (mesh.userData?.isScanPickMesh && mesh.userData.fullGeometry) {
                const fullGeo = mesh.userData.fullGeometry as THREE.BufferGeometry;
                // Ray in the mesh's local space (same frame as geometry).
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

            // M2 — markers are ALWAYS scan-local via inverse(matrixWorld).
            // Provisional display and registration both live on mesh.matrix; never
            // double-invert, and never pass display-space points to Kabsch.
            return worldHitToScanLocal(worldPoint, mesh.matrixWorld);
        },
        [scans, gl.domElement, camera, raycaster, scene],
    );

    const onPointerDown = useCallback(
        (e: PointerEvent) => {
            if (!placementMode) return;
            const local = hitScanLocal(e.clientX, e.clientY, placementMode.scanId);
            if (!local) return;
            e.stopPropagation();
            e.preventDefault();
            const state = useScanStore.getState();
            const markers = state.markersByScanId[placementMode.scanId];
            const scan = state.scans.find((s) => s.id === placementMode.scanId);
            const displayScale = scan?.display.displayScale ?? 1;
            const target = resolveMarkerPlacementTarget(placementMode.next, markers, local, displayScale);
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
            if (!local) return;
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
