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
export const SPLINE_P1_O_FRAC = 0.5;
export const SPLINE_P1_Z_FRAC = 0.9;
export const SPLINE_BETA_HEEL = 0.15;
export const SPLINE_BETA_ARCH = 0.2;
export const SPLINE_ZY_LO = 0.2;
export const SPLINE_ZY_HI = 0.6;
export const SPLINE_ZX_MAX = 0.9;
export const SPLINE_ZX_GAP = 0.4;
export const SPLINE_O_FLOOR_FRAC = 0.08;
export const SPLINE_PEAK_LO = 0.45;
export const SPLINE_PEAK_HI = 0.55;
export const SPLINE_PEAK_GATE_LO = 0.4;
export const SPLINE_PEAK_GATE_HI = 0.6;
export const SPLINE_SAG_LO = 0.15;
export const SPLINE_SAG_HI = 0.25;
export const SPLINE_H_MIN_MM = 6;
export const SPLINE_BISECT = 30;
export const SPLINE_DENSE = 512;
export const SPLINE_W_DENSE = 2048;
export const SPLINE_W_ALPHA = 0.6;
export const SPLINE_W_THETA_MIN_DEG = 1;
export const SPLINE_F_STEP_FRAC = 0.25;
export const SPLINE_F_RING_MAX = 0.02;
export const SPLINE_MIN_EDGE_FRAC = 0.2;
export const SPLINE_STEP_RATIO_MAX = 4;
export const SPLINE_ROW1_TR_MAX_DEG = 5;
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
    /** Override sag target (mm). Production uses β k(H) H. */
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

