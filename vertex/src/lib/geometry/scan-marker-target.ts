// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type * as THREE from "three";
import type { MarkerId, ScanMarkers } from "@/stores/scan-store";

/** Drag-adjust pick radius in millimetres (converted to raw scan units via displayScale). */
export const MARKER_DRAG_RADIUS_MM = 8;

/**
 * Choose which marker a placement click should set.
 *
 * Sequential placement wins: while `next` is still unplaced, always place `next`
 * so a click on M2 cannot steal/move M1. Drag-to-adjust of an existing marker is
 * only considered once that next slot is already filled (or all three are placed).
 *
 * Proximity uses a scale-aware radius: markers are stored in raw scan-local units,
 * so a fixed "8" would swallow the whole foot on meter-scale scans.
 */
export function resolveMarkerPlacementTarget(
    next: MarkerId,
    markers: ScanMarkers | undefined,
    local: THREE.Vector3,
    displayScale: number,
): MarkerId {
    const nextUnplaced = !markers?.[next];
    if (nextUnplaced) return next;

    const scale = displayScale > 0 && Number.isFinite(displayScale) ? displayScale : 1;
    const thresh = MARKER_DRAG_RADIUS_MM / scale;
    let best: MarkerId | null = null;
    let bestD = thresh;
    for (const id of ["M1", "M2", "M3", "ARCH"] as MarkerId[]) {
        const p = markers?.[id];
        if (!p) continue;
        const d = p.distanceTo(local);
        if (d < bestD) {
            bestD = d;
            best = id;
        }
    }
    return best ?? next;
}
