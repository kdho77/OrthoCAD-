// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { ClosedC2Spline } from "./types";

export interface PolyPoint {
    x: number;
    y: number;
    z: number;
}

/** Signed XY area. Positive ⇒ CCW from +Z. */
export function polygonSignedArea(points: PolyPoint[]): number {
    let s = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i]!;
        const b = points[(i + 1) % points.length]!;
        s += a.x * b.y - b.x * a.y;
    }
    return 0.5 * s;
}

export function ensureCcw(points: PolyPoint[]): PolyPoint[] {
    return polygonSignedArea(points) < 0 ? points.slice().reverse() : points;
}

/** Rotate a closed loop so index 0 is the posterior heel (min X, then mid Y). */
export function startAtPosteriorHeel(points: PolyPoint[]): PolyPoint[] {
    if (points.length === 0) return [];
    const k = posteriorHeelIndex(points);
    return points.slice(k).concat(points.slice(0, k));
}

export function posteriorHeelIndex(points: PolyPoint[]): number {
    if (points.length === 0) return 0;
    let best = 0;
    for (let i = 1; i < points.length; i++) {
        const p = points[i]!;
        const b = points[best]!;
        if (p.x < b.x - 1e-9 || (Math.abs(p.x - b.x) <= 1e-9 && Math.abs(p.y) < Math.abs(b.y))) {
            best = i;
        }
    }
    return best;
}

/** Circumradius of the (i-1, i, i+1) triplet. Larger = lower curvature. */
export function closedCurvatureRadii(points: PolyPoint[]): number[] {
    const n = points.length;
    const out = new Array<number>(n).fill(Number.POSITIVE_INFINITY);
    for (let i = 0; i < n; i++) {
        const a = points[(i + n - 1) % n]!;
        const b = points[i]!;
        const c = points[(i + 1) % n]!;
        const ab = Math.hypot(b.x - a.x, b.y - a.y);
        const bc = Math.hypot(c.x - b.x, c.y - b.y);
        const ca = Math.hypot(a.x - c.x, a.y - c.y);
        const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
        if (area2 < 1e-10 || ab < 1e-9 || bc < 1e-9) continue;
        out[i] = (ab * bc * ca) / (2 * area2);
    }
    return out;
}

const LOW_CURVE_U0 = 0.32;
const LOW_CURVE_U1 = 0.5;

/**
 * Index of a low-curvature vertex, preferring the lateral midfoot so the
 * closed-ring seam is not at the heel apex.
 */
export function lowCurvatureStartIndex(points: PolyPoint[], bounds?: { minX: number; maxX: number }): number {
    const n = points.length;
    if (n === 0) return 0;
    let minX = bounds?.minX ?? Infinity;
    let maxX = bounds?.maxX ?? -Infinity;
    if (!bounds) {
        for (const p of points) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
        }
    }
    const length = Math.max(1e-3, maxX - minX);
    const radii = closedCurvatureRadii(points);
    let best = 0;
    let bestR = -1;
    let found = false;
    for (let i = 0; i < n; i++) {
        const u = (points[i]!.x - minX) / length;
        if (u < LOW_CURVE_U0 || u > LOW_CURVE_U1) continue;
        if (radii[i]! > bestR) {
            bestR = radii[i]!;
            best = i;
            found = true;
        }
    }
    if (!found) {
        for (let i = 0; i < n; i++) {
            if (radii[i]! > bestR) {
                bestR = radii[i]!;
                best = i;
            }
        }
    }
    return best;
}

/** Rotate a closed loop so index 0 is a low-curvature midfoot vertex. */
export function startAtLowCurvature(
    points: PolyPoint[],
    bounds?: { minX: number; maxX: number },
): PolyPoint[] {
    if (points.length === 0) return [];
    const k = lowCurvatureStartIndex(points, bounds);
    return points.slice(k).concat(points.slice(0, k));
}

