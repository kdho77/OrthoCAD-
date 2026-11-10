// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { AFO_LANDMARK_STEPS, AFO_PLANTAR_STEPS } from "@/features/afo/afo-scan-markers";
import {
    AFO_MARKER_MIN_PX,
    AFO_MARKER_OUTLINE,
    AFO_MARKER_PILL,
    AFO_MARKER_WORLD_MM,
    AFO_OPTIONAL_MARKER,
    AFO_REQUIRED_MARKER,
    AFO_STAGE1_MARKER,
    type AfoMarkerDisplayCue,
    type AfoMarkerKey,
    type AfoScanDrawMode,
    type AfoViewPoint,
    activeAfoTarget,
    afoMarkerDisplayCue,
    afoMarkerOnCameraSide,
    afoScanDrawMode,
    afoTriangleStats,
} from "@/features/afo/afo-scan-ui";
import { defaultAfoScanWorkflow } from "@/lib/geometry/afo/defaults";
import { transformAfoPoint } from "@/lib/geometry/afo/landmark-frame";
import { meshCentroid } from "@/lib/geometry/afo/mesh-ops";
import { useAfoStore } from "@/stores/afo-store";
import { useDesignStore } from "@/stores/design-store";

function useReducedMotion(): boolean {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const cueWorld = new THREE.Vector3();
const cueCenter = new THREE.Vector3();

function useAfoFacingCue(
    enabled: boolean,
    drawMode: AfoScanDrawMode,
    baseOpacity: number,
    sample: () => { marker: THREE.Vector3; center: THREE.Vector3 } | null,
): AfoMarkerDisplayCue {
    const { camera } = useThree();
    const full = afoMarkerDisplayCue({ drawMode, facesCamera: true, baseOpacity });
    const [cue, setCue] = useState<AfoMarkerDisplayCue>(full);
    const cueRef = useRef(full);
    useFrame(() => {
        if (!enabled) return;
        const sampled = sample();
        if (!sampled) return;
        const faces = afoMarkerOnCameraSide(sampled.marker, camera.position, sampled.center);
        const next = afoMarkerDisplayCue({ drawMode, facesCamera: faces, baseOpacity });
        const prev = cueRef.current;
        if (
            prev.opacity === next.opacity &&
            prev.depthTest === next.depthTest &&
            prev.occluded === next.occluded &&
            prev.dimmed === next.dimmed
        ) {
            return;
        }
        cueRef.current = next;
        setCue(next);
    });
    if (!enabled) return { opacity: baseOpacity, depthTest: false, occluded: false, dimmed: false };
    return cue;
}

export function AfoScanMarkerDot({
    position,
    color,
    opacity = 1,
    isTarget,
    label,
    showLabel,
    markerId,
    onDragStart,
    interactive = true,
    centerLocal = { x: 0, y: 0, z: 0 },
    drawMode = "surface",
    depthCue = false,
}: {
    position: [number, number, number];
    color: string;
    opacity?: number;
    isTarget: boolean;
    label: string;
    showLabel: boolean;
    markerId: string;
    onDragStart?: (id: string) => void;
    /** Trim pins are the only drag targets while a trimline is being drawn. */
    interactive?: boolean;
    /** Oriented-mesh centroid. Stage 1 leaves the cue off; its scan matrix is not this frame. */
    centerLocal?: AfoViewPoint;
    drawMode?: AfoScanDrawMode;
    depthCue?: boolean;
}) {
    const groupRef = useRef<THREE.Group>(null);
    const ringRef = useRef<THREE.Mesh>(null);
    const { camera, size } = useThree();
    const reducedMotion = useReducedMotion();
    const cue = useAfoFacingCue(depthCue, drawMode, opacity, () => {
        const group = groupRef.current;
        if (!group?.parent) return null;
        const marker = group.getWorldPosition(cueWorld);
        const center = group.parent.localToWorld(cueCenter.set(centerLocal.x, centerLocal.y, centerLocal.z));
        return { marker, center };
    });
    const haloDepthTest = depthCue ? cue.depthTest : false;
    const pointOffset = depthCue && drawMode === "points";

    useFrame((state) => {
        const group = groupRef.current;
        if (!group) return;
        const dist = camera.position.distanceTo(group.position);
        const persp = camera as THREE.PerspectiveCamera;
        const vFov = (persp.fov * Math.PI) / 180;
        const minWorld = (AFO_MARKER_MIN_PX * dist * Math.tan(vFov / 2) * 2) / size.height;
        const s = Math.max(AFO_MARKER_WORLD_MM, minWorld);
        group.scale.setScalar(s / AFO_MARKER_WORLD_MM);
        if (ringRef.current && isTarget && !reducedMotion) {
            const pulse = 1 + 0.12 * Math.sin(state.clock.elapsedTime * 4);
            ringRef.current.scale.set(pulse, pulse, pulse);
        }
    });

    return (
        <group ref={groupRef} position={position}>
            <mesh
                renderOrder={22}
                userData={{ afoScanMarkerId: markerId, isAfoScanMarker: true }}
                raycast={interactive ? undefined : () => undefined}
                onPointerDown={
                    interactive
                        ? (e) => {
                              e.stopPropagation();
                              onDragStart?.(markerId);
                          }
                        : undefined
                }
            >
                <sphereGeometry args={[AFO_MARKER_WORLD_MM, 20, 16]} />
                <meshBasicMaterial
                    color={color}
                    transparent
                    opacity={cue.opacity * 0.3}
                    depthTest={haloDepthTest}
                    depthWrite={false}
                    polygonOffset={pointOffset}
                    polygonOffsetFactor={-4}
                    polygonOffsetUnits={-4}
                />
            </mesh>
            <mesh renderOrder={21}>
                <sphereGeometry args={[AFO_MARKER_WORLD_MM * 1.08, 20, 16]} />
                <meshBasicMaterial
                    color={AFO_MARKER_OUTLINE}
                    side={THREE.BackSide}
                    transparent={cue.opacity < 0.999}
                    opacity={cue.opacity}
                    depthTest
                    depthWrite={false}
                    polygonOffset={pointOffset}
                    polygonOffsetFactor={-4}
                    polygonOffsetUnits={-4}
                />
            </mesh>
            <mesh
                renderOrder={23}
                userData={{ afoScanMarkerId: markerId, isAfoScanMarker: true }}
                raycast={interactive ? undefined : () => undefined}
            >
                <sphereGeometry args={[AFO_MARKER_WORLD_MM, 20, 16]} />
                <meshBasicMaterial
                    color={color}
                    transparent
                    opacity={cue.opacity}
                    depthTest
                    depthWrite={false}
                    polygonOffset={pointOffset}
                    polygonOffsetFactor={-4}
                    polygonOffsetUnits={-4}
                />
            </mesh>
            {isTarget ? (
                <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]} renderOrder={24}>
                    <ringGeometry args={[AFO_MARKER_WORLD_MM * 1.35, AFO_MARKER_WORLD_MM * 1.55, 48]} />
                    <meshBasicMaterial
                        color="#ffffff"
                        transparent
                        opacity={0.85 * (cue.dimmed ? cue.opacity : 1)}
                        depthTest={haloDepthTest}
                        depthWrite={false}
                    />
                </mesh>
            ) : null}
            {showLabel && !cue.dimmed ? (
                <Html
                    center
                    distanceFactor={12}
                    style={{ pointerEvents: "none", transform: "translateY(-18px)" }}
                >
                    <span
                        title={label}
                        className="whitespace-nowrap rounded-full border border-black/40 bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white"
                    >
                        {label}
                    </span>
                </Html>
            ) : null}
        </group>
    );
}

