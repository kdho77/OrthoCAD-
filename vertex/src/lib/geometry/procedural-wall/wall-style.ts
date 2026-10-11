// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { ProceduralWallStyle } from "./modifiers";

export interface XYZ {
    x: number;
    y: number;
    z: number;
}

export const WALL_BULGE_DEFAULT = 0.6;
export const WALL_PLAN_OUT_DEFAULT_MM = 2;
export const WALL_BULGE_OFFSET_FRAC = 0.25;
export const WALL_BULGE_OFFSET_MAX_MM = 3;
export const WALL_W_MAX = 0.9;
/** Keep a tiny weight so a valid G1 M never collapses onto the chord. */
export const WALL_W_MIN = 1e-3;
export const WALL_LAMBDA_MIN = 1 / 3;
export const WALL_LAMBDA_BULGE_SPAN = 0.6 - 1 / 3;
export const WALL_STYLE_G1_MAX_DEG = 1;
export const WALL_STYLE_G1_OUT_MAX_DEG = 0.1;
export const WALL_MID_TURN_TARGET_DEG = 3;
export const WALL_MID_TURN_MAX_DEG = 4;
export const WALL_MID_DIHEDRAL_MAX_DEG = 4;
/** Target, not blocking. */
export const WALL_STYLE_ACROSS_P99_MAX_DEG = 3;
export const WALL_STYLE_ACROSS_P99_BLOCK_DEG = 6;
export const WALL_STYLE_ACROSS_P100_BLOCK_DEG = 8;
export const WALL_MID_SMOOTH_SIGMA_MM = 10;
export const WALL_MID_ROW_CAP = 32;
export const WALL_MID_TURN_DENSE = 256;
export const WALL_MID_INFL_SAMPLES = 32;
export const WALL_PLAN_ANGLE_REPORT_DEG = 30;
/** End-tangent tilt: β ramps 0.10 heel → 0.18 arch (default 0.15). */
export const WALL_BETA_HEEL = 0.1;
export const WALL_BETA_ARCH = 0.18;
export const WALL_BETA_DEFAULT = 0.15;
export const WALL_BETA_H_CAP = 0.3;
export const WALL_THETA_RATE_DEG = 1;
export const WALL_CHORD_OFF_MEDIAN_FRAC = 0.1;
export const WALL_CHORD_OFF_H_MIN_MM = 8;
export const WALL_ARCH_U = 0.55;
export const HYBRID_SWITCH_U_MEDIAL = 0.3;
export const HYBRID_SWITCH_U_LATERAL = 0.28;
export const HYBRID_BLEND_MM = 20;
export const WALL_H_SMOOTH_LO_MM = 3;
export const WALL_H_SMOOTH_HI_MM = 12;

export interface WallStyleParams {
    style: ProceduralWallStyle;
    bulge: number;
    planOutMm: number;
    forefootRound: boolean;
}

export function resolveWallStyleParams(input?: Partial<WallStyleParams>): WallStyleParams {
    const bulge = Number.isFinite(input?.bulge)
        ? Math.max(0, Math.min(1, input!.bulge!))
        : WALL_BULGE_DEFAULT;
    const planOutMm = Number.isFinite(input?.planOutMm)
        ? Math.max(0, Math.min(4, input!.planOutMm!))
        : WALL_PLAN_OUT_DEFAULT_MM;
    return {
        style: input?.style ?? "straight",
        bulge,
        planOutMm,
        forefootRound: input?.forefootRound !== false,
    };
}

export function smoothstep01(e0: number, e1: number, x: number): number {
    if (e0 === e1) return x < e0 ? 0 : 1;
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
}

/** Heel straight → arch/midfoot/forefoot round. Lateral switch is 0.28, medial 0.30. */
export function hybridBulgeAt(
    u: number,
    sideSign: 1 | -1,
    lengthMm: number,
    bulgeRound: number,
    forefootRound = true,
): number {
    const sw = sideSign > 0 ? HYBRID_SWITCH_U_MEDIAL : HYBRID_SWITCH_U_LATERAL;
    const lb = HYBRID_BLEND_MM / Math.max(lengthMm, 1e-3);
    let w = bulgeRound * smoothstep01(sw - 0.5 * lb, sw + 0.5 * lb, u);
    if (!forefootRound) {
        const ff = 1 - (sideSign > 0 ? HYBRID_SWITCH_U_MEDIAL : HYBRID_SWITCH_U_LATERAL);
        w *= 1 - smoothstep01(ff - 0.5 * lb, ff + 0.5 * lb, u);
    }
    return w;
}

export function midStyleWeight(heightMm: number, bulge: number): number {
    const b = Math.max(0, Math.min(1, bulge));
    const h = smoothstep01(WALL_H_SMOOTH_LO_MM, WALL_H_SMOOTH_HI_MM, heightMm);
    return Math.max(0, Math.min(WALL_W_MAX, WALL_W_MAX * (b / WALL_BULGE_DEFAULT) * h));
}

/** β(u): 0.10 at the heel → 0.18 at the arch, then hold. */
export function wallBetaAt(u: number): number {
    const t = smoothstep01(0, WALL_ARCH_U, u);
    return WALL_BETA_HEEL + (WALL_BETA_ARCH - WALL_BETA_HEEL) * t;
}