export function rotateClosed<T>(items: T[], start: number): T[] {
    const n = items.length;
    if (n === 0) return [];
    const k = ((start % n) + n) % n;
    return items.slice(k).concat(items.slice(0, k));
}

export function polylineArcLengths(points: PolyPoint[]): { cum: number[]; total: number } {
    const n = points.length;
    const cum = new Array<number>(n + 1);
    cum[0] = 0;
    for (let i = 0; i < n; i++) {
        const a = points[i]!;
        const b = points[(i + 1) % n]!;
        cum[i + 1] = cum[i]! + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    }
    return { cum, total: cum[n]! };
}

/** Arc-length fraction of the nearest point on a closed polyline. */
export function nearestClosedArc01(points: PolyPoint[], p: PolyPoint): number {
    if (points.length === 0) return 0;
    if (points.length === 1) return 0;
    const { cum, total } = polylineArcLengths(points);
    const den = Math.max(total, 1e-12);
    let bestS = 0;
    let bestD = Infinity;
    for (let i = 0; i < points.length; i++) {
        const a = points[i]!;
        const b = points[(i + 1) % points.length]!;
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const ez = b.z - a.z;
        const len2 = ex * ex + ey * ey + ez * ez;
        const t =
            len2 > 1e-12
                ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey + (p.z - a.z) * ez) / len2))
                : 0;
        const dx = p.x - (a.x + ex * t);
        const dy = p.y - (a.y + ey * t);
        const dz = p.z - (a.z + ez * t);
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) {
            bestD = d;
            const seg = (cum[i + 1] ?? total) - (cum[i] ?? 0);
            bestS = ((cum[i] ?? 0) + t * seg) / den;
        }
    }
    return ((bestS % 1) + 1) % 1;
}

/** Sample a closed polyline at arc-length fraction `s01` ∈ [0, 1). */
export function sampleClosedAtArc01(points: PolyPoint[], s01: number): PolyPoint {
    if (points.length === 0) return { x: 0, y: 0, z: 0 };
    if (points.length === 1) return { ...points[0]! };
    const { cum, total } = polylineArcLengths(points);
    if (total <= 1e-12) return { ...points[0]! };
    const t = (((s01 % 1) + 1) % 1) * total;
    let j = 0;
    while (j < points.length - 1 && cum[j + 1]! < t) j++;
    const a = points[j]!;
    const b = points[(j + 1) % points.length]!;
    const seg = cum[j + 1]! - cum[j]!;
    const f = seg > 1e-12 ? (t - cum[j]!) / seg : 0;
    return {
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        z: a.z + (b.z - a.z) * f,
    };
}

/** For each vertex of `src`, sample `target` at the same closed arc-length fraction. */
export function matchClosedByArc(src: PolyPoint[], target: PolyPoint[]): PolyPoint[] {
    if (src.length === 0) return [];
    if (target.length === 0) return src.map((p) => ({ ...p }));
    const { cum, total } = polylineArcLengths(src);
    const denom = Math.max(total, 1e-12);
    return src.map((_, i) => sampleClosedAtArc01(target, cum[i]! / denom));
}

export function resamplePolyline(points: PolyPoint[], n: number): PolyPoint[] {
    if (points.length === 0 || n <= 0) return [];
    if (points.length === 1) return Array.from({ length: n }, () => ({ ...points[0]! }));
    const { cum, total } = polylineArcLengths(points);
    if (total <= 1e-12) return Array.from({ length: n }, () => ({ ...points[0]! }));
    const out: PolyPoint[] = [];
    let j = 0;
    for (let i = 0; i < n; i++) {
        const t = (i / n) * total;
        while (j < points.length - 1 && cum[j + 1]! < t) j++;
        const a = points[j]!;
        const b = points[(j + 1) % points.length]!;
        const seg = cum[j + 1]! - cum[j]!;
        const f = seg > 1e-12 ? (t - cum[j]!) / seg : 0;
        out.push({
            x: a.x + (b.x - a.x) * f,
            y: a.y + (b.y - a.y) * f,
            z: a.z + (b.z - a.z) * f,
        });
    }
    return out;
}

