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
    return Math.max(
        0,
        Math.min(WALL_W_MAX, b * smoothstep01(WALL_H_SMOOTH_LO_MM, WALL_H_SMOOTH_HI_MM, heightMm)),
    );
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

/** Closest intersection of lines E+s tE and F+t tF. Null if parallel. */
export function intersectTangentLines(E: XYZ, tE: XYZ, F: XYZ, tF: XYZ): XYZ | null {
    const d = unit3(tE);
    const e = unit3(tF);
    const w0 = sub3(E, F);
    const a = dot3(d, d);
    const b = dot3(d, e);
    const c = dot3(e, e);
    const den = a * c - b * b;
    if (Math.abs(den) < 1e-12) return null;
    const s = (b * dot3(e, w0) - c * dot3(d, w0)) / den;
    const t = (a * dot3(e, w0) - b * dot3(d, w0)) / den;
    if (s < 1e-6) return null;
    const towardE = dot3(e, sub3(E, F));
    if (towardE > 0 && t < 1e-6) return null;
    if (towardE < 0 && t > -1e-6) return null;
    const p0 = add3(E, d, s);
    const p1 = add3(F, e, t);
    return scale3(add3(p0, p1), 0.5);
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
        planBoundsOf(sampleConicByArcLength(E, M, F, ww, n), R, F, outward, planOutMm).ok;
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

export interface MidStyleSample {
    pts: XYZ[];
    weight: number;
    M: XYZ | null;
    bulge: number;
}

/**
 * E→F mid-style. Straight = ruled line. Round/hybrid = rational quadratic
 * through the E/F tangent intersection, G1 at both ends.
 */
export function sampleWallMidStyle(
    E: XYZ,
    F: XYZ,
    tE: XYZ,
    tF: XYZ,
    R: XYZ,
    n: number,
    heightMm: number,
    outward: { x: number; y: number },
    params: WallStyleParams,
    bulgeAtStation: number,
): MidStyleSample {
    if (params.style === "straight" || bulgeAtStation <= 1e-9 || n < 1) {
        return { pts: sampleStraightMid(E, F, n), weight: 0, M: null, bulge: 0 };
    }
    const M = intersectTangentLines(E, tE, F, tF);
    if (!M) return { pts: sampleStraightMid(E, F, n), weight: 0, M: null, bulge: bulgeAtStation };
    const chord = dist3(E, F);
    const maxOff = Math.min(WALL_BULGE_OFFSET_FRAC * chord, WALL_BULGE_OFFSET_MAX_MM);
    let w = midStyleWeight(heightMm, bulgeAtStation);
    w = clampWeightForChordOffset(E, M, F, w, maxOff);
    w = bisectWeightForPlan(E, M, F, R, w, n, outward, params.planOutMm);
    if (w <= 1e-6) return { pts: sampleStraightMid(E, F, n), weight: 0, M, bulge: bulgeAtStation };
    return { pts: sampleConicByArcLength(E, M, F, w, n), weight: w, M, bulge: bulgeAtStation };
}

export function stationBulge(params: WallStyleParams, u: number, sideSign: 1 | -1, lengthMm: number): number {
    if (params.style === "straight") return 0;
    if (params.style === "round") return params.bulge;
    return hybridBulgeAt(u, sideSign, lengthMm, params.bulge, params.forefootRound);
}
