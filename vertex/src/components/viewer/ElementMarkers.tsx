import { TransformControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as THREE from "three";
import type {
    OrbitControls as OrbitControlsImpl,
    TransformControls as TransformControlsImpl,
} from "three-stdlib";
import { INSOLE_LENGTH_MM, sideOffsetX } from "@/lib/geometry/layout";
import { rafThrottle } from "@/lib/performance/raf";
import { useDesignStore } from "@/stores/design-store";
import { usePerformanceStore } from "@/stores/performance-store";
import type { PlacedElement } from "@/types";

const CENTER_X = INSOLE_LENGTH_MM / 2;

export function ElementMarkers() {
    const elements = useDesignStore((s) => s.design.elements);
    return (
        <>
            {elements.map((el) => (
                <ElementMarker key={el.id} element={el} />
            ))}
        </>
    );
}

function ElementMarker({ element }: { element: PlacedElement }) {
    const [node, setNode] = useState<THREE.Group | null>(null);
    const controlsRef = useRef<TransformControlsImpl>(null);
    const selectedId = useDesignStore((s) => s.selectedElementId);
    const mode = useDesignStore((s) => s.transformMode);
    const selectElement = useDesignStore((s) => s.selectElement);
    const updateElement = useDesignStore((s) => s.updateElement);
    const setInteractionMode = usePerformanceStore((s) => s.setInteractionMode);
    const orbitControls = useThree((s) => s.controls);

    const selected = selectedId === element.id;
    const zTop = element.heightMm + 4;

    const pendingRef = useRef<{
        position: { x: number; y: number };
        rotationDeg: number;
        scale: { x: number; y: number };
    } | null>(null);

    const flushPreview = useCallback(() => {
        const patch = pendingRef.current;
        if (!patch) return;
        pendingRef.current = null;
        updateElement(element.id, patch);
    }, [element.id, updateElement]);

    const commitPreview = useMemo(
        () =>
            rafThrottle(() => {
                const m = node;
                if (!m) return;
                pendingRef.current = {
                    position: { x: m.position.x - CENTER_X, y: m.position.y },
                    rotationDeg: (m.rotation.z * 180) / Math.PI,
                    scale: { x: Math.max(0.25, m.scale.x), y: Math.max(0.25, m.scale.y) },
                };
                flushPreview();
            }),
        [node, flushPreview],
    );

    const onDraggingChanged = useCallback(
        (dragging: boolean) => {
            if (orbitControls) {
                (orbitControls as OrbitControlsImpl).enabled = !dragging;
            }
            setInteractionMode(dragging ? "transform" : "idle");
            if (!dragging) {
                commitPreview();
                flushPreview();
            }
        },
        [orbitControls, setInteractionMode, commitPreview, flushPreview],
    );

    useEffect(() => {
        const tc = controlsRef.current;
        if (!tc) return;
        const handler = (event: { value?: boolean }) => {
            onDraggingChanged(Boolean(event.value));
        };
        const emitter = tc as unknown as {
            addEventListener(type: string, listener: (event: { value?: boolean }) => void): void;
            removeEventListener(type: string, listener: (event: { value?: boolean }) => void): void;
        };
        emitter.addEventListener("dragging-changed", handler);
        return () => emitter.removeEventListener("dragging-changed", handler);
    }, [onDraggingChanged, selected, node]);

    return (
        <>
            <group rotation={[-Math.PI / 2, 0, 0]}>
                <group position={[-CENTER_X, sideOffsetX(element.side), 0]}>
                    <group
                        ref={setNode}
                        position={[CENTER_X + element.position.x, element.position.y, zTop]}
                        rotation={[0, 0, (element.rotationDeg * Math.PI) / 180]}
                        scale={[element.scale.x, element.scale.y, 1]}
                    >
                        <mesh
                            rotation={[Math.PI / 2, 0, 0]}
                            onClick={(e) => {
                                e.stopPropagation();
                                selectElement(element.id);
                            }}
                        >
                            <cylinderGeometry args={[7, 7, 2, 16]} />
                            <meshStandardMaterial
                                color={selected ? "#f59e0b" : "#a855f7"}
                                emissive={selected ? "#f59e0b" : "#000000"}
                                emissiveIntensity={selected ? 0.4 : 0}
                                transparent
                                opacity={0.9}
                            />
                        </mesh>
                    </group>
                </group>
            </group>
            {selected && node ? (
                <TransformControls
                    ref={controlsRef}
                    object={node}
                    mode={mode}
                    space="local"
                    size={0.6}
                    showZ={mode !== "translate"}
                    onObjectChange={commitPreview}
                    onMouseUp={() => {
                        commitPreview();
                        flushPreview();
                    }}
                />
            ) : null}
        </>
    );
}
