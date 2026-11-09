// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useEffect, useMemo } from "react";
import { DoubleSide, MeshStandardMaterial } from "three";

/**
 * Lit AFO scan/cast surface. Flips the normal on the back face so a left-side
 * view is shaded instead of a black shell. Insole materials do not use this.
 */
export function AfoLitSurfaceMaterial({
    color,
    opacity,
    transparent,
    roughness,
    metalness,
    vertexColors,
    depthWrite,
}: {
    color: string;
    opacity: number;
    transparent: boolean;
    roughness: number;
    metalness: number;
    vertexColors: boolean;
    depthWrite: boolean;
}) {
    const material = useMemo(() => {
        const m = new MeshStandardMaterial({
            color,
            roughness,
            metalness,
            side: DoubleSide,
            transparent,
            opacity,
            depthWrite,
            vertexColors,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1,
        });
        m.onBeforeCompile = (shader) => {
            shader.fragmentShader = shader.fragmentShader.replace(
                "#include <normal_fragment_begin>",
                "#include <normal_fragment_begin>\nif (!gl_FrontFacing) normal = -normal;\n",
            );
        };
        m.customProgramCacheKey = () => "afo-lit-two-side";
        return m;
    }, [color, opacity, transparent, roughness, metalness, vertexColors, depthWrite]);

    useEffect(() => () => material.dispose(), [material]);
    return <primitive object={material} attach="material" />;
}