/**
 * E-only tilt that realizes sagitta h on chord d.
 * With tF along the chord, offset/d = (1/4) tan(α/2) and λ = 2/(3(1+cos α)),
 * so α = 2 atan(4h/d). The written 2 atan(2h/d) is the two-end circular
 * form; F stays on the faired ring so only E is tilted.
 */
export function thetaFromSagitta(h: number, d: number): number {
    if (!(d > 1e-9) || !(h > 0)) return 0;
    return 2 * Math.atan((4 * Math.max(0, h)) / d);
}

/** Circular-arc cubic handle: λ = 2 / (3 (1 + cos(θ/2))). θ = 0 → 1/3. */
export function lambdaFromTheta(theta: number): number {
    const a = 0.5 * Math.max(0, theta);
    const den = 3 * (1 + Math.cos(a));
    if (!(den > 1e-12)) return WALL_LAMBDA_MIN;
    return Math.max(WALL_LAMBDA_MIN, 2 / den);
}

export function clampSagitta(beta: number, d: number, planOutMm: number): number {
    if (!(d > 1e-9) || !(beta > 0)) return 0;
    return Math.min(Math.max(0, beta) * d, WALL_BETA_H_CAP * d, Math.max(0, planOutMm));
}

/** λ from the station θ(h). `bulge` is β (sagitta / chord). */
export function midStyleLambda(_heightMm: number, bulge: number): number {
    const h = Math.min(Math.max(0, bulge), WALL_BETA_H_CAP);
    return lambdaFromTheta(thetaFromSagitta(h, 1));
}

function hypot3(a: XYZ): number {
    return Math.hypot(a.x, a.y, a.z);
}

function add3(a: XYZ, b: XYZ, s = 1): XYZ {
    return { x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s };
}

