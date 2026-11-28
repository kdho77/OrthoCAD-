// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { PolyPoint } from "./curves";

/** Outer-band width (mm) re-triangulated to the wall bottom ring. */
export const DISH_BAND_MM = 3;

export function pointInPoly(x: number, y: number, poly: PolyPoint[]): boolean {
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

function bruteMinDistToLoopXY(x: number, y: number, loop: PolyPoint[]): number {
    let best = Infinity;
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        const d = segmentDistance2(a.x, a.y, b.x, b.y, x, y);
        if (d < best) best = d;
    }
    return Math.sqrt(best);
}

/** Same projection the brute-force scan uses. Squared distance, no sqrt. */
function segmentDistance2(ax: number, ay: number, bx: number, by: number, x: number, y: number): number {
    const ex = bx - ax;
    const ey = by - ay;
    const len2 = ex * ex + ey * ey;
    const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / len2)) : 0;
    const dx = x - (ax + ex * t);
    const dy = y - (ay + ey * t);
    return dx * dx + dy * dy;
}

/**
 * Squared distance to the segment's bounding box. This is a lower bound on the
 * squared distance to the segment. A 1e-6 mm² pad covers the rounding in the
 * box math, so skipping a box past `best + pad` cannot skip the closest segment.
 */
function segmentBoxLower2(ax: number, ay: number, bx: number, by: number, x: number, y: number): number {
    const minX = ax < bx ? ax : bx;
    const maxX = ax > bx ? ax : bx;
    const minY = ay < by ? ay : by;
    const maxY = ay > by ? ay : by;
    const dx = x < minX ? minX - x : x > maxX ? x - maxX : 0;
    const dy = y < minY ? minY - y : y > maxY ? y - maxY : 0;
    return dx * dx + dy * dy;
}

const LOOP_INDEX_MIN = 24;
const LOOP_CELL_MM = 4;
const LOOP_BOUND_PAD = 1e-6;
const LOOP_SEARCH_PAD_MM = 1e-4;

interface LoopDistIndex {
    n: number;
    cell: number;
    originX: number;
    originY: number;
    cols: number;
    rows: number;
    head: Int32Array;
    next: Int32Array;
    segOf: Int32Array;
    ax: Float64Array;
    ay: Float64Array;
    bx: Float64Array;
    by: Float64Array;
    seen: Int32Array;
    gen: number;
    x0: number;
    y0: number;
    xN: number;
    yN: number;
}

const loopIndexes = new WeakMap<PolyPoint[], LoopDistIndex>();

function buildLoopDistIndex(loop: PolyPoint[]): LoopDistIndex {
    const n = loop.length;
    const ax = new Float64Array(n);
    const ay = new Float64Array(n);
    const bx = new Float64Array(n);
    const by = new Float64Array(n);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % n]!;
        ax[i] = a.x;
        ay[i] = a.y;
        bx[i] = b.x;
        by[i] = b.y;
        if (a.x < minX) minX = a.x;
        if (a.y < minY) minY = a.y;
        if (a.x > maxX) maxX = a.x;
        if (a.y > maxY) maxY = a.y;
        if (b.x < minX) minX = b.x;
        if (b.y < minY) minY = b.y;
        if (b.x > maxX) maxX = b.x;
        if (b.y > maxY) maxY = b.y;
    }
    const cell = LOOP_CELL_MM;
    const originX = minX - cell;
    const originY = minY - cell;
    const cols = Math.max(1, Math.ceil((maxX - originX) / cell) + 1);
    const rows = Math.max(1, Math.ceil((maxY - originY) / cell) + 1);
    const buckets: number[][] = Array.from({ length: cols * rows }, () => []);
    const clampCell = (value: number, origin: number, limit: number): number => {
        let c = Math.floor((value - origin) / cell);
        if (c < 0) c = 0;
        if (c >= limit) c = limit - 1;
        return c;
    };
    for (let i = 0; i < n; i++) {
        const minSX = ax[i]! < bx[i]! ? ax[i]! : bx[i]!;
        const maxSX = ax[i]! > bx[i]! ? ax[i]! : bx[i]!;
        const minSY = ay[i]! < by[i]! ? ay[i]! : by[i]!;
        const maxSY = ay[i]! > by[i]! ? ay[i]! : by[i]!;
        const i0 = clampCell(minSX, originX, cols);
        const i1 = clampCell(maxSX, originX, cols);
        const j0 = clampCell(minSY, originY, rows);
        const j1 = clampCell(maxSY, originY, rows);
        for (let j = j0; j <= j1; j++) {
            const row = j * cols;
            for (let ix = i0; ix <= i1; ix++) buckets[row + ix]!.push(i);
        }
    }
    let inserts = 0;
    for (const bucket of buckets) inserts += bucket.length;
    const head = new Int32Array(cols * rows);
    head.fill(-1);
    const next = new Int32Array(Math.max(1, inserts));
    const segOf = new Int32Array(Math.max(1, inserts));
    let cursor = 0;
    for (let c = 0; c < buckets.length; c++) {
        const bucket = buckets[c]!;
        for (let k = 0; k < bucket.length; k++) {
            next[cursor] = head[c]!;
            segOf[cursor] = bucket[k]!;
            head[c] = cursor;
            cursor += 1;
        }
    }
    const first = loop[0]!;
    const last = loop[n - 1]!;
    return {
        n,
        cell,
        originX,
        originY,
        cols,
        rows,
        head,
        next,
        segOf,
        ax,
        ay,
        bx,
        by,
        seen: new Int32Array(n),
        gen: 1,
        x0: first.x,
        y0: first.y,
        xN: last.x,
        yN: last.y,
    };
}

