// FROZEN anatomical outline copied from main mortons-extension.ts stock edges
// at 4a6c76f2. The clinical line does not follow the candidate's border code.

export const LENGTH_MM = 260;
export const WIDTH_MM = 95;
/** Sink profile centers on main. Midpoint is the 1st/2nd intermetatarsal space. */
export const MPJ1 = { u: 0.665, v: 0.145 };
export const MPJ2 = { u: 0.685, v: 0.365 };
/** Medial-contour sample short of the toe cap, used as the 1st-ray direction. */
export const TOE_MEDIAL_U = 0.97;
export const FULL_HEIGHT_REACH_MM = 10;
export const FULL_HEIGHT_LINE_MM = 11;
export const BLEND_MM = 25;
export const BEVEL_ABS_MAX_MM = 8;
export const END_INSET_MM = 5;
export const HEIGHTS_MM = [3, 6] as const;

const EDGE_U = [
    0, 0.025, 0.05, 0.075, 0.1, 0.125, 0.15, 0.175, 0.2, 0.225, 0.25, 0.275, 0.3, 0.325, 0.35, 0.375, 0.4,
    0.425, 0.45, 0.475, 0.5, 0.525, 0.55, 0.575, 0.6, 0.625, 0.65, 0.675, 0.7, 0.725, 0.75, 0.775, 0.8, 0.825,
    0.85, 0.875, 0.9, 0.925, 0.95, 0.975, 1,
] as const;
const EDGE_MEDIAL = [
    -0.3422, -0.5834, -0.689, -0.7603, -0.7861, -0.7945, -0.7993, -0.8033, -0.8068, -0.8102, -0.812, -0.8126,
    -0.8126, -0.8121, -0.8113, -0.8108, -0.812, -0.8156, -0.8236, -0.8391, -0.8592, -0.8836, -0.9098, -0.9363,
    -0.961, -0.9781, -0.9907, -0.9985, -1, -0.9995, -0.9933, -0.9818, -0.969, -0.9491, -0.926, -0.8995,
    -0.8687, -0.8268, -0.7776, -0.6983, -0.548,
] as const;
const EDGE_LATERAL = [
    0.2791, 0.5003, 0.5959, 0.6729, 0.7214, 0.749, 0.7752, 0.7925, 0.8025, 0.809, 0.8137, 0.8183, 0.8216,
    0.827, 0.8349, 0.8432, 0.8566, 0.8689, 0.8869, 0.908, 0.9342, 0.955, 0.9733, 0.9883, 0.9975, 1, 0.9991,
    0.9929, 0.976, 0.9549, 0.9211, 0.8852, 0.8457, 0.7929, 0.7461, 0.6848, 0.6158, 0.5247, 0.433, 0.2995,
    0.0495,
] as const;

export type FootSide = "left" | "right";

export interface Xy {
    x: number;
    y: number;
}

/** Frozen left-medial sign. Left medial is −Y. Right medial is +Y. */
export function frozenMedialSign(side: FootSide): 1 | -1 {
    return side === "left" ? -1 : 1;
}

function lerpEdge(u: number): { medial: number; lateral: number } {
    const x = Math.max(0, Math.min(1, u));
    let i = 1;
    while (i < EDGE_U.length - 1 && EDGE_U[i]! < x) i++;
    const u0 = EDGE_U[i - 1]!;
    const u1 = EDGE_U[i]!;
    const t = u1 > u0 ? (x - u0) / (u1 - u0) : 0;
    return {
        medial: EDGE_MEDIAL[i - 1]! + t * (EDGE_MEDIAL[i]! - EDGE_MEDIAL[i - 1]!),
        lateral: EDGE_LATERAL[i - 1]! + t * (EDGE_LATERAL[i]! - EDGE_LATERAL[i - 1]!),
    };
}

