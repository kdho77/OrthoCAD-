// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useBaseInsoleGeometry } from "@/hooks/useBaseInsoleGeometry";
import { INSOLE_LENGTH_MM, sideOffsetX } from "@/lib/geometry/layout";
import { modifierPerf } from "@/lib/performance/modifier-perf";
import { useDesignStore } from "@/stores/design-store";
import type { Side } from "@/types";

const sideColors: Record<Side, string> = {
    left: "#c084fc",
    right: "#a855f7",
};

/**
 * Renders a base template GLB with the design's corrections / elements applied
 * live as a deformation (Base + Modifier model).
 *
 * Geometry object identity is kept stable across slider ticks so R3F does not
 * remount the mesh; only BufferAttribute contents update (`needsUpdate`).
 */
export function BaseInsoleMesh({ side, transparent }: { side: Side; transparent: boolean }) {
    const design = useDesignStore((s) => s.design);
    const { geometry, building, usingLod, edgesRevision } = useBaseInsoleGeometry(design, side);
    const mountCounted = useRef(false);

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

    useEffect(() => {
        if (geometry && !mountCounted.current) {
            mountCounted.current = true;
            modifierPerf.recordMeshMount();
        }
    }, [geometry]);

    // Keep mesh mounted once geometry exists — never return null on rebuilds
    // (that caused remounts). Show nothing only before the first successful load.
    if (!geometry) return null;

    const offsetX = sideOffsetX(side);
    return (
        <group rotation={[-Math.PI / 2, 0, 0]}>
            <mesh
                // Stable key: side only — geometry identity is preserved by the hook.
                key={`base-mesh-${side}`}
                geometry={geometry}
                material={material}
                position={[-INSOLE_LENGTH_MM / 2, offsetX, 0]}
                castShadow={!building && !usingLod}
                receiveShadow
                frustumCulled={false}
            />
            {/* Outline only when idle on the full mesh — EdgesGeometry rebuild is costly. */}
            {!usingLod && !building ? (
                <lineSegments
                    key={`base-edges-${side}-${edgesRevision}`}
                    position={[-INSOLE_LENGTH_MM / 2, offsetX, 0]}
                >
                    <edgesGeometry args={[geometry, 35]} />
                    <lineBasicMaterial color={sideColors[side]} transparent opacity={0.35} />
                </lineSegments>
            ) : null}
        </group>
    );
}
