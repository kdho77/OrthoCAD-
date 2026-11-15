// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

/** Millimetre point in the export / print frame (not the viewer). */
export interface MeasureVec3 {
    x: number;
    y: number;
    z: number;
}

/** Indexed triangle mesh. Positions are whatever frame the caller states. */
export interface MeasureTriangleMesh {
    positions: Float32Array;
    indices: Uint32Array;
}

export type MeasureProduct = "insole" | "afo";

export type MeasureSide = "left" | "right" | "afo";

/**
 * Viewer-only transform undone before a number is shown.
 * Print meshes are stored in true millimetres. This describes how the
 * viewport places them: optional L/R display mirror, normalize/fit scale,
 * centering plus the insole pair Y-shift, then the Rx(−90°) group.
 */
export interface MeasureDisplayTransform {
    /** Applied in export space after the optional mirror. (1,1,1) = already mm. */
    scale: MeasureVec3;
    /** Mesh position: insole centering on X and pair shift on Y. */
    translation: MeasureVec3;
    /** Euler XYZ radians. Insole and AFO viewers use x = −π/2. */
    rotationEuler: MeasureVec3;
    /** Reflection about an axis-aligned plane in export space, before scale. */
    mirror: { axis: 0 | 1 | 2; center: number } | null;
}

export interface MeasureAabb {
    min: MeasureVec3;
    max: MeasureVec3;
}

/** Print-orientation overall size. Insole: L×W×H. AFO: footplate × height × width. */
export interface MeasureOverall {
    lengthMm: number;
    widthMm: number;
    heightMm: number;
    min: MeasureVec3;
    max: MeasureVec3;
    includedLeader: boolean;
    leaderError: string | null;
}

export interface MeasureSegment {
    distanceMm: number;
    /** Absolute component along export X (insole length, AFO width). */
    dx: number;
    /** Absolute component along export Y (insole width, AFO footplate). */
    dy: number;
    /** Absolute component along export Z (height). */
    dz: number;
}

export interface MeasureHit {
    point: MeasureVec3;
    /** Unit face normal in the same frame as `point`, facing the ray. */
    normal: MeasureVec3;
    triangle: number;
    snapped: boolean;
}
