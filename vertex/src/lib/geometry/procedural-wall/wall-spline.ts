// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { PATTERN_ARCH_U0, PATTERN_ARCH_U1, patternCurvatureReport } from "./bottom-pattern";
import { smoothstep01, WALL_H_SMOOTH_HI_MM, WALL_H_SMOOTH_LO_MM } from "./wall-style";

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
/** max/min |κ| on the middle 80% of the body arc. Report-only. */
export const SPLINE_KAPPA_RATIO_MAX = 2;
/** κ_max / κ_mean on the middle 80% of the body (lip excluded). */
export const SPLINE_KAPPA_MAX_MEAN = 3;
export const SPLINE_KAPPA_MID_LO = 0.1;
export const SPLINE_KAPPA_MID_HI = 0.9;
/** Body-side κ near E ≥ this / r1 (report-only; 3 rows after E replace lip-ok). */
export const SPLINE_LIP_KAPPA_OVER_R1 = 0.1;
export const SPLINE_LIP_TURN_ROWS = 3;
/** Lip may go outboard of R up to r1 + this. */
export const SPLINE_LIP_S_SLACK_MM = 0.1;
/** g bisect bracket [0, this × |EB|]. */
export const SPLINE_G_HI_FRAC = 0.5;
/** Neighbouring hybrid/short weights may differ by at most this. */
export const SPLINE_WR_STEP_MAX = 0.08;
/** Quadratic handle: M_s = s_E + λ (Ls − s_E). */
export const SPLINE_LAMBDA = 0.5;
export const SPLINE_LAMBDA_LO = 0.35;
export const SPLINE_LAMBDA_HI = 0.65;
/** r1 = this × heel edge thickness (default thickness 1 mm → r1 = 0.5). */
export const ROUND_R1_OVER_HEEL = 0.5;
export const HEEL_EDGE_THICKNESS_MM = 1;
/** Hard skip: do not evaluate ROUND when Ls is below this. */
export const SPLINE_SHORT_LS_MM = 2;
/** Kept for callers; short-Ls ROUND ramp now uses SPLINE_SHORT_RAMP_LB_MM. */
export const SPLINE_SHORT_BLEND_MM = 15;
/** Short-Ls ROUND ramp is centered where smoothed Ls crosses this. */
export const SPLINE_SHORT_LS_CROSS_MM = 3;
/** Analytic short-Ls ramp length (mm of rim arc), no Gaussian. */
export const SPLINE_SHORT_RAMP_LB_MM = 32;
/** Shared lip-block step: NL = max_i ceil(θ_i / this). */
export const SPLINE_LIP_ANGLE_DEG = 3.5;
/** Medial-arch ramp length, inside [u_a0, u_a1]. Analytic HYBRID w uses this Lb. */
export const HYBRID_ARCH_LB_MM = 30;
/** Kept for callers; HYBRID w no longer min()s Lb with a span fraction. */
export const HYBRID_ARCH_LB_FRAC = 0.3;
/** [RND-E]: |C_lip(end) − C_par(0)| must stay under this. */
export const RND_E_POS_EPS = 1e-9;
/** [RND-E]: angle(tE, M − E) must stay under this. */
export const RND_E_ANG_MAX_DEG = 0.1;
/** Analytic G1-R/E/B from the curve objects. */
export const SPLINE_G1_ANALYTIC_MAX_DEG = 0.1;
/** Mesh G1-R_m: dihedral of incident top face vs first wall face. */
export const SPLINE_G1_MESH_MAX_DEG = 4;
/** INFL: both sides of a sign change must be at least this. */
export const SPLINE_INFL_TURN_MIN_DEG = 0.2;
/** Remainder INFL: opposite turn below this is accepted. */
export const SPLINE_INFL_ACCEPT_DEG = 0.5;
/** Body filler lives in this central fraction of the body arc. */
export const SPLINE_BODY_FILL_LO = 0.1;
export const SPLINE_BODY_FILL_HI = 0.9;
/** Consecutive landing-row spacing may change by at most this. */
export const SPLINE_LANDING_STEP_RATIO = 1.3;
/** Pin this many f-rows from B after ring smoothing. */
export const SPLINE_F_PIN_FROM_B = 3;
/** Landing gates apply at k >= N − this. */
export const SPLINE_LANDING_TAIL_ROWS = 5;
/** Graph-blend switch: 45° from vertical. */
export const SPLINE_BLEND_FROM_VERTICAL_DEG = 45;
/** Freeze: remaining turn / along / G1-R_m misses may be this large. */
export const SPLINE_FREEZE_MISS_MAX_DEG = 8;
/** Freeze: at most this many stations may still miss those three gates. */
export const SPLINE_FREEZE_MISS_STATIONS = 10;
/** Cap the lip so M.s ≤ Ls − this. */
export const SPLINE_LIP_MS_SLACK_MM = 0.5;
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
/** Lip-only ds floor. Body keeps SPLINE_DS_FLOOR_MM. */
export const SPLINE_DS_LIP_FLOOR_MM = 0.025;
/** Lip-row face aspect allowance. */
export const SPLINE_LIP_ASPECT_MAX = 60;
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
    sBound: boolean;
    kappaRatio: number;
    kappaMaxMean: number;
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
    maxOppTurnDeg: number;
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
    sBound: boolean;
    kappaRatio: number;
    kappaMaxMean: number;
    sagitta: number;
    sagFrac: number;
    peakZFrac: number;
    g1RDeg: number;
    seamBDeg: number;
    infl: number;
    inflCount: number;
    maxOppTurnDeg: number;
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

export function clampLambda(lambda: number): number {
    return clampNum(lambda, SPLINE_LAMBDA_LO, SPLINE_LAMBDA_HI);
}

/** P(t) = (1−t)² P0 + 2(1−t)t P1 + t² P2. */
export function evalQuadraticBezier(P0: XYZ, P1: XYZ, P2: XYZ, t: number): XYZ {
    const u = 1 - t;
    return {
        x: u * u * P0.x + 2 * u * t * P1.x + t * t * P2.x,
        y: u * u * P0.y + 2 * u * t * P1.y + t * t * P2.y,
        z: u * u * P0.z + 2 * u * t * P1.z + t * t * P2.z,
    };
}

export function quadraticBezierTangent(P0: XYZ, P1: XYZ, P2: XYZ, t: number): XYZ {
    return {
        x: 2 * (1 - t) * (P1.x - P0.x) + 2 * t * (P2.x - P1.x),
        y: 2 * (1 - t) * (P1.y - P0.y) + 2 * t * (P2.y - P1.y),
        z: 2 * (1 - t) * (P1.z - P0.z) + 2 * t * (P2.z - P1.z),
    };
}

/** M0 = (λ Ls, 0) in the column (s, z) frame. */
export function parabolaHandleM0(B: XYZ, R: XYZ, h: { x: number; y: number }, lambda = SPLINE_LAMBDA): XYZ {
    const fr = stationSzFrame(R, B, h);
    return fromSz({ s: clampLambda(lambda) * fr.Ls, z: 0 }, fr.origin, fr.h);
}

/** Legacy M = (s_E + λ (Ls − s_E), 0). Prefer solveLipParabolaJoint. */
export function parabolaHandleM(
    E: XYZ,
    B: XYZ,
    R: XYZ,
    h: { x: number; y: number },
    lambda = SPLINE_LAMBDA,
): XYZ {
    const fr = stationSzFrame(R, B, h);
    const sE = toSz(E, fr.origin, fr.h).s;
    const lam = clampLambda(lambda);
    return fromSz({ s: sE + lam * (fr.Ls - sE), z: 0 }, fr.origin, fr.h);
}

