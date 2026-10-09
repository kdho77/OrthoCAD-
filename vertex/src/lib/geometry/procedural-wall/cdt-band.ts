// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

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

export function minDistToLoopXY(x: number, y: number, loop: PolyPoint[]): number {
    let best = Infinity;
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const len2 = ex * ex + ey * ey;
        const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / len2)) : 0;
        const dx = x - (a.x + ex * t);
        const dy = y - (a.y + ey * t);
        const d = dx * dx + dy * dy;
        if (d < best) best = d;
    }
    return Math.sqrt(best);
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

/**
 * Constrained Delaunay of a simple polygon interior. `boundary` vertices stay
 * at indices 0..n-1; each boundary edge is kept once. Steiner points are extra.
 */
export function cdtInteriorPolygon(
    boundary: PolyPoint[],
    steiner: PolyPoint[],
): { points: PolyPoint[]; faces: Array<[number, number, number]> } {
    if (boundary.length < 3) return { points: [], faces: [] };
    const points = boundary.map((p) => ({ ...p }));
    const nB = points.length;
    for (const p of steiner) points.push({ ...p });
    const inside = (x: number, y: number) => pointInPoly(x, y, boundary);
    let faces = delaunayXY(points).filter((f) => {
        const a = points[f[0]]!;
        const b = points[f[1]]!;
        const c = points[f[2]]!;
        return inside((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3);
    });
    faces = uniqueBoundaryFaces(faces, nB);
    const constrain: Array<[number, number]> = [];
    for (let i = 0; i < nB; i++) constrain.push([i, (i + 1) % nB]);
    for (const [a, b] of constrain) {
        if (hasEdge(faces, a, b)) continue;
        const tri = thirdPointForEdge(points, a, b, inside);
        if (tri) faces.push(tri);
    }
    return { points, faces: uniqueBoundaryFaces(faces, nB) };
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
