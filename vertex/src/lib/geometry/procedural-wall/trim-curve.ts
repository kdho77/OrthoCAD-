// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type MedialYSign, medialYSignFromTopRim } from "./bottom-pattern";
import type { PolyPoint } from "./curves";

/** Distal trim families cut from SAMPLE_Top. */
export type TrimKind = "34" | "sulcus";

export interface Uv {
    u: number;
    v: number;
}

/**
 * Traced cut, medial → lateral. Re-trace of Kendon's figures stayed within 1%
 * of foot length of these controls (sulcus rises toward the lateral side;
 * 3/4 falls toward the lateral side).
 */
export const TRIM_SEED_CONTROLS: Record<TrimKind, readonly Uv[]> = {
    "34": [
        { u: 0, v: 0.62 },
        { u: 0.2, v: 0.64 },
        { u: 0.6, v: 0.61 },
        { u: 1, v: 0.55 },
    ],
    sulcus: [
        { u: 0, v: 0.68 },
        { u: 0.29, v: 0.74 },
        { u: 0.58, v: 0.79 },
        { u: 1, v: 0.77 },
    ],
};

/** Overhang past the medial and lateral silhouette so the cut clears the rim. */
export const TRIM_EXTEND_MM = 2;
/** Re-meshed band proximal to the cut. */
export const TRIM_BAND_MM = 3;
/** Constrained cut-edge chord. */
export const TRIM_CHORD_MM = 0.1;

export const SKIVE_END_MM = 0.5;
export const SKIVE_FEATHER_MM = 5;

export interface LockedFootprintFrame {
    lengthAxis: 0 | 1 | 2;
    widthAxis: 0 | 1 | 2;
    thickAxis: 0 | 1 | 2;
    lengthMin: number;
    widthCenter: number;
}

/** Identity lock: the GLB is already in the SAMPLE_Top footprint frame. */
export const TRIM_GLB_LOCK: LockedFootprintFrame = {
    lengthAxis: 0,
    widthAxis: 1,
    thickAxis: 2,
    lengthMin: 0,
    widthCenter: 0,
};

interface CubicSpan {
    u0: number;
    u1: number;
    a: number;
    b: number;
    c: number;
    d: number;
}

/** Natural cubic v(u). C2, second derivative 0 at the ends. u must increase. */
export function naturalCubic(controls: readonly Uv[]): (u: number) => number {
    const n = controls.length;
    if (n === 0) return () => 0;
    if (n === 1) {
        const v = controls[0]!.v;
        return () => v;
    }
    const us = controls.map((p) => p.u);
    const vs = controls.map((p) => p.v);
    const h: number[] = [];
    for (let i = 0; i < n - 1; i++) h.push(us[i + 1]! - us[i]!);
    const m = new Array<number>(n).fill(0);
    if (n > 2) {
        const a: number[] = [];
        const b: number[] = [];
        const c: number[] = [];
        const d: number[] = [];
        for (let i = 1; i < n - 1; i++) {
            a.push(h[i - 1]! / 6);
            b.push((h[i - 1]! + h[i]!) / 3);
            c.push(h[i]! / 6);
            d.push((vs[i + 1]! - vs[i]!) / h[i]! - (vs[i]! - vs[i - 1]!) / h[i - 1]!);
        }
        const cp = new Array<number>(d.length);
        const dp = new Array<number>(d.length);
        cp[0] = c[0]! / b[0]!;
        dp[0] = d[0]! / b[0]!;
        for (let i = 1; i < d.length; i++) {
            const inv = 1 / (b[i]! - a[i]! * cp[i - 1]!);
            cp[i] = i < d.length - 1 ? c[i]! * inv : 0;
            dp[i] = (d[i]! - a[i]! * dp[i - 1]!) * inv;
        }
        const mid = new Array<number>(d.length);
        mid[d.length - 1] = dp[d.length - 1]!;
        for (let i = d.length - 2; i >= 0; i--) mid[i] = dp[i]! - cp[i]! * mid[i + 1]!;
        for (let i = 0; i < mid.length; i++) m[i + 1] = mid[i]!;
    }
    const spans: CubicSpan[] = [];
    for (let i = 0; i < n - 1; i++) {
        const hi = h[i]!;
        spans.push({
            u0: us[i]!,
            u1: us[i + 1]!,
            a: vs[i]!,
            b: (vs[i + 1]! - vs[i]!) / hi - (hi * (2 * m[i]! + m[i + 1]!)) / 6,
            c: m[i]! / 2,
            d: (m[i + 1]! - m[i]!) / (6 * hi),
        });
    }
    return (u: number) => {
        let span = spans[0]!;
        if (u >= spans[spans.length - 1]!.u1) span = spans[spans.length - 1]!;
        else {
            for (const s of spans) {
                if (u <= s.u1) {
                    span = s;
                    break;
                }
            }
        }
        const t = u - span.u0;
        return span.a + span.b * t + span.c * t * t + span.d * t * t * t;
    };
}