/** Design and clinical markers. Same near/far cue as the scan dots. */
export function AfoCueSphere({
    position,
    color,
    radius,
    renderOrder,
    userData,
    centerLocal,
    drawMode,
}: {
    position: [number, number, number];
    color: string;
    radius: number;
    renderOrder: number;
    userData: Record<string, unknown>;
    centerLocal: AfoViewPoint;
    drawMode: AfoScanDrawMode;
}) {
    const meshRef = useRef<THREE.Mesh>(null);
    const cue = useAfoFacingCue(true, drawMode, 1, () => {
        const mesh = meshRef.current;
        if (!mesh?.parent) return null;
        const marker = mesh.getWorldPosition(cueWorld);
        const center = mesh.parent.localToWorld(cueCenter.set(centerLocal.x, centerLocal.y, centerLocal.z));
        return { marker, center };
    });
    return (
        <mesh ref={meshRef} position={position} renderOrder={renderOrder} userData={userData}>
            <sphereGeometry args={[radius, 12, 10]} />
            <meshBasicMaterial
                color={color}
                transparent={cue.opacity < 0.999}
                opacity={cue.opacity}
                depthTest={drawMode === "points" ? true : cue.depthTest}
                depthWrite={false}
                polygonOffset={drawMode === "points"}
                polygonOffsetFactor={-4}
                polygonOffsetUnits={-4}
                toneMapped={false}
            />
        </mesh>
    );
}

