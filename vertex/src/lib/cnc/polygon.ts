// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EndType, inflatePathsD, isPositiveD, JoinType } from "clipper2-ts";
import type { Point } from "./types";

export function signedArea(pts: Point[]): number {
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!;
        const b = pts[(i + 1) % pts.length]!;
        s += a.x * b.y - b.x * a.y;
    }
    return 0.5 * s;
}

export function ensureCcw(pts: Point[]): Point[] {
    return signedArea(pts) < 0 ? pts.slice().reverse() : pts.slice();
}

export function ensureCw(pts: Point[]): Point[] {
    return signedArea(pts) > 0 ? pts.slice().reverse() : pts.slice();
}

export function perimeter(pts: Point[]): number {
    let l = 0;
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!;
        const b = pts[(i + 1) % pts.length]!;
        l += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return l;
}

export function centroid(pts: Point[]): Point {
    let x = 0;
    let y = 0;
    for (const p of pts) {
        x += p.x;
        y += p.y;
    }
    const n = Math.max(1, pts.length);
    return { x: x / n, y: y / n };
}

export function bboxOf(pts: Point[]): { minX: number; maxX: number; minY: number; maxY: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    return { minX, maxX, minY, maxY };
}

/** Rotate so index 0 is posterior heel (min X, then mid |Y|). */
export function startAtHeel(pts: Point[]): Point[] {
    if (pts.length === 0) return [];
    let best = 0;
    for (let i = 1; i < pts.length; i++) {
        const p = pts[i]!;
        const b = pts[best]!;
        if (p.x < b.x - 1e-9 || (Math.abs(p.x - b.x) <= 1e-9 && Math.abs(p.y) < Math.abs(b.y))) best = i;
    }
    return pts.slice(best).concat(pts.slice(0, best));
}

export function closeOutline(pts: Point[], gapTolMm: number): Point[] {
    if (pts.length < 3) return pts.slice();
    const a = pts[0]!;
    const b = pts[pts.length - 1]!;
    const gap = Math.hypot(a.x - b.x, a.y - b.y);
    if (gap <= gapTolMm) return pts.slice(0, pts.length - (gap < 1e-9 ? 1 : 0));
    return pts.slice();
}

export function outlineGapMm(pts: Point[]): number {
    if (pts.length < 2) return Infinity;
    const a = pts[0]!;
    const b = pts[pts.length - 1]!;
    return Math.hypot(a.x - b.x, a.y - b.y);
}

export function pointInPoly(x: number, y: number, poly: Point[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const yi = poly[i]!.y;
        const yj = poly[j]!.y;
        const xi = poly[i]!.x;
        const xj = poly[j]!.x;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-18) + xi) inside = !inside;
    }
    return inside;
}

export function distToPoly(x: number, y: number, poly: Point[]): number {
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i]!;
        const b = poly[(i + 1) % poly.length]!;
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const len2 = ex * ex + ey * ey;
        const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / len2)) : 0;
        const d = Math.hypot(x - (a.x + ex * t), y - (a.y + ey * t));
        if (d < best) best = d;
    }
    return best;
}

export function nearestOnPoly(x: number, y: number, poly: Point[]): Point {
    let best = poly[0] ?? { x, y, z: 0 };
    let bestD = Infinity;
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i]!;
        const b = poly[(i + 1) % poly.length]!;
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const ez = (b.z ?? 0) - (a.z ?? 0);
        const len2 = ex * ex + ey * ey;
        const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / len2)) : 0;
        const px = a.x + ex * t;
        const py = a.y + ey * t;
        const d = Math.hypot(x - px, y - py);
        if (d < bestD) {
            bestD = d;
            best = { x: px, y: py, z: (a.z ?? 0) + ez * t };
        }
    }
    return best;
}

export function resampleClosed(pts: Point[], spacingMm: number): Point[] {
    if (pts.length < 3) return pts.slice();
    const len = perimeter(pts);
    const n = Math.max(24, Math.ceil(len / Math.max(0.05, spacingMm)));
    const out: Point[] = [];
    const segs: number[] = [];
    let total = 0;
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!;
        const b = pts[(i + 1) % pts.length]!;
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        segs.push(d);
        total += d;
    }
    if (total < 1e-9) return pts.slice();
    for (let k = 0; k < n; k++) {
        let s = (k / n) * total;
        for (let i = 0; i < pts.length; i++) {
            const d = segs[i]!;
            if (s <= d || i === pts.length - 1) {
                const t = d > 1e-12 ? s / d : 0;
                const a = pts[i]!;
                const b = pts[(i + 1) % pts.length]!;
                out.push({
                    x: a.x + (b.x - a.x) * t,
                    y: a.y + (b.y - a.y) * t,
                    z: (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * t,
                });
                break;
            }
            s -= d;
        }
    }
    return out;
}