export function splineZx(zy: number): number {
    return Math.min(SPLINE_ZX_MAX, zy + SPLINE_ZX_GAP);
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

export function splineA(o: number, zx: number, H: number, tSz: Sz): number {
    let a = SPLINE_A_FRAC * H;
    if (Math.abs(tSz.s) > 1e-14) a = Math.min(a, (SPLINE_P1_O_FRAC * o) / Math.abs(tSz.s));
    if (Math.abs(tSz.z) > 1e-14) a = Math.min(a, (SPLINE_P1_Z_FRAC * (1 - zx) * H) / Math.abs(tSz.z));
    return Math.max(0, a);
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

/**
 * Corner-cut box in (s, z): R=(0,H), B=(Ls,0), outward −s.
 * P0=R, P1=R+a tR, P2=X=(-o,zx H), P3=Y=(-o,zy H), P4=Q=(Ls-c,0), P5=B.
 * a and c follow the formulas unless `aOverride` is set (ring-smoothed a).
 */
export function buildSplinePolygon(
    R: XYZ,
    B: XYZ,
    h: { x: number; y: number },
    tR: XYZ,
    o: number,
    zy: number,
    aOverride?: number,
): XYZ[] {
    const fr = stationSzFrame(R, B, h);
    const tOver = overEdgeTangent(tR, fr.h);
    const tSz = tRInSz(tR, fr.h);
    const zx = splineZx(zy);
    const a = aOverride ?? splineA(o, zx, fr.H, tSz);
    const c = splineC(fr.Ls, o);
    const P0 = { ...R };
    const P1 = add(R, tOver, a);
    const P2 = fromSz({ s: -o, z: zx * fr.H }, fr.origin, fr.h);
    const P3 = fromSz({ s: -o, z: zy * fr.H }, fr.origin, fr.h);
    const P4 = fromSz({ s: fr.Ls - c, z: 0 }, fr.origin, fr.h);
    const P5 = { ...B };
    return [P0, P1, P2, P3, P4, P5];
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

function sampleStraight(R: XYZ, B: XYZ, n: number): XYZ[] {
    const pts: XYZ[] = [];
    for (let i = 0; i <= n; i++) pts.push(lerp(R, B, i / Math.max(n, 1)));
    return pts;
}

function measureOf(poly: XYZ[], R: XYZ, B: XYZ, h: { x: number; y: number }, tR: XYZ) {
    const dense = sampleSplineDense(poly);
    const sag = splineSagitta(dense, R, B, h);
    const plan = planBounds(dense, R, B, h);
    const inflCount = polylineInflCount(dense, R, B, h);
    return {
        dense,
        ...sag,
        ...plan,
        inflCount,
        infl: inflCount > 0,
        convex: polygonConvex(poly, h),
        g1RDeg: g1AtR(poly, tR, h),
        seamBDeg: seamBDeg(dense),
        maxTurnDeg: maxPolylineTurn(dense),
    };
}

function finishSolve(
    input: SplineStationInput,
    poly: XYZ[],
    o: number,
    zy: number,
    a: number,
    oMax: number,
    tRAngleDeg: number,
    steep: boolean,
    fallback: boolean,
): SplineSolve {
    const { R, B, tR } = input;
    const fr = stationSzFrame(R, B, input.h);
    const H = input.heightMm ?? fr.H;
    const zx = splineZx(zy);
    const c = splineC(fr.Ls, o);
    const m = measureOf(poly, R, B, fr.h, tR);
    if (fallback) {
        return {
            pts: sampleStraight(R, B, 16),
            poly: [R, lerp(R, B, 0.2), lerp(R, B, 0.4), lerp(R, B, 0.6), lerp(R, B, 0.8), B],
            o: 0,
            zy,
            zx,
            a: 0,
            c,
            H,
            Ls: fr.Ls,
            sagitta: 0,
            sagFrac: 0,
            peakZFrac: 0.5,
            g1RDeg: 0,
            seamBDeg: 0,
            infl: false,
            inflCount: 0,
            convex: true,
            insetMin: 0,
            planOffset: 0,
            maxTurnDeg: 0,
            tRAngleDeg,
            oMax,
            steep,
            fallbackStraight: true,
        };
    }
    return {
        pts: m.dense,
        poly,
        o,
        zy,
        zx,
        a,
        c,
        H,
        Ls: fr.Ls,
        sagitta: m.sag,
        sagFrac: m.sag / H,
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
        oMax,
        steep,
        fallbackStraight: false,
    };
}

/**
 * Nested monotone bisections on the corner-cut box.
 * Outer zy ∈ [0.2, 0.6] for peak vs chord RB ∈ [0.45, 0.55] H.
 * Inner o ∈ [0, o_max] for sag = β k(H) H. Convexity only lowers o.
 */
export function solveSplineStation(input: SplineStationInput): SplineSolve {
    const { R, B, tR } = input;
    const planOut = input.planOutMm ?? SPLINE_PLAN_OUT_MM;
    const fr = stationSzFrame(R, B, input.h);
    const H = input.heightMm ?? fr.H;
    const tSz = tRInSz(tR, fr.h);
    const tRAngleDeg = tRAngleBelowHorizontalDeg(tSz);
    const targetSag = input.targetSagMm ?? splineBetaAt(input.u) * splineHeightScale(H) * H;
    const targetPeak = SPLINE_PEAK_LO;

    const tryAt = (o: number, zy: number, aOverride?: number) => {
        const poly = buildSplinePolygon(R, B, fr.h, tR, o, zy, aOverride);
        return { poly, m: measureOf(poly, R, B, fr.h, tR) };
    };

    const bisectO = (zy: number): { o: number; oMax: number; steep: boolean } => {
        const zx = splineZx(zy);
        const oMax = Math.max(0, splineOMax(zx, H, tSz, planOut));
        const oFloor = H >= SPLINE_H_MIN_MM - 1e-9 ? Math.min(SPLINE_O_FLOOR_FRAC * H, oMax) : 0;
        let lo = 0;
        let hi = oMax;
        let best = 0;
        for (let i = 0; i < SPLINE_BISECT; i++) {
            const mid = 0.5 * (lo + hi);
            const { m } = tryAt(mid, zy);
            best = mid;
            if (m.sag < targetSag) lo = mid;
            else hi = mid;
        }
        let o = Math.max(best, oFloor);
        if (o > oMax) o = oMax;
        const { m } = tryAt(o, zy);
        const steep = m.sag + 1e-4 < targetSag && o >= oMax - 1e-9;
        return { o, oMax, steep };
    };

    let zyLo = SPLINE_ZY_LO;
    let zyHi = SPLINE_ZY_HI;
    let zy = zyLo;
    let inner = bisectO(zy);
    for (let i = 0; i < SPLINE_BISECT; i++) {
        zy = 0.5 * (zyLo + zyHi);
        inner = bisectO(zy);
        const { m } = tryAt(inner.o, zy);
        if (m.peakZFrac < targetPeak) zyLo = zy;
        else zyHi = zy;
    }
    zy = 0.5 * (zyLo + zyHi);
    inner = bisectO(zy);

    let { o, oMax, steep } = inner;
    if (!tryAt(o, zy).m.convex) {
        let lo = 0;
        let hi = o;
        if (tryAt(0, zy).m.convex) {
            for (let i = 0; i < SPLINE_BISECT; i++) {
                const mid = 0.5 * (lo + hi);
                if (tryAt(mid, zy).m.convex) lo = mid;
                else hi = mid;
            }
            o = lo;
        } else {
            o = 0;
        }
    }

    const zx = splineZx(zy);
    const a = splineA(o, zx, H, tSz);
    const { poly, m } = tryAt(o, zy);
    if (steep) {
        console.log(
            "[RND-STEEP]",
            JSON.stringify({
                u: Number(input.u.toFixed(4)),
                tRAngleDeg: Number(tRAngleDeg.toFixed(3)),
                o: Number(o.toFixed(4)),
                oMax: Number(oMax.toFixed(4)),
                sag: Number(m.sag.toFixed(4)),
                targetSag: Number(targetSag.toFixed(4)),
            }),
        );
    }
    const fallback = o <= 1e-9 && !m.convex;
    return finishSolve(input, poly, o, zy, a, oMax, tRAngleDeg, steep, fallback);
}

/** Rebuild a station from ring-smoothed o, zy, a. c stays on its formula. */
export function rebuildSplineStation(
    input: SplineStationInput,
    o: number,
    zy: number,
    a: number,
): SplineSolve {
    const { R, B, tR } = input;
    const planOut = input.planOutMm ?? SPLINE_PLAN_OUT_MM;
    const fr = stationSzFrame(R, B, input.h);
    const H = input.heightMm ?? fr.H;
    const tSz = tRInSz(tR, fr.h);
    const tRAngleDeg = tRAngleBelowHorizontalDeg(tSz);
    const zx = splineZx(zy);
    const oMax = splineOMax(zx, H, tSz, planOut);
    const poly = buildSplinePolygon(R, B, fr.h, tR, o, zy, a);
    const m = measureOf(poly, R, B, fr.h, tR);
    const targetSag = splineBetaAt(input.u) * splineHeightScale(H) * H;
    const steep = (m.sag + 1e-4 < targetSag && o >= oMax - 1e-9) || m.infl;
    if (steep) {
        console.log(
            "[RND-STEEP]",
            JSON.stringify({
                u: Number(input.u.toFixed(4)),
                tRAngleDeg: Number(tRAngleDeg.toFixed(3)),
                o: Number(o.toFixed(4)),
                oMax: Number(oMax.toFixed(4)),
                sag: Number(m.sag.toFixed(4)),
                rebuild: true,
            }),
        );
    }
    return finishSolve(input, poly, o, zy, a, oMax, tRAngleDeg, steep, o <= 1e-9 && !m.convex);
}

export interface SplineDensityTable {
    u: number[];
    S: number[];
    T: number[];
    W: number[];
    L: number;
    Theta: number;
    alpha: number;
}

/** 2048 uniform-u samples: cumulative arc S(u), |turning| T(u), mix W(u). */
export function buildSplineDensityTable(poly: XYZ[], nDense = SPLINE_W_DENSE): SplineDensityTable {
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
    const L = S[n]!;
    const Theta = T[n]!;
    const alpha = Theta < SPLINE_W_THETA_MIN_DEG ? 0 : SPLINE_W_ALPHA;
    const W: number[] = [];
    for (let i = 0; i <= n; i++) {
        const sTerm = L > 1e-16 ? S[i]! / L : (u[i] ?? 0);
        const tTerm = Theta > 1e-16 ? T[i]! / Theta : 0;
        W.push((1 - alpha) * sTerm + alpha * tTerm);
    }
    W[0] = 0;
    W[n] = 1;
    return { u, S, T, W, L, Theta, alpha };
}

export function invertDensityW(table: SplineDensityTable, f: number): number {
    const target = Math.max(0, Math.min(1, f));
    if (target <= 0) return 0;
    if (target >= 1) return 1;
    const W = table.W;
    let i = 1;
    while (i < W.length && (W[i] ?? 1) < target) i++;
    const a = W[i - 1]!;
    const b = W[i] ?? a;
    const t = b > a + 1e-16 ? (target - a) / (b - a) : 0;
    const u0 = table.u[i - 1]!;
    const u1 = table.u[i] ?? u0;
    return u0 + (u1 - u0) * t;
}

/** f_0 = 0, f_N = 1, f_k >= f_{k-1} + 0.25/N. */
export function enforceMonotoneF(f: number[], N: number): number[] {
    const out = f.slice();
    if (!out.length) return out;
    const n = Math.max(1, N);
    const minStep = SPLINE_F_STEP_FRAC / n;
    out[0] = 0;
    out[out.length - 1] = 1;
    for (let k = 1; k < out.length; k++) out[k] = Math.max(out[k]!, out[k - 1]! + minStep);
    out[out.length - 1] = 1;
    for (let k = out.length - 2; k >= 1; k--) {
        out[k] = Math.min(out[k]!, out[k + 1]! - minStep);
        out[k] = Math.max(out[k]!, out[k - 1]! + minStep);
    }
    out[0] = 0;
    out[out.length - 1] = 1;
    return out;
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

/**
 * Shared N (last-row index). Smooth f_k = k/N along the rim, enforce spacing,
 * invert each station's W(u). Rows 0 and N are C(0)=R and C(1)=B.
 */
export function sampleSplineRingByW(
    polys: XYZ[][],
    N: number,
    rim: XYZ[],
): { pts: XYZ[][]; f: number[][]; u: number[][]; L: number[]; Theta: number[] } {
    const nS = polys.length;
    const tables = polys.map((p) => buildSplineDensityTable(p));
    const f: number[][] = [];
    const denom = Math.max(N, 1);
    for (let i = 0; i < nS; i++) {
        const row: number[] = [];
        for (let k = 0; k <= N; k++) row.push(k / denom);
        f.push(row);
    }
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
    const u: number[][] = [];
    const pts: XYZ[][] = [];
    const L: number[] = [];
    const Theta: number[] = [];
    for (let i = 0; i < nS; i++) {
        const fk = enforceMonotoneF(f[i]!, N);
        f[i] = fk;
        const ui: number[] = [];
        const pi: XYZ[] = [];
        const poly = polys[i]!;
        const table = tables[i]!;
        for (let k = 0; k <= N; k++) {
            if (k === 0) {
                ui.push(0);
                pi.push({ ...poly[0]! });
            } else if (k === N) {
                ui.push(1);
                pi.push({ ...poly[poly.length - 1]! });
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
        o: s.o,
        zy: s.zy,
        zx: s.zx,
        a: s.a,
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

export function columnConvex(samples: XYZ[], h: { x: number; y: number }): boolean {
    return polygonConvex(samples, h);
}

/** Smooth o, zy, a on the closed rim (σ = 10 mm) and rebuild each station. */
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
    const oSm = periodicGaussian1d(
        solved.map((s) => s.o),
        rim,
        SPLINE_SMOOTH_SIGMA_MM,
        period,
    );
    const zySm = periodicGaussian1d(
        solved.map((s) => s.zy),
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
        rebuildSplineStation(inp, oSm[i] ?? 0, zySm[i] ?? SPLINE_ZY_LO, aSm[i] ?? 0),
    );
}
