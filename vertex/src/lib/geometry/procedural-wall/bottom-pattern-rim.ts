// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { PolyPoint } from "./curves";
import type { StockWallModel } from "./types";

export const BOTTOM_PATTERN_RIM_SLACK_MM = 0.2;

function pointInPolygonXY(x: number, y: number, poly: ReadonlyArray<{ x: number; y: number }>): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i]!.x;
        const yi = poly[i]!.y;
        const xj = poly[j]!.x;
        const yj = poly[j]!.y;
        const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-30) + xi;
        if (intersect) inside = !inside;
    }
    return inside;
}

function distPointToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-12) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    const qx = ax + t * dx;
    const qy = ay + t * dy;
    return Math.hypot(px - qx, py - qy);
}

function minDistToClosedPolygon(
    px: number,
    py: number,
    poly: ReadonlyArray<{ x: number; y: number }>,
): number {
    let min = Infinity;
    const n = poly.length;
    if (n < 2) return Infinity;
    for (let i = 0; i < n; i++) {
        const a = poly[i]!;
        const b = poly[(i + 1) % n]!;
        min = Math.min(min, distPointToSegment(px, py, a.x, a.y, b.x, b.y));
    }
    return min;
}

/** Signed inset of one B vertex vs the closed composed-top rim (mm). Negative = outside R. */
export function signedBottomPatternInsetVsRimMm(
    bx: number,
    by: number,
    rimPolygon: ReadonlyArray<{ x: number; y: number }>,
): number {
    if (rimPolygon.length < 4) return Infinity;
    const d = minDistToClosedPolygon(bx, by, rimPolygon);
    const inside = pointInPolygonXY(bx, by, rimPolygon);
    return inside ? d : -d;
}

export function composedTopRimPolygon(model: Pick<StockWallModel, "top">): PolyPoint[] {
    const pos = model.top.meshPositions;
    const rimLocal = model.top.rimLocal ?? [];
    if (!pos || rimLocal.length < 4) return [];
    return rimLocal.map((i) => ({
        x: pos[i * 3]!,
        y: pos[i * 3 + 1]!,
        z: 0,
    }));
}

/** Min signed inset of pattern stations vs the composed top rim (mm). Negative = outside R. */
export function minBottomPatternInsetVsTopRimMm(
    pattern: ReadonlyArray<PolyPoint>,
    model: Pick<StockWallModel, "top">,
): number {
    const rim = composedTopRimPolygon(model);
    if (pattern.length < 4 || rim.length < 4) return Infinity;
    let minInset = Infinity;
    for (const b of pattern) {
        if (!b) continue;
        minInset = Math.min(minInset, signedBottomPatternInsetVsRimMm(b.x, b.y, rim));
    }
    return minInset;
}

export function bottomPatternOutsideComposedRim(minInsetMm: number): boolean {
    return Number.isFinite(minInsetMm) && minInsetMm < -BOTTOM_PATTERN_RIM_SLACK_MM;
}
