// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useRef } from "react";
import type { DirectionalLight } from "three";
import { useAfoStore } from "@/stores/afo-store";
import { useDesignStore } from "@/stores/design-store";
import {
    AFO_SCAN_LANDMARK_AMBIENT_INTENSITY,
    AFO_SCAN_LANDMARK_FILL_INTENSITY,
    AFO_SCAN_LANDMARK_HEMISPHERE_INTENSITY,
    AFO_SCAN_LANDMARK_KEY_INTENSITY,
    afoScanLandmarkFillLightPosition,
    afoScanLandmarkKeyLightPosition,
} from "./afo-scan-landmark-lighting-config";

/** Key/fill/ambient lighting tuned for AFO scan landmarking. */
export function AfoScanLandmarkLighting() {
    const placement = useAfoStore((s) => s.scanPlacement);
    const isAfo = useDesignStore((s) => s.design.productType === "afo");
    const { camera } = useThree();
    const keyRef = useRef<DirectionalLight>(null);
    const fillRef = useRef<DirectionalLight>(null);

    const syncLights = () => {
        const key = keyRef.current;
        const fill = fillRef.current;
        if (!key || !fill) return;
        camera.updateMatrixWorld();
        key.position.copy(afoScanLandmarkKeyLightPosition(camera.position, camera.matrixWorld));
        fill.position.copy(afoScanLandmarkFillLightPosition(camera.position, camera.matrixWorld));
    };

    useLayoutEffect(() => {
        if (!placement || !isAfo) return;
        syncLights();
    }, [placement, isAfo, camera]);

    useFrame(() => {
        if (!placement || !isAfo) return;
        syncLights();
    });

    if (!isAfo || !placement) return null;
    return (
        <>
            <ambientLight intensity={AFO_SCAN_LANDMARK_AMBIENT_INTENSITY} />
            <hemisphereLight
                color="#e8eef8"
                groundColor="#1a2230"
                intensity={AFO_SCAN_LANDMARK_HEMISPHERE_INTENSITY}
            />
            <directionalLight
                ref={keyRef}
                intensity={AFO_SCAN_LANDMARK_KEY_INTENSITY}
                castShadow
                shadow-mapSize-width={1024}
                shadow-mapSize-height={1024}
                shadow-bias={-0.0002}
            />
            <directionalLight ref={fillRef} intensity={AFO_SCAN_LANDMARK_FILL_INTENSITY} />
        </>
    );
}