/**
 * Solve a periodic tridiagonal system (cyclic Thomas) for m:
 *   (1/6) m[i-1] + (2/3) m[i] + (1/6) m[i+1] = rhs[i]
 * used by the periodic cubic interpolant (C2).
 */
function solvePeriodicCubicMoments(rhs: number[]): number[] {
    const n = rhs.length;
    if (n === 0) return [];
    if (n === 1) return [rhs[0]!];
    const a = 1 / 6;
    const b = 2 / 3;
    const c = 1 / 6;
    const bb = new Array<number>(n);
    const u = new Array<number>(n);
    const v = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) bb[i] = b;
    u[0] = c;
    v[0] = a;
    u[n - 1] = a;
    v[n - 1] = c;
    bb[0]! -= c;
    bb[n - 1]! -= a;

    const y = solveTridiagonal(a, bb, c, rhs);
    const q = solveTridiagonal(a, bb, c, v);
    const vy = v[0]! * y[0]! + v[n - 1]! * y[n - 1]!;
    const vq = v[0]! * q[0]! + v[n - 1]! * q[n - 1]!;
    const denom = 1 + vq;
    const factor = Math.abs(denom) > 1e-12 ? vy / denom : 0;
    const m = new Array<number>(n);
    for (let i = 0; i < n; i++) m[i] = y[i]! - factor * q[i]!;
    return m;
}

function solveTridiagonal(a: number, bb: number[], c: number, rhs: number[]): number[] {
    const n = rhs.length;
    const cp = new Array<number>(n);
    const dp = new Array<number>(n);
    const out = new Array<number>(n);
    cp[0] = c / bb[0]!;
    dp[0] = rhs[0]! / bb[0]!;
    for (let i = 1; i < n; i++) {
        const inv = 1 / (bb[i]! - a * cp[i - 1]!);
        cp[i] = i < n - 1 ? c * inv : 0;
        dp[i] = (rhs[i]! - a * dp[i - 1]!) * inv;
    }
    out[n - 1] = dp[n - 1]!;
    for (let i = n - 2; i >= 0; i--) out[i] = dp[i]! - cp[i]! * out[i + 1]!;
    return out;
}

/** Uniform cubic B-spline basis (C2). */
function bsplineBasis(u: number): [number, number, number, number] {
    const u2 = u * u;
    const u3 = u2 * u;
    return [
        (1 - 3 * u + 3 * u2 - u3) / 6,
        (4 - 6 * u2 + 3 * u3) / 6,
        (1 + 3 * u + 3 * u2 - 3 * u3) / 6,
        u3 / 6,
    ];
}

function samplePeriodicBSpline(ctrl: PolyPoint[], s: number): PolyPoint {
    const n = ctrl.length;
    const t = (((s % 1) + 1) % 1) * n;
    const i = Math.floor(t) % n;
    const u = t - Math.floor(t);
    const [b0, b1, b2, b3] = bsplineBasis(u);
    const p0 = ctrl[(i - 1 + n) % n]!;
    const p1 = ctrl[i]!;
    const p2 = ctrl[(i + 1) % n]!;
    const p3 = ctrl[(i + 2) % n]!;
    return {
        x: b0 * p0.x + b1 * p1.x + b2 * p2.x + b3 * p3.x,
        y: b0 * p0.y + b1 * p1.y + b2 * p2.y + b3 * p3.y,
        z: b0 * p0.z + b1 * p1.z + b2 * p2.z + b3 * p3.z,
    };
}

/** Fit a periodic cubic interpolant (C2) through a closed polyline. */
export function fitClosedC2Spline(points: PolyPoint[]): ClosedC2Spline {
    const controls = startAtPosteriorHeel(ensureCcw(points.map((p) => ({ ...p }))));
    return { controls, c2: true };
}

