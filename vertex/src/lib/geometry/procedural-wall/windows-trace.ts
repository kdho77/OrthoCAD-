// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { minDistToLoopXY, pointInPoly } from "./cdt-band";
import {
    ensureCcw,
    type PolyPoint,
    polylineArcLengths,
    resamplePolyline,
    startAtPosteriorHeel,
} from "./curves";
import { WINDOWS_TRACE_PX } from "./windows-trace-data";

/** Canonical Windows trace has the medial arch cut-in on +Y. */
export const WINDOWS_TRACE_MEDIAL_SIGN = 1 as const;
/** Hausdorff gate: faired QP vs the smoothed, placed Windows trace (midfoot/heel). */
export const PATTERN_TRACE_HAUSDORFF_MM = 2;
export const WINDOWS_TRACE_SMOOTH_PASSES = 10;
export const WINDOWS_FORE_U0 = 0.62;
/** Toe box must sit within this of the top rim (both sides + tip). */
export const TOE_BOX_RIM_MAX_MM = 1;
/** Blend starts behind the toe box so u ≥ 0.62 is a full rim pull. */
export const TOE_BOX_BLEND_U0 = 0.54;
export const TOE_BOX_BLEND_U1 = 0.62;

export interface TracePlacement {
    /** Smoothed trace in the footprint frame (X=length heel→toe), placed on the rim. */
    smoothed: PolyPoint[];
    scale: number;
    offset: { x: number; y: number };
    mirrored: boolean;
}

function asPts(src: ReadonlyArray<readonly [number, number]>): PolyPoint[] {
    return src.map(([x, y]) => ({ x, y, z: 0 }));
}

/** Drop consecutive duplicates and the DXF (0,0)/(3,3) junk tail. */
export function cleanWindowsTracePx(src?: PolyPoint[]): PolyPoint[] {
    const raw = src?.length ? src : asPts(WINDOWS_TRACE_PX);
    const out: PolyPoint[] = [];
    for (const p of raw) {
        if (p.x < 8 && p.y < 20) continue;
        const last = out[out.length - 1];
        if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1e-6) continue;
        out.push({ x: p.x, y: p.y, z: 0 });
    }
    return out;
}

function laplacianClosed(loop: PolyPoint[], passes: number): PolyPoint[] {
    let cur = loop.map((p) => ({ ...p }));
    for (let p = 0; p < passes; p++) {
        cur = cur.map((b, i) => {
            const a = cur[(i + cur.length - 1) % cur.length]!;
            const c = cur[(i + 1) % cur.length]!;
            return {
                x: b.x * 0.5 + (a.x + c.x) * 0.25,
                y: b.y * 0.5 + (a.y + c.y) * 0.25,
                z: 0,
            };
        });
    }
    return cur;
}

/**
 * Pixel Y is length (heel at 0 → toe at max). Pixel X is width.
 * Footprint frame: X = length, Y = width, origin at the heel, Y centered.
 */
export function windowsTraceToFootprint(px: PolyPoint[]): PolyPoint[] {
    if (px.length < 3) return [];
    let minY = Infinity;
    let maxY = -Infinity;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const p of px) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
    }
    const midX = 0.5 * (minX + maxX);
    const mapped = px.map((p) => ({ x: p.y - minY, y: p.x - midX, z: 0 }));
    return startAtPosteriorHeel(ensureCcw(mapped));
}

/** Clean + Laplacian-smooth + rotate into the footprint frame (unscaled). */
export function smoothedWindowsTraceCanonical(src?: PolyPoint[]): PolyPoint[] {
    const cleaned = cleanWindowsTracePx(src);
    if (cleaned.length < 8) return [];
    const dense = resamplePolyline(cleaned, Math.max(160, cleaned.length));
    const smooth = laplacianClosed(dense, WINDOWS_TRACE_SMOOTH_PASSES);
    return windowsTraceToFootprint(smooth);
}

function lengthSpan(pts: PolyPoint[]): { minX: number; maxX: number; length: number } {
    let minX = Infinity;
    let maxX = -Infinity;
    for (const p of pts) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
    }
    return { minX, maxX, length: Math.max(1e-3, maxX - minX) };
}

/** Intersect a closed plan loop with the station plane X = x. */
export function intersectLoopAtX(loop: PolyPoint[], x: number): number[] {
    const ys: number[] = [];
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        const dx = b.x - a.x;
        if (Math.abs(dx) < 1e-9) {
            if (Math.abs(a.x - x) < 0.35) {
                ys.push(a.y);
                ys.push(b.y);
            }
            continue;
        }
        const t = (x - a.x) / dx;
        if (t >= -1e-6 && t <= 1 + 1e-6) ys.push(a.y + t * (b.y - a.y));
    }
    ys.sort((a, b) => a - b);
    return ys;
}

