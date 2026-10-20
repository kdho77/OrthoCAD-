// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

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