export interface LipParabolaJoint {
    E: Sz;
    M: Sz;
    tR: Sz;
    tP: Sz;
    lambda: number;
    lipTurn: number;
    r1: number;
    H: number;
    Ls: number;
    zeroLip: boolean;
    capped: boolean;
}

function rotate90CcwSz(t: Sz): Sz {
    return { s: -t.z, z: t.s };
}

function rotateSz(t: Sz, ang: number): Sz {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    return { s: t.s * c - t.z * s, z: t.s * s + t.z * c };
}

function unitSz(t: Sz): Sz {
    const l = hypot2(t.s, t.z) || 1;
    return { s: t.s / l, z: t.z / l };
}

/** Signed CCW turn from `from` to `to` in the (s, z) plane. */
export function signedTurnSz(from: Sz, to: Sz): number {
    return Math.atan2(from.s * to.z - from.z * to.s, from.s * to.s + from.z * to.z);
}

/** Circular lip: E = R + r1 sin(α) tR + r1 (1−cos(α)) n, n = rotate90CCW(tR). */
export function lipArcEnd(R: Sz, tR: Sz, r1: number, alpha: number): Sz {
    const n = rotate90CcwSz(tR);
    const sA = Math.sin(alpha);
    const cA = Math.cos(alpha);
    return {
        s: R.s + r1 * sA * tR.s + r1 * (1 - cA) * n.s,
        z: R.z + r1 * sA * tR.z + r1 * (1 - cA) * n.z,
    };
}

export function plantarHit(E: Sz, tP: Sz): Sz | null {
    if (Math.abs(tP.z) < 1e-9) return null;
    const t = -E.z / tP.z;
    if (t < -1e-9) return null;
    return { s: E.s + t * tP.s, z: 0 };
}

/** Infinite line (E, tE) ∩ z = 0. */
export function plantarLineHit(E: Sz, tE: Sz): Sz | null {
    if (Math.abs(tE.z) < 1e-9) return null;
    const t = -E.z / tE.z;
    return { s: E.s + t * tE.s, z: 0 };
}

/**
 * After smoothing, θ is the only source: E = lip(R, tR, r1, θ), tE = rotate(tR, θ),
 * M = line(E, tE) ∩ z=0. λ is not used for geometry.
 */
export function buildJointFromTheta(
    tR: Sz,
    H: number,
    Ls: number,
    r1: number,
    theta: number,
    lambda = SPLINE_LAMBDA,
): LipParabolaJoint {
    const r = Math.max(r1, 1e-6);
    const tRu = unitSz(tR);
    let alpha = theta;
    let zeroLip = false;
    if (alpha <= 1e-12) {
        alpha = 0;
        zeroLip = true;
    }
    const R: Sz = { s: 0, z: H };
    const tE = alpha <= 1e-12 ? tRu : unitSz(rotateSz(tRu, alpha));
    const E = alpha <= 1e-12 ? { ...R } : lipArcEnd(R, tRu, r, alpha);
    const M = plantarLineHit(E, tE);
    if (!M) {
        throw new Error(`[RND-E] ${JSON.stringify({ reason: "no-plantar-hit", theta: alpha })}`);
    }
    const joint: LipParabolaJoint = {
        E,
        M,
        tR: tRu,
        tP: tE,
        lambda: clampLambda(lambda),
        lipTurn: alpha,
        r1: r,
        H,
        Ls,
        zeroLip,
        capped: false,
    };
    assertLipParabolaJoint(joint);
    return joint;
}

export function assertLipParabolaJoint(joint: LipParabolaJoint): void {
    const R: Sz = { s: 0, z: joint.H };
    const lipEnd =
        joint.zeroLip || joint.lipTurn <= 1e-12 ? { ...R } : lipArcEnd(R, joint.tR, joint.r1, joint.lipTurn);
    const dE = hypot2(lipEnd.s - joint.E.s, lipEnd.z - joint.E.z);
    const me = { s: joint.M.s - joint.E.s, z: joint.M.z - joint.E.z };
    const meL = hypot2(me.s, me.z);
    const ang = meL < 1e-15 ? 0 : (Math.abs(signedTurnSz(joint.tP, unitSz(me))) * 180) / Math.PI;
    if (dE >= RND_E_POS_EPS || ang >= RND_E_ANG_MAX_DEG) {
        throw new Error(`[RND-E] ${JSON.stringify({ dE, ang, lipTurn: joint.lipTurn })}`);
    }
}

/** C_lip'(α) = rotate(tR, α) in the column (s, z) plane. */
export function lipCPrimeSz(tR: Sz, alpha: number): Sz {
    return alpha <= 1e-12 ? unitSz(tR) : unitSz(rotateSz(tR, alpha));
}

export function szToXyz(t: Sz, h: { x: number; y: number }): XYZ {
    return { x: h.x * t.s, y: h.y * t.s, z: t.z };
}

/** G1-R_a = angle(tR_face, C_lip'(0+)). */
export function analyticG1RDeg(tRFace: Sz, tRUsed: Sz): number {
    return (Math.abs(signedTurnSz(unitSz(tRFace), unitSz(tRUsed))) * 180) / Math.PI;
}

/** G1-E_a = angle(C_lip'(θ), C_par'(0)). */
export function analyticG1EDeg(joint: LipParabolaJoint): number {
    const me = { s: joint.M.s - joint.E.s, z: joint.M.z - joint.E.z };
    if (hypot2(me.s, me.z) < 1e-15) return 0;
    return (Math.abs(signedTurnSz(joint.tP, unitSz(me))) * 180) / Math.PI;
}

/** G1-B_a = angle(C_par'(1), plantar direction in the column plane). */
export function analyticG1BDeg(joint: LipParabolaJoint, plantar: Sz = { s: 1, z: 0 }): number {
    const tEnd = { s: joint.Ls - joint.M.s, z: -joint.M.z };
    if (hypot2(tEnd.s, tEnd.z) < 1e-15) return 0;
    return (Math.abs(signedTurnSz(unitSz(tEnd), unitSz(plantar))) * 180) / Math.PI;
}

/** Plantar ∩ column plane, pointing inboard (+s). */
export function plantarDirInColumn(nPlantar: XYZ | undefined, h: { x: number; y: number }): Sz {
    if (!nPlantar) return { s: 1, z: 0 };
    const nCol = { x: -h.y, y: h.x, z: 0 };
    const d = {
        x: nPlantar.y * nCol.z - nPlantar.z * nCol.y,
        y: nPlantar.z * nCol.x - nPlantar.x * nCol.z,
        z: nPlantar.x * nCol.y - nPlantar.y * nCol.x,
    };
    let s = d.x * h.x + d.y * h.y;
    let z = d.z;
    const l = hypot2(s, z);
    if (l < 1e-12) return { s: 1, z: 0 };
    s /= l;
    z /= l;
    if (s < 0) {
        s = -s;
        z = -z;
    }
    return { s, z };
}

/**
 * Pre-smoothing θ target from λ: tP0 = unit(M0 − R), M0 = (λ Ls, 0).
 * Zero if the signed turn tR→tP0 is ≤ 0. Cap so M.s ≤ Ls − 0.5.
 */
