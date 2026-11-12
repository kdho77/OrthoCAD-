// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useAfoStore } from "@/stores/afo-store";

export function AfoScanHoverDot() {
    const hover = useAfoStore((s) => s.scanHoverWorld);
    const placement = useAfoStore((s) => s.scanPlacement);
    if (!hover || !placement || placement.paused) return null;
    return (
        <mesh position={[hover.x, hover.y, hover.z]} renderOrder={30}>
            <sphereGeometry args={[2.5, 12, 10]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.85} depthTest={false} />
        </mesh>
    );
}