function inwardAt(rim: PolyPoint[], x: number, y: number): { x: number; y: number } {
    let best = Infinity;
    let nx = 0;
    let ny = 0;
    for (let i = 0; i < rim.length; i++) {
        const a = rim[i]!;
        const b = rim[(i + 1) % rim.length]!;
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const len2 = ex * ex + ey * ey;
        const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / len2)) : 0;
        const px = a.x + ex * t;
        const py = a.y + ey * t;
        const d = Math.hypot(x - px, y - py);
        if (d < best) {
            best = d;
            const len = Math.hypot(ex, ey) || 1;
            nx = -ey / len;
            ny = ex / len;
        }
    }
    const probe = { x: x + nx * 0.6, y: y + ny * 0.6 };
    if (!pointInPoly(probe.x, probe.y, rim)) {
        nx = -nx;
        ny = -ny;
    }
    return { x: nx, y: ny };
}

interface Pair {
    sx: number;
    sy: number;
    dx: number;
    dy: number;
}

function forefootPairs(
    canonical: PolyPoint[],
    rim: PolyPoint[],
    bounds: { minX: number; maxX: number },
    insetMm: number,
): Pair[] {
    const tSpan = lengthSpan(canonical);
    const rLen = Math.max(1e-3, bounds.maxX - bounds.minX);
    const pairs: Pair[] = [];
    for (let k = 0; k <= 16; k++) {
        const u = WINDOWS_FORE_U0 + (1 - WINDOWS_FORE_U0) * (k / 16);
        const tx = tSpan.minX + u * tSpan.length;
        const rx = bounds.minX + u * rLen;
        const tYs = intersectLoopAtX(canonical, tx);
        const rYs = intersectLoopAtX(rim, rx);
        if (tYs.length < 2 || rYs.length < 2) continue;
        const tLo = tYs[0]!;
        const tHi = tYs[tYs.length - 1]!;
        const rLo = rYs[0]!;
        const rHi = rYs[rYs.length - 1]!;
        const nLo = inwardAt(rim, rx, rLo);
        const nHi = inwardAt(rim, rx, rHi);
        pairs.push({ sx: tx, sy: tLo, dx: rx + nLo.x * insetMm, dy: rLo + nLo.y * insetMm });
        pairs.push({ sx: tx, sy: tHi, dx: rx + nHi.x * insetMm, dy: rHi + nHi.y * insetMm });
    }
    return pairs;
}

/** Least-squares offset with scale locked: t = mean(dst − s·src). */
export function leastSquaresOffset(pairs: Pair[], scale: number): { x: number; y: number } {
    if (!pairs.length) return { x: 0, y: 0 };
    let sx = 0;
    let sy = 0;
    for (const p of pairs) {
        sx += p.dx - scale * p.sx;
        sy += p.dy - scale * p.sy;
    }
    return { x: sx / pairs.length, y: sy / pairs.length };
}

/**
 * Uniform scale + 2D offset: length = rim − heel − toe, then least-squares
 * refine to the forefoot 0.5 mm inset. `s * p + offset`.
 */
export function leastSquaresScaleOffset(
    pairs: Pair[],
    lengthScale: number,
    lengthWeight = 80,
): { scale: number; offset: { x: number; y: number } } {
    // Unknowns: [s, tx, ty]. Length residual: s ≈ lengthScale.
    let h00 = lengthWeight;
    let h01 = 0;
    let h02 = 0;
    let h11 = lengthWeight * 0 + 0;
    const h12 = 0;
    let h22 = 0;
    let b0 = lengthWeight * lengthScale;
    let b1 = 0;
    let b2 = 0;
    h11 = 0;
    for (const p of pairs) {
        h00 += p.sx * p.sx + p.sy * p.sy;
        h01 += p.sx;
        h02 += p.sy;
        h11 += 1;
        h22 += 1;
        b0 += p.sx * p.dx + p.sy * p.dy;
        b1 += p.dx;
        b2 += p.dy;
    }
    if (pairs.length < 2) {
        return { scale: lengthScale, offset: { x: 0, y: 0 } };
    }
    // Solve 3x3 symmetric (h12 stays 0 — tx and ty decouple).
    const H = [
        [h00, h01, h02],
        [h01, h11, h12],
        [h02, h12, h22],
    ];
    const rhs = [b0, b1, b2];
    const n = 3;
    const a = H.map((row) => row.slice());
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
        const diag = a[k]![k]!;
        for (let i = k + 1; i < n; i++) {
            const f = a[i]![k]! / diag;
            for (let j = k; j < n; j++) a[i]![j]! -= f * a[k]![j]!;
            b[i]! -= f * b[k]!;
        }
    }
    const x = new Array<number>(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
        let s = b[i]!;
        for (let j = i + 1; j < n; j++) s -= a[i]![j]! * x[j]!;
        const diag = a[i]![i]!;
        x[i] = Math.abs(diag) < 1e-14 ? 0 : s / diag;
    }
    const scale = Number.isFinite(x[0]) && x[0]! > 1e-6 ? x[0]! : lengthScale;
    return { scale, offset: { x: x[1] ?? 0, y: x[2] ?? 0 } };
}