export function lipTurnTargetFromLambda(
    tR: Sz,
    H: number,
    Ls: number,
    r1: number,
    lambda = SPLINE_LAMBDA,
): { theta: number; zeroLip: boolean; capped: boolean } {
    const lam = clampLambda(lambda);
    const tRu = unitSz(tR);
    const R: Sz = { s: 0, z: H };
    const M0: Sz = { s: lam * Math.max(Ls, 0), z: 0 };
    const tP0 = unitSz({ s: M0.s - R.s, z: M0.z - R.z });
    let alpha = signedTurnSz(tRu, tP0);
    if (alpha <= 1e-12) {
        return { theta: 0, zeroLip: true, capped: false };
    }
    const r = Math.max(r1, 1e-6);
    const capMs = Ls - SPLINE_LIP_MS_SLACK_MM;
    const mOf = (a: number): Sz | null => {
        const tE = a <= 1e-12 ? tRu : unitSz(rotateSz(tRu, a));
        const E = a <= 1e-12 ? { ...R } : lipArcEnd(R, tRu, r, a);
        return plantarLineHit(E, tE);
    };
    const M0hit = mOf(alpha);
    let capped = false;
    if (M0hit && M0hit.s > capMs + 1e-9) {
        let lo = 0;
        let hi = alpha;
        for (let i = 0; i < 40; i++) {
            const mid = 0.5 * (lo + hi);
            const Mm = mOf(mid);
            if (Mm && Mm.s > capMs + 1e-9) hi = mid;
            else lo = mid;
        }
        alpha = lo;
        capped = true;
        if (alpha <= 1e-12) {
            return { theta: 0, zeroLip: true, capped: true };
        }
    }
    return { theta: alpha, zeroLip: false, capped };
}

/**
 * Lip-to-parabola joint in the column (s, z) frame.
 * Omit lipTurn to take the λ-target θ (pre-smoothing). Pass lipTurn to rebuild
 * from that θ only — λ is never used for tE / M after smoothing.
 */
export function solveLipParabolaJoint(
    tR: Sz,
    H: number,
    Ls: number,
    r1: number,
    lambda = SPLINE_LAMBDA,
    lipTurn?: number,
): LipParabolaJoint {
    if (lipTurn != null) {
        return buildJointFromTheta(tR, H, Ls, r1, lipTurn, lambda);
    }
    const raw = lipTurnTargetFromLambda(tR, H, Ls, r1, lambda);
    const joint = buildJointFromTheta(tR, H, Ls, r1, raw.theta, lambda);
    return { ...joint, zeroLip: raw.zeroLip || joint.zeroLip, capped: raw.capped };
}

export function sampleLipArc(R: Sz, tR: Sz, r1: number, alpha: number, n = 48): Sz[] {
    if (alpha <= 1e-12) return [{ ...R }];
    const out: Sz[] = [];
    const nUse = Math.max(1, n);
    for (let i = 0; i <= nUse; i++) {
        out.push(i === 0 ? { ...R } : lipArcEnd(R, tR, r1, (alpha * i) / nUse));
    }
    return out;
}

export function liftLipParabola(
    joint: LipParabolaJoint,
    origin: XYZ,
    h: { x: number; y: number },
    B: XYZ,
    R: XYZ,
): { lip: XYZ[]; body: XYZ[]; composite: XYZ[]; E: XYZ; M: XYZ } {
    const Rsz: Sz = { s: 0, z: joint.H };
    const lip = sampleLipArc(Rsz, joint.tR, joint.r1, joint.lipTurn).map((p) => fromSz(p, origin, h));
    const E = fromSz(joint.E, origin, h);
    const M = fromSz(joint.M, origin, h);
    if (lip.length) {
        lip[0] = { ...R };
        lip[lip.length - 1] = { ...E };
    } else {
        lip.push({ ...R });
    }
    const body = sampleQuadraticDense(E, M, B);
    return { lip, body, composite: concatProfiles(lip, body), E, M };
}

export function sampleQuadraticDense(P0: XYZ, P1: XYZ, P2: XYZ, n = SPLINE_DENSE): XYZ[] {
    const pts: XYZ[] = [];
    const nUse = Math.max(1, n);
    for (let i = 0; i <= nUse; i++) pts.push(evalQuadraticBezier(P0, P1, P2, i / nUse));
    pts[0] = { ...P0 };
    pts[pts.length - 1] = { ...P2 };
    return pts;
}

export interface HybridArchSpan {
    uA0: number;
    uA1: number;
    sA0: number;
    sA1: number;
    lbMm: number;
    lbU: number;
}

export interface HybridArchMark {
    u: number;
    s: number;
    x: number;
    y: number;
    z: number;
    label: "u_a0" | "u_a0+Lb" | "u_a1-Lb" | "u_a1";
}

export interface HybridArchInfo extends HybridArchSpan {
    marks: HybridArchMark[];
}

function closedArcDist(a: number, b: number, period: number): number {
    const p = Math.max(period, 1e-9);
    let d = Math.abs(a - b);
    d = Math.min(d, p - d);
    return d;
}

export function hybridArchWeightAtS(s: number, arch: HybridArchSpan, sideSign: 1 | -1): number {
    if (sideSign < 0) return 0;
    const span = arch.sA1 - arch.sA0;
    if (span <= 1e-6) return 0;
    const lb = arch.lbMm;
    return smoothstep01(arch.sA0, arch.sA0 + lb, s) * (1 - smoothstep01(arch.sA1 - lb, arch.sA1, s));
}

export function hybridArchWeight(
    u: number,
    sideSign: 1 | -1,
    arch: HybridArchSpan | null | undefined,
): number {
    if (sideSign < 0 || !arch) return 0;
    const span = arch.uA1 - arch.uA0;
    if (span <= 1e-6) return 0;
    const lb = arch.lbU;
    return smoothstep01(arch.uA0, arch.uA0 + lb, u) * (1 - smoothstep01(arch.uA1 - lb, arch.uA1, u));
}

/**
 * Medial cut-in between the faired pattern's two inflections.
 * u_a0 is posterior, u_a1 anterior. Lateral weight is always 0.
 */
export function medialArchFromLoop(
    loop: XYZ[],
    us: number[],
    sideSigns: Array<1 | -1>,
    arc: number[],
    period: number,
    medialSign: 1 | -1,
): HybridArchInfo | null {
    if (loop.length < 4) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const p of loop) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
    }
    const report = patternCurvatureReport(loop, { minX, maxX }, medialSign);
    const medialU = report.inflectionU.filter((u) => {
        let best = 0;
        let bestD = Number.POSITIVE_INFINITY;
        for (let i = 0; i < us.length; i++) {
            const d = Math.abs((us[i] ?? 0) - u);
            if (d < bestD) {
                bestD = d;
                best = i;
            }
        }
        return (sideSigns[best] ?? 1) > 0;
    });
    const raw = (medialU.length >= 2 ? medialU : report.inflectionU).slice().sort((a, b) => a - b);
    if (raw.length < 2) {
        raw.push(PATTERN_ARCH_U0, PATTERN_ARCH_U1);
    }
    let uA0 = raw[0]!;
    let uA1 = raw[raw.length - 1]!;
    if (raw.length > 2) {
        let bestSpan = -1;
        for (let i = 0; i < raw.length - 1; i++) {
            const a = raw[i]!;
            const b = raw[i + 1]!;
            const mid = 0.5 * (a + b);
            let midI = 0;
            let midD = Number.POSITIVE_INFINITY;
            for (let j = 0; j < us.length; j++) {
                const d = Math.abs((us[j] ?? 0) - mid);
                if (d < midD) {
                    midD = d;
                    midI = j;
                }
            }
            if ((sideSigns[midI] ?? 1) < 0) continue;
            const span = b - a;
            if (span > bestSpan) {
                bestSpan = span;
                uA0 = a;
                uA1 = b;
            }
        }
    }
    if (uA1 <= uA0 + 1e-6) return null;
    const nearest = (u: number, medialOnly: boolean): number => {
        let best = 0;
        let bestD = Number.POSITIVE_INFINITY;
        for (let i = 0; i < us.length; i++) {
            if (medialOnly && (sideSigns[i] ?? 1) < 0) continue;
            const d = Math.abs((us[i] ?? 0) - u);
            if (d < bestD) {
                bestD = d;
                best = i;
            }
        }
        return best;
    };
    const i0 = nearest(uA0, true);
    const i1 = nearest(uA1, true);
    let sA0 = arc[i0] ?? 0;
    let sA1 = arc[i1] ?? sA0;
    if (sA1 < sA0) {
        const tmpS = sA0;
        const tmpU = uA0;
        sA0 = sA1;
        sA1 = tmpS;
        uA0 = uA1;
        uA1 = tmpU;
    }
    const spanS = sA1 - sA0;
    const lbMm = HYBRID_ARCH_LB_MM;
    const lbU = spanS > 1e-9 ? (lbMm / spanS) * (uA1 - uA0) : 0;
    const atS = (sTarget: number): { i: number; u: number; s: number; p: XYZ } => {
        let best = 0;
        let bestD = Number.POSITIVE_INFINITY;
        for (let i = 0; i < arc.length; i++) {
            const d = Math.abs((arc[i] ?? 0) - sTarget);
            if (d < bestD) {
                bestD = d;
                best = i;
            }
        }
        return { i: best, u: us[best] ?? 0, s: arc[best] ?? sTarget, p: loop[best]! };
    };
    const p0 = atS(sA0);
    const p1 = atS(sA0 + lbMm);
    const p2 = atS(sA1 - lbMm);
    const p3 = atS(sA1);
    const mark = (hit: { u: number; s: number; p: XYZ }, label: HybridArchMark["label"]): HybridArchMark => ({
        u: hit.u,
        s: hit.s,
        x: hit.p.x,
        y: hit.p.y,
        z: hit.p.z,
        label,
    });
    void period;
    void closedArcDist;
    return {
        uA0,
        uA1,
        sA0,
        sA1,
        lbMm,
        lbU,
        marks: [mark(p0, "u_a0"), mark(p1, "u_a0+Lb"), mark(p2, "u_a1-Lb"), mark(p3, "u_a1")],
    };
}

