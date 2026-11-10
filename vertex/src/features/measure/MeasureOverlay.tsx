// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { Html } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { BufferGeometry, type Mesh, Vector3 } from "three";
import {
    formatMeasureMm,
    pointToPoint,
    probeThickness,
    triangleMeshFromGeometry,
} from "@/lib/geometry/measure";
import { nearestSurfacePoint, pickFrontFace } from "@/lib/geometry/measure/mesh-ops";
import { getExportMeasureMesh } from "@/lib/geometry/measure/registry";
import type { MeasureVec3 } from "@/lib/geometry/measure/types";
import { useMeasureStore } from "@/stores/measure-store";

/**
 * On-mesh dimension line. Clicks hit `userData.measureSolid` triangle meshes
 * only (front faces). The hit is converted with `worldToLocal`, which undoes
 * the viewer matrix (centering, pair Y-shift, Rx(−π/2), fit scale).
 */
export function MeasureOverlay() {
    const tool = useMeasureStore((s) => s.tool);
    const points = useMeasureStore((s) => s.points);
    const thickness = useMeasureStore((s) => s.thickness);
    const thicknessMm = useMeasureStore((s) => s.thicknessMm);
    const { camera, gl, scene, raycaster } = useThree();

    useEffect(() => {
        if (!tool || !gl?.domElement) return;
        const el = gl.domElement;
        const onPointerDown = (event: PointerEvent) => {
            if (useMeasureStore.getState().tool == null) return;
            const rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            const ndc = new Vector3(
                ((event.clientX - rect.left) / rect.width) * 2 - 1,
                -((event.clientY - rect.top) / rect.height) * 2 + 1,
                0,
            );
            raycaster.setFromCamera({ x: ndc.x, y: ndc.y }, camera);
            const targets: Mesh[] = [];
            scene.traverse((obj) => {
                const mesh = obj as Mesh;
                if (!mesh.isMesh || mesh.userData?.measureSolid !== true) return;
                targets.push(mesh);
            });
            let picked: { mesh: Mesh; local: MeasureVec3; normal: MeasureVec3; distance: number } | null =
                null;
            for (const mesh of targets) {
                const inverse = mesh.matrixWorld.clone().invert();
                const origin = raycaster.ray.origin.clone().applyMatrix4(inverse);
                const end = raycaster.ray.origin.clone().add(raycaster.ray.direction).applyMatrix4(inverse);
                const direction = end.sub(origin);
                const meshData = triangleMeshFromGeometry(mesh.geometry);
                const hit = pickFrontFace(
                    meshData,
                    { x: origin.x, y: origin.y, z: origin.z },
                    { x: direction.x, y: direction.y, z: direction.z },
                    { snapMm: useMeasureStore.getState().vertexSnap ? 1 : 0 },
                );
                if (!hit) continue;
                const worldHit = new Vector3(hit.point.x, hit.point.y, hit.point.z);
                mesh.localToWorld(worldHit);
                const distance = worldHit.distanceTo(raycaster.ray.origin);
                if (!picked || distance < picked.distance) {
                    picked = { mesh, local: hit.point, normal: hit.normal, distance };
                }
            }
            if (!picked) return;
            const side = String(picked.mesh.userData.measureSide ?? "");
            const exportMesh = getExportMeasureMesh(side);
            if (!exportMesh) {
                useMeasureStore.getState().setNotice("Print mesh is still measuring.");
                return;
            }
            const snapped = nearestSurfacePoint(exportMesh, picked.local);
            if (!snapped) return;
            event.stopPropagation();
            event.preventDefault();
            const worldV = new Vector3(snapped.point.x, snapped.point.y, snapped.point.z);
            picked.mesh.localToWorld(worldV);
            const world = { x: worldV.x, y: worldV.y, z: worldV.z };
            const solidId = String(picked.mesh.userData.measureId ?? picked.mesh.name ?? "solid");
            const stored = { solidId, export: snapped.point, world, normal: snapped.normal };
            const active = useMeasureStore.getState().tool;
            if (active === "point") {
                useMeasureStore.getState().addPoint(stored);
                return;
            }
            const inward = {
                x: -snapped.normal.x,
                y: -snapped.normal.y,
                z: -snapped.normal.z,
            };
            const thicknessHit = probeThickness(exportMesh, snapped.point, inward);
            useMeasureStore.getState().setThickness(stored, thicknessHit);
        };
        el.addEventListener("pointerdown", onPointerDown);
        return () => el.removeEventListener("pointerdown", onPointerDown);
    }, [tool, camera, gl, raycaster, scene]);

    const first = points[0];
    const second = points[1];
    const segment = first && second ? pointToPoint(first.export, second.export) : null;
    const lineEnds = useMemo(() => {
        if (!first || !second) return null;
        return [first.world, second.world] as const;
    }, [first, second]);

    return (
        <group>
            {points.map((point) => (
                <mesh
                    key={`${point.solidId}:${point.export.x.toFixed(2)}:${point.export.y.toFixed(2)}:${point.export.z.toFixed(2)}`}
                    position={[point.world.x, point.world.y, point.world.z]}
                    renderOrder={1000}
                    raycast={() => null}
                >
                    <sphereGeometry args={[1.6, 12, 10]} />
                    <meshBasicMaterial
                        color="#67e8f9"
                        depthTest={false}
                        depthWrite={false}
                        toneMapped={false}
                    />
                </mesh>
            ))}
            {lineEnds ? (
                <MeasureLine
                    a={lineEnds[0]}
                    b={lineEnds[1]}
                    label={`${formatMeasureMm(segment?.distanceMm ?? 0)} mm`}
                />
            ) : null}
            {thickness && thicknessMm != null ? (
                <Html
                    position={[thickness.world.x, thickness.world.y, thickness.world.z]}
                    center
                    zIndexRange={[120, 0]}
                    style={{ pointerEvents: "none" }}
                >
                    <MeasureChip testId="measure-thickness-label">
                        {formatMeasureMm(thicknessMm)} mm
                    </MeasureChip>
                </Html>
            ) : null}
        </group>
    );
}

function MeasureLine({ a, b, label }: { a: MeasureVec3; b: MeasureVec3; label: string }) {
    const geometry = useMemo(() => {
        const g = new BufferGeometry();
        g.setFromPoints([new Vector3(a.x, a.y, a.z), new Vector3(b.x, b.y, b.z)]);
        return g;
    }, [a.x, a.y, a.z, b.x, b.y, b.z]);
    useEffect(() => () => geometry.dispose(), [geometry]);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
    return (
        <group>
            <line geometry={geometry} renderOrder={1000} raycast={() => null}>
                <lineBasicMaterial
                    color="#67e8f9"
                    depthTest={false}
                    depthWrite={false}
                    polygonOffset
                    polygonOffsetFactor={-4}
                    polygonOffsetUnits={-4}
                    toneMapped={false}
                />
            </line>
            <Html
                position={[mid.x, mid.y, mid.z]}
                center
                zIndexRange={[120, 0]}
                style={{ pointerEvents: "none" }}
            >
                <MeasureChip testId="measure-distance-label">{label}</MeasureChip>
            </Html>
        </group>
    );
}

function MeasureChip({ children, testId }: { children: string; testId: string }) {
    return (
        <span
            data-testid={testId}
            className="whitespace-nowrap rounded bg-cyan-950/90 px-1.5 py-0.5 font-mono text-[11px] text-cyan-100 shadow"
        >
            {children}
        </span>
    );
}
