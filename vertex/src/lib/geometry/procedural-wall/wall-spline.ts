// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { hybridBulgeAt, smoothstep01, WALL_H_SMOOTH_HI_MM, WALL_H_SMOOTH_LO_MM } from "./wall-style";

export interface XYZ {
    x: number;
    y: number;
    z: number;
}

export const SPLINE_DEGREE = 3;
export const SPLINE_KNOTS = [0, 0, 0, 0, 1 / 3, 2 / 3, 1, 1, 1, 1];
/** 5-point body polygon E, E+a tE, X, Q, B. */
export const SPLINE_KNOTS_5 = [0, 0, 0, 0, 0.5, 1, 1, 1, 1];
export const SPLINE_A_FRAC = 0.35;
/** a = max(SPLINE_A_FRAC × |EB|, this × r1). */
export const SPLINE_A_R1_MULT = 3;
export const SPLINE_C_FRAC = 0.5;
export const SPLINE_P1_O_FRAC = 0.9;
export const SPLINE_P1_Z_FRAC = 0.9;
/** β: 0.12 heel, 0.15 elsewhere, 0.18 arch/midfoot. */
export const SPLINE_BETA_HEEL = 0.12;
export const SPLINE_BETA_DEFAULT = 0.15;
export const SPLINE_BETA_ARCH = 0.18;
export const SPLINE_ZY_LO = 0.1;
/** zyHi = zx − this. */
export const SPLINE_ZY_GAP = 0.2;
/** zx = clamp(1 − this × o/H, SPLINE_ZX_LO, SPLINE_ZX_HI). */
export const SPLINE_ZX_O_COEF = 1.5;
export const SPLINE_ZX_LO = 0.55;
export const SPLINE_ZX_HI = 0.92;
/** Kept for call-sites that still pass a fixed zy ceiling. */
export const SPLINE_ZY_HI = 0.72;
export const SPLINE_ZX_MAX = 0.92;
export const SPLINE_ZX_GAP = 0.2;
export const SPLINE_O_FLOOR_FRAC = 0.08;
/** o_target = β k(H) H × this. */
export const SPLINE_O_TARGET_FRAC = 0.6;
/** Gate: o/H ∈ [this, SPLINE_O_H_HI] where H ≥ 6. */
export const SPLINE_O_H_LO = 0.07;
export const SPLINE_O_H_HI = 0.18;
export const SPLINE_W_EPS = 1e-9;
/** zy bisect target: z(min s) / H. */
export const SPLINE_PEAK_TARGET = 0.5;
export const SPLINE_PEAK_LO = 0.45;
export const SPLINE_PEAK_HI = 0.55;
export const SPLINE_PEAK_GATE_LO = 0.4;
export const SPLINE_PEAK_GATE_HI = 0.6;
/** Sagitta / |EB| where |EB| ≥ 6 mm. */
export const SPLINE_SAG_LO = 0.12;
export const SPLINE_SAG_HI = 0.22;
export const SPLINE_SAG_EB_MIN_MM = 6;
/** Never outboard of R. */
export const SPLINE_S_MIN_MM = -0.1;
/** [RND-FLAT] only where |EB| < this. */
export const SPLINE_FLAT_EB_MM = 2;
/** max/min |κ| on the middle 80% of the body arc. */
export const SPLINE_KAPPA_RATIO_MAX = 2;
export const SPLINE_KAPPA_MID_LO = 0.1;
export const SPLINE_KAPPA_MID_HI = 0.9;
/** Body-side κ near E ≥ this / r1, or 3 rows after E turn ≤ 4°. */
export const SPLINE_LIP_KAPPA_OVER_R1 = 0.1;
export const SPLINE_LIP_TURN_ROWS = 3;
export const SPLINE_WR_STEP_MAX = 0.05;
export const SPLINE_FACE_DOT_MIN = -0.2;
export const SPLINE_VOL_ERR_FRAC = 0.01;
export const SPLINE_H_MIN_MM = 6;
export const SPLINE_BISECT = 30;
export const SPLINE_DENSE = 512;
export const SPLINE_W_DENSE = 2048;
export const SPLINE_W_ALPHA = 0.75;
export const SPLINE_W_THETA_MIN_DEG = 1;
/** Fallback column count when a caller does not pass a computed N. */
export const SPLINE_N = 64;
/** Shared N cap for the turn-bounded sampler. */
export const SPLINE_N_MAX = 128;
/** ds_t = clamp(this × ρ, SPLINE_DS_FLOOR_MM, L/SPLINE_N_MIN_DIV). */
export const SPLINE_DS_TURN_RAD = 0.0611;
export const SPLINE_DS_FLOOR_MM = 0.04;
export const SPLINE_N_MIN_DIV = 24;
/** Absolute chord floor. Replaces 0.2 L/N. */
export const SPLINE_CHORD_MIN_MM = 0.03;
export const SPLINE_R_CAP = 4.5;
/** Report-only ρ_need = L / (r_cap N this). */
export const SPLINE_RHO_TURN_RAD = 0.0698;
export const SPLINE_RHO_O_SCALE = 0.65;
export const SPLINE_RHO_ARC_FRAC = 0.2;
export const SPLINE_R_FILL_ITERS = 20;
export const SPLINE_F_RING_MAX = 0.02;
export const SPLINE_MIN_EDGE_FRAC = 0.2;
export const SPLINE_FLAT_MM = 0.05;
/** Legacy H floor; FLAT is now |EB| < SPLINE_FLAT_EB_MM only. */
export const SPLINE_FLAT_H_MM = 3;
export const SPLINE_STEP_RATIO_MAX = 4;
export const SPLINE_ROW1_TR_MAX_DEG = 6;
/** This build: shape/sampling asserts log and continue. Final pass sets false. */
export const SPLINE_GATES_REPORT_ONLY = true;
export const SPLINE_ENDPOINT_EPS = 1e-9;
export const SPLINE_SMOOTH_SIGMA_MM = 10;
export const SPLINE_PLAN_OUT_MM = 2;
export const SPLINE_G1_R_MAX_DEG = 1;
export const SPLINE_SEAM_B_MAX_DEG = 6.05;
export const SPLINE_TURN_MAX_DEG = 4;
export const SPLINE_DIHEDRAL_MAX_DEG = 4;

export interface Sz {
    s: number;
    z: number;
}

export interface SplineStationInput {
    R: XYZ;
    B: XYZ;
    h: { x: number; y: number };
    tR: XYZ;
    u: number;
    sideSign: 1 | -1;
    planOutMm?: number;
    heightMm?: number;
    /** Top-round end. Synthesized from R + r1 if omitted (unit tests). */
    E?: XYZ;
    /** Body-start tangent at E (column plane). */
    tE?: XYZ;
    r1?: number;
    /** Override sag target (mm). Production uses β |EB|. */
    targetSagMm?: number;
}

export interface SplineSolve {
    pts: XYZ[];
    poly: XYZ[];
    o: number;
    zy: number;
    zx: number;
    a: number;
    c: number;
    g: number;
    beta: number;
    eb: number;
    sMin: number;
    kappaRatio: number;
    kappaE: number;
    r1: number;
    H: number;
    Ls: number;
    sagitta: number;
    sagFrac: number;
    peakZFrac: number;
    g1RDeg: number;
    seamBDeg: number;
    infl: boolean;
    inflCount: number;
    convex: boolean;
    insetMin: number;
    planOffset: number;
    maxTurnDeg: number;
    tRAngleDeg: number;
    oMax: number;
    oMin: number;
    rhoNeed: number;
    rhoMin: number;
    corner: boolean;
    peakClosest: boolean;
    steep: boolean;
    fallbackStraight: boolean;
}

export interface SplineGatePrint {
    u: number;
    side: 1 | -1;
    H: number;
    o: number;
    zy: number;
    zx: number;
    a: number;
    g: number;
    beta: number;
    eb: number;
    sMin: number;
    kappaRatio: number;
    sagitta: number;
    sagFrac: number;
    peakZFrac: number;
    g1RDeg: number;
    seamBDeg: number;
    infl: number;
    inflCount: number;
    convex: boolean;
    insetMin: number;
    planOffset: number;
    maxTurnDeg: number;
    tRAngleDeg: number;
    steep: boolean;
    fallbackStraight: boolean;
    pass: boolean;
    misses: string[];
}

function hypot2(s: number, z: number): number {
    return Math.hypot(s, z);
}

function add(a: XYZ, b: XYZ, k = 1): XYZ {
    return { x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k };
}

function sub(a: XYZ, b: XYZ): XYZ {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: XYZ, b: XYZ): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

function hypot3(a: XYZ): number {
    return Math.hypot(a.x, a.y, a.z);
}

