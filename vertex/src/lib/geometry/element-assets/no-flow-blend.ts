// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import { getBaseFootprintFrame } from "@/lib/geometry/base-modifier";
import { NO_FLOW_BASE_RADIUS_MM, NO_FLOW_SMOOTH_MAX_K_MM } from "./types";

/** CAD smooth max: smax(a,b)=max(a,b)+h²/(4k), h=max(k-|a-b|,0). */
export function smoothMaxMm(a: number, b: number, k = NO_FLOW_SMOOTH_MAX_K_MM): number {
    const h = Math.max(k - Math.abs(a - b), 0);
    return Math.max(a, b) + (h * h) / (4 * k);
}

/** CAD smooth min for sinks: smin(a,b)=min(a,b)-h²/(4k). */
export function smoothMinMm(a: number, b: number, k = NO_FLOW_SMOOTH_MAX_K_MM): number {
    const h = Math.max(k - Math.abs(a - b), 0);
    return Math.min(a, b) - (h * h) / (4 * k);
}

export interface NoFlowHeightHooks {
    /** Mean top z within radius of anchor (mm). */
    baseHeightAtAnchor(geometry: BufferGeometry, anchorX: number, anchorY: number, thickAxis: number): number;
}

export const defaultNoFlowHeightHooks: NoFlowHeightHooks = {
    baseHeightAtAnchor(geometry, anchorX, anchorY, thickAxis) {
        const pos = geometry.getAttribute("position");
        if (!pos) return 0;
        const arr = pos.array as Float32Array;
        const r2 = NO_FLOW_BASE_RADIUS_MM * NO_FLOW_BASE_RADIUS_MM;
        let sum = 0;
        let n = 0;
        for (let i = 0; i < pos.count; i++) {
            const dx = arr[i * 3]! - anchorX;
            const dy = arr[i * 3 + 1]! - anchorY;
            if (dx * dx + dy * dy > r2) continue;
            sum += arr[i * 3 + thickAxis]!;
            n++;
        }
        if (n === 0) {
            let best = Infinity;
            let z = 0;
            for (let i = 0; i < pos.count; i++) {
                const d = (arr[i * 3]! - anchorX) ** 2 + (arr[i * 3 + 1]! - anchorY) ** 2;
                if (d < best) {
                    best = d;
                    z = arr[i * 3 + thickAxis]!;
                }
            }
            return z;
        }
        return sum / n;
    },
};

export function anchorMmFromPlacement(
    base: BufferGeometry,
    side: import("@/types").Side,
    positionX: number,
    positionY: number,
): { x: number; y: number; frame: ReturnType<typeof getBaseFootprintFrame> } {
    const frame = getBaseFootprintFrame(base, side);
    const centerX = frame.lenMin + frame.lenSize / 2;
    const centerY = frame.widCenter;
    return { x: centerX + positionX, y: centerY + positionY, frame };
}