function placeTrace(canonical: PolyPoint[], scale: number, offset: { x: number; y: number }): PolyPoint[] {
    return canonical.map((p) => ({
        x: scale * p.x + offset.x,
        y: scale * p.y + offset.y,
        z: 0,
    }));
}

function mirrorCanonical(pts: PolyPoint[]): PolyPoint[] {
    return startAtPosteriorHeel(ensureCcw(pts.map((p) => ({ x: p.x, y: -p.y, z: 0 }))));
}

/**
 * Scale the Windows trace onto `rim`: length = rim − heel − toe insets,
 * mirror so the medial cut-in follows `medialYSign`, then least-squares
 * scale+offset to the forefoot 0.5 mm inset.
 */
export function fitWindowsTraceToRim(
    rim: PolyPoint[],
    bounds: { minX: number; maxX: number },
    medialYSign: 1 | -1,
    opts?: { heelInsetMm?: number; toeInsetMm?: number; foreInsetMm?: number; src?: PolyPoint[] },
): TracePlacement | null {
    const raw = smoothedWindowsTraceCanonical(opts?.src);
    if (raw.length < 8 || rim.length < 8) return null;
    const mirrored = medialYSign !== WINDOWS_TRACE_MEDIAL_SIGN;
    const canonical = mirrored ? mirrorCanonical(raw) : raw;
    const heel = opts?.heelInsetMm ?? 6;
    const toe = opts?.toeInsetMm ?? 0.5;
    const fore = opts?.foreInsetMm ?? 0.5;
    const tSpan = lengthSpan(canonical);
    const rimLen = Math.max(1e-3, bounds.maxX - bounds.minX);
    const lengthScale = Math.max(1e-6, (rimLen - heel - toe) / tSpan.length);
    const targetX0 = bounds.minX + heel;
    const pairs = forefootPairs(canonical, rim, bounds, fore);
    const fitted = leastSquaresScaleOffset(pairs, lengthScale);
    // Lock length; keep the LS Y offset; re-anchor X to the heel/toe insets.
    const scale = lengthScale;
    const ty = pairs.length ? leastSquaresOffset(pairs, scale).y : fitted.offset.y;
    const offset = { x: targetX0 - scale * tSpan.minX, y: ty };
    const smoothed = startAtPosteriorHeel(ensureCcw(placeTrace(canonical, scale, offset)));
    return { smoothed, scale, offset, mirrored };
}

export function directedPolylineHausdorff(from: PolyPoint[], to: PolyPoint[]): number {
    let max = 0;
    for (const p of from) max = Math.max(max, minDistToLoopXY(p.x, p.y, to));
    return max;
}

export function polylineHausdorffMm(a: PolyPoint[], b: PolyPoint[]): number {
    if (!a.length || !b.length) return Infinity;
    return Math.max(directedPolylineHausdorff(a, b), directedPolylineHausdorff(b, a));
}

function clamp01(t: number): number {
    return Math.max(0, Math.min(1, t));
}

function smoothstep01(e0: number, e1: number, x: number): number {
    const t = clamp01((x - e0) / Math.max(1e-9, e1 - e0));
    return t * t * (3 - 2 * t);
}

function closestOnLoopXY(loop: PolyPoint[], x: number, y: number): { x: number; y: number; d: number } {
    let best = Infinity;
    let cx = x;
    let cy = y;
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const len2 = ex * ex + ey * ey;
        const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / len2)) : 0;
        const px = a.x + ex * t;
        const py = a.y + ey * t;
        const d = Math.hypot(x - px, y - py);
        if (d < best) {
            best = d;
            cx = px;
            cy = py;
        }
    }
    return { x: cx, y: cy, d: best };
}