export function mergeCollinear(pts: Point[], tolMm: number, closed = true): Point[] {
    if (pts.length < 3) return pts.slice();
    const src = pts.slice();
    const out: Point[] = [];
    const n = src.length;
    for (let i = 0; i < n; i++) {
        const a = out.length ? out[out.length - 1]! : src[(i + n - 1) % n]!;
        const b = src[i]!;
        const c = src[(i + 1) % n]!;
        if (out.length === 0 && !closed) {
            out.push(b);
            continue;
        }
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const acx = c.x - a.x;
        const acy = c.y - a.y;
        const ab2 = abx * abx + aby * aby;
        if (ab2 < 1e-16) continue;
        const t = (acx * abx + acy * aby) / ab2;
        const px = a.x + abx * Math.max(0, Math.min(1, t));
        const py = a.y + aby * Math.max(0, Math.min(1, t));
        const dist = Math.hypot(b.x - px, b.y - py);
        const reverse = abx * (c.x - b.x) + aby * (c.y - b.y) < 0;
        if (dist <= tolMm && !reverse && out.length) continue;
        out.push(b);
    }
    if (closed && out.length > 3) {
        const a = out[out.length - 1]!;
        const b = out[0]!;
        const c = out[1]!;
        const d = distPointToSeg(b, a, c);
        if (d <= tolMm) out.shift();
    }
    return out.length >= 3 ? out : src;
}

function distPointToSeg(p: Point, a: Point, b: Point): number {
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len2 = ex * ex + ey * ey;
    const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2)) : 0;
    return Math.hypot(p.x - (a.x + ex * t), p.y - (a.y + ey * t));
}

function orientOuter(path: Array<{ x: number; y: number }>): Point[] {
    if (path.length < 3 || !isPositiveD(path)) return [];
    let area2 = 0;
    for (let i = 0; i < path.length; i++) {
        const a = path[i]!;
        const b = path[(i + 1) % path.length]!;
        area2 += a.x * b.y - b.x * a.y;
    }
    if (Math.abs(area2) < 1e-4) return [];
    const pts: Point[] = path.map((p) => ({ x: p.x, y: p.y, z: 0 }));
    return startAtHeel(ensureCcw(pts));
}

/** Round-join Clipper2 offset. Positive delta = outward for a CCW loop. Largest outer only. */
export function offsetClosed(loop: Point[], deltaMm: number, chordTolMm = 0.01): Point[] {
    if (loop.length < 3) return loop.map((p) => ({ ...p }));
    const all = offsetClosedAll(loop, deltaMm, chordTolMm);
    if (!all.length) return [];
    let best = all[0]!;
    let bestA = -1;
    for (const path of all) {
        const a = Math.abs(signedArea(path));
        if (a > bestA) {
            bestA = a;
            best = path;
        }
    }
    return best.map((p) => ({ x: p.x, y: p.y, z: 0 }));
}

/**
 * Every positive-area outer from a round-join offset.
 * An inward offset can split one loop into several; holes are dropped.
 * Order is centroid X then Y so a split is deterministic.
 */
export function offsetClosedAll(loop: Point[], deltaMm: number, chordTolMm = 0.01): Point[][] {
    if (loop.length < 3) return [];
    const src = ensureCcw(loop);
    const path = src.map((p) => ({ x: p.x, y: p.y }));
    const paths = inflatePathsD([path], deltaMm, JoinType.Round, EndType.Polygon, 2, 4, chordTolMm);
    const out: Point[][] = [];
    for (const p of paths) {
        const oriented = orientOuter(p);
        if (oriented.length >= 3) out.push(oriented);
    }
    out.sort((a, b) => {
        const ca = centroid(a);
        const cb = centroid(b);
        return ca.x - cb.x || ca.y - cb.y;
    });
    return out;
}

export function unit(x: number, y: number): Point {
    const l = Math.hypot(x, y) || 1;
    return { x: x / l, y: y / l };
}

/** Outward normal for a CW path (interior left). */
export function outwardNormalCw(tangent: Point): Point {
    return { x: tangent.y, y: -tangent.x };
}

export function tangentAt(pts: Point[], i: number): Point {
    const a = pts[(i + pts.length - 1) % pts.length]!;
    const b = pts[(i + 1) % pts.length]!;
    return unit(b.x - a.x, b.y - a.y);
}

