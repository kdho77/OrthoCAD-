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
