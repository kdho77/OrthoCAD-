import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useBaseInsoleGeometry } from "@/hooks/useBaseInsoleGeometry";
import { INSOLE_LENGTH_MM, sideOffsetX } from "@/lib/geometry/layout";
import { useDesignStore } from "@/stores/design-store";
import { usePerformanceStore } from "@/stores/performance-store";
import type { Side } from "@/types";

const sideColors: Record<Side, string> = {
    left: "#c084fc",
    right: "#a855f7",
};

/**
 * Renders a base template GLB with the design's corrections / elements applied
 * live as a deformation (Base + Modifier model). Falls back to nothing when the
 * design has no base or the base fails to load (the parametric mesh covers that
 * case in the viewer).
 */
export function BaseInsoleMesh({ side, transparent }: { side: Side; transparent: boolean }) {
    const design = useDesignStore((s) => s.design);
    const interacting = usePerformanceStore((s) => s.interacting);
    const { geometry, building } = useBaseInsoleGeometry(design, side);

    const material = useMemo(
        () =>
            new THREE.MeshStandardMaterial({
                color: sideColors[side],
                metalness: 0.15,
                roughness: 0.7,
                transparent,
                opacity: transparent ? 0.5 : 1,
                side: THREE.DoubleSide,
            }),
        [side, transparent],
    );

    useEffect(() => () => material.dispose(), [material]);

    if (!geometry || building) return null;

    const offsetX = sideOffsetX(side);
    return (
        <group rotation={[-Math.PI / 2, 0, 0]}>
            <mesh
                geometry={geometry}
                material={material}
                position={[-INSOLE_LENGTH_MM / 2, offsetX, 0]}
                castShadow={!building}
                receiveShadow
            />
            {/* Edge extract is expensive on large bases — only when idle. */}
            {!interacting ? (
                <lineSegments position={[-INSOLE_LENGTH_MM / 2, offsetX, 0]}>
                    <edgesGeometry args={[geometry, 35]} />
                    <lineBasicMaterial color={sideColors[side]} transparent opacity={0.35} />
                </lineSegments>
            ) : null}
        </group>
    );
}
