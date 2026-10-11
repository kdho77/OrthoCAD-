// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    hybridBulgeAt,
    smoothstep01,
    WALL_ARCH_U,
    WALL_H_SMOOTH_HI_MM,
    WALL_H_SMOOTH_LO_MM,
} from "./wall-style";

export interface XYZ {
    x: number;
    y: number;
    z: number;
}

export const SPLINE_DEGREE = 3;
export const SPLINE_KNOTS = [0, 0, 0, 0, 1 / 3, 2 / 3, 1, 1, 1, 1];
export const SPLINE_A_FRAC = 0.25;
export const SPLINE_C_FRAC = 0.25;
export const SPLINE_BETA_HEEL = 0.15;
export const SPLINE_BETA_ARCH = 0.2;
export const SPLINE_ASYM_LO = -0.5;
export const SPLINE_ASYM_HI = 0.5;
export const SPLINE_PEAK_LO = 0.45;
export const SPLINE_PEAK_HI = 0.55;
export const SPLINE_PEAK_GATE_LO = 0.4;
export const SPLINE_PEAK_GATE_HI = 0.6;
export const SPLINE_SAG_LO = 0.15;
export const SPLINE_SAG_HI = 0.25;
export const SPLINE_H_MIN_MM = 6;
export const SPLINE_BISECT = 30;
export const SPLINE_DENSE = 512;
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
}

export interface SplineSolve {
    pts: XYZ[];
    poly: XYZ[];
    gamma: number;
    asym: number;
    a: number;
    c: number;
    H: number;
    Ls: number;
    sagitta: number;
    sagFrac: number;
    peakZFrac: number;
    g1RDeg: number;
    seamBDeg: number;
    infl: boolean;
    convex: boolean;
    insetMin: number;
    planOffset: number;
    maxTurnDeg: number;
    fallbackStraight: boolean;
}

