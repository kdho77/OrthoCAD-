// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { MeshBounds, MeshIssue } from "./slicer-mesh";

export interface MeshTopology {
    /** Edges used by exactly one triangle after welding. */
    boundaryEdges: number;
    /** Edges used by more than two triangles after welding. */
    nonManifoldEdges: number;
    weldedVertexCount: number;
    triangleCount: number;
    /**
     * Closed boundary loops that are real openings: perimeter over
     * {@link HOLE_PERIMETER_BLOCK_MM}, or enough mid-size loops to count as many.
     * Hairline cracks and T-junctions stay out of this count.
     */
    boundaryLoops: number;
    /** Longest closed boundary loop, in millimetres. Zero when every gap is a crack. */
    longestBoundaryPerimeterMm: number;
}

/** Weld tolerance as a fraction of the AABB diagonal (Three.js mergeVertices is 1e-4 absolute). */
export const WELD_RELATIVE_TOLERANCE = 1e-4;

/**
 * Kept so callers can still name the old edge-count gate. Blocking no longer
 * uses it: a few phantom edges from a weld of ~0.03 mm is not a hole.
 */
export const OPEN_BOUNDARY_BLOCK_EDGES = 3;

/** A boundary loop longer than this is a hole Orca should not be asked to ignore. */
export const HOLE_PERIMETER_BLOCK_MM = 2;

/** Loops shorter than this are hairline cracks, even when there are many of them. */
export const SMALL_LOOP_MM = 0.5;

/** Many loops that are bigger than a hairline still block, even under 2 mm each. */
export const MANY_BOUNDARY_LOOPS = 12;

/**
 * Gaps at or under this distance are cracks, slivers, or float noise just past
 * the weld. A 5 mm hole is farther apart than this, so it stays a hole.
 */
export const CRACK_GAP_MM = 0.5;

/** A boundary vertex this close to the interior of another boundary edge is a T-junction. */
export const T_JUNCTION_MM = 0.05;

/** Triangles flatter than this are dropped before any edge is counted. */
export const DEGENERATE_TRIANGLE_AREA_MM2 = 1e-4;

export const SMALL_MESH_GAP_WARNING = "Small mesh gaps found; the slicer will repair them";

/** Camera look direction used to frame the AABB (slightly above and to the side). */
export const SLICER_VIEW_DIR: [number, number, number] = [0.62, 0.48, 0.62];

export function weldToleranceMm(bounds: MeshBounds, relative = WELD_RELATIVE_TOLERANCE): number {
    const diag = Math.hypot(bounds.size[0], bounds.size[1], bounds.size[2]);
    return Math.max(diag * relative, 1e-8);
}

function boundsFromPositions(positions: Float32Array): MeshBounds {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const y = positions[i + 1];
        const z = positions[i + 2];
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
    }
    const size: [number, number, number] = [maxX - minX, maxY - minY, maxZ - minZ];
    const sorted = [...size].sort((a, b) => b - a);
    return {
        min: [minX, minY, minZ],
        max: [maxX, maxY, maxZ],
        size,
        lengthMm: sorted[0] ?? 0,
        widthMm: sorted[1] ?? 0,
        heightMm: sorted[2] ?? 0,
    };
}

/**
 * Map each triangle-soup vertex to a welded index by position.
 * STLLoader / binary STL emit unindexed duplicates; hashing without a weld
 * treats every edge as a boundary.
 */
export function weldVertexIds(positions: Float32Array, relativeTol = WELD_RELATIVE_TOLERANCE): Int32Array {
    const vertexCount = Math.floor(positions.length / 3);
    const ids = new Int32Array(vertexCount);
    if (vertexCount === 0) return ids;
    const bounds = boundsFromPositions(positions);
    const tol = weldToleranceMm(bounds, relativeTol);
    const inv = 1 / tol;
    const tolSq = tol * tol;
    const welded: number[] = [];
    const cells = new Map<string, number[]>();
    for (let i = 0; i < vertexCount; i++) {
        const x = positions[i * 3];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];
        const cx = Math.floor(x * inv);
        const cy = Math.floor(y * inv);
        const cz = Math.floor(z * inv);
        let found = -1;
        search: for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
                for (let oz = -1; oz <= 1; oz++) {
                    const bucket = cells.get(`${cx + ox},${cy + oy},${cz + oz}`);
                    if (!bucket) continue;
                    for (const wid of bucket) {
                        const bx = welded[wid * 3] - x;
                        const by = welded[wid * 3 + 1] - y;
                        const bz = welded[wid * 3 + 2] - z;
                        if (bx * bx + by * by + bz * bz <= tolSq) {
                            found = wid;
                            break search;
                        }
                    }
                }
            }
        }
        if (found < 0) {
            found = welded.length / 3;
            welded.push(x, y, z);
            const key = `${cx},${cy},${cz}`;
            const bucket = cells.get(key);
            if (bucket) bucket.push(found);
            else cells.set(key, [found]);
        }
        ids[i] = found;
    }
    return ids;
}