function scale(a: XYZ, k: number): XYZ {
    return { x: a.x * k, y: a.y * k, z: a.z * k };
}

function unit(a: XYZ): XYZ {
    const l = hypot3(a) || 1;
    return { x: a.x / l, y: a.y / l, z: a.z / l };
}

function lerp(a: XYZ, b: XYZ, t: number): XYZ {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

function vecAngleDeg(a: XYZ, b: XYZ): number {
    const du = hypot3(a) || 1;
    const dv = hypot3(b) || 1;
    const c = Math.max(-1, Math.min(1, dot(a, b) / (du * dv)));
    return (Math.acos(c) * 180) / Math.PI;
}

function acuteDeg(a: XYZ, b: XYZ): number {
    const d = vecAngleDeg(a, b);
    return Math.min(d, 180 - d);
}

/** β: 0.12 heel, 0.18 arch/midfoot, 0.15 elsewhere. */
export function splineBetaAt(u: number): number {
    const heel = 1 - smoothstep01(0.05, 0.18, u);
    const arch = smoothstep01(0.22, 0.32, u) * (1 - smoothstep01(0.62, 0.75, u));
    return (
        SPLINE_BETA_DEFAULT +
        (SPLINE_BETA_HEEL - SPLINE_BETA_DEFAULT) * heel +
        (SPLINE_BETA_ARCH - SPLINE_BETA_DEFAULT) * arch
    );
}

export function splineKnotsFor(nPoints: number): number[] {
    return nPoints <= 5 ? SPLINE_KNOTS_5 : SPLINE_KNOTS;
}

/** k(H) = smoothstep(3, 12, H). */
export function splineHeightScale(heightMm: number): number {
    return smoothstep01(WALL_H_SMOOTH_LO_MM, WALL_H_SMOOTH_HI_MM, heightMm);
}

/** o_target = β(u) k(H) H × 0.6. */
export function splineOTarget(u: number, heightMm: number): number {
    return splineBetaAt(u) * splineHeightScale(heightMm) * heightMm * SPLINE_O_TARGET_FRAC;
}

export function projectToColumnPlane(v: XYZ, h: { x: number; y: number }): XYZ {
    const bx = -h.y;
    const by = h.x;
    const d = v.x * bx + v.y * by;
    return unit({ x: v.x - d * bx, y: v.y - d * by, z: v.z });
}

/** Incident-top tangent in the column plane, pointing over the edge (outward). */
export function overEdgeTangent(tR: XYZ, h: { x: number; y: number }): XYZ {
    let t = projectToColumnPlane(tR, h);
    if (t.x * h.x + t.y * h.y > 0) t = scale(t, -1);
    return t;
}

export function stationSzFrame(
    R: XYZ,
    B: XYZ,
    h: { x: number; y: number },
): {
    H: number;
    Ls: number;
    origin: XYZ;
    h: { x: number; y: number };
} {
    const hl = Math.hypot(h.x, h.y) || 1;
    const hu = { x: h.x / hl, y: h.y / hl };
    const Ls = (B.x - R.x) * hu.x + (B.y - R.y) * hu.y;
    const H = Math.max(R.z - B.z, 1e-6);
    return { H, Ls, origin: { x: R.x, y: R.y, z: B.z }, h: hu };
}

export function toSz(p: XYZ, origin: XYZ, h: { x: number; y: number }): Sz {
    return { s: (p.x - origin.x) * h.x + (p.y - origin.y) * h.y, z: p.z - origin.z };
}

export function fromSz(sz: Sz, origin: XYZ, h: { x: number; y: number }): XYZ {
    return { x: origin.x + h.x * sz.s, y: origin.y + h.y * sz.s, z: origin.z + sz.z };
}

function chordFrame(H: number, Ls: number): { C: Sz; n: Sz; tUp: Sz } {
    const C = { s: 0.5 * Ls, z: 0.5 * H };
    const tDown = { s: Ls, z: -H };
    const td = hypot2(tDown.s, tDown.z) || 1;
    const t = { s: tDown.s / td, z: tDown.z / td };
    const tUp = { s: -t.s, z: -t.z };
    // Outward is −s: pick the chord normal with negative s.
    let n = { s: -H, z: -Ls };
    const nl = hypot2(n.s, n.z) || 1;
    n = { s: n.s / nl, z: n.z / nl };
    if (n.s > 0) n = { s: -n.s, z: -n.z };
    return { C, n, tUp };
}

function clampNum(x: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, x));
}

/** zx = clamp(1 − 1.5 o/H, 0.55, 0.92). Independent of zy. */
export function splineZx(o: number, H: number): number {
    const h = Math.max(H, 1e-9);
    return clampNum(1 - SPLINE_ZX_O_COEF * (o / h), SPLINE_ZX_LO, SPLINE_ZX_HI);
}

/** Unit over-edge tR in the column (s, z) plane. */
export function tRInSz(tR: XYZ, h: { x: number; y: number }): Sz {
    const tOver = overEdgeTangent(tR, h);
    const s = tOver.x * h.x + tOver.y * h.y;
    const z = tOver.z;
    const l = hypot2(s, z) || 1;
    return { s: s / l, z: z / l };
}

/** tR angle below horizontal (deg). tan = |tR.z| / |tR.s|. */
export function tRAngleBelowHorizontalDeg(tSz: Sz): number {
    return (Math.atan2(Math.abs(tSz.z), Math.abs(tSz.s)) * 180) / Math.PI;
}

/** a = min(0.9 o/|tR.s|, 0.9 (1−zx) H/|tR.z|). */
export function splineA(o: number, zx: number, H: number, tSz: Sz): number {
    let a = Number.POSITIVE_INFINITY;
    if (Math.abs(tSz.s) > 1e-14) a = Math.min(a, (SPLINE_P1_O_FRAC * o) / Math.abs(tSz.s));
    if (Math.abs(tSz.z) > 1e-14) a = Math.min(a, (SPLINE_P1_Z_FRAC * (1 - zx) * H) / Math.abs(tSz.z));
    if (!Number.isFinite(a)) a = 0;
    return Math.max(0, a);
}

export function splineRhoNeed(L: number, n = SPLINE_N): number {
    return L / (SPLINE_R_CAP * n * SPLINE_RHO_TURN_RAD);
}

export function rhoFromSegment(dS: number, dTdeg: number): number {
    const dTrad = (dTdeg * Math.PI) / 180;
    if (dTrad < 1e-12 || dS < 1e-16) return Number.POSITIVE_INFINITY;
    return dS / dTrad;
}

export function dsTarget(rho: number, L: number): number {
    const hi = Math.max(L / SPLINE_N_MIN_DIV, SPLINE_DS_FLOOR_MM);
    const raw = Number.isFinite(rho) ? SPLINE_DS_TURN_RAD * rho : Number.POSITIVE_INFINITY;
    return clampNum(raw, SPLINE_DS_FLOOR_MM, hi);
}

export function stationSampleNeed(S: number[], T: number[]): { n: number; L: number; integral: number } {
    const nSeg = Math.max(1, S.length - 1);
    const L = S[nSeg] ?? 0;
    let integral = 0;
    for (let j = 1; j <= nSeg; j++) {
        const dS = (S[j] ?? 0) - (S[j - 1] ?? 0);
        const dT = (T[j] ?? 0) - (T[j - 1] ?? 0);
        integral += dS / Math.max(dsTarget(rhoFromSegment(dS, dT), L), 1e-16);
    }
    return { n: Math.max(1, Math.ceil(integral - 1e-12)), L, integral };
}

export function splineOMinFromL(L: number, n = SPLINE_N): number {
    return splineRhoNeed(L, n) / SPLINE_RHO_O_SCALE;
}

/** Min discrete radius of curvature on the leading `frac` of polyline arc. */
export function minRhoFirstArc(samples: XYZ[], frac = SPLINE_RHO_ARC_FRAC): number {
    if (samples.length < 3) return Number.POSITIVE_INFINITY;
    const ds: number[] = [0];
    for (let i = 1; i < samples.length; i++) ds.push(hypot3(sub(samples[i]!, samples[i - 1]!)));
    let L = 0;
    for (const d of ds) L += d;
    const cut = frac * Math.max(L, 1e-12);
    let s = 0;
    let minRho = Number.POSITIVE_INFINITY;
    for (let i = 1; i < samples.length - 1; i++) {
        s += ds[i]!;
        if (s > cut) break;
        const a = samples[i - 1]!;
        const b = samples[i]!;
        const c = samples[i + 1]!;
        const v1 = sub(b, a);
        const v2 = sub(c, b);
        const l1 = hypot3(v1);
        const l2 = hypot3(v2);
        if (l1 < 1e-12 || l2 < 1e-12) continue;
        const cos = Math.max(-1, Math.min(1, dot(v1, v2) / (l1 * l2)));
        const dth = Math.acos(cos);
        if (dth < 1e-8) continue;
        minRho = Math.min(minRho, (0.5 * (l1 + l2)) / dth);
    }
    return minRho;
}