function sub3(a: XYZ, b: XYZ): XYZ {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale3(a: XYZ, s: number): XYZ {
    return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function dot3(a: XYZ, b: XYZ): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

function unit3(a: XYZ): XYZ {
    const l = hypot3(a) || 1;
    return { x: a.x / l, y: a.y / l, z: a.z / l };
}

function dist3(a: XYZ, b: XYZ): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function lerp3(a: XYZ, b: XYZ, t: number): XYZ {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

function cross3(a: XYZ, b: XYZ): XYZ {
    return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

export function acuteVecDeg(a: XYZ, b: XYZ): number {
    const du = hypot3(a) || 1;
    const dv = hypot3(b) || 1;
    const c = Math.max(-1, Math.min(1, dot3(a, b) / (du * dv)));
    const deg = (Math.acos(c) * 180) / Math.PI;
    return Math.min(deg, 180 - deg);
}

function orientToward(t: XYZ, target: XYZ, from: XYZ): XYZ {
    const w = sub3(target, from);
    return dot3(t, w) < 0 ? scale3(t, -1) : t;
}

/** Closest intersection of rays E+s tE and F+t tF. Null if parallel, skew, or behind E. */
export function intersectTangentLines(E: XYZ, tE: XYZ, F: XYZ, tF: XYZ): XYZ | null {
    const d = orientToward(unit3(tE), F, E);
    const e = orientToward(unit3(tF), E, F);
    const w0 = sub3(E, F);
    const b = dot3(d, e);
    const den = 1 - b * b;
    if (Math.abs(den) < 1e-6 || Math.abs(b) > 0.999) return null;
    const s = (b * dot3(e, w0) - dot3(d, w0)) / den;
    const t = (dot3(e, w0) - b * dot3(d, w0)) / den;
    if (s < 0.15 || t < 0.15) return null;
    const p0 = add3(E, d, s);
    const p1 = add3(F, e, t);
    const M = scale3(add3(p0, p1), 0.5);
    const g1 = g1OfConic(E, M, F, d, e);
    if (g1.e > WALL_STYLE_G1_MAX_DEG + 1e-6 || g1.f > WALL_STYLE_G1_MAX_DEG + 1e-6) return null;
    return M;
}

export interface G1Control {
    M: XYZ;
    s: number;
    t: number;
    gap: number;
    tE: XYZ;
    tF: XYZ;
}

function closestLineParams(
    E: XYZ,
    d: XYZ,
    F: XYZ,
    e: XYZ,
): { s: number; t: number; p0: XYZ; p1: XYZ; gap: number } | null {
    const w0 = sub3(E, F);
    const b = dot3(d, e);
    const den = 1 - b * b;
    if (Math.abs(den) < 1e-10) return null;
    const s = (b * dot3(e, w0) - dot3(d, w0)) / den;
    const t = (dot3(e, w0) - b * dot3(d, w0)) / den;
    const p0 = add3(E, d, s);
    const p1 = add3(F, e, t);
    return { s, t, p0, p1, gap: dist3(p0, p1) };
}

/**
 * M on the E tangent and (as far as the F tangent allows) on the F tangent.
 * Never slides M off tE to meet a bound — callers reduce w instead.
 */
export function g1ControlPoint(E: XYZ, tE: XYZ, F: XYZ, tF: XYZ): G1Control | null {
    const d = orientToward(unit3(tE), F, E);
    const e = orientToward(unit3(tF), E, F);
    const tan1 = Math.tan((Math.PI / 180) * WALL_STYLE_G1_MAX_DEG);
    const hit = closestLineParams(E, d, F, e);
    if (hit && hit.s >= 0.15 && hit.t >= 0.15) {
        const angE = (hit.gap * 0.5) / Math.max(hit.s, 1e-9);
        const angF = (hit.gap * 0.5) / Math.max(hit.t, 1e-9);
        if (angE <= tan1 && angF <= tan1) {
            const M = scale3(add3(hit.p0, hit.p1), 0.5);
            return { M, s: dist3(M, E), t: dist3(M, F), gap: hit.gap, tE: d, tF: e };
        }
    }
    const onRay = (): G1Control => {
        const s = Math.max(0.15, 0.35 * dist3(E, F));
        const M = add3(E, d, s);
        return { M, s, t: dist3(M, F), gap: dist3(M, add3(F, e, s)), tE: d, tF: e };
    };
    const ef = sub3(F, E);
    let n = cross3(d, ef);
    if (hypot3(n) < 1e-10) n = cross3(d, e);
    if (hypot3(n) < 1e-10) return onRay();
    n = unit3(n);
    const ePlane = sub3(e, scale3(n, dot3(e, n)));
    if (hypot3(ePlane) < 1e-10) return onRay();
    const eUse = unit3(ePlane);
    const plane = closestLineParams(E, d, F, eUse);
    if (plane && plane.s >= 0.15 && plane.t >= 0.15) {
        const M = add3(E, d, plane.s);
        return { M, s: plane.s, t: dist3(M, F), gap: plane.gap, tE: d, tF: e };
    }
    return onRay();
}

export function g1OfConic(E: XYZ, M: XYZ, F: XYZ, tE: XYZ, tF: XYZ): { e: number; f: number } {
    return {
        e: acuteVecDeg(sub3(M, E), tE),
        f: acuteVecDeg(sub3(M, F), tF),
    };
}

export function vecAngleDeg(a: XYZ, b: XYZ): number {
    const du = hypot3(a) || 1;
    const dv = hypot3(b) || 1;
    const c = Math.max(-1, Math.min(1, dot3(a, b) / (du * dv)));
    return (Math.acos(c) * 180) / Math.PI;
}

/** Plan-projected angle between tE and tF (0–180). */
export function planAngleDeg(tE: XYZ, tF: XYZ): number {
    return vecAngleDeg({ x: tE.x, y: tE.y, z: 0 }, { x: tF.x, y: tF.y, z: 0 });
}

export function hermiteControls(
    E: XYZ,
    F: XYZ,
    tE: XYZ,
    tF: XYZ,
    lambda: number,
): {
    P0: XYZ;
    P1: XYZ;
    P2: XYZ;
    P3: XYZ;
    d: number;
} {
    const d = dist3(E, F);
    const a = Math.max(0, lambda) * d;
    const uE = unit3(tE);
    const uF = unit3(tF);
    return {
        P0: { ...E },
        P1: add3(E, uE, a),
        P2: add3(F, uF, -a),
        P3: { ...F },
        d,
    };
}

export function evalCubicHermite(P0: XYZ, P1: XYZ, P2: XYZ, P3: XYZ, t: number): XYZ {
    const u = 1 - t;
    const uu = u * u;
    const tt = t * t;
    return {
        x: uu * u * P0.x + 3 * uu * t * P1.x + 3 * u * tt * P2.x + tt * t * P3.x,
        y: uu * u * P0.y + 3 * uu * t * P1.y + 3 * u * tt * P2.y + tt * t * P3.y,
        z: uu * u * P0.z + 3 * uu * t * P1.z + 3 * u * tt * P2.z + tt * t * P3.z,
    };
}

export function cubicHermiteTangent(P0: XYZ, P1: XYZ, P2: XYZ, P3: XYZ, t: number): XYZ {
    const u = 1 - t;
    return {
        x: 3 * u * u * (P1.x - P0.x) + 6 * u * t * (P2.x - P1.x) + 3 * t * t * (P3.x - P2.x),
        y: 3 * u * u * (P1.y - P0.y) + 6 * u * t * (P2.y - P1.y) + 3 * t * t * (P3.y - P2.y),
        z: 3 * u * u * (P1.z - P0.z) + 6 * u * t * (P2.z - P1.z) + 3 * t * t * (P3.z - P2.z),
    };
}

function cubicHermiteSecond(P0: XYZ, P1: XYZ, P2: XYZ, P3: XYZ, t: number): XYZ {
    const u = 1 - t;
    return {
        x: 6 * u * (P0.x - 2 * P1.x + P2.x) + 6 * t * (P1.x - 2 * P2.x + P3.x),
        y: 6 * u * (P0.y - 2 * P1.y + P2.y) + 6 * t * (P1.y - 2 * P2.y + P3.y),
        z: 6 * u * (P0.z - 2 * P1.z + P2.z) + 6 * t * (P1.z - 2 * P2.z + P3.z),
    };
}

export function g1OfCubic(P0: XYZ, P1: XYZ, P2: XYZ, P3: XYZ, tE: XYZ, tF: XYZ): { e: number; f: number } {
    return {
        e: acuteVecDeg(sub3(P1, P0), tE),
        f: acuteVecDeg(sub3(P3, P2), tF),
    };
}

export function inflectionNormal(tE: XYZ, tF: XYZ, outward: { x: number; y: number }): XYZ {
    const n = cross3(unit3(tE), unit3(tF));
    if (hypot3(n) > 1e-8) return unit3(n);
    const h = { x: outward.x, y: outward.y, z: 0 };
    const hz = cross3(h, { x: 0, y: 0, z: 1 });
    if (hypot3(hz) > 1e-10) return unit3(hz);
    return { x: 0, y: 1, z: 0 };
}

export function cubicHasInflection(
    P0: XYZ,
    P1: XYZ,
    P2: XYZ,
    P3: XYZ,
    tE: XYZ,
    tF: XYZ,
    outward: { x: number; y: number },
    samples = WALL_MID_INFL_SAMPLES,
): boolean {
    const n = inflectionNormal(unit3(tE), unit3(tF), outward);
    const out3 = { x: outward.x, y: outward.y, z: 0 };
    const ks: number[] = [];
    let pos = 0;
    let neg = 0;
    for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        const d1 = cubicHermiteTangent(P0, P1, P2, P3, t);
        const d2 = cubicHermiteSecond(P0, P1, P2, P3, t);
        ks.push(dot3(cross3(d1, d2), n));
        const p = evalCubicHermite(P0, P1, P2, P3, t);
        const s = signedChordOffset(p, P0, P3, out3);
        if (s > pos) pos = s;
        if (-s > neg) neg = -s;
    }
    const maxAbs = Math.max(...ks.map((k) => Math.abs(k)), 0);
    const eps = Math.max(1e-8, 0.02 * maxAbs);
    let sign = 0;
    let flipped = false;
    for (const k of ks) {
        if (Math.abs(k) < eps) continue;
        const s = k > 0 ? 1 : -1;
        if (sign === 0) sign = s;
        else if (s !== sign) flipped = true;
    }
    // A nearly-straight cubic with 2–3° end-tangent mismatch has a
    // mathematical sign flip and ~0.02 mm lobes. Flag only a visible S.
    const vis = 0.25;
    return flipped && pos > vis && neg > vis;
}

function signedChordOffset(p: XYZ, a: XYZ, b: XYZ, n: XYZ): number {
    const ab = sub3(b, a);
    const len2 = dot3(ab, ab);
    const t = len2 < 1e-16 ? 0 : dot3(sub3(p, a), ab) / len2;
    return dot3(sub3(p, add3(a, ab, t)), n);
}

function pointToLineDist(p: XYZ, a: XYZ, b: XYZ): number {
    const ab = sub3(b, a);
    const len2 = dot3(ab, ab);
    if (len2 < 1e-16) return dist3(p, a);
    const t = Math.max(0, Math.min(1, dot3(sub3(p, a), ab) / len2));
    return dist3(p, add3(a, ab, t));
}

export function cubicMaxChordOffset(
    P0: XYZ,
    P1: XYZ,
    P2: XYZ,
    P3: XYZ,
    samples = WALL_MID_INFL_SAMPLES,
): number {
    let max = 0;
    for (let i = 1; i < samples; i++) {
        max = Math.max(max, pointToLineDist(evalCubicHermite(P0, P1, P2, P3, i / samples), P0, P3));
    }
    return max;
}

function denseCubic(P0: XYZ, P1: XYZ, P2: XYZ, P3: XYZ, n = WALL_MID_INFL_SAMPLES): XYZ[] {
    const pts: XYZ[] = [];
    for (let i = 0; i <= n; i++) pts.push(evalCubicHermite(P0, P1, P2, P3, i / n));
    return pts;
}

export function cubicTurningTotal(P0: XYZ, P1: XYZ, P2: XYZ, P3: XYZ, tE: XYZ, tF: XYZ): number {
    let acc = 0;
    let prev = cubicHermiteTangent(P0, P1, P2, P3, 0);
    for (let i = 1; i <= WALL_MID_TURN_DENSE; i++) {
        const tan = cubicHermiteTangent(P0, P1, P2, P3, i / WALL_MID_TURN_DENSE);
        acc += vecAngleDeg(prev, tan);
        prev = tan;
    }
    const end = vecAngleDeg(tE, tF);
    const internal = Math.max(0, acc - end);
    return end + internal;
}

/** Mid rows at t_k = k/N on the Hermite parameter. Includes F, excludes E. */
export function sampleCubicUniformT(P0: XYZ, P1: XYZ, P2: XYZ, P3: XYZ, n: number): XYZ[] {
    if (n < 1) return [];
    const pts: XYZ[] = [];
    for (let k = 1; k <= n; k++) {
        pts.push(k === n ? { ...P3 } : evalCubicHermite(P0, P1, P2, P3, k / n));
    }
    return pts;
}

export function sampleCubicAtT(P0: XYZ, P1: XYZ, P2: XYZ, P3: XYZ, ts: number[]): XYZ[] {
    if (!ts.length) return [];
    return ts.map((t, i) =>
        i === ts.length - 1 ? { ...P3 } : evalCubicHermite(P0, P1, P2, P3, Math.max(0, Math.min(1, t))),
    );
}

/** Equal-turning Hermite parameters (includes F, excludes E). */
export function cubicTurningTValues(P0: XYZ, P1: XYZ, P2: XYZ, P3: XYZ, n: number): number[] {
    if (n < 1) return [];
    const steps = WALL_MID_TURN_DENSE;
    const acc = [0];
    let prevTan = cubicHermiteTangent(P0, P1, P2, P3, 0);
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const tan = cubicHermiteTangent(P0, P1, P2, P3, t);
        acc.push(acc[i - 1]! + vecAngleDeg(prevTan, tan));
        prevTan = tan;
    }
    const total = acc[steps]!;
    const ts: number[] = [];
    if (total < 1e-6) {
        for (let k = 1; k <= n; k++) ts.push(k / n);
        return ts;
    }
    for (let k = 1; k <= n; k++) {
        const target = (k / n) * total;
        let i = 1;
        while (i < acc.length && acc[i]! < target) i++;
        const a = acc[i - 1]!;
        const b = acc[i] ?? a;
        const u = b > a + 1e-12 ? (target - a) / (b - a) : 0;
        const t0 = (i - 1) / steps;
        const t1 = i / steps;
        ts.push(k === n ? 1 : t0 + (t1 - t0) * u);
    }
    ts[ts.length - 1] = 1;
    return ts;
}

/** Rows by equal turning. Includes F, excludes E. Invert 256 dense samples. */
export function sampleCubicByTurning(P0: XYZ, P1: XYZ, P2: XYZ, P3: XYZ, n: number): XYZ[] {
    if (n < 1) return [];
    const steps = WALL_MID_TURN_DENSE;
    const dense: XYZ[] = [];
    const acc = [0];
    let prevTan = cubicHermiteTangent(P0, P1, P2, P3, 0);
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const p = evalCubicHermite(P0, P1, P2, P3, t);
        if (i > 0) {
            const tan = cubicHermiteTangent(P0, P1, P2, P3, t);
            acc.push(acc[i - 1]! + vecAngleDeg(prevTan, tan));
            prevTan = tan;
        }
        dense.push(p);
    }
    const total = acc[steps]!;
    if (total < 1e-6) {
        const pts: XYZ[] = [];
        for (let k = 1; k <= n; k++) pts.push(evalCubicHermite(P0, P1, P2, P3, k / n));
        pts[pts.length - 1] = { ...P3 };
        return pts;
    }
    const pts: XYZ[] = [];
    for (let k = 1; k <= n; k++) {
        const target = (k / n) * total;
        let i = 1;
        while (i < acc.length && acc[i]! < target) i++;
        const a = acc[i - 1]!;
        const b = acc[i] ?? a;
        const u = b > a + 1e-12 ? (target - a) / (b - a) : 0;
        const t0 = (i - 1) / steps;
        const t1 = i / steps;
        pts.push(k === n ? { ...P3 } : evalCubicHermite(P0, P1, P2, P3, t0 + (t1 - t0) * u));
    }
    return pts;
}

export function cubicRowCountByTurning(
    P0: XYZ,
    P1: XYZ,
    P2: XYZ,
    P3: XYZ,
    tE: XYZ,
    tF: XYZ,
    maxDeg = WALL_MID_TURN_MAX_DEG,
    targetDeg = WALL_MID_TURN_TARGET_DEG,
): number {
    const total = cubicTurningTotal(P0, P1, P2, P3, tE, tF);
    let n = Math.max(2, Math.ceil(total / Math.max(targetDeg, 1e-3)));
    for (let k = 0; k < 8; k++) {
        const pts = [P0, ...sampleCubicByTurning(P0, P1, P2, P3, n)];
        const turn = maxPolylineTurnDeg(pts);
        if (turn <= maxDeg + 1e-6 || n >= WALL_MID_ROW_CAP) return Math.min(WALL_MID_ROW_CAP, n);
        n = Math.min(WALL_MID_ROW_CAP, Math.max(n + 1, Math.ceil((n * turn) / maxDeg)));
    }
    return n;
}

/** N so uniform-t samples stay ≤ the mid-turn gate. */
export function cubicRowCountByUniformT(
    P0: XYZ,
    P1: XYZ,
    P2: XYZ,
    P3: XYZ,
    tE: XYZ,
    tF: XYZ,
    maxDeg = WALL_MID_TURN_MAX_DEG,
    targetDeg = WALL_MID_TURN_TARGET_DEG,
): number {
    let n = cubicRowCountByTurning(P0, P1, P2, P3, tE, tF, maxDeg, targetDeg);
    for (let k = 0; k < 8; k++) {
        const pts = [P0, ...sampleCubicUniformT(P0, P1, P2, P3, n)];
        const turn = maxPolylineTurnDeg(pts);
        if (turn <= maxDeg + 1e-6 || n >= WALL_MID_ROW_CAP) return Math.min(WALL_MID_ROW_CAP, n);
        n = Math.min(WALL_MID_ROW_CAP, Math.max(n + 1, Math.ceil((n * turn) / maxDeg)));
    }
    return n;
}

/** Rational quadratic (E, M, F) with end weights 1 and control weight w. */
export function evalRationalQuadratic(E: XYZ, M: XYZ, F: XYZ, w: number, t: number): XYZ {
    const u = 1 - t;
    const w0 = u * u;
    const w1 = 2 * u * t * w;
    const w2 = t * t;
    const den = w0 + w1 + w2;
    if (den < 1e-16) return { ...E };
    return {
        x: (w0 * E.x + w1 * M.x + w2 * F.x) / den,
        y: (w0 * E.y + w1 * M.y + w2 * F.y) / den,
        z: (w0 * E.z + w1 * M.z + w2 * F.z) / den,
    };
}

export function chordOffsetAtMid(E: XYZ, M: XYZ, F: XYZ, w: number): number {
    const mid = evalRationalQuadratic(E, M, F, w, 0.5);
    const chord = lerp3(E, F, 0.5);
    return dist3(mid, chord);
}

export function clampWeightForChordOffset(E: XYZ, M: XYZ, F: XYZ, w: number, maxOff: number): number {
    if (maxOff <= 0 || chordOffsetAtMid(E, M, F, w) <= maxOff + 1e-9) return w;
    let lo = 0;
    let hi = w;
    for (let i = 0; i < 16; i++) {
        const mid = 0.5 * (lo + hi);
        if (chordOffsetAtMid(E, M, F, mid) <= maxOff + 1e-9) lo = mid;
        else hi = mid;
    }
    return lo;
}

export function sampleConicByArcLength(E: XYZ, M: XYZ, F: XYZ, w: number, n: number): XYZ[] {
    const steps = Math.max(8, n * 8);
    const dense: XYZ[] = [];
    const acc = [0];
    for (let i = 0; i <= steps; i++) {
        const p = evalRationalQuadratic(E, M, F, w, i / steps);
        if (i > 0) acc.push(acc[i - 1]! + dist3(dense[i - 1]!, p));
        dense.push(p);
    }
    const total = acc[steps]!;
    const pts: XYZ[] = [];
    for (let k = 1; k <= n; k++) {
        const target = (k / n) * total;
        let i = 1;
        while (i < acc.length && acc[i]! < target) i++;
        const a = acc[i - 1]!;
        const b = acc[i] ?? a;
        const t = b > a + 1e-12 ? (target - a) / (b - a) : 0;
        pts.push(k === n ? { ...F } : lerp3(dense[i - 1]!, dense[i] ?? F, t));
    }
    return pts;
}

function conicTangent(E: XYZ, M: XYZ, F: XYZ, w: number, t: number): XYZ {
    const u = 1 - t;
    const nx = u * u * E.x + 2 * u * t * w * M.x + t * t * F.x;
    const ny = u * u * E.y + 2 * u * t * w * M.y + t * t * F.y;
    const nz = u * u * E.z + 2 * u * t * w * M.z + t * t * F.z;
    const den = u * u + 2 * u * t * w + t * t;
    const dnx = -2 * u * E.x + 2 * (1 - 2 * t) * w * M.x + 2 * t * F.x;
    const dny = -2 * u * E.y + 2 * (1 - 2 * t) * w * M.y + 2 * t * F.y;
    const dnz = -2 * u * E.z + 2 * (1 - 2 * t) * w * M.z + 2 * t * F.z;
    const dden = -2 * u + 2 * (1 - 2 * t) * w + 2 * t;
    return { x: dnx * den - nx * dden, y: dny * den - ny * dden, z: dnz * den - nz * dden };
}

function conicTurningTotal(E: XYZ, M: XYZ, F: XYZ, w: number, steps = 48): number {
    let total = 0;
    let prev = conicTangent(E, M, F, w, 0);
    for (let i = 1; i <= steps; i++) {
        const tan = conicTangent(E, M, F, w, i / steps);
        total += acuteVecDeg(prev, tan);
        prev = tan;
    }
    return total;
}

/** Rows so adjacent samples turn by the same angle. Includes F, excludes E. */
export function sampleConicByTurning(E: XYZ, M: XYZ, F: XYZ, w: number, n: number): XYZ[] {
    if (n < 1) return [];
    const steps = Math.max(64, n * 16);
    const dense: XYZ[] = [];
    const acc = [0];
    let prevTan = conicTangent(E, M, F, w, 0);
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const p = evalRationalQuadratic(E, M, F, w, t);
        if (i > 0) {
            const tan = conicTangent(E, M, F, w, t);
            acc.push(acc[i - 1]! + acuteVecDeg(prevTan, tan));
            prevTan = tan;
        }
        dense.push(p);
    }
    const total = acc[steps]!;
    if (total < 1e-6) return sampleStraightMid(E, F, n);
    const pts: XYZ[] = [];
    for (let k = 1; k <= n; k++) {
        const target = (k / n) * total;
        let i = 1;
        while (i < acc.length && acc[i]! < target) i++;
        const a = acc[i - 1]!;
        const b = acc[i] ?? a;
        const u = b > a + 1e-12 ? (target - a) / (b - a) : 0;
        pts.push(k === n ? { ...F } : lerp3(dense[i - 1]!, dense[i] ?? F, u));
    }
    let minSp = pts.length ? dist3(E, pts[0]!) : Infinity;
    for (let i = 1; i < pts.length; i++) minSp = Math.min(minSp, dist3(pts[i]!, pts[i - 1]!));
    if (minSp < 0.01) return sampleConicByArcLength(E, M, F, w, n);
    return pts;
}