/** Solve for interpolating cubic B-spline controls: (1/6, 2/3, 1/6) * c = p. */
function interpolatingControls(points: PolyPoint[]): PolyPoint[] {
    const n = points.length;
    const cx = solvePeriodicCubicMoments(points.map((p) => p.x));
    const cy = solvePeriodicCubicMoments(points.map((p) => p.y));
    const cz = solvePeriodicCubicMoments(points.map((p) => p.z));
    const out: PolyPoint[] = [];
    for (let i = 0; i < n; i++) out.push({ x: cx[i]!, y: cy[i]!, z: cz[i]! });
    return out;
}

/**
 * Approximating periodic cubic B-spline through `controls` (the curve stays
 * in the control hull — no interpolant overshoot).
 */
export function resampleClosedBSpline(controls: PolyPoint[], n: number): PolyPoint[] {
    if (controls.length === 0 || n <= 0) return [];
    if (controls.length < 3) return resamplePolyline(controls, n);
    const dense: PolyPoint[] = [];
    const denseN = Math.max(n * 4, controls.length * 8);
    for (let i = 0; i < denseN; i++) dense.push(samplePeriodicBSpline(controls, i / denseN));
    return startAtLowCurvature(ensureCcw(resamplePolyline(dense, n)));
}

/** Arc-length-ish resample of the closed C2 interpolating B-spline. */
export function resampleClosedC2(spline: ClosedC2Spline, n: number): PolyPoint[] {
    const controls = spline.controls;
    if (controls.length === 0 || n <= 0) return [];
    if (controls.length < 3) return resamplePolyline(controls, n);
    const bctrl = interpolatingControls(controls);
    const dense: PolyPoint[] = [];
    const denseN = Math.max(n * 4, controls.length * 2);
    for (let i = 0; i < denseN; i++) dense.push(samplePeriodicBSpline(bctrl, i / denseN));
    return startAtLowCurvature(ensureCcw(resamplePolyline(dense, n)));
}

/** Rotate `b` so station 0 matches `a` (min sum of XY distances over cyclic shifts). */
export function arcLengthMatch(a: PolyPoint[], b: PolyPoint[]): PolyPoint[] {
    const n = Math.min(a.length, b.length);
    if (n === 0) return b;
    let bestShift = 0;
    let best = Number.POSITIVE_INFINITY;
    const step = Math.max(1, Math.floor(n / 64));
    for (let shift = 0; shift < n; shift += step) {
        let s = 0;
        for (let i = 0; i < n; i += step) {
            const p = a[i]!;
            const q = b[(i + shift) % n]!;
            s += (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
        }
        if (s < best) {
            best = s;
            bestShift = shift;
        }
    }
    const lo = bestShift - step;
    const hi = bestShift + step;
    for (let shift = lo; shift <= hi; shift++) {
        const sh = ((shift % n) + n) % n;
        let s = 0;
        for (let i = 0; i < n; i += step) {
            const p = a[i]!;
            const q = b[(i + sh) % n]!;
            s += (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
        }
        if (s < best) {
            best = s;
            bestShift = sh;
        }
    }
    const fwd = b.slice(bestShift).concat(b.slice(0, bestShift));
    const revSrc = b.slice().reverse();
    const revStarted = startAtPosteriorHeel(revSrc);
    let revBest = Number.POSITIVE_INFINITY;
    let revShift = 0;
    for (let shift = 0; shift < n; shift += step) {
        let s = 0;
        for (let i = 0; i < n; i += step) {
            const p = a[i]!;
            const q = revStarted[(i + shift) % n]!;
            s += (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
        }
        if (s < revBest) {
            revBest = s;
            revShift = shift;
        }
    }
    if (revBest < best) {
        return revStarted.slice(revShift).concat(revStarted.slice(0, revShift));
    }
    return fwd;
}
