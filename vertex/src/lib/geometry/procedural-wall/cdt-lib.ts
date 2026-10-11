// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import Constrainautor from "@kninnug/constrainautor";
import Delaunator from "delaunator";
import { countOpenNonBoundaryEdges, pointInPoly } from "./cdt-band";
import type { PolyPoint } from "./curves";

function orient2(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function edgeKey(a: number, b: number): string {
    return a < b ? `${a},${b}` : `${b},${a}`;
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
    const iEdges = new Set<string>();
    for (let i = 0; i < nOuter; i++) iEdges.add(edgeKey(i, (i + 1) % nOuter));
    const all: Array<[number, number, number]> = [];
    const edgeFaces = new Map<string, number[]>();
    const tri = del.triangles;
    for (let t = 0; t < tri.length; t += 3) {
        const a = tri[t]!;
        const b = tri[t + 1]!;
        const c = tri[t + 2]!;
        const A = points[a]!;
        const B = points[b]!;
        const C = points[c]!;
        const oriented: [number, number, number] =
            orient2(A.x, A.y, B.x, B.y, C.x, C.y) > 0 ? [a, b, c] : [a, c, b];
        const fi = all.length;
        all.push(oriented);
        for (const [p, q] of [
            [oriented[0], oriented[1]],
            [oriented[1], oriented[2]],
            [oriented[2], oriented[0]],
        ] as const) {
            const k = edgeKey(p, q);
            let list = edgeFaces.get(k);
            if (!list) {
                list = [];
                edgeFaces.set(k, list);
            }
            list.push(fi);
        }
    }
    let seed = -1;
    for (let i = 0; i < all.length; i++) {
        const f = all[i]!;
        const A = points[f[0]!]!;
        const B = points[f[1]!]!;
        const C = points[f[2]!]!;
        if (pointInPoly((A.x + B.x + C.x) / 3, (A.y + B.y + C.y) / 3, outer)) {
            seed = i;
            break;
        }
    }
    if (seed < 0) return [];
    const seen = new Set<number>([seed]);
    const stack = [seed];
    while (stack.length) {
        const fi = stack.pop()!;
        const f = all[fi]!;
        for (const [p, q] of [
            [f[0]!, f[1]!],
            [f[1]!, f[2]!],
            [f[2]!, f[0]!],
        ] as const) {
            const k = edgeKey(p, q);
            if (iEdges.has(k)) continue;
            for (const n of edgeFaces.get(k) ?? []) {
                if (seen.has(n)) continue;
                seen.add(n);
                stack.push(n);
            }
        }
    }
    return [...seen].map((i) => all[i]!);
}

function faceEdgeSet(faces: Array<[number, number, number]>): Set<string> {
    const have = new Set<string>();
    for (const f of faces) {
        have.add(edgeKey(f[0]!, f[1]!));
        have.add(edgeKey(f[1]!, f[2]!));
        have.add(edgeKey(f[2]!, f[0]!));
    }
    return have;
}

/** Fail loudly with the station index when an I constraint edge is missing. */
export function assertIEdges(
    faces: Array<[number, number, number]>,
    nOuter: number,
    skip?: ReadonlySet<number>,
): void {
    const have = faceEdgeSet(faces);
    for (let i = 0; i < nOuter; i++) {
        if (skip?.has(i)) continue;
        const j = (i + 1) % nOuter;
        if (!have.has(edgeKey(i, j))) {
            throw new Error(`[S1-I] missing edge at station ${i}`);
        }
    }
}

export function assertRemainingIEdges(
    faces: Array<[number, number, number]>,
    nOuter: number,
    parent: number[],
): void {
    const find = (i: number): number => {
        let x = i;
        while (parent[x] !== x) x = parent[x]!;
        return x;
    };
    const have = faceEdgeSet(faces);
    for (let i = 0; i < nOuter; i++) {
        const a = find(i);
        const b = find((i + 1) % nOuter);
        if (a === b) continue;
        if (!have.has(edgeKey(a, b))) {
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