function loopDistIndex(loop: PolyPoint[]): LoopDistIndex {
    const cached = loopIndexes.get(loop);
    const n = loop.length;
    const first = loop[0]!;
    const last = loop[n - 1]!;
    if (
        cached &&
        cached.n === n &&
        cached.x0 === first.x &&
        cached.y0 === first.y &&
        cached.xN === last.x &&
        cached.yN === last.y
    ) {
        return cached;
    }
    const built = buildLoopDistIndex(loop);
    loopIndexes.set(loop, built);
    return built;
}

function visitSegmentsInSquare(
    idx: LoopDistIndex,
    x: number,
    y: number,
    radius: number,
    fn: (seg: number) => void,
): void {
    const { cell, originX, originY, cols, rows } = idx;
    let i0 = Math.floor((x - radius - originX) / cell);
    let i1 = Math.floor((x + radius - originX) / cell);
    let j0 = Math.floor((y - radius - originY) / cell);
    let j1 = Math.floor((y + radius - originY) / cell);
    if (i1 < 0 || j1 < 0 || i0 >= cols || j0 >= rows) return;
    if (i0 < 0) i0 = 0;
    if (j0 < 0) j0 = 0;
    if (i1 >= cols) i1 = cols - 1;
    if (j1 >= rows) j1 = rows - 1;
    let gen = idx.gen + 1;
    if (gen >= 0x7ffffffe) {
        idx.seen.fill(0);
        gen = 1;
    }
    idx.gen = gen;
    for (let j = j0; j <= j1; j++) {
        const row = j * cols;
        for (let i = i0; i <= i1; i++) {
            let node = idx.head[row + i]!;
            while (node >= 0) {
                const seg = idx.segOf[node]!;
                if (idx.seen[seg] !== gen) {
                    idx.seen[seg] = gen;
                    fn(seg);
                }
                node = idx.next[node]!;
            }
        }
    }
}

function indexedSegmentDistance2(idx: LoopDistIndex, seg: number, x: number, y: number): number {
    return segmentDistance2(idx.ax[seg]!, idx.ay[seg]!, idx.bx[seg]!, idx.by[seg]!, x, y);
}

/** Exact minimum squared distance. Far segments are skipped only when their box cannot win. */
function exactMinDist2(idx: LoopDistIndex, x: number, y: number): number {
    let best = Infinity;
    visitSegmentsInSquare(idx, x, y, idx.cell * 2, (seg) => {
        const d = indexedSegmentDistance2(idx, seg, x, y);
        if (d < best) best = d;
    });
    for (let i = 0; i < idx.n; i++) {
        const lower = segmentBoxLower2(idx.ax[i]!, idx.ay[i]!, idx.bx[i]!, idx.by[i]!, x, y);
        if (lower > best + LOOP_BOUND_PAD) continue;
        const d = indexedSegmentDistance2(idx, i, x, y);
        if (d < best) best = d;
    }
    return best;
}

function indexedMinInRadius(idx: LoopDistIndex, x: number, y: number, radius: number): number {
    let best = Infinity;
    visitSegmentsInSquare(idx, x, y, radius, (seg) => {
        const d = indexedSegmentDistance2(idx, seg, x, y);
        if (d < best) best = d;
    });
    return best;
}