type V3 = [number, number, number];

function dist3(a: V3, b: V3): number {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function pointSegDist(p: V3, a: V3, b: V3): number {
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const abz = b[2] - a[2];
    const len2 = abx * abx + aby * aby + abz * abz;
    if (len2 < 1e-16) return dist3(p, a);
    let t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby + (p[2] - a[2]) * abz) / len2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    return Math.hypot(p[0] - (a[0] + abx * t), p[1] - (a[1] + aby * t), p[2] - (a[2] + abz * t));
}

function triangleArea(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
): number {
    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;
    const cx_ = aby * acz - abz * acy;
    const cy_ = abz * acx - abx * acz;
    const cz_ = abx * acy - aby * acx;
    return 0.5 * Math.hypot(cx_, cy_, cz_);
}

interface EdgeUse {
    a: number;
    b: number;
    count: number;
}

function edgeKey(a: number, b: number): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Boundary edges that are a hairline crack or a T-junction are not a hole.
 * A crack is two edges whose gap is under {@link CRACK_GAP_MM}. A T-junction
 * is a vertex sitting on another boundary edge.
 */
function realHoleLoops(
    boundary: Array<{ a: number; b: number }>,
    pos: V3[],
): { loops: number; longest: number } {
    if (boundary.length === 0) return { loops: 0, longest: 0 };
    if (boundary.length > 4000) {
        return { loops: MANY_BOUNDARY_LOOPS, longest: HOLE_PERIMETER_BLOCK_MM + 1 };
    }
    const drop = new Uint8Array(boundary.length);
    for (let i = 0; i < boundary.length; i++) {
        const e = boundary[i];
        const a = pos[e.a];
        const b = pos[e.b];
        if (!a || !b) continue;
        for (let j = i + 1; j < boundary.length; j++) {
            const o = boundary[j];
            const c = pos[o.a];
            const d = pos[o.b];
            if (!c || !d) continue;
            const share = e.a === o.a || e.a === o.b || e.b === o.a || e.b === o.b;
            let crack = false;
            if (!share) {
                const gap = Math.max(
                    pointSegDist(a, c, d),
                    pointSegDist(b, c, d),
                    pointSegDist(c, a, b),
                    pointSegDist(d, a, b),
                );
                crack = gap <= CRACK_GAP_MM;
            } else {
                const freeA = e.a === o.a || e.a === o.b ? b : a;
                const freeB = o.a === e.a || o.a === e.b ? d : c;
                crack = dist3(freeA, freeB) <= CRACK_GAP_MM;
            }
            if (crack) {
                drop[i] = 1;
                drop[j] = 1;
            }
        }
    }
    for (let i = 0; i < boundary.length; i++) {
        if (drop[i]) continue;
        const a = pos[boundary[i].a];
        const b = pos[boundary[i].b];
        if (!a || !b) continue;
        for (const other of boundary) {
            for (const vid of [other.a, other.b]) {
                if (vid === boundary[i].a || vid === boundary[i].b) continue;
                const p = pos[vid];
                if (!p) continue;
                if (
                    pointSegDist(p, a, b) <= T_JUNCTION_MM &&
                    Math.min(dist3(p, a), dist3(p, b)) > T_JUNCTION_MM
                ) {
                    drop[i] = 1;
                }
            }
        }
    }
    const kept = boundary.filter((_, i) => drop[i] === 0);
    const adj = new Map<number, number[]>();
    const addAdj = (a: number, b: number) => {
        const list = adj.get(a);
        if (list) list.push(b);
        else adj.set(a, [b]);
    };
    for (const e of kept) {
        addAdj(e.a, e.b);
        addAdj(e.b, e.a);
    }
    const unused = new Set(kept.map((e) => edgeKey(e.a, e.b)));
    const perimeters: number[] = [];
    for (const e of kept) {
        const startKey = edgeKey(e.a, e.b);
        if (!unused.has(startKey)) continue;
        unused.delete(startKey);
        let prev = e.a;
        let cur = e.b;
        let perimeter = dist3(pos[e.a], pos[e.b]);
        let closed = false;
        for (let guard = 0; guard < kept.length + 2; guard++) {
            const nbrs = adj.get(cur) ?? [];
            let next = -1;
            for (const n of nbrs) {
                if (n === prev) continue;
                const key = edgeKey(cur, n);
                if (n === e.a || unused.has(key)) {
                    next = n;
                    break;
                }
            }
            if (next < 0) break;
            const step = dist3(pos[cur], pos[next]);
            if (next === e.a) {
                perimeter += step;
                unused.delete(edgeKey(cur, next));
                closed = true;
                break;
            }
            unused.delete(edgeKey(cur, next));
            perimeter += step;
            prev = cur;
            cur = next;
        }
        if (closed) perimeters.push(perimeter);
    }
    const longest = perimeters.reduce((max, p) => (p > max ? p : max), 0);
    const real = perimeters.filter((p) => p > HOLE_PERIMETER_BLOCK_MM).length;
    const mid = perimeters.filter((p) => p > SMALL_LOOP_MM).length;
    return {
        loops:
            real > 0 || mid >= MANY_BOUNDARY_LOOPS
                ? Math.max(real, mid >= MANY_BOUNDARY_LOOPS ? MANY_BOUNDARY_LOOPS : 0)
                : 0,
        longest,
    };
}

