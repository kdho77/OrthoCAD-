// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import Constrainautor from "@kninnug/constrainautor";
import Delaunator from "delaunator";
import { countOpenNonBoundaryEdges, pointInPoly } from "./cdt-band";
import type { PolyPoint } from "./curves";

function orient2(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/**
 * Constrained Delaunay via Delaunator + Constrainautor (robust-predicates).
 * `points[0..nOuter)` is the outer ring. Extra constraint edges are allowed.
 * Exterior triangles are dropped. Boundary vertices are never split.
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
        throw new Error(`[S1-CDT] constrainautor failed on outline: ${String(err)}`);
    }
    for (const e of extraEdges) {
        try {
            con.constrainAll([e]);
        } catch {
            /* skip a band edge that still crosses a constraint */
        }
    }
    const outer = points.slice(0, nOuter);
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
        if (!pointInPoly(cx, cy, outer)) continue;
        if (orient2(A.x, A.y, B.x, B.y, C.x, C.y) > 0) faces.push([a, b, c]);
        else faces.push([a, c, b]);
    }
    return faces;
}

export function assertLibraryDisk(faces: Array<[number, number, number]>, nOuter: number): void {
    const { open, nonManifold, missingBoundary } = countOpenNonBoundaryEdges(faces, nOuter);
    if (open !== 0 || missingBoundary !== 0 || nonManifold !== 0) {
        throw new Error(
            `[S1-CDT] library disk failed: open=${open} missingBoundary=${missingBoundary} ` +
                `nonManifold=${nonManifold}`,
        );
    }
}