export function smoothstep01(t: number): number {
    const x = Math.max(0, Math.min(1, t));
    return x * x * (3 - 2 * x);
}

/**
 * 3/4: 10 mm, or 3 × local thickness where that thickness is over 4 mm, cap 15.
 * Sulcus: 6 mm.
 */
export function skiveLengthMm(kind: TrimKind, localThicknessMm: number): number {
    if (kind === "sulcus") return 6;
    if (localThicknessMm > 4) return Math.min(15, 3 * localThicknessMm);
    return 10;
}

/** t(s) with s = 0 at the skive start and s = S at the cut. */
export function skiveThicknessMm(t0: number, s: number, lengthMm: number): number {
    if (!(lengthMm > 1e-9)) return SKIVE_END_MM;
    const f = smoothstep01(s / lengthMm);
    return t0 - (t0 - SKIVE_END_MM) * f;
}

export interface WidthSlice {
    x: number;
    yMedial: number;
    yLateral: number;
}

export interface FootprintUvFrame {
    minX: number;
    maxX: number;
    medialYSign: MedialYSign;
    slices: WidthSlice[];
}

function sliceAt(slices: WidthSlice[], x: number): WidthSlice {
    if (slices.length === 0) return { x, yMedial: 0, yLateral: 1 };
    if (x <= slices[0]!.x) return slices[0]!;
    const last = slices[slices.length - 1]!;
    if (x >= last.x) return last;
    let lo = 0;
    let hi = slices.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (slices[mid]!.x < x) lo = mid;
        else hi = mid;
    }
    const a = slices[lo]!;
    const b = slices[hi]!;
    const t = (x - a.x) / Math.max(1e-9, b.x - a.x);
    return {
        x,
        yMedial: a.yMedial + (b.yMedial - a.yMedial) * t,
        yLateral: a.yLateral + (b.yLateral - a.yLateral) * t,
    };
}

/** Width slices from a closed rim. u = 0 is medial, u = 1 is lateral, at that x. */
export function footprintFrameFromRim(rim: readonly PolyPoint[]): FootprintUvFrame {
    let minX = Infinity;
    let maxX = -Infinity;
    for (const p of rim) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
    }
    const medialYSign = medialYSignFromTopRim(rim as PolyPoint[], { minX, maxX });
    const length = Math.max(1e-6, maxX - minX);
    const n = Math.max(64, Math.ceil(length / 1));
    const slices: WidthSlice[] = [];
    for (let i = 0; i <= n; i++) {
        const x = minX + (length * i) / n;
        let yMin = Infinity;
        let yMax = -Infinity;
        for (let k = 0; k < rim.length; k++) {
            const a = rim[k]!;
            const b = rim[(k + 1) % rim.length]!;
            const d = b.x - a.x;
            if (Math.abs(d) < 1e-12) continue;
            const t = (x - a.x) / d;
            if (t < -1e-6 || t > 1 + 1e-6) continue;
            const y = a.y + (b.y - a.y) * Math.max(0, Math.min(1, t));
            if (y < yMin) yMin = y;
            if (y > yMax) yMax = y;
        }
        if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) continue;
        const yMedial = medialYSign < 0 ? yMin : yMax;
        const yLateral = medialYSign < 0 ? yMax : yMin;
        slices.push({ x, yMedial, yLateral });
    }
    return { minX, maxX, medialYSign, slices };
}

export function uvToXy(frame: FootprintUvFrame, u: number, v: number): { x: number; y: number } {
    const x = frame.minX + v * (frame.maxX - frame.minX);
    const s = sliceAt(frame.slices, x);
    return { x, y: s.yMedial + u * (s.yLateral - s.yMedial) };
}

export function xyToUv(frame: FootprintUvFrame, x: number, y: number): Uv {
    const v = (x - frame.minX) / Math.max(1e-9, frame.maxX - frame.minX);
    const s = sliceAt(frame.slices, x);
    const span = s.yLateral - s.yMedial;
    const u = Math.abs(span) < 1e-9 ? 0.5 : (y - s.yMedial) / span;
    return { u, v };
}

export interface CutSample {
    x: number;
    y: number;
    /** Unit tangent along increasing u. */
    tx: number;
    ty: number;
    /** Unit normal pointing proximal (heel / keep side). */
    nx: number;
    ny: number;
}

function pushExtend(pts: Array<{ x: number; y: number }>, mm: number): Array<{ x: number; y: number }> {
    if (pts.length < 2 || mm <= 0) return pts;
    const a = pts[0]!;
    const b = pts[1]!;
    const c = pts[pts.length - 2]!;
    const d = pts[pts.length - 1]!;
    const l0 = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const l1 = Math.hypot(d.x - c.x, d.y - c.y) || 1;
    return [
        { x: a.x + ((a.x - b.x) / l0) * mm, y: a.y + ((a.y - b.y) / l0) * mm },
        ...pts,
        { x: d.x + ((d.x - c.x) / l1) * mm, y: d.y + ((d.y - c.y) / l1) * mm },
    ];
}

