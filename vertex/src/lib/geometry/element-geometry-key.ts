// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { PlacedElement } from "@/types";

/** Material changes must not rebuild the approved placement or print solid. */
export function elementGeometryKey(elements: PlacedElement[]): string {
    return JSON.stringify(
        elements.map((e) => ({
            id: e.id,
            kind: e.kind,
            customElementId: e.customElementId,
            side: e.side,
            position: e.position,
            rotationDeg: e.rotationDeg,
            scale: e.scale,
            heightMm: e.heightMm,
            placementMode: e.placementMode,
            zOffsetMm: e.zOffsetMm,
        })),
    );
}