export function minDistToLoopXY(x: number, y: number, loop: PolyPoint[]): number {
    if (loop.length < LOOP_INDEX_MIN) return bruteMinDistToLoopXY(x, y, loop);
    return Math.sqrt(exactMinDist2(loopDistIndex(loop), x, y));
}

/** True when {@link minDistToLoopXY} is strictly greater than `threshold`. */
export function loopDistanceExceeds(x: number, y: number, loop: PolyPoint[], threshold: number): boolean {
    if (!(threshold > 0) || !Number.isFinite(threshold) || loop.length < LOOP_INDEX_MIN) {
        return bruteMinDistToLoopXY(x, y, loop) > threshold;
    }
    const best = indexedMinInRadius(loopDistIndex(loop), x, y, threshold + LOOP_SEARCH_PAD_MM);
    return Math.sqrt(best) > threshold;
}

/** True when {@link minDistToLoopXY} is strictly less than `threshold`. */
export function loopDistanceIsBelow(x: number, y: number, loop: PolyPoint[], threshold: number): boolean {
    if (!(threshold > 0) || !Number.isFinite(threshold) || loop.length < LOOP_INDEX_MIN) {
        return bruteMinDistToLoopXY(x, y, loop) < threshold;
    }
    const best = indexedMinInRadius(loopDistIndex(loop), x, y, threshold + LOOP_SEARCH_PAD_MM);
    return Math.sqrt(best) < threshold;
}

function orient2(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function inCircumcircle(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
    dx: number,
    dy: number,
): boolean {
    const adx = ax - dx;
    const ady = ay - dy;
    const bdx = bx - dx;
    const bdy = by - dy;
    const cdx = cx - dx;
    const cdy = cy - dy;
    const det =
        (adx * adx + ady * ady) * (bdx * cdy - cdx * bdy) -
        (bdx * bdx + bdy * bdy) * (adx * cdy - cdx * ady) +
        (cdx * cdx + cdy * cdy) * (adx * bdy - bdx * ady);
    const ccw = orient2(ax, ay, bx, by, cx, cy);
    return ccw > 0 ? det > 1e-16 : det < -1e-16;
}

interface Tri {
    a: number;
    b: number;
    c: number;
}

/** Bowyer–Watson Delaunay in XY. */
export function delaunayXY(pts: Array<{ x: number; y: number }>): Array<[number, number, number]> {
    const n = pts.length;
    if (n < 3) return [];
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
    const dx = maxX - minX || 1;
    const dy = maxY - minY || 1;
    const midX = (minX + maxX) * 0.5;
    const midY = (minY + maxY) * 0.5;
    const d = Math.max(dx, dy) * 20;
    const sto: Array<{ x: number; y: number }> = [
        { x: midX - d, y: midY - d },
        { x: midX + d, y: midY - d },
        { x: midX, y: midY + d },
    ];
    const all = pts.concat(sto);
    const s0 = n;
    const s1 = n + 1;
    const s2 = n + 2;
    let tris: Tri[] = [{ a: s0, b: s1, c: s2 }];
    for (let i = 0; i < n; i++) {
        const p = all[i]!;
        const bad: Tri[] = [];
        const keep: Tri[] = [];
        for (const t of tris) {
            const A = all[t.a]!;
            const B = all[t.b]!;
            const C = all[t.c]!;
            if (inCircumcircle(A.x, A.y, B.x, B.y, C.x, C.y, p.x, p.y)) bad.push(t);
            else keep.push(t);
        }
        const edges = new Map<string, { a: number; b: number; n: number }>();
        const add = (a: number, b: number) => {
            const k = a < b ? `${a},${b}` : `${b},${a}`;
            const e = edges.get(k);
            if (e) e.n++;
            else edges.set(k, { a, b, n: 1 });
        };
        for (const t of bad) {
            add(t.a, t.b);
            add(t.b, t.c);
            add(t.c, t.a);
        }
        const next = keep;
        for (const e of edges.values()) {
            if (e.n !== 1) continue;
            if (orient2(all[e.a]!.x, all[e.a]!.y, all[e.b]!.x, all[e.b]!.y, p.x, p.y) > 0) {
                next.push({ a: e.a, b: e.b, c: i });
            } else {
                next.push({ a: e.b, b: e.a, c: i });
            }
        }
        tris = next;
    }
    const out: Array<[number, number, number]> = [];
    for (const t of tris) {
        if (t.a >= n || t.b >= n || t.c >= n) continue;
        const A = pts[t.a]!;
        const B = pts[t.b]!;
        const C = pts[t.c]!;
        if (orient2(A.x, A.y, B.x, B.y, C.x, C.y) <= 0) out.push([t.a, t.c, t.b]);
        else out.push([t.a, t.b, t.c]);
    }
    return out;
}

function boundaryEdgeKey(a: number, b: number): string {
    return a < b ? `${a},${b}` : `${b},${a}`;
}

function uniqueBoundaryFaces(
    faces: Array<[number, number, number]>,
    nBoundary: number,
): Array<[number, number, number]> {
    const seen = new Set<string>();
    const out: Array<[number, number, number]> = [];
    for (const f of faces) {
        const b = [f[0]!, f[1]!, f[2]!].filter((i) => i < nBoundary);
        if (b.length === 2) {
            const k = boundaryEdgeKey(b[0]!, b[1]!);
            if (seen.has(k)) continue;
            seen.add(k);
        }
        out.push(f);
    }
    return out;
}

function hasEdge(faces: Array<[number, number, number]>, a: number, b: number): boolean {
    for (const f of faces) {
        const [i, j, k] = f;
        if ((i === a && j === b) || (j === a && k === b) || (k === a && i === b)) return true;
        if ((i === b && j === a) || (j === b && k === a) || (k === b && i === a)) return true;
    }
    return false;
}

function segIntersectProper(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
    dx: number,
    dy: number,
): boolean {
    const o1 = orient2(ax, ay, bx, by, cx, cy);
    const o2 = orient2(ax, ay, bx, by, dx, dy);
    const o3 = orient2(cx, cy, dx, dy, ax, ay);
    const o4 = orient2(cx, cy, dx, dy, bx, by);
    return o1 * o2 < -1e-16 && o3 * o4 < -1e-16;
}

function thirdOf(f: [number, number, number], p: number, q: number): number {
    if (f[0] !== p && f[0] !== q) return f[0]!;
    if (f[1] !== p && f[1] !== q) return f[1]!;
    return f[2]!;
}

function orientFace(
    points: Array<{ x: number; y: number }>,
    a: number,
    b: number,
    c: number,
): [number, number, number] {
    const A = points[a]!;
    const B = points[b]!;
    const C = points[c]!;
    if (orient2(A.x, A.y, B.x, B.y, C.x, C.y) > 0) return [a, b, c];
    return [a, c, b];
}

function facesSharingEdge(faces: Array<[number, number, number]>, p: number, q: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < faces.length; i++) {
        const f = faces[i]!;
        const hasP = f[0] === p || f[1] === p || f[2] === p;
        const hasQ = f[0] === q || f[1] === q || f[2] === q;
        if (hasP && hasQ) out.push(i);
    }
    return out;
}

