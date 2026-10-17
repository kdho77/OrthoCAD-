import { TransformControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as THREE_NS from "three";
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
import type { PlacedElement } from "@/types";

/**
 * Viewer overlay for placed library elements.
 *
 * Height-field lift lives on the insole mesh. This component must not draw
 * extra solid geometry (the old 7×2 mm cylinder looked like a coin standing
 * on edge). Only the move gizmo is shown, and only while an element is selected.
 */
export function ElementMarkers() {
    const elements = useDesignStore((s) => s.design.elements);
    const selectedId = useDesignStore((s) => s.selectedElementId);
    const usMenSize = useDesignStore((s) => s.design.usMenSize);
    const sizeSystem = useDesignStore((s) => s.design.sizeSystem);
    const ukSize = useDesignStore((s) => s.design.ukSize);
    const footLengthMm = useDesignStore((s) => s.design.footLengthMm);
    const layout = insoleLayoutFromDesign({ sizeSystem, usMenSize, ukSize, footLengthMm });
    const centerX = layout.lengthMm / 2;

    const selected = useMemo(() => elements.find((e) => e.id === selectedId) ?? null, [elements, selectedId]);

    if (!selected) return null;

    return <SelectedElementGizmo element={selected} centerX={centerX} widthMm={layout.widthMm} />;
}

function SelectedElementGizmo({
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
                    />
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