export function analyzeMeshTopology(
    positions: Float32Array,
    relativeTol = WELD_RELATIVE_TOLERANCE,
): MeshTopology {
    const empty: MeshTopology = {
        boundaryEdges: 0,
        nonManifoldEdges: 0,
        weldedVertexCount: 0,
        triangleCount: 0,
        boundaryLoops: 0,
        longestBoundaryPerimeterMm: 0,
    };
    if (positions.length < 9) return empty;
    const ids = weldVertexIds(positions, relativeTol);
    const edges = new Map<string, EdgeUse>();
    const used = new Set<number>();
    const weldedPos: V3[] = [];
    let triangles = 0;
    for (let t = 0; t + 2 < ids.length; t += 3) {
        const a = ids[t];
        const b = ids[t + 1];
        const c = ids[t + 2];
        const ax = positions[t * 3];
        const ay = positions[t * 3 + 1];
        const az = positions[t * 3 + 2];
        const bx = positions[t * 3 + 3];
        const by = positions[t * 3 + 4];
        const bz = positions[t * 3 + 5];
        const cx = positions[t * 3 + 6];
        const cy = positions[t * 3 + 7];
        const cz = positions[t * 3 + 8];
        if (![ax, ay, az, bx, by, bz, cx, cy, cz].every((n) => Number.isFinite(n))) continue;
        if (a === b || b === c || c === a) continue;
        if (triangleArea(ax, ay, az, bx, by, bz, cx, cy, cz) < DEGENERATE_TRIANGLE_AREA_MM2) continue;
        if (!weldedPos[a]) weldedPos[a] = [ax, ay, az];
        if (!weldedPos[b]) weldedPos[b] = [bx, by, bz];
        if (!weldedPos[c]) weldedPos[c] = [cx, cy, cz];
        triangles++;
        used.add(a);
        used.add(b);
        used.add(c);
        for (const [u, v] of [
            [a, b],
            [b, c],
            [c, a],
        ] as const) {
            const key = edgeKey(u, v);
            const prev = edges.get(key);
            if (prev) prev.count++;
            else edges.set(key, { a: u, b: v, count: 1 });
        }
    }
    let boundaryEdges = 0;
    let nonManifoldEdges = 0;
    const boundary: Array<{ a: number; b: number }> = [];
    for (const edge of edges.values()) {
        if (edge.count === 1) {
            boundaryEdges++;
            boundary.push({ a: edge.a, b: edge.b });
        } else if (edge.count > 2) nonManifoldEdges++;
    }
    const holes = realHoleLoops(boundary, weldedPos);
    return {
        boundaryEdges,
        nonManifoldEdges,
        weldedVertexCount: used.size,
        triangleCount: triangles,
        boundaryLoops: holes.loops,
        longestBoundaryPerimeterMm: holes.longest,
    };
}