function quadIsConvex(
    points: Array<{ x: number; y: number }>,
    u: number,
    p: number,
    v: number,
    q: number,
): boolean {
    const o0 = orient2(points[u]!.x, points[u]!.y, points[p]!.x, points[p]!.y, points[v]!.x, points[v]!.y);
    const o1 = orient2(points[p]!.x, points[p]!.y, points[v]!.x, points[v]!.y, points[q]!.x, points[q]!.y);
    const o2 = orient2(points[v]!.x, points[v]!.y, points[q]!.x, points[q]!.y, points[u]!.x, points[u]!.y);
    const o3 = orient2(points[q]!.x, points[q]!.y, points[u]!.x, points[u]!.y, points[p]!.x, points[p]!.y);
    return o0 > 1e-14 && o1 > 1e-14 && o2 > 1e-14 && o3 > 1e-14;
}

function flipSharedEdge(
    points: Array<{ x: number; y: number }>,
    faces: Array<[number, number, number]>,
    p: number,
    q: number,
): boolean {
    const shared = facesSharingEdge(faces, p, q);
    if (shared.length !== 2) return false;
    const f0 = faces[shared[0]!]!;
    const f1 = faces[shared[1]!]!;
    const u = thirdOf(f0, p, q);
    const v = thirdOf(f1, p, q);
    if (u === v) return false;
    if (!quadIsConvex(points, u, p, v, q)) return false;
    faces[shared[0]!] = orientFace(points, u, v, p);
    faces[shared[1]!] = orientFace(points, u, v, q);
    return true;
}