function rimInsetTarget(rim: PolyPoint[], x: number, y: number, insetMm: number): PolyPoint {
    const closest = closestOnLoopXY(rim, x, y);
    const n = inwardAt(rim, closest.x, closest.y);
    const target = { x: closest.x + n.x * insetMm, y: closest.y + n.y * insetMm, z: 0 };
    if (!pointInPoly(target.x, target.y, rim)) {
        return { x: closest.x - n.x * insetMm, y: closest.y - n.y * insetMm, z: 0 };
    }
    return target;
}

/**
 * Pull Windows forefoot targets (u ≥ 0.62) onto the top-rim inset so the toe
 * box matches the rim. Midfoot / heel / arch vertices are left unchanged.
 * Blend TOE_BOX_BLEND_U0–U1 so u ≥ 0.62 is a full rim pull.
 */
export function pullForefootTargetsToRim(
    placed: PolyPoint[],
    rim: PolyPoint[],
    bounds: { minX: number; maxX: number },
    insetMm = 0.5,
    u0 = TOE_BOX_BLEND_U0,
    blendU1 = TOE_BOX_BLEND_U1,
): PolyPoint[] {
    if (placed.length < 3 || rim.length < 3) return placed;
    const length = Math.max(1e-3, bounds.maxX - bounds.minX);
    return placed.map((p) => {
        const u = clamp01((p.x - bounds.minX) / length);
        if (u < u0) return { ...p };
        const w = smoothstep01(u0, blendU1, u);
        if (w <= 1e-6) return { ...p };
        const target = rimInsetTarget(rim, p.x, p.y, insetMm);
        return {
            x: p.x + (target.x - p.x) * w,
            y: p.y + (target.y - p.y) * w,
            z: 0,
        };
    });
}

/** Snap any remaining toe-box vertex with d > maxMm onto the rim inset. */
export function clampForefootToRimInset(
    pattern: PolyPoint[],
    rim: PolyPoint[],
    bounds: { minX: number; maxX: number },
    opts?: { maxMm?: number; insetMm?: number; u0?: number },
): PolyPoint[] {
    if (pattern.length < 3 || rim.length < 3) return pattern;
    const maxMm = opts?.maxMm ?? TOE_BOX_RIM_MAX_MM;
    const insetMm = opts?.insetMm ?? 0.5;
    const u0 = opts?.u0 ?? WINDOWS_FORE_U0;
    const length = Math.max(1e-3, bounds.maxX - bounds.minX);
    return pattern.map((p) => {
        const u = clamp01((p.x - bounds.minX) / length);
        if (u < u0) return { ...p };
        const closest = closestOnLoopXY(rim, p.x, p.y);
        if (closest.d <= maxMm + 1e-6) return { ...p };
        return rimInsetTarget(rim, p.x, p.y, insetMm);
    });
}

/** Directed pattern→rim clearance on the toe box (u ≥ u0), both sides + tip. */
export function forefootRimClearanceMm(
    pattern: PolyPoint[],
    rim: PolyPoint[],
    bounds: { minX: number; maxX: number },
    u0 = WINDOWS_FORE_U0,
): { maxD: number; minD: number; count: number } {
    const length = Math.max(1e-3, bounds.maxX - bounds.minX);
    let maxD = 0;
    let minD = Infinity;
    let count = 0;
    for (const p of pattern) {
        const u = (p.x - bounds.minX) / length;
        if (u < u0) continue;
        const d = minDistToLoopXY(p.x, p.y, rim);
        maxD = Math.max(maxD, d);
        minD = Math.min(minD, d);
        count++;
    }
    return { maxD, minD: Number.isFinite(minD) ? minD : 0, count };
}

export function s01Along(loop: PolyPoint[], p: PolyPoint): number {
    const { cum, total } = polylineArcLengths(loop);
    let bestS = 0;
    let bestD = Infinity;
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const len2 = ex * ex + ey * ey;
        const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2)) : 0;
        const d = (p.x - (a.x + ex * t)) ** 2 + (p.y - (a.y + ey * t)) ** 2;
        if (d < bestD) {
            bestD = d;
            const seg = cum[i + 1]! - cum[i]!;
            bestS = (cum[i]! + t * seg) / Math.max(total, 1e-12);
        }
    }
    return ((bestS % 1) + 1) % 1;
}
