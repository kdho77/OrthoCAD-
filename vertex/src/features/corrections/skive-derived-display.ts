// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

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