function findCrossingEdge(
    points: Array<{ x: number; y: number }>,
    faces: Array<[number, number, number]>,
    a: number,
    b: number,
): { p: number; q: number } | null {
    const A = points[a]!;
    const B = points[b]!;
    for (const f of faces) {
        const e: Array<[number, number]> = [
            [f[0]!, f[1]!],
            [f[1]!, f[2]!],
            [f[2]!, f[0]!],
        ];
        for (const [p, q] of e) {
            if (p === a || p === b || q === a || q === b) continue;
            const P = points[p]!;
            const Q = points[q]!;
            if (segIntersectProper(A.x, A.y, B.x, B.y, P.x, P.y, Q.x, Q.y)) return { p, q };
        }
    }
    return null;
}

function triHitsSegment(
    points: Array<{ x: number; y: number }>,
    f: [number, number, number],
    a: number,
    b: number,
): boolean {
    if (f[0] === a || f[1] === a || f[2] === a || f[0] === b || f[1] === b || f[2] === b) {
        const cross = findCrossingEdge(points, [f], a, b);
        return cross != null;
    }
    const A = points[a]!;
    const B = points[b]!;
    const e: Array<[number, number]> = [
        [f[0]!, f[1]!],
        [f[1]!, f[2]!],
        [f[2]!, f[0]!],
    ];
    for (const [p, q] of e) {
        const P = points[p]!;
        const Q = points[q]!;
        if (segIntersectProper(A.x, A.y, B.x, B.y, P.x, P.y, Q.x, Q.y)) return true;
    }
    return false;
}

function insertConstraintCavity(
    points: Array<{ x: number; y: number }>,
    faces: Array<[number, number, number]>,
    a: number,
    b: number,
): void {
    const hit: number[] = [];
    for (let i = 0; i < faces.length; i++) {
        if (triHitsSegment(points, faces[i]!, a, b)) hit.push(i);
    }
    if (hit.length === 0) return;
    const edgeUse = new Map<string, { p: number; q: number; n: number }>();
    const add = (p: number, q: number) => {
        const k = boundaryEdgeKey(p, q);
        const e = edgeUse.get(k);
        if (e) e.n++;
        else edgeUse.set(k, { p, q, n: 1 });
    };
    for (const i of hit) {
        const f = faces[i]!;
        add(f[0]!, f[1]!);
        add(f[1]!, f[2]!);
        add(f[2]!, f[0]!);
    }
    const adj = new Map<number, number[]>();
    const link = (p: number, q: number) => {
        const list = adj.get(p) ?? [];
        list.push(q);
        adj.set(p, list);
    };
    for (const e of edgeUse.values()) {
        if (e.n !== 1) continue;
        if (boundaryEdgeKey(e.p, e.q) === boundaryEdgeKey(a, b)) continue;
        link(e.p, e.q);
        link(e.q, e.p);
    }
    const walk = (first: number): number[] => {
        const path = [a, first];
        const seen = new Set<string>([boundaryEdgeKey(a, first)]);
        let cur = first;
        const guard = points.length + 4;
        for (let k = 0; k < guard && cur !== b; k++) {
            const nbrs = adj.get(cur) ?? [];
            let next = -1;
            for (const n of nbrs) {
                const ek = boundaryEdgeKey(cur, n);
                if (seen.has(ek)) continue;
                next = n;
                seen.add(ek);
                break;
            }
            if (next < 0) break;
            path.push(next);
            cur = next;
        }
        return path;
    };
    const starts = (adj.get(a) ?? []).slice(0, 2);
    const left = starts[0] != null ? walk(starts[0]) : [a, b];
    const right = starts[1] != null ? walk(starts[1]) : [a, b];
    const drop = new Set(hit);
    const kept = faces.filter((_, i) => !drop.has(i));
    faces.length = 0;
    for (const f of kept) faces.push(f);
    const fan = (chain: number[]) => {
        if (chain.length < 3) return;
        for (let i = 1; i < chain.length - 1; i++) {
            faces.push(orientFace(points, chain[0]!, chain[i]!, chain[i + 1]!));
        }
    };
    if (left.length >= 3 && left[left.length - 1] === b) fan(left);
    if (right.length >= 3 && right[right.length - 1] === b && right.join(",") !== left.join(",")) {
        fan(right);
    }
}

