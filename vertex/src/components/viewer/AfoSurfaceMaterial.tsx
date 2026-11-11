// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useEffect, useMemo } from "react";
import { DoubleSide, MeshStandardMaterial, PointsMaterial } from "three";
import { type AfoPointCloudShader, patchAfoPointCloudShaders } from "@/features/afo/afo-scan-ui";

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

/**
 * Visible point-cloud pass. Near samples are brighter and larger.
 * A depth-only splat drawn under this pass occludes the far side.
 */
export function AfoPointCloudMaterial({
    color,
    size,
    vertexColors,
}: {
    color: string;
    size: number;
    vertexColors: boolean;
}) {
    const material = useMemo(() => {
        const m = new PointsMaterial({
            color,
            size,
            sizeAttenuation: true,
            vertexColors,
            depthWrite: true,
            depthTest: true,
            toneMapped: false,
        });
        m.onBeforeCompile = (shader) => {
            patchAfoPointCloudShaders(shader as AfoPointCloudShader);
            m.userData.afoShader = shader;
        };
        m.customProgramCacheKey = () => "afo-point-camera-depth";
        return m;
    }, [color, size, vertexColors]);

    useEffect(() => () => material.dispose(), [material]);
    return <primitive object={material} attach="material" />;
}