/** Mesh Y of the medial and lateral borders. Same map as main stockStation. */
export function stockStation(
    u: number,
    side: FootSide,
    widthMm = WIDTH_MM,
): { medial: number; lateral: number } {
    const e = lerpEdge(u);
    const half = widthMm / 2;
    const mirror = side === "right" ? -1 : 1;
    const a = e.medial * half * mirror;
    const b = e.lateral * half * mirror;
    const sign = frozenMedialSign(side);
    return {
        medial: sign < 0 ? Math.min(a, b) : Math.max(a, b),
        lateral: sign < 0 ? Math.max(a, b) : Math.min(a, b),
    };
}

export function pointAtUV(u: number, v: number, side: FootSide): Xy {
    const station = stockStation(u, side);
    return {
        x: u * LENGTH_MM,
        y: station.medial + v * (station.lateral - station.medial),
    };
}

export function vAtPoint(x: number, y: number, side: FootSide): number {
    const u = x / LENGTH_MM;
    const station = stockStation(u, side);
    const span = station.lateral - station.medial;
    if (Math.abs(span) < 1e-9) return 0;
    return (y - station.medial) / span;
}

export interface ClinicalFrame {
    side: FootSide;
    mpj1: Xy;
    mpj2: Xy;
    mid: Xy;
    /** Unit direction of the medial forefoot contour, distal positive. */
    dir: Xy;
    /** Unit normal pointing lateral. */
    lateral: Xy;
    /** Distal of this x, medial of the line, height must already be full (10 mm band). */
    xFullMin: number;
    /** Nominal plateau end, 11 mm proximal of MPJ1. Blend starts here. */
    xLine: number;
    /** 25 mm proximal of xLine. Added height is 0 here. */
    xBlendEnd: number;
    /** Toe edge minus 5 mm. */
    xToe: number;
    /** Plateau corner plus 5 mm, where straightness is measured. */
    xCorner: number;
}

export function clinicalFrame(side: FootSide): ClinicalFrame {
    const mpj1 = pointAtUV(MPJ1.u, MPJ1.v, side);
    const mpj2 = pointAtUV(MPJ2.u, MPJ2.v, side);
    const mid = { x: (mpj1.x + mpj2.x) / 2, y: (mpj1.y + mpj2.y) / 2 };
    const med0 = pointAtUV(MPJ1.u, 0, side);
    const med1 = pointAtUV(TOE_MEDIAL_U, 0, side);
    let dx = med1.x - med0.x;
    let dy = med1.y - med0.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    if (dx < 0) {
        dx = -dx;
        dy = -dy;
    }
    const station = stockStation(MPJ1.u, side);
    const towardLateralY = station.lateral - station.medial;
    let nx = -dy;
    let ny = dx;
    if (ny * towardLateralY < 0) {
        nx = -nx;
        ny = -ny;
    }
    const nlen = Math.hypot(nx, ny) || 1;
    return {
        side,
        mpj1,
        mpj2,
        mid,
        dir: { x: dx, y: dy },
        lateral: { x: nx / nlen, y: ny / nlen },
        xFullMin: mpj1.x - FULL_HEIGHT_REACH_MM,
        xLine: mpj1.x - FULL_HEIGHT_LINE_MM,
        xBlendEnd: mpj1.x - FULL_HEIGHT_LINE_MM - BLEND_MM,
        xToe: LENGTH_MM - END_INSET_MM,
        xCorner: mpj1.x - FULL_HEIGHT_LINE_MM + END_INSET_MM,
    };
}

/** Point on the clinical line whose length coordinate is x. */
export function lineAtX(frame: ClinicalFrame, x: number): Xy & { s: number } {
    const s = (x - frame.mid.x) / frame.dir.x;
    return {
        x: frame.mid.x + frame.dir.x * s,
        y: frame.mid.y + frame.dir.y * s,
        s,
    };
}

/** Lateral offset (mm) of a point from the clinical line. Positive is lateral. */
export function lateralOffset(frame: ClinicalFrame, p: Xy): number {
    return (p.x - frame.mid.x) * frame.lateral.x + (p.y - frame.mid.y) * frame.lateral.y;
}
