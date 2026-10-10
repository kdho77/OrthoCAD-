// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { pointInPoly } from "./cdt-band";
import { ensureCcw, type PolyPoint, resamplePolyline, startAtLowCurvature } from "./curves";

export const FAIRED_CONTROL_MIN = 16;
export const FAIRED_CONTROL_MAX = 24;
export const FAIRED_CONTROL_DEFAULT = 20;
export const FAIRED_RIDGE = 1e-8;
export const FAIRED_CONSTRAINT_ITERS = 12;

export interface FairedTarget {
    point: PolyPoint;
    weight?: number;
    /** Parameter in [0, 1). When omitted, targets are spaced uniformly. */
    s01?: number;
}

export interface FairedConstraints {
    rim?: PolyPoint[];
    minInsetMm?: number;
    medialYSign?: 1 | -1;
    archU0?: number;
    archU1?: number;
    bounds?: { minX: number; maxX: number };
    /** Lateral side must stay convex (k >= this). */
    lateralMinK?: number;
    maxIters?: number;
}

export interface FairedPatternInput {
    targets: Array<PolyPoint | FairedTarget>;
    controlCount?: number;
    wFit?: number;
    wFair?: number;
    sampleCount?: number;
    constraints?: FairedConstraints;
}

export interface FairedPattern {
    controls: PolyPoint[];
    samples: PolyPoint[];
    evaluate: (s01: number) => PolyPoint;
}

function asTarget(t: PolyPoint | FairedTarget): FairedTarget {
    if ("point" in t && t.point) return t;
    return { point: t as PolyPoint, weight: 1 };
}

/** Uniform cubic B-spline basis (C2). */
export function cubicBSplineBasis(u: number): [number, number, number, number] {
    const u2 = u * u;
    const u3 = u2 * u;
    return [
        (1 - 3 * u + 3 * u2 - u3) / 6,
        (4 - 6 * u2 + 3 * u3) / 6,
        (1 + 3 * u + 3 * u2 - 3 * u3) / 6,
        u3 / 6,
    ];
}

export function samplePeriodicCubic(ctrl: PolyPoint[], s01: number): PolyPoint {
    const n = ctrl.length;
    if (n === 0) return { x: 0, y: 0, z: 0 };
    if (n === 1) return { ...ctrl[0]! };
    const t = (((s01 % 1) + 1) % 1) * n;
    const i = Math.floor(t) % n;
    const u = t - Math.floor(t);
    const [b0, b1, b2, b3] = cubicBSplineBasis(u);
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

/** Fill `row` with N_j(s01) for a periodic cubic with `n` controls. */
function basisRow(n: number, s01: number, row: number[]): void {
    for (let j = 0; j < n; j++) row[j] = 0;
    const t = (((s01 % 1) + 1) % 1) * n;
    const i = Math.floor(t) % n;
    const u = t - Math.floor(t);
    const [b0, b1, b2, b3] = cubicBSplineBasis(u);
    row[(i - 1 + n) % n] = b0;
    row[i] = b1;
    row[(i + 1) % n] = b2;
    row[(i + 2) % n] = b3;
}

function solveSymmetric(H: number[][], rhs: number[]): number[] {
    const n = rhs.length;
    const a = H.map((row, i) => {
        const copy = row.slice();
        copy[i] = (copy[i] ?? 0) + FAIRED_RIDGE;
        return copy;
    });
    const b = rhs.slice();
    for (let k = 0; k < n; k++) {
        let piv = k;
        let best = Math.abs(a[k]![k]!);
        for (let i = k + 1; i < n; i++) {
            const v = Math.abs(a[i]![k]!);
            if (v > best) {
                best = v;
                piv = i;
            }
        }
        if (best < 1e-14) continue;
        if (piv !== k) {
            const tmp = a[k]!;
            a[k] = a[piv]!;
            a[piv] = tmp;
            const tb = b[k]!;
            b[k] = b[piv]!;
            b[piv] = tb;
        }
        const akk = a[k]![k]!;
        for (let i = k + 1; i < n; i++) {
            const f = a[i]![k]! / akk;
            if (Math.abs(f) < 1e-18) continue;
            for (let j = k; j < n; j++) a[i]![j]! -= f * a[k]![j]!;
            b[i]! -= f * b[k]!;
        }
    }
    const x = new Array<number>(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
        let s = b[i]!;
        for (let j = i + 1; j < n; j++) s -= a[i]![j]! * x[j]!;
        const d = a[i]![i]!;
        x[i] = Math.abs(d) > 1e-14 ? s / d : 0;
    }
    return x;
}

function addOuter(H: number[][], row: number[], scale: number): void {
    const n = row.length;
    for (let i = 0; i < n; i++) {
        const ri = row[i]!;
        if (Math.abs(ri) < 1e-18) continue;
        for (let j = 0; j < n; j++) {
            const rj = row[j]!;
            if (Math.abs(rj) < 1e-18) continue;
            H[i]![j]! += scale * ri * rj;
        }
    }
}

function thirdDerivRow(n: number, span: number, row: number[]): void {
    for (let j = 0; j < n; j++) row[j] = 0;
    row[(span - 1 + n) % n] = -1;
    row[span] = 3;
    row[(span + 1) % n] = -3;
    row[(span + 2) % n] = 1;
}

function minDistToLoop(x: number, y: number, loop: PolyPoint[]): number {
    let best = Infinity;
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const len2 = ex * ex + ey * ey;
        const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / len2)) : 0;
        best = Math.min(best, Math.hypot(x - (a.x + ex * t), y - (a.y + ey * t)));
    }
    return best;
}

