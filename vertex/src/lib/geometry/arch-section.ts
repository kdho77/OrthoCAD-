// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { GridPoint, HeightFieldParams } from "@/lib/geometry/height-field";
import { heightAt, resolveOutlineHalfWidth } from "@/lib/geometry/height-field";
import { archGrindPlantarRaiseAt, clampArchGrindDepthMm } from "@/lib/geometry/shape-finish-modifiers";

/** Inclusive samples from one trimline edge to the other. */
const ACROSS_SAMPLES = 17;

function acrossSigned(index: number): number {
    const last = ACROSS_SAMPLES - 1;
    return -1 + (2 * index) / last;
}

function footprintHalfWidthMm(u: number, params: HeightFieldParams): number {
    return resolveOutlineHalfWidth(u, params) * (params.widthMm / 2);
}

function appliedGrindDepthMm(params: HeightFieldParams): number {
    const requested = params.shapeFinish?.archGrindDepthMm ?? 0;
    return clampArchGrindDepthMm(requested, params.thicknessMm);
}

function pointAt(x: number, across: number, halfWidthMm: number, z: number): GridPoint {
    return { x, y: across * halfWidthMm, z };
}

/**
 * Closed station profile at normalized length `u` (0 heel, 1 toe).
 *
 * The plantar chord is emitted first, edge to edge, with arch grind raising
 * the sole into the solid. The dorsal contour then returns along the same
 * stations so both rings have an equal point count.
 */
export function sectionProfilePoints(u: number, params: HeightFieldParams): GridPoint[] {
    const x = u * params.lengthMm;
    const halfWidthMm = footprintHalfWidthMm(u, params);
    const grindMm = appliedGrindDepthMm(params);
    const plantar: GridPoint[] = [];
    const dorsal: GridPoint[] = [];

    for (let index = 0; index < ACROSS_SAMPLES; index++) {
        const across = acrossSigned(index);
        plantar.push(pointAt(x, across, halfWidthMm, archGrindPlantarRaiseAt(u, Math.abs(across), grindMm)));
    }
    for (let index = ACROSS_SAMPLES - 1; index >= 0; index--) {
        const across = acrossSigned(index);
        dorsal.push(pointAt(x, across, halfWidthMm, heightAt(u, across, params)));
    }
    return plantar.concat(dorsal);
}