export function maxPolylineTurnDeg(pts: XYZ[]): number {
    let max = 0;
    for (let i = 1; i < pts.length - 1; i++) {
        max = Math.max(max, acuteVecDeg(sub3(pts[i]!, pts[i - 1]!), sub3(pts[i + 1]!, pts[i]!)));
    }
    return max;
}

/** Rows by equal turning. Target ~3°, then raise until the gate (≤4°) holds. */
export function conicRowCountByTurning(
    E: XYZ,
    M: XYZ,
    F: XYZ,
    w: number,
    maxDeg = WALL_MID_TURN_MAX_DEG,
    targetDeg = WALL_MID_TURN_TARGET_DEG,
): number {
    const total = conicTurningTotal(E, M, F, w);
    let n = Math.max(2, Math.ceil(total / Math.max(targetDeg, 1e-3)));
    for (let k = 0; k < 8; k++) {
        const pts = [E, ...sampleConicByTurning(E, M, F, w, n)];
        const turn = maxPolylineTurnDeg(pts);
        if (turn <= maxDeg + 1e-6 || n >= WALL_MID_ROW_CAP) return Math.min(WALL_MID_ROW_CAP, n);
        n = Math.min(WALL_MID_ROW_CAP, Math.max(n + 1, Math.ceil((n * turn) / maxDeg)));
    }
    return n;
}

