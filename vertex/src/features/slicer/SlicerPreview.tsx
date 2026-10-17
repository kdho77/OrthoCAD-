// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Grid, OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo } from "react";
import * as THREE from "three";
import { Button } from "@/components/ui/button";
import type { VertexSlicePrintDirection } from "../../../shared/vertexslice/contract";
import {
    cameraDistanceForBounds,
    formatDimensionsMm,
    type MeshBounds,
    type ParsedSlicerMesh,
} from "./slicer-mesh";

interface SlicerPreviewProps {
    mesh: ParsedSlicerMesh | null;
    printDirection: VertexSlicePrintDirection;
    onResetView: () => void;
    resetNonce: number;
}

function FitCamera({ bounds, resetNonce }: { bounds: MeshBounds; resetNonce: number }) {
    const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
    const controls = useThree((s) => s.controls) as {
        target: THREE.Vector3;
        minDistance: number;
        maxDistance: number;
        update: () => void;
    } | null;
    const size = useThree((s) => s.size);
    const invalidate = useThree((s) => s.invalidate);

    useLayoutEffect(() => {
        const aspect = size.width / Math.max(size.height, 1);
        const { center, distance, viewDir } = cameraDistanceForBounds(bounds, camera.fov, aspect);
        const target = new THREE.Vector3(center[0], center[1], center[2]);
        camera.near = Math.max(distance / 200, 0.05);
        camera.far = Math.max(distance * 40, 4000);
        camera.position.copy(target).addScaledVector(new THREE.Vector3(...viewDir), distance);
        camera.lookAt(target);
        camera.updateProjectionMatrix();
        if (controls) {
            controls.target.copy(target);
            controls.minDistance = Math.max(distance * 0.15, 1);
            controls.maxDistance = distance * 12;
            controls.update();
        }
        invalidate();
    }, [bounds, resetNonce, camera, controls, size.width, size.height, invalidate]);

    return null;
}

function MeshView({
    mesh,
    printDirection,
}: {
    mesh: ParsedSlicerMesh;
    printDirection: VertexSlicePrintDirection;
}) {
    const geometry = useMemo(() => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
        geo.computeVertexNormals();
        geo.computeBoundingBox();
        return geo;
    }, [mesh]);

    const { center, toePos, arrowDir } = useMemo(() => {
        const b = mesh.bounds;
        const centerVec = new THREE.Vector3(
            (b.min[0] + b.max[0]) / 2,
            (b.min[1] + b.max[1]) / 2,
            (b.min[2] + b.max[2]) / 2,
        );
        const axes: Array<{ axis: 0 | 1 | 2; size: number }> = [
            { axis: 0, size: b.size[0] },
            { axis: 1, size: b.size[1] },
            { axis: 2, size: b.size[2] },
        ];
        axes.sort((a, c) => c.size - a.size);
        const lengthAxis = axes[0].axis;
        const toe = centerVec.clone();
        toe.setComponent(lengthAxis, b.max[lengthAxis]);
        const dir = new THREE.Vector3();
        dir.setComponent(lengthAxis, printDirection === "toe_first" ? -1 : 1);
        return {
            center: centerVec,
            toePos: toe,
            arrowDir: dir,
        };
    }, [mesh, printDirection]);

    const coneQuat = useMemo(() => {
        const quat = new THREE.Quaternion();
        quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), arrowDir.clone().normalize());
        return quat;
    }, [arrowDir]);

    return (
        <group>
            <mesh geometry={geometry}>
                <meshStandardMaterial
                    color="#7dd3fc"
                    roughness={0.45}
                    metalness={0.08}
                    side={THREE.DoubleSide}
                />
            </mesh>
            <mesh position={toePos.toArray()}>
                <sphereGeometry args={[Math.max(mesh.bounds.widthMm, 8) * 0.04, 16, 16]} />
                <meshStandardMaterial color="#f59e0b" emissive="#b45309" emissiveIntensity={0.3} />
            </mesh>
            <mesh
                position={center
                    .clone()
                    .add(arrowDir.clone().multiplyScalar(mesh.bounds.lengthMm * 0.15))
                    .toArray()}
                quaternion={coneQuat}
            >
                <coneGeometry
                    args={[
                        Math.max(4, mesh.bounds.widthMm * 0.03),
                        Math.max(12, mesh.bounds.lengthMm * 0.08),
                        12,
                    ]}
                />
                <meshStandardMaterial color="#22d3ee" />
            </mesh>
            <ambientLight intensity={0.7} />
            <directionalLight position={[80, 120, 60]} intensity={1.1} />
            <directionalLight position={[-40, 40, -30]} intensity={0.35} />
        </group>
    );
}

export function SlicerPreview({ mesh, printDirection, onResetView, resetNonce }: SlicerPreviewProps) {
    const description = mesh
        ? `Model ${formatDimensionsMm(mesh.bounds)}. Print direction ${printDirection === "toe_first" ? "toe first" : "heel first"}. Toe marker at the toe.`
        : "No model uploaded yet. The build plate is empty.";

    return (
        <div className="absolute inset-0 h-full w-full overflow-hidden bg-[#0b1220] md:border-l md:border-border">
            <p className="sr-only" id="slicer-preview-desc">
                {description}
            </p>
            <Canvas
                camera={{ position: [180, 140, 220], fov: 35, near: 0.1, far: 8000 }}
                frameloop="demand"
                dpr={[1, 1.5]}
                gl={{ antialias: true, alpha: false }}
                style={{ touchAction: "none", width: "100%", height: "100%" }}
                aria-hidden
                tabIndex={-1}
            >
                <color attach="background" args={["#0b1220"]} />
                <Grid
                    infiniteGrid
                    fadeDistance={800}
                    sectionColor="#334155"
                    cellColor="#1e293b"
                    cellSize={10}
                    sectionSize={50}
                    position={[0, 0, 0]}
                    rotation={[-Math.PI / 2, 0, 0]}
                />
                {mesh ? <MeshView mesh={mesh} printDirection={printDirection} /> : null}
                <OrbitControls
                    makeDefault
                    enableDamping
                    enablePan
                    enableZoom
                    enableRotate
                    minDistance={5}
                    maxDistance={8000}
                    zoomToCursor={false}
                />
                {mesh ? <FitCamera bounds={mesh.bounds} resetNonce={resetNonce} /> : null}
            </Canvas>
            {mesh ? (
                <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/55 px-2 py-1 text-[11px] text-cyan-100">
                    Toe
                </div>
            ) : (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">
                    Upload a file to preview the model
                </div>
            )}
            <div className="absolute bottom-3 right-3">
                <Button type="button" size="sm" variant="outline" onClick={onResetView}>
                    Reset view
                </Button>
            </div>
            {mesh ? (
                <div className="pointer-events-none absolute bottom-3 left-3 text-[11px] text-slate-300">
                    {formatDimensionsMm(mesh.bounds)} ·{" "}
                    {printDirection === "toe_first" ? "Toe first" : "Heel first"}
                </div>
            ) : null}
        </div>
    );
}
