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
export const WALL_STYLE_G1_MAX_DEG = 1;
export const WALL_MID_TURN_TARGET_DEG = 3;
export const WALL_MID_TURN_MAX_DEG = 4;
export const WALL_MID_DIHEDRAL_MAX_DEG = 4;
/** Target, not blocking. */
export const WALL_STYLE_ACROSS_P99_MAX_DEG = 3;
export const WALL_STYLE_ACROSS_P99_BLOCK_DEG = 5;
export const WALL_STYLE_ACROSS_P100_BLOCK_DEG = 8;
export const WALL_MID_SMOOTH_SIGMA_MM = 10;
export const WALL_MID_ROW_CAP = 32;
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
    // Default bulge 0.6 reaches w = 0.9 on tall walls so the conic can hit the
    // chord-offset bound. Lower bulge scales down from that.
    return Math.max(0, Math.min(WALL_W_MAX, WALL_W_MAX * (b / WALL_BULGE_DEFAULT) * h));
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

export interface MidStyleSample {
    pts: XYZ[];
    weight: number;
    M: XYZ | null;
    bulge: number;
    s?: number;
    t?: number;
    g1EDeg?: number;
    g1FDeg?: number;
    rowNeed?: number;
    chordOffsetMm?: number;
    planOffsetMm?: number;
    limit?: "none" | "w" | "chord" | "plan";
    flagged?: boolean;
}

export interface MidStyleLock {
    M?: XYZ;
    w: number;
}

function clampMidWeight(
    E: XYZ,
    M: XYZ,
    F: XYZ,
    R: XYZ,
    wWanted: number,
    n: number,
    outward: { x: number; y: number },
    planOutMm: number,
    maxOff: number,
): { w: number; afterChord: number } {
    const w0 = Math.max(WALL_W_MIN, Math.min(WALL_W_MAX, wWanted));
    const afterChord = clampWeightForChordOffset(E, M, F, w0, maxOff);
    const w = Math.max(WALL_W_MIN, bisectWeightForPlan(E, M, F, R, afterChord, n, outward, planOutMm));
    return { w, afterChord };
}

function lineG1(E: XYZ, F: XYZ, tE: XYZ, tF: XYZ): { e: number; f: number } {
    return {
        e: acuteVecDeg(sub3(F, E), tE),
        f: acuteVecDeg(sub3(E, F), tF),
    };
}

/**
 * E→F mid-style. Straight = ruled line. Round/hybrid = rational quadratic
 * whose control M is the E/F tangent intersection. Bounds shrink w only.
 * Never invents an off-tangent M.
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
    lock?: MidStyleLock,
): MidStyleSample {
    if (params.style === "straight" || n < 1) {
        const g1 = lineG1(E, F, tE, tF);
        return {
            pts: sampleStraightMid(E, F, n),
            weight: 0,
            M: null,
            bulge: 0,
            g1EDeg: g1.e,
            g1FDeg: g1.f,
        };
    }
    const chord = dist3(E, F);
    const maxOff = Math.min(WALL_BULGE_OFFSET_FRAC * chord, WALL_BULGE_OFFSET_MAX_MM);
    const M = intersectTangentLines(E, tE, F, tF);
    if (!M) {
        const g1 = lineG1(E, F, tE, tF);
        return {
            pts: sampleStraightMid(E, F, n),
            weight: 0,
            M: null,
            bulge: bulgeAtStation,
            chordOffsetMm: 0,
            planOffsetMm: 0,
            limit: "none",
            g1EDeg: g1.e,
            g1FDeg: g1.f,
            rowNeed: n,
            flagged: true,
        };
    }
    let wWanted = lock?.w ?? midStyleWeight(heightMm, Math.max(bulgeAtStation, 0));
    if (lock?.w == null && bulgeAtStation <= 1e-9) wWanted = WALL_W_MIN;
    const { w, afterChord } = clampMidWeight(E, M, F, R, wWanted, n, outward, params.planOutMm, maxOff);
    const pts = sampleConicByTurning(E, M, F, w, n);
    const chordOff = chordOffsetAtMid(E, M, F, w);
    const plan = planBoundsOf(pts, R, F, outward, params.planOutMm);
    const g1 = g1OfConic(E, M, F, tE, tF);
    let limit: "none" | "w" | "chord" | "plan" = "none";
    if (w + 1e-6 < afterChord) limit = "plan";
    else if (afterChord + 1e-6 < wWanted) limit = "chord";
    else if (wWanted + 1e-6 < WALL_W_MAX) limit = "w";
    return {
        pts,
        weight: w,
        M,
        bulge: bulgeAtStation,
        s: dist3(M, E),
        t: dist3(M, F),
        g1EDeg: g1.e,
        g1FDeg: g1.f,
        rowNeed: conicRowCountByTurning(E, M, F, w),
        chordOffsetMm: chordOff,
        planOffsetMm: plan.offsetMax,
        limit,
        flagged: false,
    };
}

export function stationBulge(params: WallStyleParams, u: number, sideSign: 1 | -1, lengthMm: number): number {
    if (params.style === "straight") return 0;
    if (params.style === "round") return params.bulge;
    return hybridBulgeAt(u, sideSign, lengthMm, params.bulge, params.forefootRound);
}