export function minRhoFirstArcOfPoly(poly: XYZ[], frac = SPLINE_RHO_ARC_FRAC): number {
    return minRhoFirstArc(sampleSplineDense(poly), frac);
}

export function splineC(Ls: number, o: number): number {
    return 0.5 * (Ls + o);
}

export function splineOMax(zx: number, H: number, tSz: Sz, planOut: number): number {
    const tanAng = Math.abs(tSz.s) < 1e-14 ? Number.POSITIVE_INFINITY : Math.abs(tSz.z) / Math.abs(tSz.s);
    const geom =
        Number.isFinite(tanAng) && tanAng > 1e-14 ? ((1 - zx) * H) / tanAng : Number.POSITIVE_INFINITY;
    return Math.min(planOut, geom);
}

/** Synthesize a 90° top-round end when the caller has no sweep E. */
export function lipEndFromR(R: XYZ, h: { x: number; y: number }, r1: number): XYZ {
    const r = Math.max(r1, 1e-6);
    const hl = Math.hypot(h.x, h.y) || 1;
    return { x: R.x + (h.x / hl) * r, y: R.y + (h.y / hl) * r, z: R.z - r };
}

export function bodyTangentFromE(E: XYZ, B: XYZ, h: { x: number; y: number }, tE?: XYZ): XYZ {
    if (tE && hypot3(tE) > 1e-12) return projectToColumnPlane(tE, h);
    const hl = Math.hypot(h.x, h.y) || 1;
    return projectToColumnPlane({ x: (h.x / hl) * 0.2, y: (h.y / hl) * 0.2, z: -1 }, h);
}

/** Outward (−s) unit normal of chord AB in the column plane. */
export function chordOutwardNormalBetween(A: XYZ, B: XYZ, h: { x: number; y: number }, R: XYZ): XYZ {
    const fr = stationSzFrame(R, B, h);
    const a = toSz(A, fr.origin, fr.h);
    const b = toSz(B, fr.origin, fr.h);
    let ns = -(b.z - a.z);
    let nz = b.s - a.s;
    const nl = hypot2(ns, nz) || 1;
    ns /= nl;
    nz /= nl;
    if (ns > 0) {
        ns = -ns;
        nz = -nz;
    }
    return unit({ x: fr.h.x * ns, y: fr.h.y * ns, z: nz });
}

/**
 * Body polygon: E, E+a tE, X, Q, B.
 * Q = (Ls − c, 0), c = 0.5 Ls. X = mid(EB) + g n_out(EB).
 */
export function buildSplinePolygon(
    E: XYZ,
    B: XYZ,
    R: XYZ,
    h: { x: number; y: number },
    tE: XYZ,
    a: number,
    g: number,
    c: number,
): XYZ[] {
    const fr = stationSzFrame(R, B, h);
    const t = bodyTangentFromE(E, B, fr.h, tE);
    const n = chordOutwardNormalBetween(E, B, fr.h, R);
    const mid = lerp(E, B, 0.5);
    const qS = fr.Ls - c;
    return [E, add(E, t, a), add(mid, n, g), fromSz({ s: qS, z: 0 }, fr.origin, fr.h), { ...B }];
}

/** Clamped cubic B-spline. 6-pt knots [0,0,0,0,1/3,2/3,1…] or 5-pt [0,0,0,0,1/2,1…]. */
export function evalClampedCubic(
    points: XYZ[],
    t: number,
    knots: number[] = splineKnotsFor(points.length),
): XYZ {
    const n = points.length - 1;
    const p = SPLINE_DEGREE;
    const u = Math.max(0, Math.min(1, t));
    if (u <= knots[p]!) return { ...points[0]! };
    if (u >= knots[n + 1]!) return { ...points[n]! };
    let k = p;
    while (k < n + 1 && (knots[k + 1] ?? 1) <= u) k++;
    const d: XYZ[] = [];
    for (let j = 0; j <= p; j++) d.push({ ...points[k - p + j]! });
    for (let r = 1; r <= p; r++) {
        for (let j = p; j >= r; j--) {
            const i = k - p + j;
            const den = (knots[i + p + 1 - r] ?? 1) - (knots[i] ?? 0);
            const a = den > 1e-16 ? (u - (knots[i] ?? 0)) / den : 0;
            const prev = d[j - 1]!;
            const cur = d[j]!;
            d[j] = {
                x: (1 - a) * prev.x + a * cur.x,
                y: (1 - a) * prev.y + a * cur.y,
                z: (1 - a) * prev.z + a * cur.z,
            };
        }
    }
    return d[p]!;
}

export function splineTangent(
    points: XYZ[],
    t: number,
    knots: number[] = splineKnotsFor(points.length),
): XYZ {
    const e = 1e-4;
    const t0 = Math.max(0, Math.min(1, t));
    const a = evalClampedCubic(points, Math.max(0, t0 - e), knots);
    const b = evalClampedCubic(points, Math.min(1, t0 + e), knots);
    return unit(sub(b, a));
}

export function sampleSplineDense(points: XYZ[], n = SPLINE_DENSE): XYZ[] {
    const pts: XYZ[] = [];
    for (let i = 0; i <= n; i++) pts.push(evalClampedCubic(points, i / n));
    pts[0] = { ...points[0]! };
    pts[pts.length - 1] = { ...points[points.length - 1]! };
    return pts;
}

function signedChordOffset(p: XYZ, R: XYZ, B: XYZ, n: XYZ): number {
    const ab = sub(B, R);
    const len2 = dot(ab, ab);
    const t = len2 < 1e-16 ? 0 : dot(sub(p, R), ab) / len2;
    const q = add(R, ab, t);
    return dot(sub(p, q), n);
}

export function chordOutwardNormal(R: XYZ, B: XYZ, h: { x: number; y: number }): XYZ {
    const fr = stationSzFrame(R, B, h);
    const { n } = chordFrame(fr.H, fr.Ls);
    return unit({ x: fr.h.x * n.s, y: fr.h.y * n.s, z: n.z });
}

export function splineSagitta(
    samples: XYZ[],
    A: XYZ,
    B: XYZ,
    h: { x: number; y: number },
    R?: XYZ,
): {
    sag: number;
    peakZFrac: number;
} {
    const origin = R ?? A;
    const n = chordOutwardNormalBetween(A, B, h, origin);
    let sag = 0;
    for (const p of samples) {
        sag = Math.max(sag, signedChordOffset(p, A, B, n));
    }
    return { sag, peakZFrac: peakZFracAtMinS(samples, origin, B, h) };
}

export function minSOfSamples(samples: XYZ[], R: XYZ, B: XYZ, h: { x: number; y: number }): number {
    const fr = stationSzFrame(R, B, h);
    let minS = Number.POSITIVE_INFINITY;
    for (const p of samples) minS = Math.min(minS, toSz(p, fr.origin, fr.h).s);
    return Number.isFinite(minS) ? minS : 0;
}

/** Discrete |κ| samples along a polyline, with arc-length parameter in [0,1]. */
export function polylineAbsKappa(samples: XYZ[]): { s: number; k: number }[] {
    if (samples.length < 3) return [];
    const acc = [0];
    for (let i = 1; i < samples.length; i++)
        acc.push(acc[i - 1]! + hypot3(sub(samples[i]!, samples[i - 1]!)));
    const L = acc[acc.length - 1] ?? 0;
    const out: { s: number; k: number }[] = [];
    for (let i = 1; i < samples.length - 1; i++) {
        const v1 = sub(samples[i]!, samples[i - 1]!);
        const v2 = sub(samples[i + 1]!, samples[i]!);
        const l1 = hypot3(v1);
        const l2 = hypot3(v2);
        if (l1 < 1e-12 || l2 < 1e-12) continue;
        const cos = Math.max(-1, Math.min(1, dot(v1, v2) / (l1 * l2)));
        const dth = Math.acos(cos);
        const k = dth / Math.max(0.5 * (l1 + l2), 1e-12);
        out.push({ s: L > 1e-12 ? acc[i]! / L : 0, k });
    }
    return out;
}

export function midArcKappaRatio(samples: XYZ[], lo = SPLINE_KAPPA_MID_LO, hi = SPLINE_KAPPA_MID_HI): number {
    const ks = polylineAbsKappa(samples).filter((r) => r.s >= lo && r.s <= hi);
    if (ks.length < 2) return 1;
    let mn = Number.POSITIVE_INFINITY;
    let mx = 0;
    for (const r of ks) {
        if (r.k < 1e-5) continue;
        mn = Math.min(mn, r.k);
        mx = Math.max(mx, r.k);
    }
    if (!Number.isFinite(mn) || mn < 1e-8) return mx > 1e-8 ? Number.POSITIVE_INFINITY : 1;
    return mx / mn;
}

