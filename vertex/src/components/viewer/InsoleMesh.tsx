import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useInsoleGeometry } from "@/hooks/useInsoleGeometry";
import { INSOLE_LENGTH_MM, INSOLE_WIDTH_MM, sideOffsetX } from "@/lib/geometry/layout";
import { useDesignStore } from "@/stores/design-store";
import { usePreviewQuality } from "@/stores/performance-store";
import type { Side } from "@/types";

interface InsoleMeshProps {
    side: Side;
    transparent: boolean;
    heightmap: boolean;
}

export function InsoleMesh({ side, transparent, heightmap }: InsoleMeshProps) {
    const thicknessMm = useDesignStore((s) => s.design.thicknessMm);
    const corrections = useDesignStore((s) => s.design.corrections[side]);
    const elements = useDesignStore((s) => s.design.elements);
    const preview = usePreviewQuality();

    const sideElements = useMemo(() => elements.filter((e) => e.side === side), [elements, side]);

    const params = useMemo(
        () => ({
            side,
            lengthMm: INSOLE_LENGTH_MM,
            widthMm: INSOLE_WIDTH_MM,
            thicknessMm,
            corrections,
            elements: sideElements,
        }),
        [side, thicknessMm, corrections, sideElements],
    );

    const { geometry, building } = useInsoleGeometry({ params, preview });

    const material = useMemo(() => {
        const buildingOpacity = building ? 0.72 : 1;
        if (heightmap) {
            return new THREE.MeshStandardMaterial({
                vertexColors: true,
                metalness: 0.1,
                roughness: 0.85,
                transparent: true,
                opacity: (transparent ? 0.55 : 1) * buildingOpacity,
            });
        }
        return new THREE.MeshStandardMaterial({
            color: side === "left" ? "#38bdf8" : "#22d3ee",
            metalness: 0.15,
            roughness: 0.7,
            transparent: true,
            opacity: (transparent ? 0.5 : 1) * buildingOpacity,
            side: THREE.DoubleSide,
        });
    }, [heightmap, transparent, side, building]);

    useEffect(() => () => material.dispose(), [material]);

    const colorAttrRef = useRef<THREE.BufferAttribute | null>(null);

    const displayGeometry = useMemo(() => {
        if (!geometry) return null;
        if (!heightmap) return geometry;

        const g = geometry;
        const pos = g.getAttribute("position");
        if (!colorAttrRef.current || colorAttrRef.current.count !== pos.count) {
            colorAttrRef.current = new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3);
        }
        const colors = colorAttrRef.current;
        const color = new THREE.Color();
        let maxZ = 0;
        for (let i = 0; i < pos.count; i++) maxZ = Math.max(maxZ, pos.getZ(i));
        for (let i = 0; i < pos.count; i++) {
            const t = maxZ > 0 ? pos.getZ(i) / maxZ : 0;
            color.setHSL(0.66 - 0.66 * t, 0.85, 0.5);
            colors.setXYZ(i, color.r, color.g, color.b);
        }
        g.setAttribute("color", colors);
        return g;
    }, [geometry, heightmap]);

    useEffect(
        () => () => {
            colorAttrRef.current = null;
        },
        [],
    );

    const offsetX = sideOffsetX(side);

    if (!displayGeometry) return null;

    return (
        <group rotation={[-Math.PI / 2, 0, 0]}>
            <mesh
                geometry={displayGeometry}
                material={material}
                position={[-INSOLE_LENGTH_MM / 2, offsetX, 0]}
                castShadow={!preview && !building}
                receiveShadow
                frustumCulled
            />
        </group>
    );
}
