// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { type BufferGeometry, DoubleSide } from "three";
import {
    buildElementDisplayMeshes,
    type ElementDisplayMesh,
} from "@/lib/geometry/element-assets/display-mesh";
import { elementGeometryKey } from "@/lib/geometry/element-geometry-key";
import { elementPreviewColor } from "@/lib/hardness/split-overlay";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";
import { mergeElementPreviews, usePerformanceStore } from "@/stores/performance-store";
import type { Side } from "@/types";
import { ElementHardnessPopup } from "./ElementHardnessPopup";
import { applyHeightmapColors, extendZRange, zRangeFromPositions } from "./heightmap-colors";

/** Uses the same coordinates and visibility as its parent insole. */
export function ElementSurfaceMeshes({
    base,
    reference = base,
    side,
    heightmap = false,
}: {
    base: BufferGeometry;
    reference?: BufferGeometry;
    side: Side;
    heightmap?: boolean;
}) {
    const elements = useDesignStore((s) => s.design.elements);
    const geometryElementsKey = elementGeometryKey(elements);
    const split = useDesignStore((s) => Boolean(s.design.splitElements));
    const selected = useDesignStore((s) => s.selectedElementId);
    const select = useDesignStore((s) => s.selectElement);
    const step = useClinicalWorkflowStore((s) => s.step);
    const previews = usePerformanceStore((s) => s.elementPreviews);
    const print = step === "print" || step === "export";
    const [meshes, setMeshes] = useState<ElementDisplayMesh[]>([]);
    // biome-ignore lint/correctness/useExhaustiveDependencies: geometryElementsKey excludes material metadata; previews trigger placement changes
    useEffect(() => {
        let cancelled = false;
        let owned: ElementDisplayMesh[] = [];
        setMeshes([]);
        void buildElementDisplayMeshes(
            base,
            mergeElementPreviews(useDesignStore.getState().design.elements),
            side,
            print,
            reference,
        )
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
        return () => {
            cancelled = true;
            for (const mesh of owned) {
                mesh.surface.dispose();
                mesh.border.dispose();
            }
        };
    }, [base, reference, geometryElementsKey, side, print, previews]);

    const heightmapZRange = useMemo(() => {
        if (!heightmap || print) return null;
        let range = zRangeFromPositions(base);
        for (const { surface } of meshes) {
            range = extendZRange(range, surface);
        }
        return range;
    }, [base, heightmap, print, meshes]);

    useEffect(() => {
        if (!heightmap || print) {
            for (const { surface } of meshes) {
                surface.deleteAttribute("color");
            }
            return;
        }
        if (!heightmapZRange) return;
        for (const { surface } of meshes) {
            const pos = surface.getAttribute("position");
            if (!pos) continue;
            if (!surface.getAttribute("normal")) surface.computeVertexNormals();
            const existing = surface.getAttribute("color") as THREE.BufferAttribute | undefined;
            const colors =
                existing?.count === pos.count
                    ? existing
                    : new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3);
            applyHeightmapColors(surface, colors, heightmapZRange);
        }
    }, [heightmap, print, meshes, heightmapZRange]);

    const useHeightmapSurface = heightmap && !print;

    return (
        <group>
            {meshes.map(({ element, surface, border }) => {
                const liveElement = elements.find((e) => e.id === element.id);
                if (!liveElement) return null;
                const isSelected = selected === element.id;
                const color = elementPreviewColor(liveElement, print, isSelected, split);
                if (!surface.boundingBox) surface.computeBoundingBox();
                const bounds = surface.boundingBox;
                const popupPosition: [number, number, number] = bounds
                    ? [(bounds.min.x + bounds.max.x) / 2, (bounds.min.y + bounds.max.y) / 2, bounds.max.z]
                    : [0, 0, 0];
                return (
                    <group key={element.id}>
                        {/* biome-ignore lint/a11y/noStaticElementInteractions: R3F mesh pick target */}
                        <mesh
                            geometry={surface}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                                event.stopPropagation();
                                select(element.id);
                            }}
                        >
                            <meshStandardMaterial
                                color={useHeightmapSurface ? "#ffffff" : color}
                                vertexColors={useHeightmapSurface}
                                roughness={0.8}
                                metalness={0}
                                side={DoubleSide}
                                polygonOffset
                                polygonOffsetFactor={-1}
                                polygonOffsetUnits={-1}
                            />
                        </mesh>
                        <lineSegments geometry={border}>
                            <lineBasicMaterial color={print ? (isSelected ? "#22d3ee" : "#f8fafc") : color} />
                        </lineSegments>
                        {step === "print" && isSelected && surface.getAttribute("position").count > 0 ? (
                            <ElementHardnessPopup elementId={element.id} position={popupPosition} />
                        ) : null}
                    </group>
                );
            })}
        </group>
    );
}