function nearestOnLoop(x: number, y: number, loop: PolyPoint[]): PolyPoint {
    let best = loop[0] ?? { x, y, z: 0 };
    let bestD = Infinity;
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const len2 = ex * ex + ey * ey;
        const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / len2)) : 0;
        const q = { x: a.x + ex * t, y: a.y + ey * t, z: 0 };
        const d = (q.x - x) ** 2 + (q.y - y) ** 2;
        if (d < bestD) {
            bestD = d;
            best = q;
        }
    }
    return best;
}

function unitInwardAt(loop: PolyPoint[], x: number, y: number): { x: number; y: number } {
    let bestI = 0;
    let bestD = Infinity;
    for (let i = 0; i < loop.length; i++) {
        const p = loop[i]!;
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (d < bestD) {
            bestD = d;
            bestI = i;
        }
    }
    const a = loop[(bestI + loop.length - 1) % loop.length]!;
    const b = loop[bestI]!;
    const c = loop[(bestI + 1) % loop.length]!;
    const ex = c.x - a.x;
    const ey = c.y - a.y;
    const len = Math.hypot(ex, ey) || 1;
    let nx = -ey / len;
    let ny = ex / len;
    const probe = { x: b.x + nx, y: b.y + ny };
    if (!pointInPoly(probe.x, probe.y, loop)) {
        nx = -nx;
        ny = -ny;
    }
    return { x: nx, y: ny };
}

function signedK(prev: PolyPoint, cur: PolyPoint, next: PolyPoint): number {
    const ab = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const bc = Math.hypot(next.x - cur.x, next.y - cur.y);
    const cross = (cur.x - prev.x) * (next.y - cur.y) - (cur.y - prev.y) * (next.x - cur.x);
    const dot = (cur.x - prev.x) * (next.x - cur.x) + (cur.y - prev.y) * (next.y - cur.y);
    return Math.atan2(cross, dot) / Math.max(0.5 * (ab + bc), 1e-9);
}

function meanY(pts: PolyPoint[]): number {
    if (!pts.length) return 0;
    let s = 0;
    for (const p of pts) s += p.y;
    return s / pts.length;
}

function seedControls(targets: FairedTarget[], n: number): PolyPoint[] {
    const pts = targets.map((t) => t.point);
    if (pts.length === 0) return [];
    return resamplePolyline(startAtLowCurvature(ensureCcw(pts)), n);
}

function assembleTargets(raw: Array<PolyPoint | FairedTarget>): FairedTarget[] {
    const out = raw.map(asTarget).filter((t) => Number.isFinite(t.point.x) && Number.isFinite(t.point.y));
    if (out.length < 3) return out;
    const assigned = out.every((t) => t.s01 !== undefined);
    if (assigned) return out;
    return out.map((t, i) => ({ ...t, s01: i / out.length, weight: t.weight ?? 1 }));
}