/**
 * Cut polyline in the current footprint frame. The stored controls are (u, v);
 * millimetres come only from this frame (the same one the TopSheet already uses).
 * Ends are extended `extendMm` past the silhouette.
 */
export function cutPolyline(
    frame: FootprintUvFrame,
    controls: readonly Uv[],
    extendMm = TRIM_EXTEND_MM,
    chordMm = TRIM_CHORD_MM,
): CutSample[] {
    const vAt = naturalCubic(controls);
    const u0 = controls[0]!.u;
    const u1 = controls[controls.length - 1]!.u;
    const dense: Array<{ x: number; y: number }> = [];
    const steps = Math.max(32, Math.ceil((frame.maxX - frame.minX) / Math.max(chordMm, 0.05)));
    for (let i = 0; i <= steps; i++) {
        const u = u0 + ((u1 - u0) * i) / steps;
        dense.push(uvToXy(frame, u, vAt(u)));
    }
    const extended = pushExtend(dense, extendMm);
    const out: CutSample[] = [];
    let acc = 0;
    for (let i = 0; i < extended.length; i++) {
        const p = extended[i]!;
        const q = extended[Math.min(extended.length - 1, i + 1)]!;
        const prev = extended[Math.max(0, i - 1)]!;
        if (i > 0) acc += Math.hypot(p.x - prev.x, p.y - prev.y);
        if (out.length > 0 && i !== extended.length - 1 && acc < chordMm * 0.5) continue;
        acc = 0;
        let tx = q.x - prev.x;
        let ty = q.y - prev.y;
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl;
        ty /= tl;
        let nx = -ty;
        let ny = tx;
        const keep = uvToXy(frame, 0.5, 0);
        if ((keep.x - p.x) * nx + (keep.y - p.y) * ny < 0) {
            nx = -nx;
            ny = -ny;
        }
        out.push({ x: p.x, y: p.y, tx, ty, nx, ny });
    }
    return out;
}

export interface CurveHit {
    dist: number;
    /** Positive on the proximal / keep side, negative distal. */
    signed: number;
    x: number;
    y: number;
    nx: number;
    ny: number;
    index: number;
}

/** Closest point on an open cut polyline. */
export function closestOnCut(x: number, y: number, cut: readonly CutSample[]): CurveHit {
    let bestD = Infinity;
    let best: CurveHit = { dist: Infinity, signed: 0, x, y, nx: 0, ny: 1, index: 0 };
    for (let i = 0; i < cut.length - 1; i++) {
        const a = cut[i]!;
        const b = cut[i + 1]!;
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const len2 = ex * ex + ey * ey;
        const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / len2)) : 0;
        const px = a.x + ex * t;
        const py = a.y + ey * t;
        const dx = x - px;
        const dy = y - py;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD) {
            bestD = d2;
            const nx = a.nx + (b.nx - a.nx) * t;
            const ny = a.ny + (b.ny - a.ny) * t;
            const nl = Math.hypot(nx, ny) || 1;
            const signed = (dx * nx + dy * ny) / nl;
            best = {
                dist: Math.sqrt(d2),
                signed,
                x: px,
                y: py,
                nx: nx / nl,
                ny: ny / nl,
                index: i,
            };
        }
    }
    return best;
}

/** Solve S from the original thickness sampled `S` mm proximal of the cut. */
export function resolveSkiveLength(
    kind: TrimKind,
    sampleThickness: (distanceFromCutMm: number) => number,
): { lengthMm: number; t0: number } {
    let lengthMm = skiveLengthMm(kind, sampleThickness(kind === "sulcus" ? 6 : 10));
    for (let i = 0; i < 6; i++) {
        const t0 = sampleThickness(lengthMm);
        const next = skiveLengthMm(kind, t0);
        if (Math.abs(next - lengthMm) < 1e-3) {
            lengthMm = next;
            break;
        }
        lengthMm = next;
    }
    return { lengthMm, t0: sampleThickness(lengthMm) };
}

/**
 * Feather for elements and text. 0 at and distal of the skive start,
 * smoothstep to 1 over the next 5 mm proximal.
 */
export function skiveFeather01(proximalMm: number, lengthMm: number): number {
    if (proximalMm <= lengthMm) return 0;
    return smoothstep01((proximalMm - lengthMm) / SKIVE_FEATHER_MM);
}

/** Max surface angle allowed in the skive: 2·atan((t0−0.5)/S). */
export function skiveSlopeLimitRad(t0: number, lengthMm: number): number {
    if (!(lengthMm > 1e-9)) return Math.PI / 2;
    return 2 * Math.atan(Math.max(0, t0 - SKIVE_END_MM) / lengthMm);
}
