// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { SkiveDriven } from "@/lib/geometry/heel-skive";

/** T22: blank derived Angle/Location readout when skive depth is zero. */
export function skiveDerivedDisplayText(
    driven: SkiveDriven,
    depthMm: number,
): { angleDisplayText?: string; locationDisplayText?: string } {
    if (!(depthMm > 0)) {
        if (driven === "angle") return { angleDisplayText: "—" };
        return { locationDisplayText: "—" };
    }
    return {};
}