export function kappaNearStart(samples: XYZ[], frac = 0.08): number {
    const ks = polylineAbsKappa(samples).filter((r) => r.s <= frac);
    let mx = 0;
    for (const r of ks) mx = Math.max(mx, r.k);
    return mx;
}

/** Signed area between two (s,z) profiles that share endpoints. */
export function profileAreaBetween(
    round: XYZ[],
    straight: XYZ[],
    R: XYZ,
    B: XYZ,
    h: { x: number; y: number },
): number {
    const fr = stationSzFrame(R, B, h);
    const a = round.map((p) => toSz(p, fr.origin, fr.h));
    const b = straight.map((p) => toSz(p, fr.origin, fr.h));
    const ring = [...a, ...b.slice().reverse()];
    let area = 0;
    for (let i = 0; i < ring.length; i++) {
        const p = ring[i]!;
        const q = ring[(i + 1) % ring.length]!;
        area += p.s * q.z - q.s * p.z;
    }
    return 0.5 * area;
}

/** z of the most-outward sample (min s), as a fraction of H. */
export function peakZFracAtMinS(samples: XYZ[], R: XYZ, B: XYZ, h: { x: number; y: number }): number {
    const fr = stationSzFrame(R, B, h);
    const H = Math.max(fr.H, 1e-6);
    let minS = Number.POSITIVE_INFINITY;
    let zAt = 0.5 * H;
    for (const p of samples) {
        const sz = toSz(p, fr.origin, fr.h);
        if (sz.s <= minS) {
            minS = sz.s;
            zAt = sz.z;
        }
    }
    return zAt / H;
}

export function polygonConvex(poly: XYZ[], h: { x: number; y: number }): boolean {
    const fr = stationSzFrame(poly[0]!, poly[poly.length - 1]!, h);
    const sz = poly.map((p) => toSz(p, fr.origin, fr.h));
    let sign = 0;
    for (let i = 1; i < sz.length - 1; i++) {
        const a = sz[i - 1]!;
        const b = sz[i]!;
        const c = sz[i + 1]!;
        const cross = (b.s - a.s) * (c.z - b.z) - (b.z - a.z) * (c.s - b.s);
        if (Math.abs(cross) < 1e-12) continue;
        const s = cross > 0 ? 1 : -1;
        if (sign === 0) sign = s;
        else if (s !== sign) return false;
    }
    return sign !== 0 || sz.length < 3;
}

export function polylineInflCount(samples: XYZ[], R: XYZ, B: XYZ, h: { x: number; y: number }): number {
    const n = chordOutwardNormal(R, B, h);
    const ks: number[] = [];
    for (let i = 1; i < samples.length - 1; i++) {
        const a = samples[i - 1]!;
        const b = samples[i]!;
        const c = samples[i + 1]!;
        const d1 = sub(b, a);
        const d2 = sub(c, b);
        const cr = {
            x: d1.y * d2.z - d1.z * d2.y,
            y: d1.z * d2.x - d1.x * d2.z,
            z: d1.x * d2.y - d1.y * d2.x,
        };
        ks.push(dot(cr, n));
    }
    const maxAbs = Math.max(...ks.map((k) => Math.abs(k)), 0);
    const eps = Math.max(1e-10, 0.02 * maxAbs);
    let sign = 0;
    let flips = 0;
    for (const k of ks) {
        if (Math.abs(k) < eps) continue;
        const s = k > 0 ? 1 : -1;
        if (sign === 0) sign = s;
        else if (s !== sign) {
            flips++;
            sign = s;
        }
    }
    return flips;
}

export function polylineInfl(samples: XYZ[], R: XYZ, B: XYZ, h: { x: number; y: number }): boolean {
    return polylineInflCount(samples, R, B, h) > 0;
}

export function planBounds(
    samples: XYZ[],
    R: XYZ,
    B: XYZ,
    h: { x: number; y: number },
): {
    insetMin: number;
    offsetMax: number;
} {
    const out = { x: -h.x, y: -h.y };
    const ol = Math.hypot(out.x, out.y) || 1;
    const nx = out.x / ol;
    const ny = out.y / ol;
    const proj = (p: XYZ): number => p.x * nx + p.y * ny;
    const inner = Math.min(proj(R), proj(B));
    const outer = Math.max(proj(R), proj(B));
    let insetMin = Infinity;
    let offsetMax = -Infinity;
    for (const p of samples) {
        const s = proj(p);
        insetMin = Math.min(insetMin, s - inner);
        offsetMax = Math.max(offsetMax, s - outer);
    }
    return {
        insetMin: Number.isFinite(insetMin) ? insetMin : 0,
        offsetMax: Number.isFinite(offsetMax) ? offsetMax : 0,
    };
}

export function maxPolylineTurn(samples: XYZ[]): number {
    let max = 0;
    for (let i = 1; i < samples.length - 1; i++) {
        max = Math.max(max, acuteDeg(sub(samples[i]!, samples[i - 1]!), sub(samples[i + 1]!, samples[i]!)));
    }
    return max;
}

export function seamBDeg(samples: XYZ[]): number {
    if (samples.length < 3) return 0;
    const a = samples[samples.length - 2]!;
    const b = samples[samples.length - 1]!;
    const t = sub(b, a);
    return acuteDeg(t, { x: t.x, y: t.y, z: 0 });
}

export function g1AtR(poly: XYZ[], tR: XYZ, h: { x: number; y: number }): number {
    const tOver = overEdgeTangent(tR, h);
    const tan = sub(poly[1]!, poly[0]!);
    return acuteDeg(tan, tOver);
}

export function g1AtE(poly: XYZ[], tE: XYZ, h: { x: number; y: number }): number {
    return acuteDeg(sub(poly[1]!, poly[0]!), projectToColumnPlane(tE, h));
}

/** C'(0) ≈ C(1/2048) − C(0) from the dense table. */
export function denseCPrime0(poly: XYZ[], nDense = SPLINE_W_DENSE): XYZ {
    return sub(evalClampedCubic(poly, 1 / Math.max(1, nDense)), evalClampedCubic(poly, 0));
}

export function g1CPrime0Deg(poly: XYZ[], tR: XYZ, h: { x: number; y: number }): number {
    return acuteDeg(denseCPrime0(poly), overEdgeTangent(tR, h));
}

export function splineGateFail(tag: string, detail: Record<string, number | string | boolean>): void {
    console.log(tag, JSON.stringify(detail));
    if (!SPLINE_GATES_REPORT_ONLY) {
        throw new Error(`${tag} ${JSON.stringify(detail)}`);
    }
}

function sampleStraight(R: XYZ, B: XYZ, n: number): XYZ[] {
    const pts: XYZ[] = [];
    for (let i = 0; i <= n; i++) pts.push(lerp(R, B, i / Math.max(n, 1)));
    return pts;
}

function measureOf(poly: XYZ[], E: XYZ, B: XYZ, R: XYZ, h: { x: number; y: number }, tE: XYZ) {
    const dense = sampleSplineDense(poly);
    const sag = splineSagitta(dense, E, B, h, R);
    const plan = planBounds(dense, R, B, h);
    const inflCount = polylineInflCount(dense, E, B, h);
    return {
        dense,
        ...sag,
        ...plan,
        inflCount,
        infl: inflCount > 0,
        convex: inflCount === 0,
        g1RDeg: g1AtE(poly, tE, h),
        seamBDeg: seamBDeg(dense),
        maxTurnDeg: maxPolylineTurn(dense),
        sMin: minSOfSamples(dense, R, B, h),
        kappaRatio: midArcKappaRatio(dense),
        kappaE: kappaNearStart(dense),
    };
}

interface SplineSolveExtra {
    corner: boolean;
    oMin: number;
    rhoNeed: number;
    peakClosest?: boolean;
    g?: number;
    c?: number;
    beta?: number;
    eb?: number;
    r1?: number;
}

function stationEnds(input: SplineStationInput): { E: XYZ; tE: XYZ; r1: number } {
    const r1 = input.r1 ?? 0.5;
    const E = input.E ?? lipEndFromR(input.R, input.h, r1);
    const tE = bodyTangentFromE(E, input.B, input.h, input.tE);
    return { E, tE, r1 };
}

