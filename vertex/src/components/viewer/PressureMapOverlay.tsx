// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { pressureMapMeshPose } from "@/lib/pressure-map/placement";
import { useDesignStore } from "@/stores/design-store";
import type { Side } from "@/types";

interface PressureMapOverlayProps {
    side: Side;
}

function PressureMapPlane({ side }: PressureMapOverlayProps) {
    const foot = useDesignStore((s) => s.design.pressureMaps?.[side]);
    const design = useDesignStore((s) => s.design);
    const viewerTransparent = useDesignStore((s) => s.viewer.transparent);

    const texture = useMemo(() => {
        if (!foot?.visible) return null;
        const loader = new THREE.TextureLoader();
        const tex = loader.load(foot.imageDataUrl);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        return tex;
    }, [foot?.imageDataUrl, foot?.visible]);

    useEffect(() => () => texture?.dispose(), [texture]);

    const pose = useMemo(() => {
        if (!foot) return null;
        return pressureMapMeshPose(design, side, foot);
    }, [design, foot, side]);

    useEffect(() => {
        if (!texture || !pose) return;
        if (pose.mirrorImageU) {
            texture.repeat.x = -1;
            texture.offset.x = 1;
        } else {
            texture.repeat.x = 1;
            texture.offset.x = 0;
        }
        texture.needsUpdate = true;
    }, [texture, pose]);

    if (!foot?.visible || !texture || !pose) return null;

    /** Above bottom-pattern fill (8); skip depth test when transparent so ink is not occluded. */
    const renderOrder = viewerTransparent ? 10 : -2;
    const depthTest = !viewerTransparent;

    return (
        <mesh
            position={pose.position}
            rotation={pose.rotation}
            scale={[pose.scale.x, pose.scale.y, 1]}
            renderOrder={renderOrder}
            raycast={() => {}}
        >
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial
                map={texture}
                transparent={false}
                side={THREE.DoubleSide}
                depthWrite={false}
                depthTest={depthTest}
                toneMapped={false}
            />
        </mesh>
    );
}

/** Flat plantar pressure image beneath the insole (visualization only). */
export function PressureMapOverlay({ side }: PressureMapOverlayProps) {
    return (
        <group rotation={[-Math.PI / 2, 0, 0]}>
            <PressureMapPlane side={side} />
        </group>
    );
}

export function PressureMapOverlayPair({
    showLeft,
    showRight,
}: {
    showLeft: boolean;
    showRight: boolean;
}) {
    return (
        <>
            {showLeft ? <PressureMapOverlay side="left" /> : null}
            {showRight ? <PressureMapOverlay side="right" /> : null}
        </>
    );
}
