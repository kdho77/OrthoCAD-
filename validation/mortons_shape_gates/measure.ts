// Frozen numeric gates. Thresholds are the clinical rules. Do not retune them
// after this file is committed.

export const G1_MAX_DEV_MM = 0.3;
export const G2_WIDTH_TOL_MM = 0.3;
export const G3_MIN_FRACTION = 0.99;
export const G4_MIN_FRACTION = 0.99;
export const G5_MAX_RISE_MM = 0.05;
export const G6_MAX_POS_SLOPE = 0.02;
export const G6_SMOOTH_MM = 4;
export const G7_MAX_SLOPE_JUMP = 0.01;
export const G7_MAX_SECOND_DIFF = 0.02;
export const G7_DX_MM = 1;
export const G8_MAX_SLOPE_AT_3MM = 1.0;
export const G11_MAX_ABS_MM = 1e-6;

export interface Xy {
    x: number;
    y: number;
}

export interface GateResult {
    id: string;
    pass: boolean;
    value: number;
    threshold: number;
    op: "<=" | ">=";
    detail?: string;
}

export function judge(
    id: string,
    value: number,
    op: "<=" | ">=",
    threshold: number,
    detail?: string,
): GateResult {
    const pass = op === "<=" ? value <= threshold + 1e-12 : value >= threshold - 1e-12;
    return { id, pass, value, threshold, op, detail };
}

export interface LineFit {
    maxDev: number;
    origin: Xy;
    /** Unit direction along the line, +x. */
    dir: Xy;
    /** Unit normal. */
    normal: Xy;
}

/** Best-fit line and the max orthogonal distance (mm) of the points. */
export function fitLine(points: readonly Xy[]): LineFit {
    const n = points.length;
    if (n < 3) {
        return {
            maxDev: Number.POSITIVE_INFINITY,
            origin: { x: 0, y: 0 },
            dir: { x: 1, y: 0 },
            normal: { x: 0, y: 1 },
        };
    }
    let mx = 0;
    let my = 0;
    for (const p of points) {
        mx += p.x;
        my += p.y;
    }
    mx /= n;
    my /= n;
    let xx = 0;
    let xy = 0;
    let yy = 0;
    for (const p of points) {
        const dx = p.x - mx;
        const dy = p.y - my;
        xx += dx * dx;
        xy += dx * dy;
        yy += dy * dy;
    }
    const tr = xx + yy;
    const det = xx * yy - xy * xy;
    const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    const lambda = tr / 2 + disc;
    let vx = xy;
    let vy = lambda - xx;
    if (Math.hypot(vx, vy) < 1e-12) {
        if (xx >= yy) {
            vx = 1;
            vy = 0;
        } else {
            vx = 0;
            vy = 1;
        }
    }
    if (vx < 0) {
        vx = -vx;
        vy = -vy;
    }
    const vlen = Math.hypot(vx, vy) || 1;
    const dir = { x: vx / vlen, y: vy / vlen };
    const normal = { x: -dir.y, y: dir.x };
    let max = 0;
    for (const p of points) {
        const d = Math.abs((p.x - mx) * normal.x + (p.y - my) * normal.y);
        if (d > max) max = d;
    }
    return { maxDev: max, origin: { x: mx, y: my }, dir, normal };
}

export function lineDeviationMm(points: readonly Xy[]): number {
    return fitLine(points).maxDev;
}

export function distanceToFitMm(fit: LineFit, p: Xy): number {
    return Math.abs((p.x - fit.origin.x) * fit.normal.x + (p.y - fit.origin.y) * fit.normal.y);
}

/** Angle in degrees between two directions, 0..90. */
export function angleDeg(a: Xy, b: Xy): number {
    const la = Math.hypot(a.x, a.y) || 1;
    const lb = Math.hypot(b.x, b.y) || 1;
    const dot = Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / (la * lb)));
    const deg = (Math.acos(Math.abs(dot)) * 180) / Math.PI;
    return deg;
}

/** Max |width - median| in mm. */
export function widthSpreadMm(widths: readonly number[]): {
    spread: number;
    median: number;
    min: number;
    max: number;
} {
    if (widths.length === 0) return { spread: Number.POSITIVE_INFINITY, median: 0, min: 0, max: 0 };
    const sorted = [...widths].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    let spread = 0;
    for (const w of widths) spread = Math.max(spread, Math.abs(w - median));
    return { spread, median, min: sorted[0]!, max: sorted[sorted.length - 1]! };
}

export function minFraction(samples: readonly number[], nominal: number): number {
    if (samples.length === 0 || !(nominal > 0)) return 0;
    let min = Number.POSITIVE_INFINITY;
    for (const h of samples) if (h < min) min = h;
    return min / nominal;
}

/**
 * Largest rise (mm) after a local minimum, walking the profile in order.
 * A new deeper minimum ends the previous basin.
 */
