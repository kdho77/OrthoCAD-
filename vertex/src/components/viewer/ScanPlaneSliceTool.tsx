// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
    cuttingPlaneFromViewLine,
    keepPositiveTowardPoint,
    planeWorldToLocal,
    scanSliceFromPlane,
} from "@/lib/geometry/scan-plane-slice";
import { useScanStore } from "@/stores/scan-store";

/**
 * Draw a screen-space cut line (two clicks) to define a scan clipping plane.
 * Sketch plane passes through the scan bbox centre, facing the camera so the
 * clinician can cut connected noise that is not a separate component.
 */
export function ScanPlaneSliceTool() {
    const sliceDraft = useScanStore((s) => s.sliceDraft);
    const setSliceDraft = useScanStore((s) => s.setSliceDraft);
    const scans = useScanStore((s) => s.scans);
    const { gl, camera, raycaster, scene } = useThree();

    const scan = sliceDraft ? scans.find((s) => s.id === sliceDraft.scanId) : null;

    const sketchHit = useCallback(
        (clientX: number, clientY: number): THREE.Vector3 | null => {
            if (!scan || !sliceDraft) return null;
            const rect = gl.domElement.getBoundingClientRect();
            const ndc = new THREE.Vector2(
                ((clientX - rect.left) / rect.width) * 2 - 1,
                -((clientY - rect.top) / rect.height) * 2 + 1,
            );
            raycaster.setFromCamera(ndc, camera);

            // Prefer hit on the scan mesh (kept surface); else sketch plane through bbox centre.
            const targets: THREE.Object3D[] = [];
            scene.traverse((obj) => {
                if (!(obj as THREE.Mesh).isMesh || obj.userData?.scanId !== sliceDraft.scanId) return;
                if (obj.userData?.isScanMesh || obj.userData?.isScanPickMesh) targets.push(obj);
            });
            const hits = targets.length > 0 ? raycaster.intersectObjects(targets, false) : [];
            if (hits[0]) return hits[0].point.clone();

            // Fallback: intersect plane through scan centre facing camera.
            let mesh: THREE.Mesh | null = null;
            scene.traverse((obj) => {
                if (mesh) return;
                if (
                    (obj as THREE.Mesh).isMesh &&
                    obj.userData?.isScanMesh &&
                    obj.userData?.scanId === sliceDraft.scanId
                ) {
                    mesh = obj as THREE.Mesh;
                }
            });
            const center = new THREE.Vector3();
            if (mesh) {
                scan.geometry.computeBoundingBox();
                const box = scan.geometry.boundingBox ?? new THREE.Box3();
                box.getCenter(center);
                (mesh as THREE.Mesh).localToWorld(center);
            } else {
                center.set(0, 0, 0);
            }
            const viewDir = new THREE.Vector3();
            camera.getWorldDirection(viewDir);
            const sketch = new THREE.Plane().setFromNormalAndCoplanarPoint(viewDir, center);
            const out = new THREE.Vector3();
            if (!raycaster.ray.intersectPlane(sketch, out)) return null;
            return out;
        },
        [scan, sliceDraft, gl.domElement, camera, raycaster, scene],
    );

    const onPointerDown = useCallback(
        (e: PointerEvent) => {
            if (!sliceDraft || !scan) return;
            // Ignore UI clicks outside canvas.
            if (e.target !== gl.domElement) return;
            const hit = sketchHit(e.clientX, e.clientY);
            if (!hit) return;
            e.preventDefault();
            e.stopPropagation();

            if (sliceDraft.step === 0 || sliceDraft.step === 2) {
                // Start / restart line.
                setSliceDraft({
                    scanId: sliceDraft.scanId,
                    step: 1,
                    p0World: [hit.x, hit.y, hit.z],
                    p1World: null,
                    previewLocal: null,
                });
                return;
            }

            // Second point → build plane.
            const p0 = new THREE.Vector3().fromArray(sliceDraft.p0World!);
            const p1 = hit;
            const viewDir = new THREE.Vector3();
            camera.getWorldDirection(viewDir);
            const planeWorld = cuttingPlaneFromViewLine(p0, p1, viewDir);
            if (!planeWorld) return;

            // Find mesh matrixWorld for local conversion.
            let mesh: THREE.Mesh | null = null;
            scene.traverse((obj) => {
                if (mesh) return;
                if (
                    (obj as THREE.Mesh).isMesh &&
                    obj.userData?.isScanMesh &&
                    obj.userData?.scanId === scan.id
                ) {
                    mesh = obj as THREE.Mesh;
                }
            });
            if (!mesh) return;
            const localPlane = planeWorldToLocal(planeWorld, (mesh as THREE.Mesh).matrixWorld);

            // Default keep side: toward geometry centroid.
            scan.geometry.computeBoundingBox();
            const center = new THREE.Vector3();
            scan.geometry.boundingBox?.getCenter(center);
            const keepPositive = keepPositiveTowardPoint(localPlane, center);
            const previewLocal = scanSliceFromPlane(localPlane, keepPositive);

            setSliceDraft({
                scanId: sliceDraft.scanId,
                step: 2,
                p0World: sliceDraft.p0World,
                p1World: [p1.x, p1.y, p1.z],
                previewLocal,
            });
        },
        [sliceDraft, scan, sketchHit, gl.domElement, setSliceDraft, camera, scene],
    );

    useEffect(() => {
        if (!sliceDraft) return;
        const el = gl.domElement;
        el.addEventListener("pointerdown", onPointerDown);
        el.style.cursor = "crosshair";
        return () => {
            el.removeEventListener("pointerdown", onPointerDown);
            el.style.cursor = "";
        };
    }, [sliceDraft, gl.domElement, onPointerDown]);

    const previewHelpers = useMemo(() => {
        if (!sliceDraft?.p0World) return null;
        const p0 = new THREE.Vector3().fromArray(sliceDraft.p0World);
        const p1 = sliceDraft.p1World ? new THREE.Vector3().fromArray(sliceDraft.p1World) : null;
        return { p0, p1 };
    }, [sliceDraft]);

    const cutLine = useMemo(() => {
        if (!previewHelpers?.p1) return null;
        const geom = new THREE.BufferGeometry().setFromPoints([previewHelpers.p0, previewHelpers.p1]);
        return new THREE.Line(geom, new THREE.LineBasicMaterial({ color: "#fbbf24" }));
    }, [previewHelpers]);

    const cutLineRef = useRef<THREE.Line | null>(null);
    useEffect(() => {
        const prev = cutLineRef.current;
        cutLineRef.current = cutLine;
        return () => {
            prev?.geometry.dispose();
            (prev?.material as THREE.Material | undefined)?.dispose();
        };
    }, [cutLine]);

    if (!sliceDraft || !previewHelpers) return null;

    const { p0, p1 } = previewHelpers;

    return (
        <group>
            <mesh position={p0.toArray() as [number, number, number]}>
                <sphereGeometry args={[2.5, 12, 10]} />
                <meshBasicMaterial color="#fbbf24" depthTest={false} />
            </mesh>
            {p1 ? (
                <>
                    <mesh position={p1.toArray() as [number, number, number]}>
                        <sphereGeometry args={[2.5, 12, 10]} />
                        <meshBasicMaterial color="#fbbf24" depthTest={false} />
                    </mesh>
                    {cutLine ? <primitive object={cutLine} /> : null}
                    {sliceDraft.previewLocal ? (
                        <SlicePlanePreview scanId={sliceDraft.scanId} planeLocal={sliceDraft.previewLocal} />
                    ) : null}
                </>
            ) : null}
        </group>
    );
}

