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
}

/** Weld tolerance as a fraction of the AABB diagonal (Three.js mergeVertices is 1e-4 absolute). */
export const WELD_RELATIVE_TOLERANCE = 1e-4;

/** A loop of three or more boundary edges is treated as a real hole. */
export const OPEN_BOUNDARY_BLOCK_EDGES = 3;

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
export function weldVertexIds(
    positions: Float32Array,
    relativeTol = WELD_RELATIVE_TOLERANCE,
): Int32Array {
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

function bumpEdge(edges: Map<string, number>, a: number, b: number): void {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    edges.set(key, (edges.get(key) ?? 0) + 1);
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
    };
    if (positions.length < 9) return empty;
    const ids = weldVertexIds(positions, relativeTol);
    const edges = new Map<string, number>();
    const used = new Set<number>();
    let triangles = 0;
    for (let t = 0; t + 2 < ids.length; t += 3) {
        const a = ids[t];
        const b = ids[t + 1];
        const c = ids[t + 2];
        if (a === b || b === c || c === a) continue;
        triangles++;
        used.add(a);
        used.add(b);
        used.add(c);
        bumpEdge(edges, a, b);
        bumpEdge(edges, b, c);
        bumpEdge(edges, c, a);
    }
    let boundaryEdges = 0;
    let nonManifoldEdges = 0;
    for (const count of edges.values()) {
        if (count === 1) boundaryEdges++;
        else if (count > 2) nonManifoldEdges++;
    }
    return {
        boundaryEdges,
        nonManifoldEdges,
        weldedVertexCount: used.size,
        triangleCount: triangles,
    };
}

export function isClosedManifold(positions: Float32Array): boolean {
    const topology = analyzeMeshTopology(positions);
    return topology.triangleCount > 0 && topology.boundaryEdges === 0;
}

export function meshOpenBoundaryIssue(topology: MeshTopology): MeshIssue | null {
    if (topology.triangleCount === 0) {
        return {
            message: "This file isn't a closed mesh. Re-export from OrthoCAD with Export > STL.",
            fix: "Export a watertight STL and try again.",
        };
    }
    if (topology.boundaryEdges >= OPEN_BOUNDARY_BLOCK_EDGES) {
        return {
            message: "This file isn't a closed mesh. Re-export from OrthoCAD with Export > STL.",
            fix: "Export a watertight STL and try again.",
        };
    }
    return null;
}

export function meshTopologyWarning(topology: MeshTopology): string | null {
    if (topology.boundaryEdges > 0 && topology.boundaryEdges < OPEN_BOUNDARY_BLOCK_EDGES) {
        return "This mesh has a few unmatched edges. The slicer will confirm if it can print.";
    }
    if (topology.nonManifoldEdges > 0) {
        return "This mesh has non-manifold edges. The slicer will confirm if it can print.";
    }
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
