import { TransformControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as THREE_NS from "three";
import * as THREE from "three";
import type {
    OrbitControls as OrbitControlsImpl,
    TransformControls as TransformControlsImpl,
} from "three-stdlib";
import { sideOffsetX } from "@/lib/geometry/layout";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { rafThrottle } from "@/lib/performance/throttle";
import { useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import { usePerformanceStore } from "@/stores/performance-store";
import type { PlacedElement, Side } from "@/types";

export function ElementMarkers() {
    const elements = useDesignStore((s) => s.design.elements);
    const selectedId = useDesignStore((s) => s.selectedElementId);
    const elementPreviews = usePerformanceStore((s) => s.elementPreviews);
    const usMenSize = useDesignStore((s) => s.design.usMenSize);
    const sizeSystem = useDesignStore((s) => s.design.sizeSystem);
    const ukSize = useDesignStore((s) => s.design.ukSize);
    const footLengthMm = useDesignStore((s) => s.design.footLengthMm);
    const layout = insoleLayoutFromDesign({ sizeSystem, usMenSize, ukSize, footLengthMm });
    const centerX = layout.lengthMm / 2;

    const nonSelected = useMemo(() => elements.filter((e) => e.id !== selectedId), [elements, selectedId]);

    const selected = useMemo(() => elements.find((e) => e.id === selectedId) ?? null, [elements, selectedId]);

    const bySide = useMemo(() => {
        const left = nonSelected.filter((e) => e.side === "left");
        const right = nonSelected.filter((e) => e.side === "right");
        return { left, right };
    }, [nonSelected]);

    return (
        <>
            <InstancedMarkersSide
                side="left"
                elements={bySide.left}
                previews={elementPreviews}
                centerX={centerX}
                widthMm={layout.widthMm}
            />
            <InstancedMarkersSide
                side="right"
                elements={bySide.right}
                previews={elementPreviews}
                centerX={centerX}
                widthMm={layout.widthMm}
            />
            {selected ? (
                <SelectedElementMarker element={selected} centerX={centerX} widthMm={layout.widthMm} />
            ) : null}
        </>
    );
}

function InstancedMarkersSide({
    side,
    elements,
    previews,
    centerX,
    widthMm,
}: {
    side: Side;
    elements: PlacedElement[];
    previews: Record<
        string,
        { position?: { x: number; y: number }; rotationDeg?: number; scale?: { x: number; y: number } }
    >;
    centerX: number;
    widthMm: number;
}) {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const dummy = useMemo(() => new THREE.Object3D(), []);

    useEffect(() => {
        const mesh = meshRef.current;
        if (!mesh) return;

        for (let i = 0; i < elements.length; i++) {
            const el = elements[i]!;
            const preview = previews[el.id];
            const pos = preview?.position ?? el.position;
            const rot = preview?.rotationDeg ?? el.rotationDeg;
            const scale = preview?.scale ?? el.scale;
            const zTop = el.heightMm + 4;

            dummy.position.set(centerX + pos.x, pos.y, zTop);
            dummy.rotation.set(0, 0, (rot * Math.PI) / 180);
            dummy.scale.set(scale.x, scale.y, 1);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
        }

        mesh.instanceMatrix.needsUpdate = true;
        mesh.count = elements.length;
    }, [elements, previews, dummy, centerX]);

    if (elements.length === 0) return null;

    return (
        <group rotation={[-Math.PI / 2, 0, 0]}>
            <group position={[-centerX, sideOffsetX(side, widthMm), 0]}>
                <instancedMesh
                    ref={meshRef}
                    args={[undefined, undefined, elements.length]}
                    frustumCulled={false}
                >
                    <cylinderGeometry args={[7, 7, 2, 12]} />
                    <meshStandardMaterial color="#a855f7" transparent opacity={0.85} />
                </instancedMesh>
            </group>
        </group>
    );
}

function SelectedElementMarker({
    element,
    centerX,
    widthMm,
}: {
    element: PlacedElement;
    centerX: number;
    widthMm: number;
}) {
    const [node, setNode] = useState<THREE_NS.Group | null>(null);
    const controlsRef = useRef<TransformControlsImpl>(null);
    const mode = useDesignStore((s) => s.transformMode);
    const editMode = useMeshEditStore((s) => s.editMode);
    const selectElement = useDesignStore((s) => s.selectElement);
    const updateElement = useDesignStore((s) => s.updateElement);
    const setInteracting = usePerformanceStore((s) => s.setInteracting);
    const setElementPreview = usePerformanceStore((s) => s.setElementPreview);
    const clearElementPreview = usePerformanceStore((s) => s.clearElementPreview);
    const orbitControls = useThree((s) => s.controls);

    const zTop = element.heightMm + 4;

    const commitTransform = useCallback(() => {
        const m = node;
        if (!m) return;
        updateElement(element.id, {
            position: { x: m.position.x - centerX, y: m.position.y },
            rotationDeg: (m.rotation.z * 180) / Math.PI,
            scale: { x: Math.max(0.25, m.scale.x), y: Math.max(0.25, m.scale.y) },
        });
        clearElementPreview(element.id);
    }, [node, element.id, updateElement, clearElementPreview, centerX]);

    const previewTransform = useMemo(
        () =>
            rafThrottle(() => {
                const m = node;
                if (!m) return;
                setElementPreview(element.id, {
                    id: element.id,
                    position: { x: m.position.x - centerX, y: m.position.y },
                    rotationDeg: (m.rotation.z * 180) / Math.PI,
                    scale: { x: Math.max(0.25, m.scale.x), y: Math.max(0.25, m.scale.y) },
                });
            }),
        [node, element.id, setElementPreview, centerX],
    );

    const onDraggingChanged = useCallback(
        (dragging: boolean) => {
            if (orbitControls) {
                (orbitControls as OrbitControlsImpl).enabled = !dragging;
            }
            setInteracting(dragging, "gizmo");
            if (!dragging) commitTransform();
        },
        [orbitControls, setInteracting, commitTransform],
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
    }, [onDraggingChanged, node]);

    return (
        <>
            <group rotation={[-Math.PI / 2, 0, 0]}>
                <group position={[-centerX, sideOffsetX(element.side, widthMm), 0]}>
                    <group
                        ref={setNode}
                        position={[centerX + element.position.x, element.position.y, zTop]}
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
                            <cylinderGeometry args={[7, 7, 2, 12]} />
                            <meshStandardMaterial
                                color="#f59e0b"
                                emissive="#f59e0b"
                                emissiveIntensity={0.4}
                                transparent
                                opacity={0.95}
                            />
                        </mesh>
                    </group>
                </group>
            </group>
            {node && editMode === "transform" ? (
                <TransformControls
                    ref={controlsRef}
                    object={node}
                    mode={mode}
                    space="local"
                    size={0.6}
                    showZ={mode !== "translate"}
                    onObjectChange={previewTransform}
                />
            ) : null}
        </>
    );
}
