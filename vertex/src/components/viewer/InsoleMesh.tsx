import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useInsoleGeometry } from "@/hooks/useInsoleGeometry";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import { INSOLE_LENGTH_MM, sideOffsetX } from "@/lib/geometry/layout";
import type { DesignState, Side } from "@/types";

interface InsoleMeshProps {
    side: Side;
    design: DesignState;
    transparent: boolean;
    heightmap: boolean;
}

const sideColors: Record<Side, string> = {
    left: "#38bdf8",
    right: "#22d3ee",
};

export function InsoleMesh({ side, design, transparent, heightmap }: InsoleMeshProps) {
    const trimLines = useMeshEditStore((s) => s.trimLines);
    const vertexOverrides = useMeshEditStore((s) => s.vertexOverrides);
    const target = useMeshEditStore((s) => s.target);
    const applyEdits = target?.type === "insole" && target.side === side;

    const { geometry, building } = useInsoleGeometry({
        side,
        design,
        trimLines,
        vertexOverrides,
        applyEdits,
    });

    const material = useMemo(() => {
        if (heightmap) {
            return new THREE.MeshStandardMaterial({
                vertexColors: true,
                metalness: 0.1,
                roughness: 0.85,
                transparent,
                opacity: transparent ? 0.55 : 1,
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

    const coloredGeometry = useMemo(() => {
        if (!geometry || !heightmap) return geometry;
        const g = geometry.clone();
        const pos = g.getAttribute("position");
        const colors = new Float32Array(pos.count * 3);
        const color = new THREE.Color();
        let maxZ = 0;
        for (let i = 0; i < pos.count; i++) maxZ = Math.max(maxZ, pos.getZ(i));
        for (let i = 0; i < pos.count; i++) {
            const t = maxZ > 0 ? pos.getZ(i) / maxZ : 0;
            color.setHSL(0.66 - 0.66 * t, 0.85, 0.5);
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }
        g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        return g;
    }, [geometry, heightmap]);

    useEffect(() => {
        const c = coloredGeometry;
        return () => {
            if (c && c !== geometry) c.dispose();
        };
    }, [coloredGeometry, geometry]);

    const offsetX = sideOffsetX(side);
    const displayGeo = coloredGeometry ?? geometry;

    if (!displayGeo) return null;

    return (
        <group rotation={[-Math.PI / 2, 0, 0]}>
            <mesh
                geometry={displayGeo}
                material={material}
                position={[-INSOLE_LENGTH_MM / 2, offsetX, 0]}
                castShadow
                receiveShadow
            />
            {building ? (
                <mesh position={[-INSOLE_LENGTH_MM / 2, offsetX, 0.5]}>
                    <boxGeometry args={[INSOLE_LENGTH_MM, 90, 0.2]} />
                    <meshBasicMaterial color="#334155" transparent opacity={0.15} wireframe />
                </mesh>
            ) : null}
        </group>
    );
}
