// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { triangulateD } from "clipper2-ts";
import { BufferAttribute, BufferGeometry } from "three";
import type { TextGlyphGroup, TextXy } from "./types";

function pathOf(pts: TextXy[]): Array<{ x: number; y: number }> {
    return pts.map((p) => ({ x: p.x, y: p.y }));
}

function triangulateGroup(group: TextGlyphGroup): Array<[TextXy, TextXy, TextXy]> {
    const paths = [pathOf(group.outer), ...group.holes.map(pathOf)];
    const { solution } = triangulateD(paths, 4, true);
    const tris: Array<[TextXy, TextXy, TextXy]> = [];
    for (const tri of solution) {
        if (tri.length < 3) continue;
        tris.push([
            { x: tri[0]!.x, y: tri[0]!.y },
            { x: tri[1]!.x, y: tri[1]!.y },
            { x: tri[2]!.x, y: tri[2]!.y },
        ]);
    }
    return tris;
}

export type MapTextPoint = (p: TextXy, t: number) => { x: number; y: number; z: number };

function pushTri(
    positions: number[],
    indices: number[],
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number },
    c: { x: number; y: number; z: number },
): void {
    const i = positions.length / 3;
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    indices.push(i, i + 1, i + 2);
}

function contourLoops(group: TextGlyphGroup): TextXy[][] {
    return [group.outer, ...group.holes];
}

/**
 * Closed prism / lofted shell: t=0 and t=1 surfaces plus contour walls.
 * `mapPoint` places each 2D contour vertex; t is the offset parameter (0 / 1).
 */
export function extrudeTextSolid(groups: TextGlyphGroup[], mapPoint: MapTextPoint): BufferGeometry {
    const positions: number[] = [];
    const indices: number[] = [];
    for (const group of groups) {
        const tris = triangulateGroup(group);
        for (const [a, b, c] of tris) {
            const a0 = mapPoint(a, 0);
            const b0 = mapPoint(b, 0);
            const c0 = mapPoint(c, 0);
            const a1 = mapPoint(a, 1);
            const b1 = mapPoint(b, 1);
            const c1 = mapPoint(c, 1);
            pushTri(positions, indices, a0, c0, b0);
            pushTri(positions, indices, a1, b1, c1);
        }
        for (const loop of contourLoops(group)) {
            const n = loop.length;
            for (let i = 0; i < n; i++) {
                const p = loop[i]!;
                const q = loop[(i + 1) % n]!;
                const p0 = mapPoint(p, 0);
                const q0 = mapPoint(q, 0);
                const p1 = mapPoint(p, 1);
                const q1 = mapPoint(q, 1);
                pushTri(positions, indices, p0, q0, q1);
                pushTri(positions, indices, p0, q1, p1);
            }
        }
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
}

export function planarBottomMap(z0: number, z1: number): MapTextPoint {
    return (p, t) => ({ x: p.x, y: p.y, z: z0 + (z1 - z0) * t });
}
