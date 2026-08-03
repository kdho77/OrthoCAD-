import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useInsoleGeometry } from "@/hooks/useInsoleGeometry";
import { sideOffsetX } from "@/lib/geometry/layout";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { getDesignTrimline } from "@/lib/geometry/trimline";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
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
    const trimlineEdit = useMeshEditStore((s) => s.trimlineEdit);
    const applyEdits = target?.type === "insole" && target.side === side;

    const trimline = useMemo(() => {
        // Phase 3A production editing: wire the live draft (including during active drag)
        // into the parametric preview so the user sees the footprint deform in real time.
        // The TrimlineEditTools already rate-limits draft commits via rAF + interacting=true
        // keeps the geometry engine on "preview" quality, so live updates are safe and responsive.
        if (trimlineEdit?.side === side) return trimlineEdit.draft;
        return getDesignTrimline(design, side);
    }, [design, trimlineEdit, side]);

    const { geometry, building } = useInsoleGeometry({
        side,
        design,
        trimLines,
        trimline,
        vertexOverrides,
        applyEdits,
    });

    const layout = insoleLayoutFromDesign(design);

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

    const colorAttrRef = useRef<THREE.BufferAttribute | null>(null);

    const coloredGeometry = useMemo(() => {
        if (!geometry || !heightmap) return geometry;
        const pos = geometry.getAttribute("position");
        if (!colorAttrRef.current || colorAttrRef.current.count !== pos.count) {
            colorAttrRef.current = new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3);
        }
        const colors = colorAttrRef.current;
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
        return geometry;
    }, [geometry, heightmap]);

    useEffect(
        () => () => {
            colorAttrRef.current = null;
        },
        [],
    );

    const offsetX = sideOffsetX(side, layout.widthMm);
    const displayGeo = coloredGeometry ?? geometry;

    if (!displayGeo || building) return null;

    return (
        <group rotation={[-Math.PI / 2, 0, 0]}>
            <mesh
                geometry={displayGeo}
                material={material}
                position={[-layout.lengthMm / 2, offsetX, 0]}
                castShadow
                receiveShadow
            />
        </group>
    );
}
