import { TransformControls } from "@react-three/drei";
import { useRef, useState } from "react";
import type * as THREE from "three";
import { INSOLE_LENGTH_MM, sideOffsetX } from "@/lib/geometry/layout";
import { useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import type { PlacedElement } from "@/types";

const CENTER_X = INSOLE_LENGTH_MM / 2;

// Draggable handles for placed elements. The selected element gets a
// TransformControls gizmo (translate / rotate / scale) operating in the foot's
// local plane; edits write back to the design store in real time, which
// re-welds the element into the insole solid.
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
    // Callback ref via state so the gizmo attaches reliably once the group mounts
    // (even when an element is added and selected in the same store update).
    const [node, setNode] = useState<THREE.Group | null>(null);
    const selectedId = useDesignStore((s) => s.selectedElementId);
    const mode = useDesignStore((s) => s.transformMode);
    const editMode = useMeshEditStore((s) => s.editMode);
    const selectElement = useDesignStore((s) => s.selectElement);
    const updateElement = useDesignStore((s) => s.updateElement);

    const selected = selectedId === element.id;
    const zTop = element.heightMm + 4;

    // Coalesce high-frequency gizmo callbacks to one store write per frame so
    // the solid rebuild stays smooth during drags.
    const rafRef = useRef<number | null>(null);
    const commit = () => {
        if (rafRef.current !== null) return;
        rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null;
            const m = node;
            if (!m) return;
            updateElement(element.id, {
                position: { x: m.position.x - CENTER_X, y: m.position.y },
                rotationDeg: (m.rotation.z * 180) / Math.PI,
                scale: { x: Math.max(0.25, m.scale.x), y: Math.max(0.25, m.scale.y) },
            });
        });
    };

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
                            <cylinderGeometry args={[7, 7, 2, 24]} />
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
            {selected && node && editMode === "transform" ? (
                <TransformControls
                    object={node}
                    mode={mode}
                    space="local"
                    size={0.6}
                    showZ={mode !== "translate"}
                    onObjectChange={commit}
                    onMouseUp={commit}
                />
            ) : null}
        </>
    );
}