function finishSolve(
    input: SplineStationInput,
    poly: XYZ[],
    a: number,
    g: number,
    c: number,
    beta: number,
    fallback: boolean,
    extra: SplineSolveExtra,
): SplineSolve {
    const { R, B } = input;
    const { E, tE, r1 } = stationEnds(input);
    const fr = stationSzFrame(R, B, input.h);
    const H = input.heightMm ?? fr.H;
    const tSz = tRInSz(input.tR, fr.h);
    const tRAngleDeg = tRAngleBelowHorizontalDeg(tSz);
    const eb = extra.eb ?? hypot3(sub(B, E));
    const m = fallback
        ? {
              dense: sampleStraight(E, B, 16),
              sag: 0,
              peakZFrac: 0.5,
              insetMin: 0,
              offsetMax: 0,
              inflCount: 0,
              infl: false,
              convex: true,
              g1RDeg: 0,
              seamBDeg: 0,
              maxTurnDeg: 0,
              sMin: minSOfSamples([E, B], R, B, fr.h),
              kappaRatio: 1,
              kappaE: 0,
          }
        : measureOf(poly, E, B, R, fr.h, tE);
    const extraFields = {
        oMin: extra.oMin,
        rhoNeed: extra.rhoNeed,
        rhoMin: fallback ? Number.POSITIVE_INFINITY : minRhoFirstArc(m.dense),
        corner: extra.corner,
        peakClosest: extra.peakClosest ?? false,
    };
    return {
        pts: fallback ? sampleStraight(E, B, 16) : m.dense,
        poly: fallback ? [E, lerp(E, B, 0.25), lerp(E, B, 0.5), lerp(E, B, 0.75), B] : poly,
        o: 0,
        zy: 0,
        zx: 0,
        a: fallback ? 0 : a,
        c,
        g: fallback ? 0 : g,
        beta,
        eb,
        sMin: m.sMin,
        kappaRatio: m.kappaRatio,
        kappaE: m.kappaE,
        r1,
        H,
        Ls: fr.Ls,
        sagitta: m.sag,
        sagFrac: eb > 1e-9 ? m.sag / eb : 0,
        peakZFrac: m.peakZFrac,
        g1RDeg: m.g1RDeg,
        seamBDeg: m.seamBDeg,
        infl: m.infl,
        inflCount: m.inflCount,
        convex: m.convex,
        insetMin: m.insetMin,
        planOffset: m.offsetMax,
        maxTurnDeg: m.maxTurnDeg,
        tRAngleDeg,
        oMax: 0,
        steep: false,
        fallbackStraight: fallback,
        ...extraFields,
    };
}

/**
 * Body E→B: 5-point cubic. Bisect g for sag = β|EB|, clamp s ≥ −0.1,
 * then bisect a/c so mid-arc max/min κ ≤ 2.
 */
export function solveSplineStation(input: SplineStationInput): SplineSolve {
    const { R, B } = input;
    const { E, tE, r1 } = stationEnds(input);
    const fr = stationSzFrame(R, B, input.h);
    const eb = hypot3(sub(B, E));
    const beta = splineBetaAt(input.u);
    const extra: SplineSolveExtra = {
        corner: false,
        oMin: 0,
        rhoNeed: splineRhoNeed(eb),
        eb,
        r1,
        beta,
    };
    if (eb < SPLINE_FLAT_EB_MM) {
        return finishSolve(input, [E, B], 0, 0, SPLINE_C_FRAC * fr.Ls, beta, true, extra);
    }
    const c0 = SPLINE_C_FRAC * fr.Ls;
    const a0 = Math.max(SPLINE_A_FRAC * eb, SPLINE_A_R1_MULT * r1);
    const targetSag = input.targetSagMm ?? beta * eb;

    const at = (aa: number, gg: number, cc: number) => {
        const poly = buildSplinePolygon(E, B, R, fr.h, tE, Math.max(0, aa), gg, cc);
        return { poly, m: measureOf(poly, E, B, R, fr.h, tE) };
    };

    let a = a0;
    let g = 0;
    const sag0 = at(a, 0, c0).m.sag;
    if (sag0 < targetSag) {
        let gLo = 0;
        let gHi = Math.max(eb, 1e-3);
        for (let i = 0; i < SPLINE_BISECT; i++) {
            g = 0.5 * (gLo + gHi);
            if (at(a, g, c0).m.sag < targetSag) gLo = g;
            else gHi = g;
        }
        g = 0.5 * (gLo + gHi);
    } else {
        let aLo = 0.25 * a0;
        let aHi = a0;
        for (let i = 0; i < SPLINE_BISECT; i++) {
            a = 0.5 * (aLo + aHi);
            if (at(a, 0, c0).m.sag > targetSag) aHi = a;
            else aLo = a;
        }
        a = 0.5 * (aLo + aHi);
        g = 0;
    }
    for (let i = 0; i < 16; i++) {
        const { m } = at(a, g, c0);
        if (m.sMin >= SPLINE_S_MIN_MM - 1e-9) break;
        if (g > 1e-4) g *= 0.85;
        else a *= 0.9;
    }

    let best = at(a, g, c0);
    let bestRatio = best.m.kappaRatio;
    let aLo = Math.max(0.35 * a0, 1.2 * r1);
    let aHi = Math.max(aLo * 1.01, 2.2 * a0);
    for (let i = 0; i < SPLINE_BISECT; i++) {
        const mid = 0.5 * (aLo + aHi);
        const trial = at(mid, g, c0);
        if (trial.m.kappaRatio < bestRatio && trial.m.sMin >= SPLINE_S_MIN_MM - 1e-6) {
            bestRatio = trial.m.kappaRatio;
            best = trial;
            a = mid;
        }
        const left = at(0.5 * (aLo + mid), g, c0);
        const right = at(0.5 * (mid + aHi), g, c0);
        if (left.m.kappaRatio < right.m.kappaRatio) aHi = mid;
        else aLo = mid;
    }
    if (best.m.sMin < SPLINE_S_MIN_MM - 1e-9) {
        for (let i = 0; i < 12 && best.m.sMin < SPLINE_S_MIN_MM - 1e-9; i++) {
            if (g > 1e-4) g *= 0.85;
            else a *= 0.9;
            best = at(a, g, c0);
        }
    }
    return finishSolve(input, best.poly, a, g, c0, beta, false, extra);
}

/** Rebuild a station from ring-smoothed g, a. c stays 0.5 Ls. */
export function rebuildSplineStation(
    input: SplineStationInput,
    g: number,
    _zy: number,
    a: number,
    extra?: Partial<SplineSolveExtra>,
): SplineSolve {
    const { R, B } = input;
    const { E, tE, r1 } = stationEnds(input);
    const fr = stationSzFrame(R, B, input.h);
    const eb = extra?.eb ?? hypot3(sub(B, E));
    const beta = extra?.beta ?? splineBetaAt(input.u);
    const c = extra?.c ?? SPLINE_C_FRAC * fr.Ls;
    const extraUse: SplineSolveExtra = {
        corner: false,
        oMin: extra?.oMin ?? 0,
        rhoNeed: extra?.rhoNeed ?? splineRhoNeed(eb),
        peakClosest: extra?.peakClosest ?? false,
        g,
        c,
        beta,
        eb,
        r1,
    };
    if (eb < SPLINE_FLAT_EB_MM) {
        return finishSolve(input, [E, B], 0, 0, c, beta, true, extraUse);
    }
    const poly = buildSplinePolygon(E, B, R, fr.h, tE, Math.max(0, a), Math.max(0, g), c);
    let use = poly;
    let gg = Math.max(0, g);
    for (let i = 0; i < 12; i++) {
        const m = measureOf(use, E, B, R, fr.h, tE);
        if (m.sMin >= SPLINE_S_MIN_MM - 1e-9) break;
        gg *= 0.85;
        use = buildSplinePolygon(E, B, R, fr.h, tE, Math.max(0, a), gg, c);
    }
    return finishSolve(input, use, Math.max(0, a), gg, c, beta, false, extraUse);
}

export interface SplineDensityTable {
    u: number[];
    S: number[];
    T: number[];
    W: number[];
    L: number;
    Theta: number;
    alpha?: number;
    maxR?: number;
    fillPasses?: number;
    nNeed?: number;
    N?: number;
}

/**
 * Turn-bounded density: ds_t = clamp(0.0611 ρ, 0.04, L/24),
 * q = 1/ds_t + (N − n_i)/L, W = normalized ∫ q ds.
 */
