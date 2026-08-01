// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { applyYawAboutAnchor } from "@/lib/geometry/scan-display";
import { usePerformanceStore } from "@/stores/performance-store";
import { useScanStore } from "@/stores/scan-store";
import { suppressNextScanMissDeselect } from "./ScanTransformTool";

function angleOnPlane(from: THREE.Vector3, to: THREE.Vector3): number {
    return Math.atan2(to.y - from.y, to.x - from.x);
}

/**
 * Two-point yaw rotate for a selected foot scan:
 * 1) click anchor (centre of rotation)
 * 2) click pivot (initial direction)
 * 3) move cursor to rotate; click to commit (Esc cancels)
 */
export function ScanRotateTool() {
    const rotateDraft = useScanStore((s) => s.rotateDraft);
    const setRotateDraft = useScanStore((s) => s.setRotateDraft);
    const setManualOffset = useScanStore((s) => s.setManualOffset);
    const cancelRotate = useScanStore((s) => s.cancelRotate);
    const setInteracting = usePerformanceStore((s) => s.setInteracting);
    const { gl, camera, raycaster, scene, controls } = useThree();

    const pickOnScanOrPlane = useCallback(
        (
            clientX: number,
            clientY: number,
            scanId: string,
        ): { world: THREE.Vector3; parentLocal: THREE.Vector3; parent: THREE.Object3D } | null => {
            const rect = gl.domElement.getBoundingClientRect();
            const ndc = new THREE.Vector2(
                ((clientX - rect.left) / rect.width) * 2 - 1,
                -((clientY - rect.top) / rect.height) * 2 + 1,
            );
            raycaster.setFromCamera(ndc, camera);

            const targets: THREE.Object3D[] = [];
            scene.traverse((obj) => {
                if (!(obj as THREE.Mesh).isMesh || obj.userData?.scanId !== scanId) return;
                if (obj.userData?.isScanMesh || obj.userData?.isScanPickMesh) targets.push(obj);
            });

            let world: THREE.Vector3 | null = null;
            let mesh: THREE.Mesh | null = null;
            const hits = targets.length > 0 ? raycaster.intersectObjects(targets, false) : [];
            if (hits[0]) {
                world = hits[0].point.clone();
                mesh = hits[0].object as THREE.Mesh;
            } else {
                // Fallback: footprint plane through mesh origin (parent +Z).
                let found: THREE.Mesh | null = null;
                scene.traverse((obj) => {
                    if (found) return;
                    if (
                        (obj as THREE.Mesh).isMesh &&
                        obj.userData?.isScanMesh &&
                        obj.userData?.scanId === scanId
                    ) {
                        found = obj as THREE.Mesh;
                    }
                });
                if (!found) return null;
                const foundMesh = found as THREE.Mesh;
                const parent = foundMesh.parent;
                if (!parent) return null;
                mesh = foundMesh;
                parent.updateWorldMatrix(true, false);
                const origin = new THREE.Vector3(0, 0, 0).applyMatrix4(parent.matrixWorld);
                const worldNormal = new THREE.Vector3(0, 0, 1)
                    .applyMatrix3(new THREE.Matrix3().getNormalMatrix(parent.matrixWorld))
                    .normalize();
                const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(worldNormal, origin);
                const hit = new THREE.Vector3();
                if (!raycaster.ray.intersectPlane(plane, hit)) return null;
                world = hit;
            }

            if (!mesh?.parent || !world) return null;
            const parent = mesh.parent;
            parent.updateWorldMatrix(true, false);
            const parentLocal = world.clone().applyMatrix4(parent.matrixWorld.clone().invert());
            return { world, parentLocal, parent };
        },
        [gl.domElement, camera, raycaster, scene],
    );

    const onPointerDown = useCallback(
        (e: PointerEvent) => {
            if (!rotateDraft || e.button !== 0) return;
            if (e.target !== gl.domElement) return;

            if (rotateDraft.step === 2) {
                // Commit current rotation.
                e.preventDefault();
                e.stopPropagation();
                suppressNextScanMissDeselect();
                if (controls) (controls as OrbitControlsImpl).enabled = true;
                setInteracting(false);
                cancelRotate({ restore: false });
                return;
            }

            const hit = pickOnScanOrPlane(e.clientX, e.clientY, rotateDraft.scanId);
            if (!hit) return;
            e.preventDefault();
            e.stopPropagation();
            suppressNextScanMissDeselect();

            if (rotateDraft.step === 0) {
                setRotateDraft({
                    ...rotateDraft,
                    step: 1,
                    anchorLocal: hit.parentLocal.toArray() as [number, number, number],
                    anchorWorld: hit.world.toArray() as [number, number, number],
                });
                return;
            }

            // step 1 → start rotating about anchor using pivot as initial angle
            const anchor = new THREE.Vector3().fromArray(rotateDraft.anchorLocal!);
            const baseAngle = angleOnPlane(anchor, hit.parentLocal);
            setRotateDraft({
                ...rotateDraft,
                step: 2,
                pivotLocal: hit.parentLocal.toArray() as [number, number, number],
                pivotWorld: hit.world.toArray() as [number, number, number],
                baseAngle,
            });
            if (controls) (controls as OrbitControlsImpl).enabled = false;
            setInteracting(true, "gizmo");
        },
        [
            rotateDraft,
            gl.domElement,
            pickOnScanOrPlane,
            setRotateDraft,
            cancelRotate,
            controls,
            setInteracting,
        ],
    );

    const onPointerMove = useCallback(
        (e: PointerEvent) => {
            if (!rotateDraft || rotateDraft.step !== 2 || rotateDraft.baseAngle == null) return;
            if (!rotateDraft.anchorLocal) return;

            const hit = pickOnScanOrPlane(e.clientX, e.clientY, rotateDraft.scanId);
            if (!hit) return;

            const anchor = new THREE.Vector3().fromArray(rotateDraft.anchorLocal);
            const current = angleOnPlane(anchor, hit.parentLocal);
            let delta = current - rotateDraft.baseAngle;
            // Wrap to (−π, π] so the mesh does not jump when crossing the branch cut.
            while (delta > Math.PI) delta -= 2 * Math.PI;
            while (delta <= -Math.PI) delta += 2 * Math.PI;

            setManualOffset(
                rotateDraft.scanId,
                applyYawAboutAnchor(rotateDraft.startOffset, { x: anchor.x, y: anchor.y }, delta),
            );
        },
        [rotateDraft, pickOnScanOrPlane, setManualOffset],
    );

    useEffect(() => {
        if (!rotateDraft) {
            if (controls) (controls as OrbitControlsImpl).enabled = true;
            return;
        }
        const el = gl.domElement;
        el.addEventListener("pointerdown", onPointerDown);
        el.addEventListener("pointermove", onPointerMove);
        el.style.cursor = "crosshair";
        return () => {
            el.removeEventListener("pointerdown", onPointerDown);
            el.removeEventListener("pointermove", onPointerMove);
            el.style.cursor = "";
        };
    }, [rotateDraft, gl.domElement, onPointerDown, onPointerMove, controls]);

    const markers = useMemo(() => {
        if (!rotateDraft?.anchorWorld) return null;
        const a = new THREE.Vector3().fromArray(rotateDraft.anchorWorld);
        const p = rotateDraft.pivotWorld ? new THREE.Vector3().fromArray(rotateDraft.pivotWorld) : null;
        return { a, p };
    }, [rotateDraft]);

    if (!rotateDraft || !markers) return null;

    return (
        <group>
            <mesh position={markers.a.toArray() as [number, number, number]} renderOrder={30}>
                <sphereGeometry args={[2.8, 14, 12]} />
                <meshBasicMaterial color="#c084fc" depthTest={false} />
            </mesh>
            {markers.p ? (
                <mesh position={markers.p.toArray() as [number, number, number]} renderOrder={30}>
                    <sphereGeometry args={[2.4, 14, 12]} />
                    <meshBasicMaterial color="#a78bfa" depthTest={false} />
                </mesh>
            ) : null}
        </group>
    );
}
