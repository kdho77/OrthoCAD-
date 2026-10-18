// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { useEffect, useState } from "react";
import { type BufferGeometry, DoubleSide } from "three";
import {
    buildElementDisplayMeshes,
    type ElementDisplayMesh,
} from "@/lib/geometry/element-assets/display-mesh";
import { DESIGN_ELEMENT_COLOR } from "@/lib/geometry/element-visualization";
import { splitColorForElement } from "@/lib/hardness/split-overlay";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";
import { mergeElementPreviews, usePerformanceStore } from "@/stores/performance-store";
import type { Side } from "@/types";

/** Uses the same coordinates and visibility as its parent insole. */
export function ElementSurfaceMeshes({
    base,
    reference = base,
    side,
}: {
    base: BufferGeometry;
    reference?: BufferGeometry;
    side: Side;
}) {
    const elements = useDesignStore((s) => s.design.elements);
    const split = useDesignStore((s) => Boolean(s.design.splitElements));
    const selected = useDesignStore((s) => s.selectedElementId);
    const select = useDesignStore((s) => s.selectElement);
    const step = useClinicalWorkflowStore((s) => s.step);
    const previews = usePerformanceStore((s) => s.elementPreviews);
    const print = step === "print" || step === "export";
    const [meshes, setMeshes] = useState<ElementDisplayMesh[]>([]);
    // biome-ignore lint/correctness/useExhaustiveDependencies: mergeElementPreviews reads the subscribed preview store
    useEffect(() => {
        let cancelled = false;
        let owned: ElementDisplayMesh[] = [];
        setMeshes([]);
        if (!print || split) {
            void buildElementDisplayMeshes(base, mergeElementPreviews(elements), side, print, reference)
                .then((next) => {
                    if (cancelled) {
                        for (const mesh of next) {
                            mesh.surface.dispose();
                            mesh.border.dispose();
                        }
                    } else {
                        owned = next;
                        setMeshes(next);
                    }
                })
                .catch((error) => console.error("Element display mesh failed", error));
        }
        return () => {
            cancelled = true;
            for (const mesh of owned) {
                mesh.surface.dispose();
                mesh.border.dispose();
            }
        };
    }, [base, reference, elements, side, print, split, previews]);
    return (
        <group>
            {meshes.map(({ element, surface, border }) => {
                const color =
                    selected === element.id
                        ? "#22c55e"
                        : print
                          ? splitColorForElement(element)
                          : DESIGN_ELEMENT_COLOR;
                return (
                    <group key={element.id}>
                        {/* biome-ignore lint/a11y/noStaticElementInteractions: R3F mesh pick target */}
                        <mesh
                            geometry={surface}
                            onClick={(event) => {
                                event.stopPropagation();
                                select(element.id);
                            }}
                        >
                            <meshStandardMaterial
                                color={color}
                                roughness={0.8}
                                metalness={0}
                                side={DoubleSide}
                                polygonOffset
                                polygonOffsetFactor={-1}
                                polygonOffsetUnits={-1}
                            />
                        </mesh>
                        <lineSegments geometry={border}>
                            <lineBasicMaterial color={print ? "#f8fafc" : color} />
                        </lineSegments>
                    </group>
                );
            })}
        </group>
    );
}