export interface PlanBoundReport {
    insetMin: number;
    offsetMax: number;
    ok: boolean;
}

/** Outward plan: +n. inset = proj − min(R,F); offset = proj − max(R,F). */
export function planBoundsOf(
    samples: XYZ[],
    R: XYZ,
    F: XYZ,
    outward: { x: number; y: number },
    planOutMm: number,
): PlanBoundReport {
    const nl = Math.hypot(outward.x, outward.y) || 1;
    const nx = outward.x / nl;
    const ny = outward.y / nl;
    const proj = (p: XYZ): number => p.x * nx + p.y * ny;
    const inner = Math.min(proj(R), proj(F));
    const outer = Math.max(proj(R), proj(F));
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
        ok: insetMin >= -1e-6 && offsetMax <= planOutMm + 1e-6,
    };
}

export function bisectWeightForPlan(
    E: XYZ,
    M: XYZ,
    F: XYZ,
    R: XYZ,
    w: number,
    n: number,
    outward: { x: number; y: number },
    planOutMm: number,
): number {
    const ok = (ww: number): boolean =>
        planBoundsOf(sampleConicByTurning(E, M, F, ww, n), R, F, outward, planOutMm).ok;
    if (ok(w)) return w;
    let lo = 0;
    let hi = w;
    for (let i = 0; i < 16; i++) {
        const mid = 0.5 * (lo + hi);
        if (ok(mid)) lo = mid;
        else hi = mid;
    }
    return lo;
}

