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

/** Unsheared position along the belt. +zt is the heel on toe-first prints. */
export function beltAlongZt(p: Xyz): number {
    return p.z - p.y;
}

/**
 * Reading frame after the 90° turn. +x is toward the toe (left to right).
 * +y is the cap direction of an upright name.
 */
export function physicalReadingView(p: Xyz): Xy {
    const zt = beltAlongZt(p);
    const imageX = -p.x;
    const imageY = zt;
    return { x: -imageY, y: imageX };
}