/** Nominal G1 spacing along the toolpath, matching the Windows reference. */
export const TOOLPATH_SPACING_MM = 1;
/** Split a chord only when it leaves the source curve by more than this in XY or Z. */
export const TOOLPATH_CHORD_DEV_MM = 0.05;

interface ArcStation {
    x: number;
    y: number;
    z: number;
    s: number;
}

function buildArcStations(pts: Point[], closed: boolean): { stations: ArcStation[]; total: number } {
    const stations: ArcStation[] = [];
    const n = pts.length;
    if (n === 0) return { stations, total: 0 };
    const push = (p: Point, s: number) => {
        stations.push({ x: p.x, y: p.y, z: p.z ?? 0, s });
    };
    push(pts[0]!, 0);
    let s = 0;
    const edges = closed ? n : n - 1;
    for (let i = 0; i < edges; i++) {
        const a = pts[i]!;
        const b = pts[(i + 1) % n]!;
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        if (d < 1e-9) continue;
        s += d;
        push(b, s);
    }
    return { stations, total: s };
}

function stationAt(stations: ArcStation[], s: number): ArcStation {
    const last = stations[stations.length - 1]!;
    if (s <= 0) return stations[0]!;
    if (s >= last.s) return last;
    let lo = 0;
    let hi = stations.length - 1;
    while (lo + 1 < hi) {
        const mid = (lo + hi) >> 1;
        if (stations[mid]!.s <= s) lo = mid;
        else hi = mid;
    }
    const a = stations[lo]!;
    const b = stations[hi]!;
    const span = b.s - a.s;
    const u = span > 1e-12 ? (s - a.s) / span : 0;
    return {
        x: a.x + (b.x - a.x) * u,
        y: a.y + (b.y - a.y) * u,
        z: a.z + (b.z - a.z) * u,
        s,
    };
}

function worstChord(
    a: ArcStation,
    b: ArcStation,
    stations: ArcStation[],
): { xy: number; z: number; s: number } {
    let lo = 0;
    let hi = stations.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (stations[mid]!.s <= a.s + 1e-8) lo = mid + 1;
        else hi = mid;
    }
    let worst = 0;
    let xy = 0;
    let z = 0;
    let s = (a.s + b.s) / 2;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const ez = b.z - a.z;
    const len2 = ex * ex + ey * ey;
    for (let i = lo; i < stations.length; i++) {
        const p = stations[i]!;
        if (p.s >= b.s - 1e-8) break;
        const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2)) : 0;
        const dxy = Math.hypot(p.x - (a.x + ex * t), p.y - (a.y + ey * t));
        const dz = Math.abs(p.z - (a.z + ez * t));
        const err = Math.max(dxy, dz);
        if (err > worst) {
            worst = err;
            xy = dxy;
            z = dz;
            s = p.s;
        }
    }
    return { xy, z, s };
}

function toPoint(s: ArcStation): Point {
    return { x: s.x, y: s.y, z: s.z };
}

/**
 * Even samples about `spacingMm` apart along XY arc length.
 * A span is split until every source vertex stays within `maxDevMm` of the chord in XY and in Z.
 * The first point is kept. Closed loops are not repeated.
 */
export function resampleToSpacing(
    pts: Point[],
    spacingMm: number,
    maxDevMm: number,
    closed = false,
): Point[] {
    if (pts.length < 2) return pts.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 }));
    const { stations, total } = buildArcStations(pts, closed);
    if (stations.length < 2 || total < 1e-9)
        return [toPoint(stations[0] ?? { x: pts[0]!.x, y: pts[0]!.y, z: 0, s: 0 })];
    const spacing = Math.max(1e-3, spacingMm);
    const nSeg = Math.max(closed ? 3 : 1, Math.round(total / spacing));
    const step = total / nSeg;
    const keys: ArcStation[] = [];
    const count = closed ? nSeg : nSeg + 1;
    for (let k = 0; k < count; k++) {
        if (k === 0) keys.push(stations[0]!);
        else if (!closed && k === count - 1) keys.push(stations[stations.length - 1]!);
        else keys.push(stationAt(stations, Math.min(total, k * step)));
    }
    type Span = { a: ArcStation; b: ArcStation };
    const spans: Span[] = [];
    for (let i = 0; i < keys.length - 1; i++) spans.push({ a: keys[i]!, b: keys[i + 1]! });
    if (closed) {
        const end = keys[keys.length - 1]!;
        const start = stations[0]!;
        spans.push({ a: end, b: { x: start.x, y: start.y, z: start.z, s: total } });
    }
    const out: Point[] = [toPoint(keys[0]!)];
    for (let i = 0; i < spans.length; i++) {
        const span = spans[i]!;
        const dev = worstChord(span.a, span.b, stations);
        if ((dev.xy > maxDevMm || dev.z > maxDevMm) && dev.s > span.a.s + 1e-4 && dev.s < span.b.s - 1e-4) {
            const mid = stationAt(stations, dev.s);
            spans.splice(i, 1, { a: span.a, b: mid }, { a: mid, b: span.b });
            // `continue` still runs the for-loop increment, which would skip the new span.
            i--;
            continue;
        }
        const closes =
            closed &&
            Math.abs(span.b.s - total) <= 1e-6 &&
            Math.hypot(span.b.x - stations[0]!.x, span.b.y - stations[0]!.y) <= 1e-6;
        if (closes) continue;
        const prev = out[out.length - 1]!;
        if (
            Math.hypot(prev.x - span.b.x, prev.y - span.b.y) < 1e-6 &&
            Math.abs((prev.z ?? 0) - span.b.z) < 1e-6
        ) {
            continue;
        }
        out.push(toPoint(span.b));
    }
    return out;
}

