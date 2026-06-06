import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { getKernel } from "@/lib/chili3d/kernel";
import { applyTrimLines, applyVertexOverrides } from "@/lib/geometry/mesh-edit";
import { INSOLE_LENGTH_MM, INSOLE_WIDTH_MM, sideOffsetX } from "@/lib/geometry/layout";
import { useKernelStore } from "@/stores/kernel-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import type { DesignState, Side } from "@/types";

interface InsoleMeshProps {
    side: Side;
    design: DesignState;
    transparent: boolean;
    heightmap: boolean;
}

export function InsoleMesh({ side, design, transparent, heightmap }: InsoleMeshProps) {
    const kernelVersion = useKernelStore((s) => s.version);
    const trimLines = useMeshEditStore((s) => s.trimLines);
    const vertexOverrides = useMeshEditStore((s) => s.vertexOverrides);
    const target = useMeshEditStore((s) => s.target);

    const sideElements = useMemo(
        () => design.elements.filter((e) => e.side === side),
        [design.elements, side],
    );

    const applyEdits = target?.type === "insole" && target.side === side;

    const geometry = useMemo(() => {
        let g = getKernel().buildInsole({
            side,
            lengthMm: INSOLE_LENGTH_MM,
            widthMm: INSOLE_WIDTH_MM,
            thicknessMm: design.thicknessMm,
            corrections: design.corrections[side],
            elements: sideElements,
        });
        if (applyEdits) {
            g = applyTrimLines(g, trimLines);
            g = applyVertexOverrides(g, vertexOverrides);
        }
        return g;
    }, [
        side,
        design.thicknessMm,
        design.corrections,
        sideElements,
        kernelVersion,
        trimLines,
        vertexOverrides,
        applyEdits,
    ]);

    // Color the surface by height when the heightmap toggle is on.
    const material = useMemo(() => {
        if (heightmap) {
            const mat = new THREE.MeshStandardMaterial({
                vertexColors: true,
                metalness: 0.1,
                roughness: 0.85,
                transparent,
                opacity: transparent ? 0.55 : 1,
            });
            return mat;
        }
        return new THREE.MeshStandardMaterial({
            color: side === "left" ? "#38bdf8" : "#22d3ee",
            metalness: 0.15,
            roughness: 0.7,
            transparent,
            opacity: transparent ? 0.5 : 1,
            side: THREE.DoubleSide,
        });
    }, [heightmap, transparent, side]);

    // Dispose superseded geometry to avoid GPU memory growth during real-time edits.
    useEffect(() => () => geometry.dispose(), [geometry]);

    const coloredGeometry = useMemo(() => {
        if (!heightmap) return geometry;
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
            if (c !== geometry) c.dispose();
        };
    }, [coloredGeometry, geometry]);

    // Lay left/right side by side, centered, lying flat (rotate so length = X, height = Y).
    const offsetX = sideOffsetX(side);

    return (
        <group rotation={[-Math.PI / 2, 0, 0]}>
            <mesh
                geometry={coloredGeometry}
                material={material}
                position={[-INSOLE_LENGTH_MM / 2, offsetX, 0]}
                castShadow
                receiveShadow
            />
        </group>
    );
}