export function sampleStraightMid(E: XYZ, F: XYZ, n: number): XYZ[] {
    const pts: XYZ[] = [];
    for (let k = 1; k <= n; k++) pts.push(lerp3(E, F, k / n));
    return pts;
}

export type MidStyleLimit = "none" | "lambda" | "chord" | "plan" | "infl";

export interface MidStyleSample {
    pts: XYZ[];
    weight: number;
    lambda: number;
    P1: XYZ;
    P2: XYZ;
    M: XYZ | null;
    bulge: number;
    s?: number;
    t?: number;
    g1EDeg?: number;
    g1FDeg?: number;
    rowNeed?: number;
    chordOffsetMm?: number;
    planOffsetMm?: number;
    planAngleDeg?: number;
    limit?: MidStyleLimit;
    flagged?: boolean;
}

export interface MidStyleLock {
    lambda?: number;
    theta?: number;
    ts?: number[];
    w?: number;
}

function lineG1(E: XYZ, F: XYZ, tE: XYZ, tF: XYZ): { e: number; f: number } {
    return {
        e: acuteVecDeg(sub3(F, E), tE),
        f: acuteVecDeg(sub3(E, F), tF),
    };
}

function cubicBoundsOk(
    ctrl: { P0: XYZ; P1: XYZ; P2: XYZ; P3: XYZ },
    tE: XYZ,
    tF: XYZ,
    R: XYZ,
    F: XYZ,
    outward: { x: number; y: number },
    planOutMm: number,
    maxOff: number,
): { ok: boolean; infl: boolean; chord: number; plan: PlanBoundReport } {
    const infl = cubicHasInflection(ctrl.P0, ctrl.P1, ctrl.P2, ctrl.P3, tE, tF, outward);
    const chord = cubicMaxChordOffset(ctrl.P0, ctrl.P1, ctrl.P2, ctrl.P3);
    const plan = planBoundsOf(denseCubic(ctrl.P0, ctrl.P1, ctrl.P2, ctrl.P3), R, F, outward, planOutMm);
    return {
        ok: !infl && chord <= maxOff + 1e-9 && plan.ok,
        infl,
        chord,
        plan,
    };
}