/** Insert polygon constraint edges by Sloan flips, then cavity fill if needed. */
export function insertConstraintEdges(
    points: Array<{ x: number; y: number }>,
    faces: Array<[number, number, number]>,
    edges: Array<[number, number]>,
): void {
    for (const [a, b] of edges) {
        if (a === b || a < 0 || b < 0 || a >= points.length || b >= points.length) continue;
        if (hasEdge(faces, a, b)) continue;
        const budget = Math.max(32, faces.length * 4);
        for (let n = 0; n < budget && !hasEdge(faces, a, b); n++) {
            const cross = findCrossingEdge(points, faces, a, b);
            if (!cross) break;
            if (!flipSharedEdge(points, faces, cross.p, cross.q)) break;
        }
        if (!hasEdge(faces, a, b)) insertConstraintCavity(points, faces, a, b);
    }
}

/** Interior edges used once (holes) plus edges used more than twice. */
export function countOpenNonBoundaryEdges(
    faces: Array<[number, number, number]>,
    nBoundary: number,
): { open: number; nonManifold: number; missingBoundary: number } {
    const use = new Map<string, number>();
    for (const f of faces) {
        const e: Array<[number, number]> = [
            [f[0]!, f[1]!],
            [f[1]!, f[2]!],
            [f[2]!, f[0]!],
        ];
        for (const [a, b] of e) {
            const k = boundaryEdgeKey(a, b);
            use.set(k, (use.get(k) ?? 0) + 1);
        }
    }
    let open = 0;
    let nonManifold = 0;
    let missingBoundary = 0;
    for (const [k, n] of use) {
        const [a, b] = k.split(",").map(Number) as [number, number];
        const wrap = nBoundary > 1 && ((a === 0 && b === nBoundary - 1) || (b === 0 && a === nBoundary - 1));
        const boundary = a < nBoundary && b < nBoundary && (Math.abs(a - b) === 1 || wrap);
        if (n === 1) {
            if (!boundary) open++;
        } else if (n !== 2) {
            nonManifold++;
        }
    }
    for (let i = 0; i < nBoundary; i++) {
        const k = boundaryEdgeKey(i, (i + 1) % nBoundary);
        if ((use.get(k) ?? 0) !== 1) missingBoundary++;
    }
    return { open, nonManifold, missingBoundary };
}

/**
 * Plan-view constrained Delaunay of the dish outer band. `outer` is the wall
 * bottom ring; `inner` is the ~3 mm inset. Steiner points are native dish
 * samples. Faces whose centroid is outside the band are dropped; missing
 * boundary edges are recovered by midpoint insertion.
 */
export function cdtPlanarBand(
    outer: PolyPoint[],
    inner: PolyPoint[],
    steiner: PolyPoint[],
): { points: PolyPoint[]; faces: Array<[number, number, number]> } {
    if (outer.length < 3 || inner.length < 3) return { points: [], faces: [] };
    const points = outer.map((p) => ({ ...p }));
    const outerIdx = outer.map((_, i) => i);
    const innerStart = points.length;
    for (const p of inner) points.push({ ...p });
    const innerIdx = inner.map((_, i) => innerStart + i);
    for (const p of steiner) points.push({ ...p });

    const inBand = (x: number, y: number): boolean => {
        const inOuter = pointInPoly(x, y, outer);
        const inInner = pointInPoly(x, y, inner);
        return inOuter && !inInner;
    };

    const constrain: Array<[number, number]> = [];
    for (let i = 0; i < outerIdx.length; i++) {
        constrain.push([outerIdx[i]!, outerIdx[(i + 1) % outerIdx.length]!]);
    }
    for (let i = 0; i < innerIdx.length; i++) {
        constrain.push([innerIdx[i]!, innerIdx[(i + 1) % innerIdx.length]!]);
    }

    let faces = delaunayXY(points).filter((f) => {
        const a = points[f[0]]!;
        const b = points[f[1]]!;
        const c = points[f[2]]!;
        const cx = (a.x + b.x + c.x) / 3;
        const cy = (a.y + b.y + c.y) / 3;
        return inBand(cx, cy);
    });

    const missing = constrain.filter(
        ([a, b]) => a < points.length && b < points.length && !hasEdge(faces, a, b),
    );
    if (missing.length > constrain.length * 0.15 || faces.length < 8) {
        faces = stripExactLoops(outerIdx, innerIdx);
    } else {
        for (const [a, b] of missing) {
            const tri = thirdPointForEdge(points, a, b, inBand);
            if (tri) faces.push(tri);
        }
    }
    return { points, faces };
}