function solveAxes(n: number, wFit: number, wFair: number, targets: FairedTarget[]): PolyPoint[] {
    const H = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const bx = new Array<number>(n).fill(0);
    const by = new Array<number>(n).fill(0);
    const row = new Array<number>(n).fill(0);
    for (const t of targets) {
        const w = Math.max(1e-6, t.weight ?? 1) * wFit;
        basisRow(n, t.s01 ?? 0, row);
        addOuter(H, row, w);
        const p = t.point;
        for (let j = 0; j < n; j++) {
            const nj = row[j]!;
            if (Math.abs(nj) < 1e-18) continue;
            bx[j]! += w * nj * p.x;
            by[j]! += w * nj * p.y;
        }
    }
    const drow = new Array<number>(n).fill(0);
    for (let span = 0; span < n; span++) {
        thirdDerivRow(n, span, drow);
        addOuter(H, drow, wFair);
    }
    const cx = solveSymmetric(H, bx);
    const cy = solveSymmetric(
        H.map((r) => r.slice()),
        by,
    );
    const out: PolyPoint[] = [];
    for (let i = 0; i < n; i++) out.push({ x: cx[i]!, y: cy[i]!, z: 0 });
    return out;
}

function centroidOf(pts: PolyPoint[]): { x: number; y: number } {
    let x = 0;
    let y = 0;
    for (const p of pts) {
        x += p.x;
        y += p.y;
    }
    const n = Math.max(1, pts.length);
    return { x: x / n, y: y / n };
}

function minSignedInset(loop: PolyPoint[], rim: PolyPoint[]): number {
    let worst = Infinity;
    for (const p of loop) {
        const inside = pointInPoly(p.x, p.y, rim);
        const dist = minDistToLoop(p.x, p.y, rim);
        worst = Math.min(worst, inside ? dist : -dist);
    }
    return worst;
}

/** Uniform shrink toward the centroid so inset stays ≥ min without extra inflections. */
export function scaleToMinInset(loop: PolyPoint[], rim: PolyPoint[], minInset: number): PolyPoint[] {
    if (loop.length < 3 || rim.length < 3) return loop;
    if (minSignedInset(loop, rim) >= minInset - 1e-4) return loop;
    const c = centroidOf(loop);
    let lo = 0.72;
    let hi = 1;
    let best = loop;
    for (let k = 0; k < 18; k++) {
        const s = 0.5 * (lo + hi);
        const scaled = loop.map((p) => ({
            x: c.x + (p.x - c.x) * s,
            y: c.y + (p.y - c.y) * s,
            z: p.z,
        }));
        if (minSignedInset(scaled, rim) >= minInset - 1e-4) {
            lo = s;
            best = scaled;
        } else {
            hi = s;
        }
    }
    return best;
}

function constraintTargets(
    samples: PolyPoint[],
    input: FairedPatternInput,
    targetLoop: PolyPoint[],
): FairedTarget[] {
    const c = input.constraints;
    if (!c) return [];
    const extra: FairedTarget[] = [];
    const n = samples.length;
    if (n < 4) return extra;
    const stride = Math.max(1, Math.floor(n / 24));
    const rim = c.rim;
    const minInset = c.minInsetMm ?? 0;
    const sign = c.medialYSign ?? 1;
    const bounds = c.bounds;
    const length = bounds ? Math.max(1e-3, bounds.maxX - bounds.minX) : 1;
    const yMid = meanY(rim?.length ? rim : samples);
    const archU0 = c.archU0 ?? 0.16;
    const archU1 = c.archU1 ?? 0.62;
    const latMin = c.lateralMinK ?? 0;
    for (let i = 0; i < n; i += stride) {
        const p = samples[i]!;
        const s01 = i / n;
        const prev = samples[(i + n - 1) % n]!;
        const next = samples[(i + 1) % n]!;
        const k = signedK(prev, p, next);
        if (rim && rim.length >= 3) {
            const inside = pointInPoly(p.x, p.y, rim);
            const dist = minDistToLoop(p.x, p.y, rim);
            const inset = inside ? dist : -dist;
            if (inset < minInset - 1e-4) {
                const inward = unitInwardAt(rim, p.x, p.y);
                const push = minInset - inset + 0.15;
                extra.push({
                    point: { x: p.x + inward.x * push, y: p.y + inward.y * push, z: 0 },
                    weight: 24,
                    s01,
                });
            }
        }
        if (targetLoop.length >= 3) {
            const near = nearestOnLoop(p.x, p.y, targetLoop);
            const d = Math.hypot(p.x - near.x, p.y - near.y);
            if (d > 1.0) {
                extra.push({ point: near, weight: 10, s01 });
            }
        }
        const u = bounds ? Math.max(0, Math.min(1, (p.x - bounds.minX) / length)) : s01;
        const medial = (p.y - yMid) * sign > 0;
        if (!medial && k < latMin - 1e-5) {
            const mx = 0.45 * p.x + 0.275 * (prev.x + next.x);
            const my = 0.45 * p.y + 0.275 * (prev.y + next.y);
            extra.push({ point: { x: mx, y: my, z: 0 }, weight: 14, s01 });
        }
        if (medial && bounds) {
            const t = (u - archU0) / Math.max(1e-6, archU1 - archU0);
            if (t > 0 && t < 1) {
                const mid = t > 0.22 && t < 0.78;
                if (mid && k > 1e-4) {
                    if (rim && rim.length >= 3) {
                        const inward = unitInwardAt(rim, p.x, p.y);
                        extra.push({
                            point: { x: p.x + inward.x * 1.2, y: p.y + inward.y * 1.2, z: 0 },
                            weight: 12,
                            s01,
                        });
                    }
                } else if (!mid && k < -1e-4) {
                    const mx = 0.5 * p.x + 0.25 * (prev.x + next.x);
                    const my = 0.5 * p.y + 0.25 * (prev.y + next.y);
                    extra.push({ point: { x: mx, y: my, z: 0 }, weight: 10, s01 });
                }
            } else if (k < -1e-4) {
                const mx = 0.5 * p.x + 0.25 * (prev.x + next.x);
                const my = 0.5 * p.y + 0.25 * (prev.y + next.y);
                extra.push({ point: { x: mx, y: my, z: 0 }, weight: 8, s01 });
            }
        }
    }
    return extra;
}

