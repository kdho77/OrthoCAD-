// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import Constrainautor from "@kninnug/constrainautor";
import Delaunator from "delaunator";
import { countOpenNonBoundaryEdges, pointInPoly } from "./cdt-band";
import type { PolyPoint } from "./curves";

function orient2(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function turningNumber(pts: PolyPoint[], n: number): number {
    let sum = 0;
    for (let i = 0; i < n; i++) {
        const a = pts[(i + n - 1) % n]!;
        const b = pts[i]!;
        const c = pts[(i + 1) % n]!;
        const v1x = b.x - a.x;
        const v1y = b.y - a.y;
        const v2x = c.x - b.x;
        const v2y = c.y - b.y;
        sum += Math.atan2(v1x * v2y - v1y * v2x, v1x * v2x + v1y * v2y);
    }
    return sum / (Math.PI * 2);
}

function edgeKey(a: number, b: number): string {
    return a < b ? `${a},${b}` : `${b},${a}`;
}

function usesInteriorBoundaryWalk(a: number, b: number, c: number, nOuter: number, step: number): boolean {
    const walk = (p: number, q: number): boolean =>
        p < nOuter && q < nOuter && q === (p + step + nOuter) % nOuter;
    return walk(a, b) || walk(b, c) || walk(c, a);
}

/**
 * Constrained Delaunay via Delaunator + Constrainautor (robust-predicates).
 * `points[0..nOuter)` is the outer ring I. Extra constraint edges are allowed.
 * Exterior triangles are dropped. A sliver whose centroid falls outside I is
 * kept when it walks a consecutive I edge in the interior direction.
 * Boundary vertices are never split.
 */
export function libraryCdtInterior(
    points: PolyPoint[],
    nOuter: number,
    extraEdges: Array<[number, number]> = [],
): Array<[number, number, number]> {
    if (nOuter < 3 || points.length < 3) return [];
    const coords = new Float64Array(points.length * 2);
    for (let i = 0; i < points.length; i++) {
        coords[i * 2] = points[i]!.x;
        coords[i * 2 + 1] = points[i]!.y;
    }
    const del = new Delaunator(coords);
    const con = new Constrainautor(del);
    const outerEdges: Array<[number, number]> = [];
    for (let i = 0; i < nOuter; i++) outerEdges.push([i, (i + 1) % nOuter]);
    try {
        con.constrainAll(outerEdges);
    } catch (err) {
        throw new Error(`[S1-CDT] constrainautor failed on I: ${String(err)}`);
    }
    for (const e of extraEdges) {
        try {
            con.constrainAll([e]);
        } catch {
            /* skip a leftover extra edge that still crosses a constraint */
        }
    }
    const outer = points.slice(0, nOuter);
    const step = turningNumber(points, nOuter) >= 0 ? 1 : -1;
    const faces: Array<[number, number, number]> = [];
    const tri = del.triangles;
    for (let t = 0; t < tri.length; t += 3) {
        const a = tri[t]!;
        const b = tri[t + 1]!;
        const c = tri[t + 2]!;
        const A = points[a]!;
        const B = points[b]!;
        const C = points[c]!;
        const cx = (A.x + B.x + C.x) / 3;
        const cy = (A.y + B.y + C.y) / 3;
        const oriented: [number, number, number] =
            orient2(A.x, A.y, B.x, B.y, C.x, C.y) > 0 ? [a, b, c] : [a, c, b];
        const inside = pointInPoly(cx, cy, outer);
        const keepSliver = usesInteriorBoundaryWalk(oriented[0], oriented[1], oriented[2], nOuter, step);
        if (!inside && !keepSliver) continue;
        faces.push(oriented);
    }
    return faces;
}

/** Fail loudly with the station index when an I constraint edge is missing. */
export function assertIEdges(faces: Array<[number, number, number]>, nOuter: number): void {
    const have = new Set<string>();
    for (const f of faces) {
        have.add(edgeKey(f[0]!, f[1]!));
        have.add(edgeKey(f[1]!, f[2]!));
        have.add(edgeKey(f[2]!, f[0]!));
    }
    for (let i = 0; i < nOuter; i++) {
        const j = (i + 1) % nOuter;
        if (!have.has(edgeKey(i, j))) {
            throw new Error(`[S1-I] missing edge at station ${i}`);
        }
    }
}

export function assertLibraryDisk(faces: Array<[number, number, number]>, nOuter: number): void {
    assertIEdges(faces, nOuter);
    const { open, nonManifold, missingBoundary } = countOpenNonBoundaryEdges(faces, nOuter);
    if (open !== 0 || missingBoundary !== 0 || nonManifold !== 0) {
        throw new Error(
            `[S1-CDT] library disk failed: open=${open} missingBoundary=${missingBoundary} ` +
                `nonManifold=${nonManifold}`,
        );
    }
}
