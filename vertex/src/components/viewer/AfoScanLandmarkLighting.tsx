// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useThree } from "@react-three/fiber";
import { useAfoStore } from "@/stores/afo-store";
import { useDesignStore } from "@/stores/design-store";

/** Key/fill/ambient lighting tuned for AFO scan landmarking. */
export function AfoScanLandmarkLighting() {
    const placement = useAfoStore((s) => s.scanPlacement);
    const isAfo = useDesignStore((s) => s.design.productType === "afo");
    const { camera } = useThree();
    if (!isAfo || !placement) return null;
    return (
        <>
            <ambientLight intensity={0.35} />
            <directionalLight position={[camera.position.x, camera.position.y, camera.position.z]} intensity={0.95} />
            <directionalLight position={[-120, 80, 160]} intensity={0.35} />
        </>
    );
}
