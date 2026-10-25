import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { publishTextGuide } from "@/features/exports/text-guide-store";
import { useBaseInsoleGeometry } from "@/hooks/useBaseInsoleGeometry";
import { applyDesignElementColors } from "@/lib/geometry/element-visualization";
import { sideOffsetX } from "@/lib/geometry/layout";
import { isCoarsePointerDevice } from "@/lib/geometry/procedural-wall/preview-loft-queue";
import {
    shouldExtractBaseEdges,
    shouldHideBaseMesh,
} from "@/lib/geometry/procedural-wall/sample-top-display";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import type { TextGuide } from "@/lib/geometry/text-marking/place";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";
import { usePerformanceStore } from "@/stores/performance-store";
import type { Side } from "@/types";
import { ElementSurfaceMeshes } from "./ElementSurfaceMeshes";
import { TextPlacementGuide, useTextSurfaceDrag } from "./TextPlacementGuide";

const sideColors: Record<Side, string> = {
    left: "#f8fafc",
    right: "#f8fafc",
};

function applyHeightmapColors(geometry: THREE.BufferGeometry, colors: THREE.BufferAttribute): void {
    const pos = geometry.getAttribute("position");
    const color = new THREE.Color();
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < pos.count; i++) {
        const z = pos.getZ(i);
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
    }
    const span = Math.max(1e-6, maxZ - minZ);
    for (let i = 0; i < pos.count; i++) {
        const t = (pos.getZ(i) - minZ) / span;
        color.setHSL(0.66 - 0.66 * t, 0.85, 0.5);
        colors.setXYZ(i, color.r, color.g, color.b);
    }
    colors.needsUpdate = true;
    geometry.setAttribute("color", colors);
}

/**
 * Renders a base template GLB with the design's corrections / elements applied
 * live as a deformation (Base + Modifier model). Falls back to nothing when the
 * design has no base or the base fails to load (the parametric mesh covers that
 * case in the viewer).
 */
export function BaseInsoleMesh({
    side,
    transparent,
    heightmap = false,
}: {
    side: Side;
    transparent: boolean;
    heightmap?: boolean;
}) {
    const design = useDesignStore((s) => s.design);
    const interacting = usePerformanceStore((s) => s.interacting);
    const workflowStep = useClinicalWorkflowStore((s) => s.step);
    const selectedElementId = useDesignStore((s) => s.selectedElementId);
    const { geometry, building, elementReference } = useBaseInsoleGeometry(design, side);
    const textDrag = useTextSurfaceDrag(side);

    useEffect(() => {
        const ud = geometry?.userData as { textGuide?: TextGuide; textFitError?: string } | undefined;
        if (ud?.textGuide) publishTextGuide(side, ud.textGuide, ud.textFitError ?? null);
    }, [geometry, side]);

    const material = useMemo(() => {
        if (heightmap) {
            return new THREE.MeshStandardMaterial({
                vertexColors: true,
                metalness: 0.1,
                roughness: 0.85,
                transparent,
                opacity: transparent ? 0.55 : 1,
                side: THREE.DoubleSide,
            });
        }
        return new THREE.MeshStandardMaterial({
            vertexColors: true,
            color: sideColors[side],
            metalness: 0.15,
            roughness: 0.7,
            transparent,
            opacity: transparent ? 0.5 : 1,
            side: THREE.DoubleSide,
        });
    }, [heightmap, transparent, side]);

    useEffect(() => () => material.dispose(), [material]);

    const colorAttrRef = useRef<THREE.BufferAttribute | null>(null);
    const corr = design.corrections[side];

    // Geometry identity is reused while scrubbing — refresh color attributes when
    // height fields or the current workflow step change.
    // biome-ignore lint/correctness/useExhaustiveDependencies: correction fields stand in for in-place geo edits
    useEffect(() => {
        if (!geometry) return;
        if (!heightmap) {
            applyDesignElementColors(
                geometry,
                workflowStep !== "print" && workflowStep !== "export",
                selectedElementId,
            );
            return;
        }
        const pos = geometry.getAttribute("position");
        if (!colorAttrRef.current || colorAttrRef.current.count !== pos.count) {
            colorAttrRef.current = new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3);
        }
        applyHeightmapColors(geometry, colorAttrRef.current);
    }, [
        geometry,
        heightmap,
        workflowStep,
        selectedElementId,
        design.elements,
        design.sizeSystem,
        design.usMenSize,
        design.ukSize,
        design.footLengthMm,
        side,
        corr.archHeightMm,
        corr.heelCupDepthMm,
        corr.heelCupWidthMm,
        corr.forefootWidthMm,
        corr.apexMoveMm,
        design.thicknessMm,
    ]);

    useEffect(
        () => () => {
            colorAttrRef.current = null;
        },
        [],
    );

    if (shouldHideBaseMesh(Boolean(geometry), building)) return null;
    if (!geometry) return null;

    const layout = insoleLayoutFromDesign(design);
    const offsetX = sideOffsetX(side, layout.widthMm);
    const vertexCount = geometry.getAttribute("position")?.count ?? 0;
    const showEdges =
        !heightmap && !isCoarsePointerDevice() && shouldExtractBaseEdges(vertexCount, interacting);
    return (
        <group rotation={[-Math.PI / 2, 0, 0]}>
            <mesh
                geometry={geometry}
                material={material}
                position={[-layout.lengthMm / 2, offsetX, 0]}
                castShadow={!building}
                receiveShadow
                onPointerDown={textDrag.onPointerDown}
                onPointerMove={textDrag.onPointerMove}
                onPointerUp={textDrag.onPointerUp}
            />
            <group position={[-layout.lengthMm / 2, offsetX, 0]}>
                <TextPlacementGuide side={side} />
            </group>
            {!heightmap && (
                <group position={[-layout.lengthMm / 2, offsetX, 0]}>
                    <ElementSurfaceMeshes
                        base={geometry}
                        reference={elementReference ?? geometry}
                        side={side}
                    />
                </group>
            )}
            {/* Edge extract is expensive on large bases — only when idle and small. */}
            {showEdges ? (
                <lineSegments position={[-layout.lengthMm / 2, offsetX, 0]}>
                    <edgesGeometry args={[geometry, 35]} />
                    <lineBasicMaterial color={sideColors[side]} transparent opacity={0.35} />
                </lineSegments>
            ) : null}
        </group>
    );
}