function inTriXY(
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
): boolean {
    const o0 = orient2(ax, ay, bx, by, px, py);
    const o1 = orient2(bx, by, cx, cy, px, py);
    const o2 = orient2(cx, cy, ax, ay, px, py);
    return o0 >= -1e-9 && o1 >= -1e-9 && o2 >= -1e-9;
}

/**
 * Simple-polygon triangulation that keeps every boundary vertex. Near-collinear
 * verts emit a sliver instead of being dropped, so (i,i+1) always exists.
 */
export function triangulateSimplePolygon(
    poly: Array<{ x: number; y: number }>,
): Array<[number, number, number]> {
    const n = poly.length;
    if (n < 3) return [];
    const next = Int32Array.from({ length: n }, (_, i) => (i + 1) % n);
    const prev = Int32Array.from({ length: n }, (_, i) => (i - 1 + n) % n);
    const live = new Uint8Array(n).fill(1);
    const area = (i: number): number =>
        orient2(
            poly[prev[i]!]!.x,
            poly[prev[i]!]!.y,
            poly[i]!.x,
            poly[i]!.y,
            poly[next[i]!]!.x,
            poly[next[i]!]!.y,
        );
    const isEar = (i: number): boolean => {
        const o = area(i);
        if (o <= -1e-9) return false;
        const a = prev[i]!;
        const b = i;
        const c = next[i]!;
        const pa = poly[a]!;
        const pb = poly[b]!;
        const pc = poly[c]!;
        for (let k = 0; k < n; k++) {
            if (!live[k] || k === a || k === b || k === c) continue;
            const p = poly[k]!;
            if (inTriXY(p.x, p.y, pa.x, pa.y, pb.x, pb.y, pc.x, pc.y)) return false;
        }
        return true;
    };
    const clip = (i: number, faces: Array<[number, number, number]>): void => {
        const a = prev[i]!;
        const c = next[i]!;
        faces.push(orientFace(poly, a, i, c));
        next[a] = c;
        prev[c] = a;
        live[i] = 0;
    };
    const faces: Array<[number, number, number]> = [];
    let remaining = n;
    let i = 0;
    let fail = 0;
    const budget = n * n + 32;
    while (remaining > 3 && fail < budget) {
        if (!live[i]) {
            i = (i + 1) % n;
            fail++;
            continue;
        }
        if (isEar(i)) {
            clip(i, faces);
            remaining--;
            fail = 0;
            i = next[i]!;
            continue;
        }
        fail++;
        i = next[i]!;
    }
    if (remaining > 3) {
        for (let k = 0; k < n && remaining > 3; k++) {
            if (!live[k] || area(k) <= 0) continue;
            clip(k, faces);
            remaining--;
        }
    }
    if (remaining >= 3) {
        const alive: number[] = [];
        for (let k = 0; k < n; k++) if (live[k]) alive.push(k);
        if (alive.length >= 3) {
            faces.push(orientFace(poly, alive[0]!, alive[1]!, alive[2]!));
        }
    }
    return faces;
}

function insertSteinerSplit(
    points: Array<{ x: number; y: number }>,
    faces: Array<[number, number, number]>,
    p: { x: number; y: number },
): boolean {
    for (let i = 0; i < faces.length; i++) {
        const [a, b, c] = faces[i]!;
        const A = points[a]!;
        const B = points[b]!;
        const C = points[c]!;
        if (!inTriXY(p.x, p.y, A.x, A.y, B.x, B.y, C.x, C.y)) continue;
        const v = points.length;
        points.push({ x: p.x, y: p.y, z: "z" in p ? (p as PolyPoint).z : 0 });
        faces.splice(i, 1);
        faces.push(orientFace(points, a, b, v), orientFace(points, b, c, v), orientFace(points, c, a, v));
        return true;
    }
    return false;
}