export function isClosedManifold(positions: Float32Array): boolean {
    const topology = analyzeMeshTopology(positions);
    return topology.triangleCount > 0 && topology.boundaryEdges === 0;
}

export function meshHasRealHole(topology: MeshTopology): boolean {
    return (
        topology.longestBoundaryPerimeterMm > HOLE_PERIMETER_BLOCK_MM ||
        topology.boundaryLoops >= MANY_BOUNDARY_LOOPS
    );
}

export function meshOpenBoundaryIssue(topology: MeshTopology): MeshIssue | null {
    if (topology.triangleCount === 0 || meshHasRealHole(topology)) {
        return {
            message: "This file isn't a closed mesh. Re-export from OrthoCAD with Export > STL.",
            fix: "Export a watertight STL and try again.",
        };
    }
    return null;
}

export function meshTopologyWarning(topology: MeshTopology): string | null {
    if (meshHasRealHole(topology)) return null;
    if (topology.boundaryEdges > 0 || topology.nonManifoldEdges > 0) return SMALL_MESH_GAP_WARNING;
    return null;
}

function normalize3(v: [number, number, number]): [number, number, number] {
    const len = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / len, v[1] / len, v[2] / len];
}

function cross3(a: [number, number, number], b: [number, number, number]): [number, number, number] {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * Perspective distance so the model's bounding box fills the view.
 * Tighter than a bounding-sphere fit, which leaves a long thin insole tiny.
 */
export function cameraDistanceForBounds(
    bounds: MeshBounds,
    fovDeg: number,
    aspect: number,
    margin = 1.08,
): { center: [number, number, number]; distance: number; viewDir: [number, number, number] } {
    const center: [number, number, number] = [
        (bounds.min[0] + bounds.max[0]) / 2,
        (bounds.min[1] + bounds.max[1]) / 2,
        (bounds.min[2] + bounds.max[2]) / 2,
    ];
    const viewDir = normalize3(SLICER_VIEW_DIR);
    const upGuess: [number, number, number] = Math.abs(viewDir[1]) > 0.92 ? [0, 0, 1] : [0, 1, 0];
    const right = normalize3(cross3(upGuess, viewDir));
    const up = normalize3(cross3(viewDir, right));
    const corners: Array<[number, number, number]> = [
        [bounds.min[0], bounds.min[1], bounds.min[2]],
        [bounds.min[0], bounds.min[1], bounds.max[2]],
        [bounds.min[0], bounds.max[1], bounds.min[2]],
        [bounds.min[0], bounds.max[1], bounds.max[2]],
        [bounds.max[0], bounds.min[1], bounds.min[2]],
        [bounds.max[0], bounds.min[1], bounds.max[2]],
        [bounds.max[0], bounds.max[1], bounds.min[2]],
        [bounds.max[0], bounds.max[1], bounds.max[2]],
    ];
    let maxRight = 0;
    let maxUp = 0;
    for (const corner of corners) {
        const dx = corner[0] - center[0];
        const dy = corner[1] - center[1];
        const dz = corner[2] - center[2];
        maxRight = Math.max(maxRight, Math.abs(dx * right[0] + dy * right[1] + dz * right[2]));
        maxUp = Math.max(maxUp, Math.abs(dx * up[0] + dy * up[1] + dz * up[2]));
    }
    const vFov = (fovDeg * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(aspect, 0.0001));
    const distV = maxUp / Math.tan(vFov / 2);
    const distH = maxRight / Math.tan(hFov / 2);
    const span = Math.max(bounds.lengthMm, 1);
    return {
        center,
        viewDir,
        distance: Math.max(distV, distH, span * 0.2) * margin,
    };
}