function finishTurnDensity(
    u: number[],
    S: number[],
    T: number[],
    N: number,
    nNeed: number,
): SplineDensityTable {
    const nSeg = Math.max(1, S.length - 1);
    const L = S[nSeg] ?? 0;
    const Theta = T[nSeg] ?? 0;
    const pad = L > 1e-16 ? (N - nNeed) / L : 0;
    const W = [0];
    let Z = 0;
    const add: number[] = [];
    for (let j = 1; j <= nSeg; j++) {
        const dS = (S[j] ?? 0) - (S[j - 1] ?? 0);
        const dT = (T[j] ?? 0) - (T[j - 1] ?? 0);
        const q = 1 / Math.max(dsTarget(rhoFromSegment(dS, dT), L), 1e-16) + pad;
        const inc = q * dS;
        add.push(inc);
        Z += inc;
    }
    for (let j = 1; j <= nSeg; j++) {
        W.push((W[j - 1] ?? 0) + (Z > 1e-16 ? (add[j - 1] ?? 0) / Z : 1 / nSeg));
    }
    W[0] = 0;
    if (W.length) W[W.length - 1] = 1;
    return { u, S, T, W, L, Theta, alpha: 0, maxR: 0, fillPasses: 0, nNeed, N };
}

export function curveSTFromCubic(
    poly: XYZ[],
    nDense = SPLINE_W_DENSE,
): { u: number[]; S: number[]; T: number[] } {
    const n = Math.max(1, nDense);
    const u: number[] = [];
    const pts: XYZ[] = [];
    for (let i = 0; i <= n; i++) {
        const ui = i / n;
        u.push(ui);
        pts.push(evalClampedCubic(poly, ui));
    }
    const S = [0];
    for (let i = 1; i <= n; i++) S.push(S[i - 1]! + hypot3(sub(pts[i]!, pts[i - 1]!)));
    const T = [0];
    let prev = splineTangent(poly, 0);
    for (let i = 1; i <= n; i++) {
        const tan = splineTangent(poly, i / n);
        T.push(T[i - 1]! + vecAngleDeg(prev, tan));
        prev = tan;
    }
    return { u, S, T };
}

export function curveSTFromPolyline(
    col: XYZ[],
    nDense = SPLINE_W_DENSE,
): { u: number[]; S: number[]; T: number[] } {
    const dense = densifyPolyline(col, nDense);
    const n = Math.max(1, dense.length - 1);
    const u = dense.map((_, i) => i / n);
    const S = [0];
    for (let i = 1; i <= n; i++) S.push(S[i - 1]! + hypot3(sub(dense[i]!, dense[i - 1]!)));
    const T = [0];
    let prev = sub(dense[1] ?? dense[0]!, dense[0]!);
    for (let i = 1; i <= n; i++) {
        const tan = i < n ? sub(dense[i + 1]!, dense[i]!) : sub(dense[i]!, dense[i - 1]!);
        T.push(T[i - 1]! + vecAngleDeg(prev, tan));
        prev = tan;
    }
    return { u, S, T };
}

function tableFromST(st: { u: number[]; S: number[]; T: number[] }, N?: number): SplineDensityTable {
    const need = stationSampleNeed(st.S, st.T);
    const nUse = Math.min(need.n, SPLINE_N_MAX);
    const nShared = Math.max(1, Math.min(SPLINE_N_MAX, N ?? nUse));
    return finishTurnDensity(st.u, st.S, st.T, nShared, need.n);
}

/** 2048-point S, T on the cubic; turn-bounded W. */
export function buildSplineDensityTable(
    poly: XYZ[],
    nDense = SPLINE_W_DENSE,
    N?: number,
): SplineDensityTable {
    return tableFromST(curveSTFromCubic(poly, nDense), N);
}

/** Densify a polyline by arc length, then the same turn-bounded W table. */
export function buildPolylineDensityTable(
    col: XYZ[],
    nDense = SPLINE_W_DENSE,
    N?: number,
): SplineDensityTable {
    return tableFromST(curveSTFromPolyline(col, nDense), N);
}

export function densifyPolyline(col: XYZ[], nDense = SPLINE_W_DENSE): XYZ[] {
    if (col.length < 2) return col.map((p) => ({ ...p }));
    const acc = [0];
    for (let i = 1; i < col.length; i++) acc.push(acc[i - 1]! + hypot3(sub(col[i]!, col[i - 1]!)));
    const L = acc[acc.length - 1] ?? 0;
    const n = Math.max(1, nDense);
    const out: XYZ[] = [];
    for (let k = 0; k <= n; k++) {
        const target = L > 1e-16 ? (k / n) * L : 0;
        let i = 1;
        while (i < acc.length && (acc[i] ?? 0) < target) i++;
        const a = acc[i - 1] ?? 0;
        const b = acc[i] ?? a;
        const t = b > a ? (target - a) / (b - a) : 0;
        const p0 = col[i - 1] ?? col[0]!;
        const p1 = col[i] ?? p0;
        out.push(lerp(p0, p1, t));
    }
    out[0] = { ...col[0]! };
    out[n] = { ...col[col.length - 1]! };
    return out;
}

export function evalDensePolyline(dense: XYZ[], u: number): XYZ {
    if (!dense.length) return { x: 0, y: 0, z: 0 };
    if (dense.length === 1 || u <= 0) return { ...dense[0]! };
    if (u >= 1) return { ...dense[dense.length - 1]! };
    const n = dense.length - 1;
    const x = u * n;
    const i = Math.max(0, Math.min(n - 1, Math.floor(x)));
    return lerp(dense[i]!, dense[i + 1] ?? dense[i]!, x - i);
}

/**
 * Binary-search W and lerp u between the bracketing samples.
 * Never u = f or u = k/N.
 */
export function invertDensityW(table: SplineDensityTable, f: number): number {
    const target = Math.max(0, Math.min(1, f));
    if (target <= 0) return 0;
    if (target >= 1) return 1;
    const W = table.W;
    let lo = 0;
    let hi = W.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if ((W[mid] ?? 0) < target) lo = mid + 1;
        else hi = mid;
    }
    const i = Math.max(1, lo);
    const a = W[i - 1]!;
    const b = W[i] ?? a;
    const t = b > a ? (target - a) / (b - a) : 0;
    const u0 = table.u[i - 1]!;
    const u1 = table.u[i] ?? u0;
    return u0 + (u1 - u0) * t;
}

export function controlPointsSpaced(poly: XYZ[], minMm = SPLINE_FLAT_MM): boolean {
    for (let i = 1; i < poly.length; i++) {
        if (hypot3(sub(poly[i]!, poly[i - 1]!)) < minMm) return false;
    }
    return true;
}

export function columnChordsOk(pts: XYZ[], _L?: number, _N?: number): boolean {
    for (let k = 1; k < pts.length; k++) {
        if (hypot3(sub(pts[k]!, pts[k - 1]!)) + 1e-15 < SPLINE_CHORD_MIN_MM) return false;
    }
    return true;
}

/** Hard stop on chords shorter than 0.03 mm. */
export function assertInversionOk(pts: XYZ[], L: number, N: number, i: number): void {
    const need = SPLINE_CHORD_MIN_MM;
    for (let k = 1; k < pts.length; k++) {
        const e = hypot3(sub(pts[k]!, pts[k - 1]!));
        if (e + 1e-15 < need) {
            throw new Error(`[RND-INV] ${JSON.stringify({ i, k, chord: e, need, L, N })}`);
        }
    }
}

/** Max |ROUND − STRAIGHT| at the same row index, as a fraction of H. */
export function bulgeVsStraightFrac(round: XYZ[], straight: XYZ[], H: number): number {
    const n = Math.min(round.length, straight.length);
    let max = 0;
    for (let k = 1; k < n - 1; k++) {
        max = Math.max(max, hypot3(sub(round[k]!, straight[k]!)));
    }
    return max / Math.max(H, 1e-6);
}

/** Pin endpoints only. No f-space gap rule. */
export function enforceMonotoneF(f: number[], _N: number): number[] {
    const out = f.slice();
    if (!out.length) return out;
    out[0] = 0;
    out[out.length - 1] = 1;
    return out;
}

/** Interior turning (deg) at each row k = 1 … n-1. */
export function columnRowTurns(pts: XYZ[]): number[] {
    const turns: number[] = [];
    for (let k = 1; k < pts.length - 1; k++) {
        turns.push(acuteDeg(sub(pts[k]!, pts[k - 1]!), sub(pts[k + 1]!, pts[k]!)));
    }
    return turns;
}

export function assertSplineEndpoints(poly: XYZ[], R: XYZ, B: XYZ): void {
    const C0 = evalClampedCubic(poly, 0);
    const C1 = evalClampedCubic(poly, 1);
    const d0 = hypot3(sub(C0, R));
    const d1 = hypot3(sub(C1, B));
    if (d0 >= SPLINE_ENDPOINT_EPS || d1 >= SPLINE_ENDPOINT_EPS) {
        throw new Error(`[RND-END] |C(0)-R|=${d0.toExponential(3)} |C(1)-B|=${d1.toExponential(3)}`);
    }
}

export function row1TRAngleDeg(row1: XYZ, R: XYZ, tR: XYZ, h: { x: number; y: number }): number {
    return acuteDeg(sub(row1, R), overEdgeTangent(tR, h));
}