/**
 * Periodic cubic (quintic-ready API) approximating spline. Minimizes
 * `wFit * Σ|P(s_k)−t_k|² + wFair * ∫|P'''|²` with inset / lateral-convex /
 * single-S constraints applied as iterated high-weight targets. Re-solve
 * later with drag targets at high weight; the same module fits a 3D
 * TrimCurve in surface UV.
 */
export function fairedPattern(input: FairedPatternInput): FairedPattern {
    const targets = assembleTargets(input.targets);
    const nCtrl = Math.max(
        FAIRED_CONTROL_MIN,
        Math.min(FAIRED_CONTROL_MAX, Math.round(input.controlCount ?? FAIRED_CONTROL_DEFAULT)),
    );
    const wFit = input.wFit ?? 1;
    const wFair = input.wFair ?? 0.35;
    const nSample = Math.max(80, input.sampleCount ?? 160);
    if (targets.length < 3) {
        const samples = targets.map((t) => ({ ...t.point }));
        return {
            controls: samples,
            samples,
            evaluate: (s01) => samplePeriodicCubic(samples, s01),
        };
    }
    let controls = seedControls(targets, nCtrl);
    let working = targets.map((t) => ({ ...t }));
    const targetLoop = targets.map((t) => t.point);
    const iters = input.constraints ? (input.constraints.maxIters ?? FAIRED_CONSTRAINT_ITERS) : 1;
    for (let pass = 0; pass < iters; pass++) {
        controls = solveAxes(nCtrl, wFit, wFair, working);
        if (!input.constraints) break;
        const samples: PolyPoint[] = [];
        for (let i = 0; i < nSample; i++) samples.push(samplePeriodicCubic(controls, i / nSample));
        const extra = constraintTargets(samples, input, targetLoop);
        if (!extra.length) break;
        working = targets.map((t) => ({ ...t })).concat(extra);
    }
    const dense: PolyPoint[] = [];
    const denseN = Math.max(nSample * 4, nCtrl * 8);
    for (let i = 0; i < denseN; i++) dense.push(samplePeriodicCubic(controls, i / denseN));
    let samples = startAtLowCurvature(ensureCcw(resamplePolyline(dense, nSample)));
    const rim = input.constraints?.rim;
    const minInset = input.constraints?.minInsetMm ?? 0;
    if (rim && rim.length >= 3 && minInset > 0) {
        samples = scaleToMinInset(samples, rim, minInset);
    }
    return {
        controls,
        samples,
        evaluate: (s01) => samplePeriodicCubic(controls, s01),
    };
}
