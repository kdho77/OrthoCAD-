// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { AFO_LANDMARK_STEPS, AFO_PLANTAR_STEPS } from "@/features/afo/afo-scan-markers";
import {
    AFO_MARKER_OUTLINE,
    AFO_MARKER_PILL,
    AFO_MARKER_WORLD_MM,
    AFO_MARKER_MIN_PX,
    AFO_OPTIONAL_MARKER,
    AFO_REQUIRED_MARKER,
    AFO_STAGE1_MARKER,
    activeAfoTarget,
    type AfoMarkerKey,
} from "@/features/afo/afo-scan-ui";
import { transformAfoPoint } from "@/lib/geometry/afo/landmark-frame";
import { defaultAfoScanWorkflow } from "@/lib/geometry/afo/defaults";
import { useAfoStore } from "@/stores/afo-store";
import { useDesignStore } from "@/stores/design-store";

function useReducedMotion(): boolean {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
}: {
    position: [number, number, number];
    color: string;
    opacity?: number;
    isTarget: boolean;
    label: string;
    showLabel: boolean;
    markerId: string;
    onDragStart?: (id: string) => void;
}) {
    const groupRef = useRef<THREE.Group>(null);
    const ringRef = useRef<THREE.Mesh>(null);
    const { camera, size } = useThree();
    const reducedMotion = useReducedMotion();

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
            <mesh renderOrder={22} userData={{ afoScanMarkerId: markerId }} onPointerDown={(e) => {
                e.stopPropagation();
                onDragStart?.(markerId);
            }}>
                <sphereGeometry args={[AFO_MARKER_WORLD_MM, 20, 16]} />
                <meshBasicMaterial color={color} transparent opacity={opacity * 0.3} depthTest={false} />
            </mesh>
            <mesh renderOrder={21}>
                <sphereGeometry args={[AFO_MARKER_WORLD_MM * 1.08, 20, 16]} />
                <meshBasicMaterial color={AFO_MARKER_OUTLINE} side={THREE.BackSide} depthTest />
            </mesh>
            <mesh renderOrder={23} userData={{ afoScanMarkerId: markerId }}>
                <sphereGeometry args={[AFO_MARKER_WORLD_MM, 20, 16]} />
                <meshBasicMaterial color={color} transparent opacity={opacity} depthTest />
            </mesh>
            {isTarget ? (
                <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]} renderOrder={24}>
                    <ringGeometry args={[AFO_MARKER_WORLD_MM * 1.35, AFO_MARKER_WORLD_MM * 1.55, 48]} />
                    <meshBasicMaterial color="#ffffff" transparent opacity={0.85} depthTest={false} />
                </mesh>
            ) : null}
            {showLabel ? (
                <Html center distanceFactor={12} style={{ pointerEvents: "none", transform: "translateY(-18px)" }}>
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

/** Stage 1 plantar markers in scan mesh local space (inside RegisteredScanMesh). */
export function AfoScanStage1Markers({
    plantar,
    displayScale,
    targetId,
}: {
    plantar: ReturnType<typeof defaultAfoScanWorkflow>["plantar"];
    displayScale: number;
    targetId: string | null;
}) {
    const showLabels = useAfoStore((s) => s.scanShowMarkerLabels);
    const scale = displayScale > 0 ? displayScale : 1;
    const onDragStart = (id: string) => {
        useAfoStore.getState().setScanDraggingMarkerId(id);
        useAfoStore.getState().setScanPlacement({ redo: id, paused: false });
    };
    return (
        <>
            {AFO_PLANTAR_STEPS.map((step) => {
                const p = plantar[step.id];
                if (!p) return null;
                return (
                    <AfoScanMarkerDot
                        key={step.id}
                        markerId={step.id}
                        position={[p.x / scale, p.y / scale, p.z / scale]}
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
    const showLabels = useAfoStore((s) => s.scanShowMarkerLabels);
    const targetId = activeAfoTarget(workflow, placement?.redo ?? null);

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

    if (!placement || !workflow.alignmentApplied) return null;

    return (
        <group rotation={[-Math.PI / 2, 0, 0]}>
            {markers.map((m) => (
                <AfoScanMarkerDot
                    key={m.id}
                    markerId={m.id}
                    position={m.pos}
                    color={m.color}
                    opacity={m.opacity}
                    isTarget={targetId === m.id}
                    label={AFO_MARKER_PILL[m.id]}
                    showLabel={showLabels}
                    onDragStart={onDragStart}
                />
            ))}
        </group>
    );
}
