// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// Physical plantar view of belt G-code, calibrated on correct box/legacy files
// (VertexSlice validation/handedness_gates/hand_classify.py, PM 2026-11-24):
//   X across the belt, Y height off the belt (plantar at Y ~ 0), Z along the belt.
//   (X, Y, Z) is right-handed. De-shear with zt = Z - Y.
// Seen from below (device flipped onto its top): image right = -X, image up = +zt
// (heel), toe toward the viewer. Rotate 90° so the length-wise text is cap-up
// and the toe is to the right.

export interface Xyz {
    x: number;
    y: number;
    z: number;
}

export interface Xy {
    x: number;
    y: number;
}

/** Unsheared position along the belt. */
export function beltAlongZt(p: Xyz): number {
    return p.z - p.y;
}

/**
 * Heel-end rule from VertexSlice validation/handedness_gates/hand_classify.py
 * (frozen). The end fifth whose max Y is larger is the heel cup.
 * heelHigh means that cup is at high zt (toe-first on the calibrated belt).
 * A 180° belt turn puts the cup at low zt and flips X with it.
 */
export const HEEL_END_FRACTION = 0.2;
export const HEEL_END_MIN_MM = 5;
export const HEEL_MIN_LENGTH_MM = 80;
export const HEEL_MIN_CONTACT = 200;

export interface HeelEnd {
    /** True when the heel cup is at high zt. Null when the ends are not distinct. */
    heelHigh: boolean | null;
    loMaxY: number;
    hiMaxY: number;
    deltaMm: number;
    lengthMm: number;
}

export function heelEnd(points: readonly Xyz[]): HeelEnd {
    const empty: HeelEnd = { heelHigh: null, loMaxY: 0, hiMaxY: 0, deltaMm: 0, lengthMm: 0 };
    const contact = points.filter((p) => p.y <= 0.6);
    if (contact.length < HEEL_MIN_CONTACT) return empty;
    let z0 = Number.POSITIVE_INFINITY;
    let z1 = Number.NEGATIVE_INFINITY;
    let x0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    for (const p of contact) {
        const zt = beltAlongZt(p);
        if (zt < z0) z0 = zt;
        if (zt > z1) z1 = zt;
        if (p.x < x0) x0 = p.x;
        if (p.x > x1) x1 = p.x;
    }
    const length = z1 - z0;
    if (!(length >= HEEL_MIN_LENGTH_MM)) return { ...empty, lengthMm: length };
    const cx = (x0 + x1) / 2;
    const bandMax = (a: number, b: number, side: -1 | 1) => {
        let best = Number.NEGATIVE_INFINITY;
        for (const p of points) {
            const t = (beltAlongZt(p) - z0) / length;
            if (t < a || t >= b) continue;
            if (side < 0 ? p.x < cx : p.x >= cx) {
                if (p.y > best) best = p.y;
            }
        }
        return Number.isFinite(best) ? best : 0;
    };
    const lo = Math.max(bandMax(0, HEEL_END_FRACTION, -1), bandMax(0, HEEL_END_FRACTION, 1));
    const hi = Math.max(
        bandMax(1 - HEEL_END_FRACTION, 1.0001, -1),
        bandMax(1 - HEEL_END_FRACTION, 1.0001, 1),
    );
    const delta = hi - lo;
    return {
        heelHigh: Math.abs(delta) >= HEEL_END_MIN_MM ? delta > 0 : null,
        loMaxY: lo,
        hiMaxY: hi,
        deltaMm: delta,
        lengthMm: length,
    };
}

/**
 * Reading frame after the 90° turn. +x is toward the toe (left to right).
 * +y is the cap direction of an upright name.
 *
 * Toe-first (heel at high zt): from below, image right is -X and image up is
 * +zt, toe toward the viewer, then rotated so the toe is to the right.
 * Heel-first is that same camera after a 180° belt turn, which flips X and zt
 * together. A mirror flips only one axis, so the verdict flips.
 */
export function physicalReadingView(p: Xyz, heelHigh = true): Xy {
    const zt = beltAlongZt(p);
    const sign = heelHigh ? -1 : 1;
    return { x: sign * zt, y: sign * p.x };
}