/** Stage 1 plantar markers in scan mesh local space (inside RegisteredScanMesh). */
export function AfoScanStage1Markers({
    plantar,
    displayScale,
    targetId,
    meshMatrix,
}: {
    plantar: ReturnType<typeof defaultAfoScanWorkflow>["plantar"];
    displayScale: number;
    targetId: string | null;
    meshMatrix: THREE.Matrix4;
}) {
    const showLabels = useAfoStore((s) => s.scanShowMarkerLabels);
    const scale = displayScale > 0 ? displayScale : 1;
    const onDragStart = (id: string) => {
        useAfoStore.getState().setScanDraggingMarkerId(id);
        useAfoStore.getState().setScanPlacement({ redo: id, paused: false });
    };
    const toWorld = (p: { x: number; y: number; z: number }) =>
        new THREE.Vector3(p.x / scale, p.y / scale, p.z / scale).applyMatrix4(meshMatrix);
    return (
        <>
            {AFO_PLANTAR_STEPS.map((step) => {
                const p = plantar[step.id];
                if (!p) return null;
                const pos = toWorld(p);
                return (
                    <AfoScanMarkerDot
                        key={step.id}
                        markerId={step.id}
                        position={[pos.x, pos.y, pos.z]}
                        color={AFO_STAGE1_MARKER}
                        isTarget={targetId === step.id}
                        label={AFO_MARKER_PILL[step.id]}
                        showLabel={showLabels}
                        onDragStart={onDragStart}
                    />
                );
            })}
        </>
    );
}

export function AfoScanMarkers() {
    const workflow = useDesignStore((s) => s.design.afo?.scanWorkflow) ?? defaultAfoScanWorkflow();
    const placement = useAfoStore((s) => s.scanPlacement);
    const placingTrim = useAfoStore((s) => s.placingTrim);
    const showLabels = useAfoStore((s) => s.scanShowMarkerLabels);
    const source = useAfoStore((s) => s.sourceMesh);
    const targetId = activeAfoTarget(workflow, placement?.redo ?? null);
    const centerLocal = useMemo(() => (source ? meshCentroid(source) : { x: 0, y: 0, z: 0 }), [source]);
    const drawMode = useMemo(() => {
        if (!source) return "surface" as const;
        const stats = afoTriangleStats(source.positions, source.indices);
        return afoScanDrawMode(stats.triangles, stats.degenerateRatio);
    }, [source]);

    const markers = useMemo(() => {
        if (!workflow.alignmentApplied || !workflow.matrixElements) return [];
        const matrix = workflow.matrixElements;
        const out: {
            id: AfoMarkerKey;
            pos: [number, number, number];
            color: string;
            opacity: number;
        }[] = [];
        for (const step of AFO_PLANTAR_STEPS) {
            const p = workflow.plantar[step.id];
            if (!p) continue;
            const o = transformAfoPoint(p, matrix);
            out.push({
                id: step.id,
                pos: [o.x, o.y, o.z],
                color: AFO_STAGE1_MARKER,
                opacity: 0.5,
            });
        }
        for (const step of AFO_LANDMARK_STEPS) {
            const p = workflow.landmarks[step.id];
            if (!p) continue;
            const o = transformAfoPoint(p, matrix);
            out.push({
                id: step.id,
                pos: [o.x, o.y, o.z],
                color: step.optional ? AFO_OPTIONAL_MARKER : AFO_REQUIRED_MARKER,
                opacity: 1,
            });
        }
        return out;
    }, [workflow]);

    const onDragStart = (id: string) => {
        useAfoStore.getState().setScanDraggingMarkerId(id);
        useAfoStore.getState().setScanPlacement({ redo: id, paused: false });
    };

    if (!workflow.alignmentApplied || markers.length === 0) return null;

    return (
        <group rotation={[-Math.PI / 2, 0, 0]}>
            {markers.map((m) => (
                <AfoScanMarkerDot
                    key={m.id}
                    markerId={m.id}
                    position={m.pos}
                    color={m.color}
                    opacity={m.opacity}
                    isTarget={!placingTrim && targetId === m.id}
                    label={AFO_MARKER_PILL[m.id]}
                    showLabel={showLabels}
                    onDragStart={placingTrim ? undefined : onDragStart}
                    interactive={!placingTrim}
                    centerLocal={centerLocal}
                    drawMode={drawMode}
                    depthCue
                />
            ))}
        </group>
    );
}