/** Short-wall wR: analytic smoothstep, Lb=30 mm, centered on smoothed-Ls = 3 mm. */
export function shortLsWeights(Ls: number[], arc: number[], period: number): number[] {
    const n = Ls.length;
    const out = new Array<number>(n).fill(1);
    if (n === 0) return out;
    const p = Math.max(period, 1e-9);
    const lsSm = periodicGaussian1d(Ls, arc, SPLINE_SMOOTH_SIGMA_MM, p);
    const lo = SPLINE_SHORT_LS_CROSS_MM;
    const half = 0.5 * SPLINE_SHORT_RAMP_LB_MM;
    const crossings: Array<{ s: number; rising: boolean }> = [];
    for (let i = 0; i < n; i++) {
        const a = lsSm[i] ?? 0;
        const b = lsSm[(i + 1) % n] ?? a;
        if ((a - lo) * (b - lo) > 0) continue;
        if (Math.abs(a - lo) < 1e-12 && Math.abs(b - lo) < 1e-12) continue;
        const sa = arc[i] ?? 0;
        const sb = i + 1 < n ? (arc[i + 1] ?? sa) : sa + Math.max(p - sa, 0);
        const span = sb - sa;
        const t = Math.abs(b - a) > 1e-12 ? (lo - a) / (b - a) : 0;
        crossings.push({ s: sa + Math.max(0, Math.min(1, t)) * span, rising: b > a });
    }
    if (!crossings.length) {
        const allShort = lsSm.every((v) => (v ?? 0) < lo - 1e-9);
        return new Array<number>(n).fill(allShort ? 0 : 1);
    }
    const wrap = (d: number): number => {
        let x = d;
        if (x > 0.5 * p) x -= p;
        if (x < -0.5 * p) x += p;
        return x;
    };
    for (let i = 0; i < n; i++) {
        const s = arc[i] ?? 0;
        let best = crossings[0]!;
        let bestAbs = Number.POSITIVE_INFINITY;
        for (const c of crossings) {
            const ad = Math.abs(wrap(s - c.s));
            if (ad < bestAbs) {
                bestAbs = ad;
                best = c;
            }
        }
        const u = smoothstep01(-half, half, wrap(s - best.s));
        out[i] = Math.max(0, Math.min(1, best.rising ? u : 1 - u));
    }
    return out;
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

export function dsTarget(rho: number, L: number, floorMm = SPLINE_DS_FLOOR_MM): number {
    const fl = Math.max(1e-9, floorMm);
    const hi = Math.max(L / SPLINE_N_MIN_DIV, fl);
    const raw = Number.isFinite(rho) ? SPLINE_DS_TURN_RAD * rho : Number.POSITIVE_INFINITY;
    return clampNum(raw, fl, hi);
}

export function stationSampleNeed(
    S: number[],
    T: number[],
    lipS = 0,
): { n: number; L: number; integral: number } {
    const nSeg = Math.max(1, S.length - 1);
    const L = S[nSeg] ?? 0;
    let integral = 0;
    for (let j = 1; j <= nSeg; j++) {
        const dS = (S[j] ?? 0) - (S[j - 1] ?? 0);
        const dT = (T[j] ?? 0) - (T[j - 1] ?? 0);
        const sMid = 0.5 * ((S[j - 1] ?? 0) + (S[j] ?? 0));
        const floor = sMid <= lipS + 1e-12 ? SPLINE_DS_LIP_FLOOR_MM : SPLINE_DS_FLOOR_MM;
        integral += dS / Math.max(dsTarget(rhoFromSegment(dS, dT), L, floor), 1e-16);
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

/** κ_max / κ_mean on the middle 80% of a body polyline. */
export function midArcKappaMaxMean(
    samples: XYZ[],
    lo = SPLINE_KAPPA_MID_LO,
    hi = SPLINE_KAPPA_MID_HI,
): number {
    const ks = polylineAbsKappa(samples).filter((r) => r.s >= lo && r.s <= hi && r.k >= 1e-5);
    if (ks.length < 2) return 1;
    let mx = 0;
    let sum = 0;
    for (const r of ks) {
        mx = Math.max(mx, r.k);
        sum += r.k;
    }
    const mean = sum / ks.length;
    if (mean < 1e-8) return mx > 1e-8 ? Number.POSITIVE_INFINITY : 1;
    return mx / mean;
}

export function minSAndIndex(
    samples: XYZ[],
    R: XYZ,
    B: XYZ,
    h: { x: number; y: number },
): { sMin: number; k: number } {
    const fr = stationSzFrame(R, B, h);
    let minS = Number.POSITIVE_INFINITY;
    let k = 0;
    for (let i = 0; i < samples.length; i++) {
        const s = toSz(samples[i]!, fr.origin, fr.h).s;
        if (s < minS) {
            minS = s;
            k = i;
        }
    }
    return { sMin: Number.isFinite(minS) ? minS : 0, k };
}

export function nearestPointIndex(pts: XYZ[], target: XYZ): number {
    let best = 0;
    let bestD = Number.POSITIVE_INFINITY;
    for (let i = 0; i < pts.length; i++) {
        const d = hypot3(sub(pts[i]!, target));
        if (d < bestD) {
            bestD = d;
            best = i;
        }
    }
    return best;
}

/** Lip R→E plus body E→B, dropping the duplicated E. */
export function concatProfiles(lip: XYZ[], body: XYZ[]): XYZ[] {
    if (!lip.length) return body.map((p) => ({ ...p }));
    if (!body.length) return lip.map((p) => ({ ...p }));
    return [...lip.slice(0, -1).map((p) => ({ ...p })), ...body.map((p) => ({ ...p }))];
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

function tet6(a: XYZ, b: XYZ, c: XYZ, d: XYZ): number {
    const ab = sub(b, a);
    const ac = sub(c, a);
    const ad = sub(d, a);
    return (
        ab.x * (ac.y * ad.z - ac.z * ad.y) -
        ab.y * (ac.x * ad.z - ac.z * ad.x) +
        ab.z * (ac.x * ad.y - ac.y * ad.x)
    );
}

/** Signed volume of the prism between two triangles (same winding as pushQuad). */
export function prismVolume(a: XYZ, b: XYZ, c: XYZ, a2: XYZ, b2: XYZ, c2: XYZ): number {
    return (tet6(a, b, c, a2) + tet6(b, c, a2, b2) + tet6(c, a2, b2, c2)) / 6;
}

/**
 * Volume between two same-topology wall columns (ROUND vs STRAIGHT), using the
 * fixed (a,c,b)+(a,d,c) diagonal. This is the 3D form of profile-area × arc.
 */
export function wallStripVolume(roundA: XYZ[], roundB: XYZ[], straightA: XYZ[], straightB: XYZ[]): number {
    const n = Math.min(roundA.length, roundB.length, straightA.length, straightB.length) - 1;
    let vol = 0;
    for (let k = 0; k < n; k++) {
        const a = roundA[k]!;
        const b = roundB[k]!;
        const c = roundB[k + 1]!;
        const d = roundA[k + 1]!;
        const a2 = straightA[k]!;
        const b2 = straightB[k]!;
        const c2 = straightB[k + 1]!;
        const d2 = straightA[k + 1]!;
        vol -= prismVolume(a, c, b, a2, c2, b2);
        vol -= prismVolume(a, d, c, a2, d2, c2);
    }
    return vol;
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

/** Signed (s, z) turn at each interior vertex, degrees. */
export function polylineSignedTurnsDeg(
    samples: XYZ[],
    R: XYZ,
    B: XYZ,
    h: { x: number; y: number },
): number[] {
    const fr = stationSzFrame(R, B, h);
    const sz = samples.map((p) => toSz(p, fr.origin, fr.h));
    const turns: number[] = [];
    for (let i = 1; i < sz.length - 1; i++) {
        const d1 = { s: sz[i]!.s - sz[i - 1]!.s, z: sz[i]!.z - sz[i - 1]!.z };
        const d2 = { s: sz[i + 1]!.s - sz[i]!.s, z: sz[i + 1]!.z - sz[i]!.z };
        if (hypot2(d1.s, d1.z) < 1e-14 || hypot2(d2.s, d2.z) < 1e-14) {
            turns.push(0);
            continue;
        }
        turns.push((signedTurnSz(unitSz(d1), unitSz(d2)) * 180) / Math.PI);
    }
    return turns;
}

export interface InflReport {
    inflCount: number;
    maxOppTurnDeg: number;
    turns: number[];
}

/**
 * Sign change only if |turn| ≥ 0.2° on both sides.
 * maxOppTurnDeg is the largest opposite-sense |turn|.
 */
export function polylineInflReport(
    samples: XYZ[],
    R: XYZ,
    B: XYZ,
    h: { x: number; y: number },
    minDeg = SPLINE_INFL_TURN_MIN_DEG,
): InflReport {
    const turns = polylineSignedTurnsDeg(samples, R, B, h);
    let pos = 0;
    let neg = 0;
    for (const t of turns) {
        if (Math.abs(t) < minDeg) continue;
        if (t > 0) pos++;
        else neg++;
    }
    let dom = 0;
    if (pos || neg) dom = pos >= neg ? 1 : -1;
    else {
        let biggest = 0;
        for (const t of turns) {
            if (Math.abs(t) > Math.abs(biggest)) biggest = t;
        }
        if (Math.abs(biggest) > 1e-12) dom = biggest > 0 ? 1 : -1;
    }
    let maxOpp = 0;
    for (const t of turns) {
        if (dom !== 0 && t * dom < 0) maxOpp = Math.max(maxOpp, Math.abs(t));
    }
    let inflCount = 0;
    let prev = 0;
    for (const t of turns) {
        if (Math.abs(t) < minDeg) continue;
        const s = t > 0 ? 1 : -1;
        if (prev === 0) prev = s;
        else if (s !== prev) {
            inflCount++;
            prev = s;
        }
    }
    return { inflCount, maxOppTurnDeg: maxOpp, turns };
}

export function polylineInflCount(samples: XYZ[], R: XYZ, B: XYZ, h: { x: number; y: number }): number {
    return polylineInflReport(samples, R, B, h).inflCount;
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
    const dense =
        poly.length <= 3
            ? sampleQuadraticDense(
                  poly[0]!,
                  poly[1] ?? lerp(poly[0]!, poly[poly.length - 1]!, 0.5),
                  poly[poly.length - 1]!,
              )
            : sampleSplineDense(poly);
    const sag = splineSagitta(dense, E, B, h, R);
    const plan = planBounds(dense, R, B, h);
    const infl = polylineInflReport(dense, E, B, h);
    return {
        dense,
        ...sag,
        ...plan,
        inflCount: infl.inflCount,
        maxOppTurnDeg: infl.maxOppTurnDeg,
        infl: infl.inflCount > 0,
        convex: infl.inflCount === 0,
        g1RDeg: g1AtE(poly, tE, h),
        seamBDeg: seamBDeg(dense),
        maxTurnDeg: maxPolylineTurn(dense),
        sMin: minSOfSamples(dense, R, B, h),
        kappaRatio: midArcKappaRatio(dense),
        kappaMaxMean: midArcKappaMaxMean(dense),
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
    sBound?: boolean;
}

function stationEnds(input: SplineStationInput): { E: XYZ; tE: XYZ; r1: number } {
    const r1 = input.r1 ?? ROUND_R1_OVER_HEEL * HEEL_EDGE_THICKNESS_MM;
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
              maxOppTurnDeg: 0,
              infl: false,
              convex: true,
              g1RDeg: 0,
              seamBDeg: 0,
              maxTurnDeg: 0,
              sMin: minSOfSamples([E, B], R, B, fr.h),
              kappaRatio: 1,
              kappaMaxMean: 1,
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
        sBound: extra.sBound ?? false,
        kappaRatio: m.kappaRatio,
        kappaMaxMean: m.kappaMaxMean,
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
        maxOppTurnDeg: m.maxOppTurnDeg,
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
 * Body E→B: one quadratic Bezier P0=E, P1=M, P2=B.
 * Lip + M from the λ-target θ, then one-source rebuild (tE = rotate(tR, θ)).
 */
export function solveSplineStation(input: SplineStationInput): SplineSolve {
    const { R, B } = input;
    const r1 = input.r1 ?? ROUND_R1_OVER_HEEL * HEEL_EDGE_THICKNESS_MM;
    const fr = stationSzFrame(R, B, input.h);
    const tSz = tRInSz(input.tR, fr.h);
    const joint = solveLipParabolaJoint(tSz, fr.H, fr.Ls, r1, SPLINE_LAMBDA);
    const E = fromSz(joint.E, fr.origin, fr.h);
    const M = fromSz(joint.M, fr.origin, fr.h);
    const tE = bodyTangentFromE(E, B, fr.h, input.tE ?? sub(M, E));
    void tE;
    const eb = hypot3(sub(B, E));
    const beta = joint.lambda;
    const extra: SplineSolveExtra = {
        corner: false,
        oMin: 0,
        rhoNeed: splineRhoNeed(eb),
        eb,
        r1: joint.r1,
        beta,
        sBound: false,
    };
    if (fr.Ls < SPLINE_SHORT_LS_MM) {
        return finishSolve({ ...input, E, tE, r1: joint.r1 }, [E, B], 0, 0, 0, beta, true, extra);
    }
    const a = hypot3(sub(M, E));
    return finishSolve({ ...input, E, tE, r1: joint.r1 }, [E, M, { ...B }], a, 0, 0, beta, false, extra);
}

/** Rebuild is a no-op for the quadratic; g/a are unused. */
export function rebuildSplineStation(
    input: SplineStationInput,
    _g: number,
    _zy: number,
    _a: number,
    _extra?: Partial<SplineSolveExtra>,
): SplineSolve {
    return solveSplineStation(input);
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
    lipS = 0,
    fillLo = 0,
    fillHi = 1,
): SplineDensityTable {
    const nSeg = Math.max(1, S.length - 1);
    const L = S[nSeg] ?? 0;
    const Theta = T[nSeg] ?? 0;
    const lo = Math.max(0, Math.min(1, fillLo)) * L;
    const hi = Math.max(0, Math.min(1, fillHi)) * L;
    const fillLen = Math.max(hi - lo, 1e-16);
    const pad = fillLen > 1e-16 ? (N - nNeed) / fillLen : 0;
    const W = [0];
    let Z = 0;
    const add: number[] = [];
    for (let j = 1; j <= nSeg; j++) {
        const dS = (S[j] ?? 0) - (S[j - 1] ?? 0);
        const dT = (T[j] ?? 0) - (T[j - 1] ?? 0);
        const sMid = 0.5 * ((S[j - 1] ?? 0) + (S[j] ?? 0));
        const floor = sMid <= lipS + 1e-12 ? SPLINE_DS_LIP_FLOOR_MM : SPLINE_DS_FLOOR_MM;
        const inFill = sMid + 1e-12 >= lo && sMid - 1e-12 <= hi;
        const q = 1 / Math.max(dsTarget(rhoFromSegment(dS, dT), L, floor), 1e-16) + (inFill ? pad : 0);
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

function tableFromST(
    st: { u: number[]; S: number[]; T: number[] },
    N?: number,
    lipS = 0,
    fillLo = 0,
    fillHi = 1,
): SplineDensityTable {
    const need = stationSampleNeed(st.S, st.T, lipS);
    const nUse = Math.min(need.n, SPLINE_N_MAX);
    const nShared = Math.max(1, Math.min(SPLINE_N_MAX, N ?? nUse));
    return finishTurnDensity(st.u, st.S, st.T, nShared, need.n, lipS, fillLo, fillHi);
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

/** Hard stop on chords shorter than the row floor (logs in the report-only build). */
export function assertInversionOk(
    pts: XYZ[],
    L: number,
    N: number,
    i: number,
    lipK = 0,
    lipFloorMm: number | null = SPLINE_DS_LIP_FLOOR_MM,
): void {
    for (let k = 1; k < pts.length; k++) {
        const inLip = k <= lipK;
        if (inLip && (lipFloorMm == null || lipFloorMm <= 0)) continue;
        const need = inLip ? (lipFloorMm ?? SPLINE_DS_LIP_FLOOR_MM) : SPLINE_DS_FLOOR_MM;
        const e = hypot3(sub(pts[k]!, pts[k - 1]!));
        if (e + 1e-15 < need) {
            splineGateFail("[RND-INV]", { i, k, chord: e, need, L, N });
            if (!SPLINE_GATES_REPORT_ONLY) {
                throw new Error(`[RND-INV] ${JSON.stringify({ i, k, chord: e, need, L, N })}`);
            }
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
export function ringFValues(nS: number, N: number, rim: XYZ[], pinFromEnd = 0): number[][] {
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
    const pinFrom = pinFromEnd > 0 ? Math.max(1, N - pinFromEnd + 1) : N;
    for (let k = 1; k < N; k++) {
        if (k >= pinFrom) continue;
        const vals = f.map((row) => row[k]!);
        const sm = periodicGaussian1d(vals, arc, SPLINE_SMOOTH_SIGMA_MM, period);
        for (let i = 0; i < nS; i++) f[i]![k] = sm[i]!;
    }
    for (let i = 0; i < nS; i++) {
        for (let k = pinFrom; k <= N; k++) f[i]![k] = k / denom;
        f[i] = enforceMonotoneF(f[i]!, N);
        for (let k = pinFrom; k <= N; k++) f[i]![k] = k / denom;
        f[i]![N] = 1;
        f[i]![0] = 0;
    }
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

/** Per-segment 1/ds_t on a uniform normalized-arc grid. */
export function qOnNormalizedArc(S: number[], T: number[], nGrid = SPLINE_W_DENSE, lipS = 0): number[] {
    const nSeg = Math.max(1, S.length - 1);
    const L = Math.max(S[nSeg] ?? 0, 1e-16);
    const qSeg: number[] = [];
    for (let j = 1; j <= nSeg; j++) {
        const dS = (S[j] ?? 0) - (S[j - 1] ?? 0);
        const dT = (T[j] ?? 0) - (T[j - 1] ?? 0);
        const sMid = 0.5 * ((S[j - 1] ?? 0) + (S[j] ?? 0));
        const floor = sMid <= lipS + 1e-12 ? SPLINE_DS_LIP_FLOOR_MM : SPLINE_DS_FLOOR_MM;
        qSeg.push(1 / Math.max(dsTarget(rhoFromSegment(dS, dT), L, floor), 1e-16));
    }
    const out: number[] = [];
    for (let i = 0; i < nGrid; i++) {
        const amid = (i + 0.5) / nGrid;
        const sMid = amid * L;
        let j = 1;
        while (j < S.length && (S[j] ?? 0) < sMid) j++;
        out.push(qSeg[Math.max(0, j - 1)] ?? qSeg[qSeg.length - 1] ?? 1);
    }
    return out;
}

export function finishNormalizedDensity(qGrid: number[], N: number, nNeed: number): SplineDensityTable {
    const nGrid = Math.max(1, qGrid.length);
    const u: number[] = [0];
    const S: number[] = [0];
    const T: number[] = [0];
    const W = [0];
    const add: number[] = [];
    let Z = 0;
    const pad = Math.max(0, N - nNeed);
    for (let j = 0; j < nGrid; j++) {
        const inc = (Math.max(qGrid[j] ?? 0, 1e-16) + pad) / nGrid;
        add.push(inc);
        Z += inc;
        u.push((j + 1) / nGrid);
        S.push((j + 1) / nGrid);
        T.push(0);
    }
    for (let j = 1; j <= nGrid; j++) {
        W.push((W[j - 1] ?? 0) + (Z > 1e-16 ? (add[j - 1] ?? 0) / Z : 1 / nGrid));
    }
    W[0] = 0;
    if (W.length) W[W.length - 1] = 1;
    return { u, S, T, W, L: 1, Theta: 0, alpha: 0, maxR: 0, fillPasses: 0, nNeed, N };
}

/** Joint turn-bounded density q = (1−w) q_S + w q_R on normalized arc. */
export function jointDensityTable(
    stS: { S: number[]; T: number[] },
    stR: { S: number[]; T: number[] },
    w: number,
    N: number,
    lipS = 0,
): SplineDensityTable {
    const qS = qOnNormalizedArc(stS.S, stS.T, SPLINE_W_DENSE, 0);
    const qR = qOnNormalizedArc(stR.S, stR.T, SPLINE_W_DENSE, lipS);
    const n = Math.min(qS.length, qR.length);
    const ww = Math.max(0, Math.min(1, w));
    const q: number[] = [];
    for (let i = 0; i < n; i++) q.push((1 - ww) * (qS[i] ?? 0) + ww * (qR[i] ?? 0));
    const nS = stationSampleNeed(stS.S, stS.T, 0).n;
    const nR = stationSampleNeed(stR.S, stR.T, lipS).n;
    const nNeed = Math.max(1, Math.ceil((1 - ww) * nS + ww * nR));
    return finishNormalizedDensity(q, N, nNeed);
}

/** NL = max_i ceil(θ_i / 3.5°). At least one lip step. */
export function lipBlockCount(thetas: number[]): number {
    let n = 1;
    for (const th of thetas) {
        if (th <= 1e-12) continue;
        n = Math.max(n, Math.ceil((Math.abs(th) * 180) / Math.PI / SPLINE_LIP_ANGLE_DEG));
    }
    return Math.max(1, n);
}

/** Equal-angle lip rows. k = 0 → R, k = NL → E. `f` is the smoothed k/NL table. */
export function sampleLipEqualAngle(
    joint: LipParabolaJoint,
    origin: XYZ,
    h: { x: number; y: number },
    R: XYZ,
    NL: number,
    f?: number[],
): XYZ[] {
    const E = fromSz(joint.E, origin, h);
    const pts: XYZ[] = [];
    const denom = Math.max(NL, 1);
    for (let k = 0; k <= NL; k++) {
        if (k === 0) {
            pts.push({ ...R });
            continue;
        }
        if (k === NL) {
            pts.push({ ...E });
            continue;
        }
        const frac = f?.[k] ?? k / denom;
        const a = Math.max(0, Math.min(1, frac)) * joint.lipTurn;
        pts.push(fromSz(lipArcEnd({ s: 0, z: joint.H }, joint.tR, joint.r1, a), origin, h));
    }
    return pts;
}

/** Clamp consecutive Δu in the last `fromFrac` of [0,1] to maxRatio. */
export function clampLandingFractions(
    u: number[],
    maxRatio = SPLINE_LANDING_STEP_RATIO,
    fromFrac = SPLINE_BODY_FILL_HI,
): number[] {
    const out = u.slice();
    const n = out.length - 1;
    if (n < 2) return out;
    out[0] = 0;
    out[n] = 1;
    let start = 1;
    for (let k = 1; k < n; k++) {
        if ((out[k] ?? 0) + 1e-12 >= fromFrac) {
            start = k;
            break;
        }
    }
    for (let k = Math.max(start, 2); k < n; k++) {
        const prev = Math.max((out[k - 1] ?? 0) - (out[k - 2] ?? 0), 1e-16);
        const lo = prev / maxRatio;
        const hi = prev * maxRatio;
        const want = Math.max(out[k - 1]! + lo, Math.min(out[k - 1]! + hi, out[k] ?? out[k - 1]! + prev));
        out[k] = Math.max(out[k - 1]! + 1e-8, Math.min(1 - 1e-8 * (n - k), want));
    }
    out[n] = 1;
    const last = out[n] - (out[n - 1] ?? 0);
    const prev = Math.max((out[n - 1] ?? 0) - (out[n - 2] ?? 0), 1e-16);
    if (last > prev * maxRatio + 1e-12 && n >= 2) {
        const room = 1 - (out[start] ?? 0);
        const steps = n - start;
        if (steps > 0 && room > 0) {
            let u0 = out[start] ?? fromFrac;
            let ds = room / steps;
            const cap = prev * maxRatio;
            if (ds > cap) ds = cap;
            for (let k = start + 1; k < n; k++) {
                u0 = Math.min(1 - 1e-8 * (n - k), u0 + ds);
                out[k] = u0;
            }
            out[n] = 1;
        }
    }
    out[0] = 0;
    out[n] = 1;
    return out;
}

/** Turn-bounded + uniform-filler sample of one block. Endpoints by index. */
export function samplePolylineBlock(
    col: XYZ[],
    N: number,
    f: number[],
    floorMm = SPLINE_DS_FLOOR_MM,
    landing = false,
): XYZ[] {
    const n = Math.max(1, N);
    if (col.length < 2) {
        const p = col[0] ?? { x: 0, y: 0, z: 0 };
        return Array.from({ length: n + 1 }, () => ({ ...p }));
    }
    const st = curveSTFromPolyline(col);
    const lipS = floorMm < SPLINE_DS_FLOOR_MM - 1e-15 ? Number.POSITIVE_INFINITY : 0;
    const fillLo = landing ? SPLINE_BODY_FILL_LO : 0;
    const fillHi = landing ? SPLINE_BODY_FILL_HI : 1;
    const table = tableFromST(st, n, lipS, fillLo, fillHi);
    const dense = densifyPolyline(col, SPLINE_W_DENSE);
    const rawU: number[] = [];
    for (let k = 0; k <= n; k++) {
        if (k === 0) rawU.push(0);
        else if (k === n) rawU.push(1);
        else rawU.push(invertDensityW(table, f[k] ?? k / n));
    }
    const u = landing ? clampLandingFractions(rawU) : rawU;
    const pts: XYZ[] = [];
    for (let k = 0; k <= n; k++) {
        if (k === 0) pts.push({ ...col[0]! });
        else if (k === n) pts.push({ ...col[col.length - 1]! });
        else pts.push(evalDensePolyline(dense, u[k] ?? k / n));
    }
    return pts;
}

export function samplePolylineAtArcFractions(col: XYZ[], alphas: number[]): XYZ[] {
    const dense = densifyPolyline(col, SPLINE_W_DENSE);
    const out: XYZ[] = [];
    for (let k = 0; k < alphas.length; k++) {
        if (k === 0) out.push({ ...(col[0] ?? dense[0]!) });
        else if (k === alphas.length - 1) out.push({ ...(col[col.length - 1] ?? dense[dense.length - 1]!) });
        else out.push(evalDensePolyline(dense, Math.max(0, Math.min(1, alphas[k] ?? 0))));
    }
    return out;
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
    if (s.maxOppTurnDeg >= SPLINE_INFL_TURN_MIN_DEG) {
        misses.push(`opp-turn ${s.maxOppTurnDeg.toFixed(3)}`);
    }
    if (s.g1RDeg > SPLINE_G1_R_MAX_DEG + 1e-6) misses.push(`G1-E ${s.g1RDeg.toFixed(3)}`);
    if (s.seamBDeg > SPLINE_G1_R_MAX_DEG + 1e-6) misses.push(`G1-B ${s.seamBDeg.toFixed(3)}`);
    if (s.maxTurnDeg > SPLINE_TURN_MAX_DEG + 1e-6) misses.push(`turn ${s.maxTurnDeg.toFixed(3)}`);
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
        sBound: s.sBound,
        kappaRatio: s.kappaRatio,
        kappaMaxMean: s.kappaMaxMean,
        sagitta: s.sagitta,
        sagFrac: s.sagFrac,
        peakZFrac: s.peakZFrac,
        g1RDeg: s.g1RDeg,
        seamBDeg: s.seamBDeg,
        infl: s.infl ? 1 : 0,
        inflCount: s.inflCount,
        maxOppTurnDeg: s.maxOppTurnDeg,
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

export function hybridWeightAt(
    u: number,
    sideSign: 1 | -1,
    lengthMm: number,
    arch?: HybridArchSpan | null,
    forefootRound = true,
): number {
    if (arch) return hybridArchWeight(u, sideSign, arch);
    void lengthMm;
    void forefootRound;
    return 0;
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

function szList(col: XYZ[], origin: XYZ, h: { x: number; y: number }): Sz[] {
    return col.map((p) => toSz(p, origin, h));
}

/** First z (from E toward B) where the tangent is ≥ 45° from +z. */
export function zAt45FromVertical(
    col: XYZ[],
    origin: XYZ,
    h: { x: number; y: number },
    deg = SPLINE_BLEND_FROM_VERTICAL_DEG,
): number {
    const pts = szList(col, origin, h);
    const need = (deg * Math.PI) / 180;
    for (let i = 0; i < pts.length - 1; i++) {
        const ds = (pts[i + 1]?.s ?? 0) - (pts[i]?.s ?? 0);
        const dz = (pts[i + 1]?.z ?? 0) - (pts[i]?.z ?? 0);
        const ang = Math.atan2(Math.abs(ds), Math.max(Math.abs(dz), 1e-16));
        if (ang + 1e-12 >= need) {
            const prevDs = i > 0 ? pts[i]!.s - (pts[i - 1]?.s ?? pts[i]!.s) : 0;
            const prevDz = i > 0 ? pts[i]!.z - (pts[i - 1]?.z ?? pts[i]!.z) : 1;
            const prevAng = Math.atan2(Math.abs(prevDs), Math.max(Math.abs(prevDz), 1e-16));
            if (i > 0 && ang > prevAng + 1e-12) {
                const t = Math.max(0, Math.min(1, (need - prevAng) / (ang - prevAng)));
                return (pts[i - 1]!.z ?? 0) + t * ((pts[i]!.z ?? 0) - (pts[i - 1]!.z ?? 0));
            }
            return pts[i]!.z;
        }
    }
    return 0;
}

function interpSAtZ(pts: Sz[], z: number): number {
    if (!pts.length) return 0;
    if (pts.length === 1) return pts[0]!.s;
    let bestI = 0;
    let bestD = Number.POSITIVE_INFINITY;
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        const lo = Math.min(a.z, b.z);
        const hi = Math.max(a.z, b.z);
        if (z + 1e-9 < lo || z - 1e-9 > hi) continue;
        const t = hi - lo > 1e-12 ? (z - a.z) / (b.z - a.z) : 0;
        return a.s + (b.s - a.s) * t;
    }
    for (let i = 0; i < pts.length; i++) {
        const d = Math.abs((pts[i]?.z ?? 0) - z);
        if (d < bestD) {
            bestD = d;
            bestI = i;
        }
    }
    return pts[bestI]!.s;
}

function interpZAtS(pts: Sz[], s: number): number {
    if (!pts.length) return 0;
    if (pts.length === 1) return pts[0]!.z;
    let hit = Number.NaN;
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        const lo = Math.min(a.s, b.s);
        const hi = Math.max(a.s, b.s);
        if (s + 1e-9 < lo || s - 1e-9 > hi) continue;
        const t = hi - lo > 1e-12 ? (s - a.s) / (b.s - a.s) : 0;
        hit = a.z + (b.z - a.z) * t;
    }
    if (Number.isFinite(hit)) return hit;
    let bestI = 0;
    let bestD = Number.POSITIVE_INFINITY;
    for (let i = 0; i < pts.length; i++) {
        const d = Math.abs((pts[i]?.s ?? 0) - s);
        if (d < bestD) {
            bestD = d;
            bestI = i;
        }
    }
    return pts[bestI]!.z;
}

/**
 * Graph blend of two same-topology columns.
 * Lip k = 0..NL stays per-row lerp. Body: s(z) above z_L, z(s) below.
 */
export function blendColumnsGraph(
    straight: XYZ[],
    round: XYZ[],
    w: number,
    R: XYZ,
    B: XYZ,
    h: { x: number; y: number },
    nLip: number,
    zL: number,
): XYZ[] {
    const fr = stationSzFrame(R, B, h);
    const n = Math.min(straight.length, round.length);
    const sS = szList(straight, fr.origin, fr.h);
    const sR = szList(round, fr.origin, fr.h);
    const out: XYZ[] = [];
    for (let k = 0; k < n; k++) {
        if (k === 0) {
            out.push({ ...straight[0]! });
            continue;
        }
        if (k === n - 1) {
            out.push({ ...straight[n - 1]! });
            continue;
        }
        if (k <= nLip) {
            const a = sS[k]!;
            const b = sR[k]!;
            out.push(fromSz({ s: a.s + (b.s - a.s) * w, z: a.z + (b.z - a.z) * w }, fr.origin, fr.h));
            continue;
        }
        const zRef = (1 - w) * (sS[k]?.z ?? 0) + w * (sR[k]?.z ?? 0);
        if (zRef >= zL - 1e-9) {
            const s = (1 - w) * interpSAtZ(sS, zRef) + w * interpSAtZ(sR, zRef);
            out.push(fromSz({ s, z: zRef }, fr.origin, fr.h));
        } else {
            const sRef = (1 - w) * (sS[k]?.s ?? 0) + w * (sR[k]?.s ?? 0);
            const z = (1 - w) * interpZAtS(sS, sRef) + w * interpZAtS(sR, sRef);
            out.push(fromSz({ s: sRef, z }, fr.origin, fr.h));
        }
    }
    if (out.length) {
        out[0] = { ...straight[0]! };
        out[out.length - 1] = { ...straight[straight.length - 1]! };
        if (nLip >= 0 && nLip < out.length) {
            const eS = sS[nLip];
            const eR = sR[nLip];
            if (eS && eR) {
                out[nLip] = fromSz(
                    { s: eS.s + (eR.s - eS.s) * w, z: eS.z + (eR.z - eS.z) * w },
                    fr.origin,
                    fr.h,
                );
            }
        }
        const eZ = nLip >= 0 && nLip < out.length ? toSz(out[nLip]!, fr.origin, fr.h).z : Number.NaN;
        if (Number.isFinite(eZ) && zL < eZ - 1e-6) {
            let best = -1;
            let bestD = Number.POSITIVE_INFINITY;
            for (let k = nLip + 1; k < out.length - 1; k++) {
                const z = toSz(out[k]!, fr.origin, fr.h).z;
                const d = Math.abs(z - zL);
                if (d < bestD) {
                    bestD = d;
                    best = k;
                }
            }
            if (best > nLip) {
                const sJoin = (1 - w) * interpSAtZ(sS, zL) + w * interpSAtZ(sR, zL);
                out[best] = fromSz({ s: sJoin, z: zL }, fr.origin, fr.h);
            }
        }
    }
    return out;
}

function faceN3Local(a: XYZ, b: XYZ, c: XYZ): XYZ | null {
    const n = cross3(sub(b, a), sub(c, a));
    const l = hypot3(n);
    if (l < 1e-12) return null;
    return { x: n.x / l, y: n.y / l, z: n.z / l };
}

export interface RimDiagonalChoice {
    diag: 0 | 1;
    nWall: XYZ | null;
    deg: number;
    dot: number;
}

/**
 * Rim-adjacent quad (Ri, Rip, row1p, row1i). Pick the diagonal whose
 * max dihedral to nTop is smaller. diag 0 = a–c, diag 1 = b–d.
 */
export function chooseRimDiagonal(
    Ri: XYZ,
    Rip: XYZ,
    row1i: XYZ,
    row1p: XYZ,
    nTop: XYZ | null,
): RimDiagonalChoice {
    const options: Array<{ diag: 0 | 1; rim: [XYZ, XYZ, XYZ]; other: [XYZ, XYZ, XYZ] }> = [
        { diag: 0, rim: [Ri, row1p, Rip], other: [Ri, row1i, row1p] },
        { diag: 1, rim: [Ri, Rip, row1i], other: [Rip, row1p, row1i] },
    ];
    let best: RimDiagonalChoice = { diag: 0, nWall: null, deg: 180, dot: -1 };
    for (const opt of options) {
        const nRim = faceN3Local(opt.rim[0], opt.rim[1], opt.rim[2]);
        const nOther = faceN3Local(opt.other[0], opt.other[1], opt.other[2]);
        if (!nRim) continue;
        const dRim = nTop ? vecAngleDeg(nTop, nRim) : 0;
        const dOther = nTop && nOther ? vecAngleDeg(nTop, nOther) : dRim;
        const deg = Math.max(dRim, dOther);
        const nDot = nTop ? dot(nTop, nRim) : 1;
        if (deg < best.deg - 1e-9) best = { diag: opt.diag, nWall: nRim, deg, dot: nDot };
    }
    return best;
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

/** Per-station quadratic. λ and lip turn are faired on the rim before build. */
export function applySplineRing(inputs: SplineStationInput[]): SplineSolve[] {
    return inputs.map((inp) => solveSplineStation(inp));
}