function SlicePlanePreview({
    scanId,
    planeLocal,
}: {
    scanId: string;
    planeLocal: { normal: [number, number, number]; constant: number; keepPositive: boolean };
}) {
    const scans = useScanStore((s) => s.scans);
    const scan = scans.find((s) => s.id === scanId);
    const { scene } = useThree();

    const meshMatrix = useMemo(() => {
        let mesh: THREE.Mesh | null = null;
        scene.traverse((obj) => {
            if (mesh) return;
            if ((obj as THREE.Mesh).isMesh && obj.userData?.isScanMesh && obj.userData?.scanId === scanId) {
                mesh = obj as THREE.Mesh;
            }
        });
        return mesh ? (mesh as THREE.Mesh).matrixWorld.clone() : new THREE.Matrix4();
    }, [scene, scanId, scan?.geometry?.uuid]);

    if (!scan) return null;
    scan.geometry.computeBoundingBox();
    const box = scan.geometry.boundingBox ?? new THREE.Box3();
    const size = new THREE.Vector3();
    box.getSize(size);
    const extent = Math.max(size.x, size.y, size.z, 50) * 1.4;

    const plane = new THREE.Plane(new THREE.Vector3(...planeLocal.normal), planeLocal.constant);
    // Visual: quad in local space, transformed to world.
    const center = new THREE.Vector3();
    box.getCenter(center);
    // Project centre onto plane.
    const onPlane = plane.projectPoint(center, new THREE.Vector3());
    const n = plane.normal.clone().normalize();
    const t1 = new THREE.Vector3();
    if (Math.abs(n.x) < 0.9) t1.set(1, 0, 0).cross(n).normalize();
    else t1.set(0, 1, 0).cross(n).normalize();
    const t2 = new THREE.Vector3().crossVectors(n, t1).normalize();

    const corners = [
        onPlane.clone().addScaledVector(t1, extent).addScaledVector(t2, extent),
        onPlane.clone().addScaledVector(t1, -extent).addScaledVector(t2, extent),
        onPlane.clone().addScaledVector(t1, -extent).addScaledVector(t2, -extent),
        onPlane.clone().addScaledVector(t1, extent).addScaledVector(t2, -extent),
    ].map((p) => p.applyMatrix4(meshMatrix));

    const positions = new Float32Array([
        ...corners[0]!.toArray(),
        ...corners[1]!.toArray(),
        ...corners[2]!.toArray(),
        ...corners[0]!.toArray(),
        ...corners[2]!.toArray(),
        ...corners[3]!.toArray(),
    ]);

    return (
        <mesh>
            <bufferGeometry>
                <bufferAttribute attach="attributes-position" args={[positions, 3]} />
            </bufferGeometry>
            <meshBasicMaterial
                color={planeLocal.keepPositive ? "#34d399" : "#f87171"}
                transparent
                opacity={0.22}
                side={THREE.DoubleSide}
                depthWrite={false}
            />
        </mesh>
    );
}