/** f_k = k/N, Gaussian-smoothed along the rim. Shared by ROUND and STRAIGHT W. */
export function ringFValues(nS: number, N: number, rim: XYZ[]): number[][] {
    const denom = Math.max(N, 1);
    const f: number[][] = [];
    for (let i = 0; i < nS; i++) {
        const row: number[] = [];
        for (let k = 0; k <= N; k++) row.push(k / denom);
        f.push(row);
    }
    if (nS < 1) return f;
    const arc: number[] = [0];
    for (let i = 1; i < nS; i++) {
        const a = rim[i - 1] ?? rim[0]!;
        const b = rim[i] ?? a;
        arc.push(arc[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
    }
    let period = arc[nS - 1] ?? 0;
    if (nS > 1) {
        const a = rim[0]!;
        const b = rim[nS - 1]!;
        period += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    }
    for (let k = 1; k < N; k++) {
        const vals = f.map((row) => row[k]!);
        const sm = periodicGaussian1d(vals, arc, SPLINE_SMOOTH_SIGMA_MM, period);
        for (let i = 0; i < nS; i++) f[i]![k] = sm[i]!;
    }
    for (let i = 0; i < nS; i++) f[i] = enforceMonotoneF(f[i]!, N);
    return f;
}

/**
 * Shared N. Smooth f_k = k/N along the rim (no f-gap). Invert each W(u).
 * Rows 0 and N are C(0)=R and C(1)=B.
 */
export function sampleSplineRingByW(
    polys: XYZ[][],
    N: number,
    rim: XYZ[],
    active?: boolean[],
    fIn?: number[][],
): { pts: XYZ[][]; f: number[][]; u: number[][]; L: number[]; Theta: number[] } {
    const nS = polys.length;
    const tables = polys.map((p, i) => {
        if (active && !active[i]) {
            return {
                u: [0, 1],
                S: [0, 1],
                T: [0, 0],
                W: [0, 1],
                L: 1,
                Theta: 0,
                alpha: 0,
                maxR: 1,
                fillPasses: 0,
            };
        }
        return buildSplineDensityTable(p, SPLINE_W_DENSE, N);
    });
    const f = fIn ?? ringFValues(nS, N, rim);
    const u: number[][] = [];
    const pts: XYZ[][] = [];
    const L: number[] = [];
    const Theta: number[] = [];
    for (let i = 0; i < nS; i++) {
        const fk =
            f[i] ??
            enforceMonotoneF(
                Array.from({ length: N + 1 }, (_, k) => k / Math.max(N, 1)),
                N,
            );
        f[i] = fk;
        const ui: number[] = [];
        const pi: XYZ[] = [];
        const poly = polys[i]!;
        const table = tables[i]!;
        const skip = Boolean(active && !active[i]);
        for (let k = 0; k <= N; k++) {
            if (k === 0) {
                ui.push(0);
                pi.push({ ...poly[0]! });
            } else if (k === N) {
                ui.push(1);
                pi.push({ ...poly[poly.length - 1]! });
            } else if (skip) {
                ui.push(fk[k]!);
                pi.push({ ...poly[0]! });
            } else {
                const uk = invertDensityW(table, fk[k]!);
                ui.push(uk);
                pi.push(evalClampedCubic(poly, uk));
            }
        }
        u.push(ui);
        pts.push(pi);
        L.push(table.L);
        Theta.push(table.Theta);
    }
    return { pts, f, u, L, Theta };
}

/** Same shared-N turn-bounded W as the cubic sampler, on STRAIGHT polylines. */
export function samplePolylinesByW(cols: XYZ[][], N: number, f: number[][]): { pts: XYZ[][]; L: number[] } {
    const nS = cols.length;
    const pts: XYZ[][] = [];
    const L: number[] = [];
    for (let i = 0; i < nS; i++) {
        const col = cols[i] ?? [];
        const dense = densifyPolyline(col, SPLINE_W_DENSE);
        const table = buildPolylineDensityTable(col, SPLINE_W_DENSE, N);
        const fk =
            f[i] ??
            enforceMonotoneF(
                Array.from({ length: N + 1 }, (_, k) => k / Math.max(N, 1)),
                N,
            );
        const pi: XYZ[] = [];
        for (let k = 0; k <= N; k++) {
            if (k === 0) pi.push({ ...(col[0] ?? dense[0]!) });
            else if (k === N) pi.push({ ...(col[col.length - 1] ?? dense[dense.length - 1]!) });
            else pi.push(evalDensePolyline(dense, invertDensityW(table, fk[k]!)));
        }
        pts.push(pi);
        L.push(table.L);
    }
    return { pts, L };
}

export function splineTurningTValues(poly: XYZ[], n: number): number[] {
    if (n < 2) return [0, 1];
    const steps = SPLINE_DENSE;
    const acc = [0];
    let prev = splineTangent(poly, 0);
    for (let i = 1; i <= steps; i++) {
        const tan = splineTangent(poly, i / steps);
        acc.push(acc[i - 1]! + vecAngleDeg(prev, tan));
        prev = tan;
    }
    const total = acc[steps]!;
    const ts: number[] = [0];
    if (total < 1e-8) {
        for (let k = 1; k < n; k++) ts.push(k / (n - 1));
        ts[ts.length - 1] = 1;
        return ts;
    }
    for (let k = 1; k < n; k++) {
        const target = (k / (n - 1)) * total;
        let i = 1;
        while (i < acc.length && acc[i]! < target) i++;
        const a = acc[i - 1]!;
        const b = acc[i] ?? a;
        const u = b > a + 1e-12 ? (target - a) / (b - a) : 0;
        ts.push(k === n - 1 ? 1 : (i - 1) / steps + (1 / steps) * u);
    }
    ts[0] = 0;
    ts[ts.length - 1] = 1;
    return ts;
}

export function sampleSplineAtT(poly: XYZ[], ts: number[]): XYZ[] {
    return ts.map((t, i) => {
        if (i === 0) return { ...poly[0]! };
        if (i === ts.length - 1) return { ...poly[poly.length - 1]! };
        return evalClampedCubic(poly, t);
    });
}

export function periodicGaussian1d(
    vals: number[],
    arc: number[],
    sigma = SPLINE_SMOOTH_SIGMA_MM,
    periodOpt?: number,
): number[] {
    const n = vals.length;
    if (n < 3) return vals.slice();
    const period = periodOpt ?? arc[arc.length - 1] ?? 1;
    const sig = Math.max(1e-3, sigma);
    return vals.map((_, i) => {
        let s = 0;
        let w = 0;
        const ci = arc[i]!;
        for (let j = 0; j < n; j++) {
            let d = Math.abs(arc[j]! - ci);
            d = Math.min(d, Math.max(period - d, 0));
            const wt = Math.exp((-0.5 * d * d) / (sig * sig));
            s += wt * vals[j]!;
            w += wt;
        }
        return w > 0 ? s / w : vals[i]!;
    });
}

/** Keep 0 = t0 < t1 < … < t{n-1} = 1 after ring smoothing. */
export function monotoneTurningRows(rows: number[][]): number[][] {
    const nS = rows.length;
    const nR = rows[0]?.length ?? 0;
    const out = rows.map((r) => r.slice());
    for (let i = 0; i < nS; i++) {
        const t = out[i]!;
        if (!t.length) continue;
        t[0] = 0;
        t[t.length - 1] = 1;
        for (let j = 1; j < nR - 1; j++) {
            const lo = t[j - 1]! + 1e-6;
            const hi = 1 - 1e-6 * (nR - 1 - j);
            t[j] = Math.max(lo, Math.min(hi, t[j]!));
        }
        t[t.length - 1] = 1;
    }
    return out;
}

export function stationGates(s: SplineSolve, u: number, side: 1 | -1): SplineGatePrint {
    const misses: string[] = [];
    if (s.infl) misses.push("[RND-INFL]");
    if (s.fallbackStraight) misses.push("[RND-POLY]");
    if (!s.convex) misses.push("not-convex");
    if (s.inflCount > 0) misses.push(`sign-changes ${s.inflCount}`);
    if (s.sMin < SPLINE_S_MIN_MM - 1e-9) misses.push(`sMin ${s.sMin.toFixed(3)}`);
    if (s.eb >= SPLINE_SAG_EB_MIN_MM && !s.fallbackStraight) {
        if (s.sagFrac + 1e-9 < SPLINE_SAG_LO || s.sagFrac - 1e-9 > SPLINE_SAG_HI) {
            misses.push(`sag ${s.sagFrac.toFixed(3)}`);
        }
    }
    if (s.g1RDeg > SPLINE_G1_R_MAX_DEG + 1e-6) misses.push(`G1-E ${s.g1RDeg.toFixed(3)}`);
    if (s.seamBDeg > SPLINE_SEAM_B_MAX_DEG + 1e-6) misses.push(`seam-B ${s.seamBDeg.toFixed(3)}`);
    if (s.maxTurnDeg > SPLINE_TURN_MAX_DEG + 1e-6) misses.push(`turn ${s.maxTurnDeg.toFixed(3)}`);
    if (s.kappaRatio > SPLINE_KAPPA_RATIO_MAX + 1e-6) {
        misses.push(`kappa-ratio ${s.kappaRatio.toFixed(2)}`);
    }
    const lipNeed = SPLINE_LIP_KAPPA_OVER_R1 / Math.max(s.r1, 1e-6);
    if (!s.fallbackStraight && s.kappaE + 1e-9 < lipNeed) {
        misses.push(`lip-kappa ${s.kappaE.toFixed(3)}<${lipNeed.toFixed(3)}`);
    }
    return {
        u,
        side,
        H: s.H,
        o: s.o,
        zy: s.zy,
        zx: s.zx,
        a: s.a,
        g: s.g,
        beta: s.beta,
        eb: s.eb,
        sMin: s.sMin,
        kappaRatio: s.kappaRatio,
        sagitta: s.sagitta,
        sagFrac: s.sagFrac,
        peakZFrac: s.peakZFrac,
        g1RDeg: s.g1RDeg,
        seamBDeg: s.seamBDeg,
        infl: s.infl ? 1 : 0,
        inflCount: s.inflCount,
        convex: s.convex,
        insetMin: s.insetMin,
        planOffset: s.planOffset,
        maxTurnDeg: s.maxTurnDeg,
        tRAngleDeg: s.tRAngleDeg,
        steep: s.steep,
        fallbackStraight: s.fallbackStraight,
        pass: misses.length === 0,
        misses,
    };
}

export function printSplineGates(g: SplineGatePrint): void {
    console.log("[RND-STATION]", JSON.stringify(g));
}

export function hybridWeightAt(u: number, sideSign: 1 | -1, lengthMm: number, forefootRound = true): number {
    return hybridBulgeAt(u, sideSign, lengthMm, 1, forefootRound);
}

export function blendColumns(straight: XYZ[], round: XYZ[], w: number): XYZ[] {
    const n = Math.min(straight.length, round.length);
    const out: XYZ[] = [];
    for (let i = 0; i < n; i++) out.push(lerp(straight[i]!, round[i]!, w));
    if (out.length) {
        out[0] = { ...straight[0]! };
        out[out.length - 1] = { ...straight[straight.length - 1]! };
    }
    return out;
}

/** Lerp in the column (s, z) plane, then pin endpoints. */
export function blendColumnsSz(
    straight: XYZ[],
    round: XYZ[],
    w: number,
    R: XYZ,
    B: XYZ,
    h: { x: number; y: number },
): XYZ[] {
    const fr = stationSzFrame(R, B, h);
    const n = Math.min(straight.length, round.length);
    const out: XYZ[] = [];
    for (let i = 0; i < n; i++) {
        const a = toSz(straight[i]!, fr.origin, fr.h);
        const b = toSz(round[i]!, fr.origin, fr.h);
        out.push(fromSz({ s: a.s + (b.s - a.s) * w, z: a.z + (b.z - a.z) * w }, fr.origin, fr.h));
    }
    if (out.length) {
        out[0] = { ...straight[0]! };
        out[out.length - 1] = { ...straight[straight.length - 1]! };
    }
    return out;
}

export function maxClosedStep(vals: number[]): number {
    let max = 0;
    const n = vals.length;
    if (n < 2) return 0;
    for (let i = 0; i < n; i++) {
        max = Math.max(max, Math.abs((vals[i] ?? 0) - (vals[(i + 1) % n] ?? 0)));
    }
    return max;
}

/** Widen a closed 0–1 ramp until neighbouring steps are ≤ maxStep. */
export function widenClosedRamp(
    raw: number[],
    arc: number[],
    period: number,
    maxStep = SPLINE_WR_STEP_MAX,
    sigma0 = SPLINE_SMOOTH_SIGMA_MM,
): number[] {
    let sigma = Math.max(1e-3, sigma0);
    let out = periodicGaussian1d(raw, arc, sigma, period);
    for (let iter = 0; iter < 14 && maxClosedStep(out) > maxStep + 1e-9; iter++) {
        sigma *= 1.45;
        out = periodicGaussian1d(raw, arc, sigma, period);
    }
    for (let pass = 0; pass < 48 && maxClosedStep(out) > maxStep + 1e-9; pass++) {
        const n = out.length;
        const next = out.slice();
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const d = (next[j] ?? 0) - (next[i] ?? 0);
            if (Math.abs(d) <= maxStep + 1e-9) continue;
            const mid = 0.5 * ((next[i] ?? 0) + (next[j] ?? 0));
            const half = 0.5 * maxStep * Math.sign(d || 1);
            next[i] = mid - half;
            next[j] = mid + half;
        }
        out = next;
    }
    return out.map((v) => clampNum(v, 0, 1));
}

export function columnZMonotone(col: XYZ[], slopMm = 0.05): boolean {
    for (let k = 1; k < col.length; k++) {
        if ((col[k]!.z ?? 0) > (col[k - 1]!.z ?? 0) + slopMm) return false;
    }
    return true;
}

export function cross3(a: XYZ, b: XYZ): XYZ {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    };
}