/**
 * E→F mid-style. Straight = ruled line (unchanged vs the ALA). Round/hybrid =
 * cubic Bezier Hermite: P1 = E + a tE, P2 = F − b tF, a = b = λ d. Bounds
 * bisect λ toward 1/3 and never move P1/P2 off their tangent rays.
 */
export function sampleWallMidStyle(
    E: XYZ,
    F: XYZ,
    tE: XYZ,
    tF: XYZ,
    R: XYZ,
    n: number,
    _heightMm: number,
    outward: { x: number; y: number },
    params: WallStyleParams,
    bulgeAtStation: number,
    lock?: MidStyleLock,
): MidStyleSample {
    const planAng = planAngleDeg(tE, tF);
    if (params.style === "straight" || n < 1) {
        const g1 = lineG1(E, F, tE, tF);
        const empty = { x: 0, y: 0, z: 0 };
        return {
            pts: n < 1 ? [] : sampleStraightMid(E, F, n),
            weight: WALL_LAMBDA_MIN,
            lambda: WALL_LAMBDA_MIN,
            P1: E,
            P2: F,
            M: null,
            bulge: 0,
            g1EDeg: g1.e,
            g1FDeg: g1.f,
            planAngleDeg: planAng,
        };
    }
    const d = dist3(E, F);
    const maxOff = Math.min(WALL_BETA_H_CAP * d, params.planOutMm, WALL_BULGE_OFFSET_MAX_MM);
    const hWanted = clampSagitta(Math.max(bulgeAtStation, 0), d, params.planOutMm);
    const thetaWanted =
        lock?.theta != null && Number.isFinite(lock.theta)
            ? Math.max(0, lock.theta)
            : thetaFromSagitta(hWanted, d);
    const wanted = lock?.lambda ?? lambdaFromTheta(thetaWanted);
    const check = (lam: number) =>
        cubicBoundsOk(hermiteControls(E, F, tE, tF, lam), tE, tF, R, F, outward, params.planOutMm, maxOff);
    let lambda = wanted;
    let limit: MidStyleLimit = "none";
    let flagged = false;
    const atWanted = check(wanted);
    if (!atWanted.ok) {
        const atMin = check(WALL_LAMBDA_MIN);
        if (atMin.ok && wanted > WALL_LAMBDA_MIN + 1e-12) {
            let lo = WALL_LAMBDA_MIN;
            let hi = wanted;
            for (let i = 0; i < 16; i++) {
                const mid = 0.5 * (lo + hi);
                if (check(mid).ok) lo = mid;
                else hi = mid;
            }
            lambda = lo;
            if (atWanted.infl) limit = "infl";
            else if (atWanted.chord > maxOff + 1e-9) limit = "chord";
            else if (!atWanted.plan.ok) limit = "plan";
            else limit = "lambda";
        } else {
            lambda = WALL_LAMBDA_MIN;
            if (atMin.infl) {
                flagged = true;
                limit = "infl";
            } else if (atMin.chord > maxOff + 1e-9) limit = "chord";
            else if (!atMin.plan.ok) limit = "plan";
            else limit = "lambda";
        }
    }
    const ctrl = hermiteControls(E, F, tE, tF, lambda);
    const pts =
        lock?.ts && lock.ts.length === n
            ? sampleCubicAtT(ctrl.P0, ctrl.P1, ctrl.P2, ctrl.P3, lock.ts)
            : sampleCubicByTurning(ctrl.P0, ctrl.P1, ctrl.P2, ctrl.P3, n);
    const chordOff = cubicMaxChordOffset(ctrl.P0, ctrl.P1, ctrl.P2, ctrl.P3);
    const plan = planBoundsOf(pts, R, F, outward, params.planOutMm);
    const g1 = g1OfCubic(ctrl.P0, ctrl.P1, ctrl.P2, ctrl.P3, tE, tF);
    return {
        pts,
        weight: lambda,
        lambda,
        P1: ctrl.P1,
        P2: ctrl.P2,
        M: null,
        bulge: bulgeAtStation,
        s: dist3(ctrl.P1, E),
        t: dist3(ctrl.P2, F),
        g1EDeg: g1.e,
        g1FDeg: g1.f,
        rowNeed: cubicRowCountByTurning(ctrl.P0, ctrl.P1, ctrl.P2, ctrl.P3, tE, tF),
        chordOffsetMm: chordOff,
        planOffsetMm: plan.offsetMax,
        planAngleDeg: planAng,
        limit,
        flagged,
    };
}

export function stationBulge(params: WallStyleParams, u: number, sideSign: 1 | -1, lengthMm: number): number {
    if (params.style === "straight") return 0;
    if (params.style === "round") return params.bulge;
    return hybridBulgeAt(u, sideSign, lengthMm, params.bulge, params.forefootRound);
}

/** β used for the end-tangent tilt. HYBRID = β(u) × the existing 0–1 blend. */
export function stationBeta(params: WallStyleParams, u: number, sideSign: 1 | -1, lengthMm: number): number {
    if (params.style === "straight") return 0;
    const beta = wallBetaAt(u);
    if (params.style === "round") return beta;
    const blend = hybridBulgeAt(u, sideSign, lengthMm, 1, params.forefootRound);
    return beta * blend;
}