export interface SplineGatePrint {
    u: number;
    side: 1 | -1;
    H: number;
    gamma: number;
    asym: number;
    a: number;
    sagitta: number;
    sagFrac: number;
    peakZFrac: number;
    g1RDeg: number;
    seamBDeg: number;
    infl: number;
    convex: boolean;
    insetMin: number;
    planOffset: number;
    maxTurnDeg: number;
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

/** β: 0.15 heel → 0.20 arch/midfoot, both sides. */
export function splineBetaAt(u: number): number {
    const t = smoothstep01(0, WALL_ARCH_U, u);
    return SPLINE_BETA_HEEL + (SPLINE_BETA_ARCH - SPLINE_BETA_HEEL) * t;
}

export function splineHeightScale(heightMm: number): number {
    return smoothstep01(WALL_H_SMOOTH_LO_MM, WALL_H_SMOOTH_HI_MM, heightMm);
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

export function buildSplinePolygon(
    R: XYZ,
    B: XYZ,
    h: { x: number; y: number },
    tR: XYZ,
    a: number,
    gamma: number,
    asym: number,
): XYZ[] {
    const fr = stationSzFrame(R, B, h);
    const tOver = overEdgeTangent(tR, fr.h);
    const P0 = { ...R };
    const P1 = add(R, tOver, a);
    const P4 = { x: B.x - fr.h.x * SPLINE_C_FRAC * fr.H, y: B.y - fr.h.y * SPLINE_C_FRAC * fr.H, z: B.z };
    const P5 = { ...B };
    const { C, n, tUp } = chordFrame(fr.H, fr.Ls);
    const up2 = (fr.H / 6) * (1 + asym);
    const up3 = (fr.H / 6) * (1 - asym);
    const p2 = { s: C.s + gamma * n.s + up2 * tUp.s, z: C.z + gamma * n.z + up2 * tUp.z };
    const p3 = { s: C.s + gamma * n.s - up3 * tUp.s, z: C.z + gamma * n.z - up3 * tUp.z };
    const origin = fr.origin;
    return [P0, P1, fromSz(p2, origin, fr.h), fromSz(p3, origin, fr.h), P4, P5];
}

/** Clamped cubic B-spline. Knots [0,0,0,0, 1/3, 2/3, 1,1,1,1]. */
export function evalClampedCubic(points: XYZ[], t: number, knots: number[] = SPLINE_KNOTS): XYZ {
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

export function splineTangent(points: XYZ[], t: number, knots: number[] = SPLINE_KNOTS): XYZ {
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
    R: XYZ,
    B: XYZ,
    h: { x: number; y: number },
): {
    sag: number;
    peakZFrac: number;
} {
    const n = chordOutwardNormal(R, B, h);
    const H = Math.max(R.z - B.z, 1e-6);
    let sag = 0;
    let peakZ = 0.5 * H;
    for (const p of samples) {
        const off = signedChordOffset(p, R, B, n);
        if (off >= sag) {
            sag = off;
            peakZ = p.z - B.z;
        }
    }
    return { sag, peakZFrac: peakZ / H };
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

export function polylineInfl(samples: XYZ[], R: XYZ, B: XYZ, h: { x: number; y: number }): boolean {
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
    for (const k of ks) {
        if (Math.abs(k) < eps) continue;
        const s = k > 0 ? 1 : -1;
        if (sign === 0) sign = s;
        else if (s !== sign) return true;
    }
    return false;
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

function sampleStraight(R: XYZ, B: XYZ, n: number): XYZ[] {
    const pts: XYZ[] = [];
    for (let i = 0; i <= n; i++) pts.push(lerp(R, B, i / Math.max(n, 1)));
    return pts;
}

function measureOf(poly: XYZ[], R: XYZ, B: XYZ, h: { x: number; y: number }, tR: XYZ) {
    const dense = sampleSplineDense(poly);
    const sag = splineSagitta(dense, R, B, h);
    const plan = planBounds(dense, R, B, h);
    return {
        dense,
        ...sag,
        ...plan,
        infl: polylineInfl(dense, R, B, h),
        convex: polygonConvex(poly, h),
        g1RDeg: g1AtR(poly, tR, h),
        seamBDeg: seamBDeg(dense),
        maxTurnDeg: maxPolylineTurn(dense),
    };
}

/**
 * Per-station solve: gamma (sagitta), then asym (peak z), then plan bounds,
 * then convexity (reduce a, then gamma). 30 bisections each.
 */
export function solveSplineStation(input: SplineStationInput): SplineSolve {
    const { R, B, tR } = input;
    const planOut = input.planOutMm ?? SPLINE_PLAN_OUT_MM;
    const fr = stationSzFrame(R, B, input.h);
    const H = input.heightMm ?? fr.H;
    const a0 = SPLINE_A_FRAC * H;
    const targetSag = splineBetaAt(input.u) * splineHeightScale(H) * H;
    const targetPeak = 0.5;

    const tryAt = (a: number, gamma: number, asym: number) => {
        const poly = buildSplinePolygon(R, B, fr.h, tR, a, gamma, asym);
        return { poly, m: measureOf(poly, R, B, fr.h, tR) };
    };

    let a = a0;
    let gamma = Math.max(0, targetSag);
    let asym = 0;
    const gMax = Math.max(targetSag * 4, H);

    const bisectGamma = (lo: number, hi: number, want: number, asymUse: number, aUse: number): number => {
        let l = lo;
        let h = hi;
        let best = l;
        for (let i = 0; i < SPLINE_BISECT; i++) {
            const mid = 0.5 * (l + h);
            const { m } = tryAt(aUse, mid, asymUse);
            best = mid;
            if (m.sag < want) l = mid;
            else h = mid;
        }
        return best;
    };

    gamma = bisectGamma(0, gMax, targetSag, asym, a);

    const bisectAsym = (gammaUse: number, aUse: number): number => {
        let lo = SPLINE_ASYM_LO;
        let hi = SPLINE_ASYM_HI;
        let best = 0;
        for (let i = 0; i < SPLINE_BISECT; i++) {
            const mid = 0.5 * (lo + hi);
            const { m } = tryAt(aUse, gammaUse, mid);
            best = mid;
            if (m.peakZFrac < targetPeak) lo = mid;
            else hi = mid;
        }
        return best;
    };
    asym = bisectAsym(gamma, a);
    gamma = bisectGamma(0, gMax, targetSag, asym, a);
    asym = bisectAsym(gamma, a);

    const boundsOk = (g: number, aUse: number, as: number): boolean => {
        const { m } = tryAt(aUse, g, as);
        return m.insetMin >= -1e-6 && m.offsetMax <= planOut + 1e-6;
    };
    if (!boundsOk(gamma, a, asym)) {
        let lo = 0;
        let hi = gamma;
        for (let i = 0; i < SPLINE_BISECT; i++) {
            const mid = 0.5 * (lo + hi);
            if (boundsOk(mid, a, asym)) lo = mid;
            else hi = mid;
        }
        gamma = lo;
    }

    const convexOk = (aUse: number, g: number, as: number): boolean => tryAt(aUse, g, as).m.convex;
    if (!convexOk(a, gamma, asym)) {
        let lo = 0.05 * a0;
        let hi = a;
        if (convexOk(lo, gamma, asym)) {
            for (let i = 0; i < SPLINE_BISECT; i++) {
                const mid = 0.5 * (lo + hi);
                if (convexOk(mid, gamma, asym)) lo = mid;
                else hi = mid;
            }
            a = lo;
        } else {
            a = lo;
            let glo = 0;
            let ghi = gamma;
            if (convexOk(a, 0, asym)) {
                for (let i = 0; i < SPLINE_BISECT; i++) {
                    const mid = 0.5 * (glo + ghi);
                    if (convexOk(a, mid, asym)) glo = mid;
                    else ghi = mid;
                }
                gamma = glo;
            } else {
                gamma = 0;
            }
        }
    }

    const { poly, m } = tryAt(a, gamma, asym);
    const fallback = gamma <= 1e-9 && !m.convex;
    return {
        pts: fallback ? sampleStraight(R, B, 16) : m.dense,
        poly: fallback ? [R, lerp(R, B, 0.2), lerp(R, B, 0.4), lerp(R, B, 0.6), lerp(R, B, 0.8), B] : poly,
        gamma: fallback ? 0 : gamma,
        asym: fallback ? 0 : asym,
        a: fallback ? 0 : a,
        c: SPLINE_C_FRAC * H,
        H,
        Ls: fr.Ls,
        sagitta: fallback ? 0 : m.sag,
        sagFrac: fallback ? 0 : m.sag / H,
        peakZFrac: fallback ? 0.5 : m.peakZFrac,
        g1RDeg: fallback ? 0 : m.g1RDeg,
        seamBDeg: fallback ? 0 : m.seamBDeg,
        infl: fallback ? false : m.infl,
        convex: fallback ? true : m.convex,
        insetMin: fallback ? 0 : m.insetMin,
        planOffset: fallback ? 0 : m.offsetMax,
        maxTurnDeg: fallback ? 0 : m.maxTurnDeg,
        fallbackStraight: fallback,
    };
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

export function periodicGaussian1d(vals: number[], arc: number[], sigma = SPLINE_SMOOTH_SIGMA_MM): number[] {
    const n = vals.length;
    if (n < 3) return vals.slice();
    const period = arc[arc.length - 1]! || 1;
    const sig = Math.max(1e-3, sigma);
    return vals.map((_, i) => {
        let s = 0;
        let w = 0;
        const ci = arc[i]!;
        for (let j = 0; j < n; j++) {
            let d = Math.abs(arc[j]! - ci);
            d = Math.min(d, period - d);
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
    if (s.peakZFrac + 1e-9 < SPLINE_PEAK_GATE_LO || s.peakZFrac - 1e-9 > SPLINE_PEAK_GATE_HI) {
        misses.push(`peak ${s.peakZFrac.toFixed(3)}`);
    }
    if (s.H >= SPLINE_H_MIN_MM - 1e-9) {
        if (s.sagFrac + 1e-9 < SPLINE_SAG_LO || s.sagFrac - 1e-9 > SPLINE_SAG_HI) {
            misses.push(`sag ${s.sagFrac.toFixed(3)}`);
        }
    }
    if (s.g1RDeg > SPLINE_G1_R_MAX_DEG + 1e-6) misses.push(`G1-R ${s.g1RDeg.toFixed(3)}`);
    if (s.seamBDeg > SPLINE_SEAM_B_MAX_DEG + 1e-6) misses.push(`seam-B ${s.seamBDeg.toFixed(3)}`);
    if (s.maxTurnDeg > SPLINE_TURN_MAX_DEG + 1e-6) misses.push(`turn ${s.maxTurnDeg.toFixed(3)}`);
    if (s.insetMin < -1e-6) misses.push(`inset ${s.insetMin.toFixed(4)}`);
    if (s.planOffset > SPLINE_PLAN_OUT_MM + 1e-6) misses.push(`plan ${s.planOffset.toFixed(3)}`);
    return {
        u,
        side,
        H: s.H,
        gamma: s.gamma,
        asym: s.asym,
        a: s.a,
        sagitta: s.sagitta,
        sagFrac: s.sagFrac,
        peakZFrac: s.peakZFrac,
        g1RDeg: s.g1RDeg,
        seamBDeg: s.seamBDeg,
        infl: s.infl ? 1 : 0,
        convex: s.convex,
        insetMin: s.insetMin,
        planOffset: s.planOffset,
        maxTurnDeg: s.maxTurnDeg,
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

export function columnConvex(samples: XYZ[], h: { x: number; y: number }): boolean {
    return polygonConvex(samples, h);
}