/** Flip interior edges toward Delaunay. Boundary edges (0..nB-1 consecutive) stay locked. */
export function constrainedDelaunayFlip(
    points: Array<{ x: number; y: number }>,
    faces: Array<[number, number, number]>,
    nBoundary: number,
): void {
    const isBoundary = (p: number, q: number): boolean => {
        if (p >= nBoundary || q >= nBoundary) return false;
        const d = Math.abs(p - q);
        return d === 1 || d === nBoundary - 1;
    };
    const ek = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
    const build = (): Map<string, number[]> => {
        const map = new Map<string, number[]>();
        for (let i = 0; i < faces.length; i++) {
            const f = faces[i]!;
            for (const [p, q] of [
                [f[0]!, f[1]!],
                [f[1]!, f[2]!],
                [f[2]!, f[0]!],
            ] as Array<[number, number]>) {
                const k = ek(p, q);
                const list = map.get(k);
                if (list) list.push(i);
                else map.set(k, [i]);
            }
        }
        return map;
    };
    let map = build();
    for (let pass = 0; pass < 24; pass++) {
        let flipped = 0;
        const used = new Set<number>();
        const keys = [...map.keys()];
        for (const k of keys) {
            const [ps, qs] = k.split(",").map(Number) as [number, number];
            if (isBoundary(ps, qs)) continue;
            const shared = map.get(k);
            if (!shared || shared.length !== 2) continue;
            const i0 = shared[0]!;
            const i1 = shared[1]!;
            if (used.has(i0) || used.has(i1)) continue;
            const f0 = faces[i0]!;
            const f1 = faces[i1]!;
            const u = thirdOf(f0, ps, qs);
            const v = thirdOf(f1, ps, qs);
            if (u === v) continue;
            const A = points[ps]!;
            const B = points[qs]!;
            const C = points[u]!;
            const D = points[v]!;
            if (!inCircumcircle(A.x, A.y, B.x, B.y, C.x, C.y, D.x, D.y)) continue;
            if (!quadIsConvex(points, u, ps, v, qs)) continue;
            faces[i0] = orientFace(points, u, v, ps);
            faces[i1] = orientFace(points, u, v, qs);
            used.add(i0);
            used.add(i1);
            flipped++;
        }
        if (!flipped) break;
        map = build();
    }
}

/**
 * Constrained Delaunay of a simple polygon interior. `boundary` vertices stay
 * at indices 0..n-1; each boundary edge is kept once. Steiner points are extra.
 */
export function cdtInteriorPolygon(
    boundary: PolyPoint[],
    steiner: PolyPoint[],
): { points: PolyPoint[]; faces: Array<[number, number, number]> } {
    if (boundary.length < 3) return { points: [], faces: [] };
    const points: PolyPoint[] = boundary.map((p) => ({ ...p }));
    const nB = points.length;
    const faces = triangulateSimplePolygon(points);
    for (const s of steiner) insertSteinerSplit(points, faces, s);
    constrainedDelaunayFlip(points, faces, nB);
    return { points, faces };
}

function stripExactLoops(outerIdx: number[], innerIdx: number[]): Array<[number, number, number]> {
    const faces: Array<[number, number, number]> = [];
    const nA = outerIdx.length;
    const nB = innerIdx.length;
    if (nA < 2 || nB < 2) return faces;
    let i = 0;
    let j = 0;
    for (let step = 0; step < nA + nB; step++) {
        const aDone = i >= nA;
        const bDone = j >= nB;
        if (aDone && bDone) break;
        const a0 = outerIdx[i % nA]!;
        const b0 = innerIdx[j % nB]!;
        const ta = (i + 1) / nA;
        const tb = (j + 1) / nB;
        if (!aDone && (bDone || ta <= tb)) {
            faces.push([a0, outerIdx[(i + 1) % nA]!, b0]);
            i++;
        } else {
            faces.push([a0, innerIdx[(j + 1) % nB]!, b0]);
            j++;
        }
    }
    return faces;
}

function thirdPointForEdge(
    points: PolyPoint[],
    a: number,
    b: number,
    inBand: (x: number, y: number) => boolean,
): [number, number, number] | null {
    const pa = points[a]!;
    const pb = points[b]!;
    let best = -1;
    let bestD = Infinity;
    for (let k = 0; k < points.length; k++) {
        if (k === a || k === b) continue;
        const p = points[k]!;
        const cx = (pa.x + pb.x + p.x) / 3;
        const cy = (pa.y + pb.y + p.y) / 3;
        if (!inBand(cx, cy)) continue;
        const d = (p.x - (pa.x + pb.x) * 0.5) ** 2 + (p.y - (pa.y + pb.y) * 0.5) ** 2;
        if (d < bestD) {
            bestD = d;
            best = k;
        }
    }
    if (best < 0) return null;
    const pc = points[best]!;
    if (orient2(pa.x, pa.y, pb.x, pb.y, pc.x, pc.y) > 0) return [a, b, best];
    return [a, best, b];
}
