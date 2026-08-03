import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useBaseInsoleGeometry } from "@/hooks/useBaseInsoleGeometry";
import { sideOffsetX } from "@/lib/geometry/layout";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { useDesignStore } from "@/stores/design-store";
import { usePerformanceStore } from "@/stores/performance-store";
import type { Side } from "@/types";

const sideColors: Record<Side, string> = {
    left: "#c084fc",
    right: "#a855f7",
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
    const { geometry, building } = useBaseInsoleGeometry(design, side);

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

    // Geometry identity is reused while scrubbing — refresh vertex colors when Z params change.
    // biome-ignore lint/correctness/useExhaustiveDependencies: correction fields stand in for in-place geo edits
    useEffect(() => {
        if (!geometry || !heightmap) return;
        const pos = geometry.getAttribute("position");
        if (!colorAttrRef.current || colorAttrRef.current.count !== pos.count) {
            colorAttrRef.current = new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3);
        }
        applyHeightmapColors(geometry, colorAttrRef.current);
    }, [
        geometry,
        heightmap,
        corr.archHeightMm,
        corr.heelCupDepthMm,
        corr.heelCupWidthMm,
        corr.apexMoveMm,
        design.thicknessMm,
    ]);

    useEffect(
        () => () => {
            colorAttrRef.current = null;
        },
        [],
    );

    if (!geometry || building) return null;

    const layout = insoleLayoutFromDesign(design);
    const offsetX = sideOffsetX(side, layout.widthMm);
    return (
        <group rotation={[-Math.PI / 2, 0, 0]}>
            <mesh
                geometry={geometry}
                material={material}
                position={[-layout.lengthMm / 2, offsetX, 0]}
                castShadow={!building}
                receiveShadow
            />
            {/* Edge extract is expensive on large bases — only when idle. */}
            {!interacting && !heightmap ? (
                <lineSegments position={[-layout.lengthMm / 2, offsetX, 0]}>
                    <edgesGeometry args={[geometry, 35]} />
                    <lineBasicMaterial color={sideColors[side]} transparent opacity={0.35} />
                </lineSegments>
            ) : null}
        </group>
    );
}