/** Signed area of (a,c,b)+(a,d,c) on the wall plane (normal = outward). */
export function quadSignedOnWall(a: XYZ, b: XYZ, c: XYZ, d: XYZ, outward: XYZ): number {
    const ac = sub(c, a);
    const n1 = cross3(ac, sub(b, a));
    const n2 = cross3(sub(d, a), ac);
    return 0.5 * (dot(n1, outward) + dot(n2, outward));
}

export function wallRowOutward(h: { x: number; y: number }, tRow: XYZ): XYZ {
    const hl = Math.hypot(h.x, h.y) || 1;
    const hx = h.x / hl;
    const hy = h.y / hl;
    const ts = tRow.x * hx + tRow.y * hy;
    const tz = tRow.z;
    let out = { x: -hx * tz, y: -hy * tz, z: ts };
    const plan = out.x * -hx + out.y * -hy;
    if (plan < 0) out = scale(out, -1);
    return unit(out);
}

export function quadSignedAreaSz(a: XYZ, b: XYZ, c: XYZ, d: XYZ, h: { x: number; y: number }): number {
    const hl = Math.hypot(h.x, h.y) || 1;
    const hx = h.x / hl;
    const hy = h.y / hl;
    const sz = (p: XYZ): Sz => ({ s: p.x * hx + p.y * hy, z: p.z });
    const A = sz(a);
    const B = sz(b);
    const C = sz(c);
    const D = sz(d);
    const tri = (p: Sz, q: Sz, r: Sz): number => (q.s - p.s) * (r.z - p.z) - (q.z - p.z) * (r.s - p.s);
    return 0.5 * (tri(A, C, B) + tri(A, D, C));
}

export function columnConvex(samples: XYZ[], h: { x: number; y: number }): boolean {
    return polygonConvex(samples, h);
}

/** Smooth g, a on the closed rim (σ = 10 mm) and rebuild each station. */
export function applySplineRing(inputs: SplineStationInput[]): SplineSolve[] {
    const solved = inputs.map((inp) => solveSplineStation(inp));
    const n = solved.length;
    if (n === 0) return solved;
    const rim: number[] = [0];
    for (let i = 1; i < n; i++) {
        const a = inputs[i - 1]!.R;
        const b = inputs[i]!.R;
        rim.push(rim[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
    }
    const period =
        (rim[n - 1] ?? 0) +
        Math.hypot(inputs[0]!.R.x - inputs[n - 1]!.R.x, inputs[0]!.R.y - inputs[n - 1]!.R.y);
    const gSm = periodicGaussian1d(
        solved.map((s) => s.g),
        rim,
        SPLINE_SMOOTH_SIGMA_MM,
        period,
    );
    const aSm = periodicGaussian1d(
        solved.map((s) => s.a),
        rim,
        SPLINE_SMOOTH_SIGMA_MM,
        period,
    );
    return inputs.map((inp, i) =>
        rebuildSplineStation(inp, gSm[i] ?? 0, 0, aSm[i] ?? 0, {
            corner: solved[i]!.corner,
            oMin: solved[i]!.oMin,
            rhoNeed: solved[i]!.rhoNeed,
            peakClosest: solved[i]!.peakClosest,
            beta: solved[i]!.beta,
            eb: solved[i]!.eb,
            c: solved[i]!.c,
            r1: solved[i]!.r1,
        }),
    );
}