export function riseAfterLocalMinMm(heights: readonly number[]): number {
    const n = heights.length;
    if (n < 3) return 0;
    let maxRise = 0;
    for (let i = 1; i < n - 1; i++) {
        const h = heights[i]!;
        if (h > heights[i - 1]! + 1e-9 || h > heights[i + 1]! + 1e-9) continue;
        let maxAfter = h;
        for (let j = i + 1; j < n; j++) {
            const hj = heights[j]!;
            if (hj < h - 1e-9) break;
            if (hj > maxAfter) maxAfter = hj;
        }
        maxRise = Math.max(maxRise, maxAfter - h);
    }
    return maxRise;
}

/** Max slope (mm/mm) of a moving-average smoothed profile. Window is total width. */
export function maxSmoothedSlope(
    xs: readonly number[],
    heights: readonly number[],
    windowMm: number,
): number {
    const n = Math.min(xs.length, heights.length);
    if (n < 3) return 0;
    const half = windowMm / 2;
    const smooth = new Array<number>(n);
    for (let i = 0; i < n; i++) {
        let acc = 0;
        let count = 0;
        const x = xs[i]!;
        for (let j = 0; j < n; j++) {
            if (Math.abs(xs[j]! - x) <= half + 1e-9) {
                acc += heights[j]!;
                count++;
            }
        }
        smooth[i] = count > 0 ? acc / count : heights[i]!;
    }
    let max = Number.NEGATIVE_INFINITY;
    for (let i = 1; i < n; i++) {
        const dx = xs[i]! - xs[i - 1]!;
        if (dx <= 1e-9) continue;
        const slope = (smooth[i]! - smooth[i - 1]!) / dx;
        if (slope > max) max = slope;
    }
    return max === Number.NEGATIVE_INFINITY ? 0 : max;
}

export interface BlendEndMetrics {
    slopeJump: number;
    secondDiff: number;
}

/** Finite-difference slope jump and second derivative at one station. dx is 1 mm. */
export function blendEndMetrics(heightAt: (x: number) => number, x: number, dx = G7_DX_MM): BlendEndMetrics {
    const hm = heightAt(x - dx);
    const h0 = heightAt(x);
    const hp = heightAt(x + dx);
    const sPlus = (hp - h0) / dx;
    const sMinus = (h0 - hm) / dx;
    return {
        slopeJump: Math.abs(sPlus - sMinus),
        secondDiff: Math.abs(hp - 2 * h0 + hm) / (dx * dx),
    };
}

export function peakAbsSlope(samples: readonly { t: number; h: number }[]): number {
    let max = 0;
    for (let i = 1; i < samples.length; i++) {
        const dt = samples[i]!.t - samples[i - 1]!.t;
        if (Math.abs(dt) < 1e-9) continue;
        const slope = Math.abs((samples[i]!.h - samples[i - 1]!.h) / dt);
        if (slope > max) max = slope;
    }
    return max;
}

/** Byte-identical float32 positions. Returns the number of vertices that differ. */
export function countDifferingVertices(
    before: ArrayLike<number>,
    after: ArrayLike<number>,
    outside: (vertexIndex: number) => boolean,
): number {
    const n = Math.min(before.length, after.length) / 3;
    let differ = 0;
    for (let i = 0; i < n; i++) {
        if (!outside(i)) continue;
        const o = i * 3;
        if (before[o] !== after[o] || before[o + 1] !== after[o + 1] || before[o + 2] !== after[o + 2])
            differ++;
    }
    return differ;
}

export function maxAbsDelta(deltas: readonly number[]): number {
    let max = 0;
    for (const d of deltas) {
        const a = Math.abs(d);
        if (a > max) max = a;
    }
    return max;
}

/**
 * S5: a 6 mm miss passes only when the residual was reported and the blend
 * was not replaced by another construction (smooth-max against the arch).
 */
export function s5Verdict(input: { g5mm6: number; g6mm6: number; source: string; reportText: string }): {
    pass: boolean;
    g5Fail: boolean;
    g6Fail: boolean;
    substituted: boolean;
    reported: boolean;
} {
    const g5Fail = input.g5mm6 > G5_MAX_RISE_MM;
    const g6Fail = input.g6mm6 > G6_MAX_POS_SLOPE;
    const substituted = /smoothMax|smooth-max|smooth_max/.test(input.source);
    const reported =
        /6\s*mm/.test(input.reportText) &&
        /G5|rise/i.test(input.reportText) &&
        /G6|slope|ridge/i.test(input.reportText) &&
        /not replaced|was not replaced|do not substitute|blend was not|not substitute/i.test(
            input.reportText,
        );
    const pass = (!g5Fail && !g6Fail) || (reported && !substituted);
    return { pass, g5Fail, g6Fail, substituted, reported };
}
