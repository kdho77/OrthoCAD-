// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { PolyPoint } from "./curves";
import type { HermiteStation } from "./loft";

export const OUTLINE_DEDUPE_MM = 0.05;
export const OUTLINE_COLLINEAR_MM = 0.05;
export const OUTLINE_NUDGE_MM = 0.12;

function distXY(a: PolyPoint, b: PolyPoint): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function distToSeg(p: PolyPoint, a: PolyPoint, b: PolyPoint): { d: number; t: number } {
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len2 = ex * ex + ey * ey;
    const t = len2 > 1e-18 ? ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2 : 0;
    const tt = Math.max(0, Math.min(1, t));
    return { d: Math.hypot(p.x - (a.x + ex * tt), p.y - (a.y + ey * tt)), t: tt };
}

export function segIntersect(a: PolyPoint, b: PolyPoint, c: PolyPoint, d: PolyPoint): boolean {
    const o = (p: PolyPoint, q: PolyPoint, r: PolyPoint) =>
        (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const o1 = o(a, b, c);
    const o2 = o(a, b, d);
    const o3 = o(c, d, a);
    const o4 = o(c, d, b);
    return o1 * o2 < -1e-12 && o3 * o4 < -1e-12;
}

function centroid(pts: PolyPoint[]): { x: number; y: number } {
    let x = 0;
    let y = 0;
    for (const p of pts) {
        x += p.x;
        y += p.y;
    }
    const n = Math.max(1, pts.length);
    return { x: x / n, y: y / n };
}

/** Clean a closed outline: consecutive dedupe, collinear spikes, self-touch nudges. */
export function cleanClosedLoop(pts: PolyPoint[]): { points: PolyPoint[]; keep: number[] } {
    if (pts.length < 3) return { points: pts.map((p) => ({ ...p })), keep: pts.map((_, i) => i) };
    const src = pts.map((p) => ({ ...p }));
    const keep: number[] = [];
    const points: PolyPoint[] = [];
    for (let i = 0; i < src.length; i++) {
        const p = src[i]!;
        if (points.length && distXY(points[points.length - 1]!, p) < OUTLINE_DEDUPE_MM) continue;
        points.push(p);
        keep.push(i);
    }
    if (points.length > 3 && distXY(points[0]!, points[points.length - 1]!) < OUTLINE_DEDUPE_MM) {
        points.pop();
        keep.pop();
    }
    let dirty = true;
    while (dirty && points.length > 3) {
        dirty = false;
        for (let i = 0; i < points.length; i++) {
            const a = points[(i + points.length - 1) % points.length]!;
            const b = points[i]!;
            const c = points[(i + 1) % points.length]!;
            const hit = distToSeg(b, a, c);
            const abx = b.x - a.x;
            const aby = b.y - a.y;
            const bcx = c.x - b.x;
            const bcy = c.y - b.y;
            const reversal = abx * bcx + aby * bcy < 0;
            const spike = hit.d < OUTLINE_COLLINEAR_MM && (hit.t < 0.08 || hit.t > 0.92 || reversal);
            if (spike) {
                points.splice(i, 1);
                keep.splice(i, 1);
                dirty = true;
                break;
            }
        }
    }
    const mid = centroid(points);
    for (let i = 0; i < points.length; i++) {
        for (let j = i + 2; j < points.length; j++) {
            if (i === 0 && j === points.length - 1) continue;
            if (distXY(points[i]!, points[j]!) >= OUTLINE_DEDUPE_MM) continue;
            const p = points[j]!;
            const dx = mid.x - p.x;
            const dy = mid.y - p.y;
            const len = Math.hypot(dx, dy) || 1;
            p.x += (dx / len) * OUTLINE_NUDGE_MM;
            p.y += (dy / len) * OUTLINE_NUDGE_MM;
        }
    }
    for (let i = 0; i < points.length; i++) {
        const a = points[i]!;
        const b = points[(i + 1) % points.length]!;
        for (let k = i + 2; k < points.length; k++) {
            const wrap = i === 0 && k === points.length - 1;
            if (wrap) continue;
            const c = points[k]!;
            const d = points[(k + 1) % points.length]!;
            if (!segIntersect(a, b, c, d)) continue;
            const p = points[k]!;
            const dx = mid.x - p.x;
            const dy = mid.y - p.y;
            const len = Math.hypot(dx, dy) || 1;
            p.x += (dx / len) * OUTLINE_NUDGE_MM;
            p.y += (dy / len) * OUTLINE_NUDGE_MM;
        }
    }
    return { points, keep };
}

/** Merge column stations to the cleaned outline (same keep map). */
export function applyOutlineClean(
    stations: HermiteStation[],
    rimLocal: number[],
    indices?: number[],
): { dropped: number } {
    const n = Math.min(stations.length, rimLocal.length);
    if (n < 3) return { dropped: 0 };
    const loop = stations.slice(0, n).map((s) => s.outline);
    const { points, keep } = cleanClosedLoop(loop);
    if (keep.length === n) {
        for (let i = 0; i < n; i++) stations[i]!.outline = points[i]!;
        return { dropped: 0 };
    }
    const keepSet = new Set(keep);
    if (indices) {
        for (let i = 0; i < n; i++) {
            if (keepSet.has(i)) continue;
            let dest = keep[0]!;
            for (const k of keep) {
                if (k < i) dest = k;
                else break;
            }
            const from = rimLocal[i]!;
            const to = rimLocal[dest]!;
            if (from === to) continue;
            for (let t = 0; t < indices.length; t++) {
                if (indices[t] === from) indices[t] = to;
            }
        }
    }
    const nextSt = keep.map((i, k) => {
        const st = stations[i]!;
        return { ...st, outline: points[k]!, rim: { ...st.rim }, n: { ...st.n } };
    });
    const nextRim = keep.map((i) => rimLocal[i]!);
    stations.length = 0;
    for (const s of nextSt) stations.push(s);
    rimLocal.length = 0;
    for (const r of nextRim) rimLocal.push(r);
    return { dropped: n - keep.length };
}