function projectSeg(p: Point, a: Point, b: Point): { t: number; d: number } {
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len2 = ex * ex + ey * ey;
    const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2)) : 0;
    return { t, d: Math.hypot(p.x - (a.x + ex * t), p.y - (a.y + ey * t)) };
}

/**
 * Max XY / Z distance from `source` vertices to the chords of `path`.
 * Both polylines are walked in order. A path point may sit `slack` mm off the source.
 */
export function maxOrderedChordDeviation(
    path: Point[],
    source: Point[],
    slack = 0.08,
): { xy: number; z: number } {
    if (path.length < 2 || source.length < 2) return { xy: 0, z: 0 };
    const cum: number[] = [0];
    for (let i = 1; i < source.length; i++) {
        const a = source[i - 1]!;
        const b = source[i]!;
        cum.push(cum[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
    }
    const lastEdge = source.length - 2;
    let edge = 0;
    let vertex = 1;
    let maxXy = 0;
    let maxZ = 0;
    let prev: { s: number; p: Point } | null = null;
    for (const p of path) {
        let e = Math.min(Math.max(0, edge), lastEdge);
        let here = projectSeg(p, source[e]!, source[e + 1]!);
        while (e < lastEdge) {
            const nxt = projectSeg(p, source[e + 1]!, source[e + 2]!);
            if (here.d <= slack && nxt.d > here.d + 1e-6) break;
            if (nxt.d > here.d + 1e-4 && here.t < 0.999) break;
            e++;
            here = nxt;
        }
        if (here.d > slack) return { xy: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY };
        const s0 = cum[e]!;
        const s1 = cum[e + 1]!;
        const s = s0 + here.t * (s1 - s0);
        if (prev && s + 1e-6 < prev.s) return { xy: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY };
        if (prev) {
            const ex = p.x - prev.p.x;
            const ey = p.y - prev.p.y;
            const ez = (p.z ?? 0) - (prev.p.z ?? 0);
            const len2 = ex * ex + ey * ey;
            while (vertex < source.length - 1 && cum[vertex]! <= prev.s + 1e-6) vertex++;
            let v = vertex;
            while (v < source.length - 1 && cum[v]! < s - 1e-6) {
                const q = source[v]!;
                const t =
                    len2 > 1e-12
                        ? Math.max(0, Math.min(1, ((q.x - prev.p.x) * ex + (q.y - prev.p.y) * ey) / len2))
                        : 0;
                const dxy = Math.hypot(q.x - (prev.p.x + ex * t), q.y - (prev.p.y + ey * t));
                const dz = Math.abs((q.z ?? 0) - ((prev.p.z ?? 0) + ez * t));
                if (dxy > maxXy) maxXy = dxy;
                if (dz > maxZ) maxZ = dz;
                v++;
            }
            vertex = v;
        }
        prev = { s, p };
        edge = e;
    }
    return { xy: maxXy, z: maxZ };
}

export function densifyArc(
    cx: number,
    cy: number,
    r: number,
    a0: number,
    a1: number,
    chordTolMm: number,
): Point[] {
    const span = a1 - a0;
    const abs = Math.abs(span);
    const dTheta =
        r > chordTolMm ? 2 * Math.acos(Math.max(-1, Math.min(1, 1 - chordTolMm / r))) : Math.PI / 8;
    const n = Math.max(2, Math.ceil(abs / Math.max(1e-4, dTheta)));
    const out: Point[] = [];
    for (let i = 0; i <= n; i++) {
        const a = a0 + (span * i) / n;
        out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return out;
}
