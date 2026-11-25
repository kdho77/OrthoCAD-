// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { BufferGeometry } from "three";
import { heelCupWidthScaleFactor } from "@/lib/geometry/height-field";
import {
    applyShoeWidthToPoints,
    type ShoeWidthFrame,
    type ShoeWidthId,
    shoeWidthPlanformCenterY,
} from "@/lib/geometry/shoe-width";

function withY<T extends { x: number; y: number }>(p: T, y: number): T {
    const clone = (p as { clone?: () => T }).clone;
    if (typeof clone === "function") {
        const next = clone.call(p);
        (next as { y: number }).y = y;
        return next;
    }
    return { ...p, y };
}

/**
 * Heel-cup width on a plan loop. Same scale and centre as the top-mesh
 * lateral delta: Y' = widCenter + (Y − widCenter) · heelCupWidthScaleFactor(u).
 * A zero correction returns the input loop.
 */
export function applyHeelCupWidthToPoints<T extends { x: number; y: number }>(
    pts: T[],
    heelCupWidthMm: number,
    frame: { minX: number; lengthMm: number },
    widCenter: number,
): T[] {
    if (!Array.isArray(pts) || pts.length === 0) return pts;
    if (!Number.isFinite(heelCupWidthMm) || Math.abs(heelCupWidthMm) < 1e-6) return pts;
    if (!Number.isFinite(widCenter)) return pts;
    const length = Math.max(1e-3, frame.lengthMm);
    return pts.map((p) => {
        const u = Math.max(0, Math.min(1, (p.x - frame.minX) / length));
        const s = heelCupWidthScaleFactor(u, heelCupWidthMm);
        return withY(p, widCenter + (p.y - widCenter) * s);
    });
}

export interface BottomPatternWidthOpts {
    ballWidthMm: number;
    heelWidthMm: number;
    /** Heel-cup correction. Non-zero replaces the shoe-width heel cap. */
    heelCupWidthMm?: number;
}

/**
 * Bottom pattern in the same width frame as the top mesh.
 *
 * The pattern is the native (Medium) outline. Shoe width runs once, about the
 * mesh vertex mean and the mesh X span — the same affine as
 * {@link applyShoeWidthToGeometry}. Heel-cup width then scales about the
 * mesh bbox centre after that affine, which is the centre the top sheet uses.
 * Medium with no heel correction returns the same array.
 */
export function viewerBottomPatternPlanform<T extends { x: number; y: number }>(
    pattern: T[],
    width: ShoeWidthId,
    frame: ShoeWidthFrame,
    opts: BottomPatternWidthOpts,
    widCenter: number,
): T[] {
    const heelCup = opts.heelCupWidthMm ?? 0;
    const sized = applyShoeWidthToPoints(pattern, width, {
        ballWidthMm: opts.ballWidthMm,
        heelWidthMm: opts.heelWidthMm,
        minX: frame.minX,
        lengthMm: frame.lengthMm,
        yMid: frame.yMid,
        heelOverrideMm: heelCup,
    });
    return applyHeelCupWidthToPoints(sized, heelCup, frame, widCenter);
}

/** Mesh bbox centre the heel-cup planform scales about. */
export function bottomPatternWidthCenter(
    geometry: BufferGeometry,
    width: ShoeWidthId,
    frame: ShoeWidthFrame,
    opts: BottomPatternWidthOpts,
): number {
    const heelCup = opts.heelCupWidthMm ?? 0;
    return shoeWidthPlanformCenterY(geometry, width, {
        ballWidthMm: opts.ballWidthMm,
        heelWidthMm: opts.heelWidthMm,
        minX: frame.minX,
        lengthMm: frame.lengthMm,
        yMid: frame.yMid,
        heelOverrideMm: heelCup,
    });
}
