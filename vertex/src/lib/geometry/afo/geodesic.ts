// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { vertexCount } from "./mesh-ops";
import type { AfoTriMesh, AfoVec3 } from "./types";

/** Undirected vertex adjacency with Euclidean edge lengths. */
export function buildVertexGraph(mesh: AfoTriMesh): { adj: number[][]; dist: number[][] } {
    const n = vertexCount(mesh);
    const adj: number[][] = Array.from({ length: n }, () => []);
    const dist: number[][] = Array.from({ length: n }, () => []);
    const seen = new Set<string>();
    const add = (a: number, b: number) => {
        if (a === b) return;
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (seen.has(key)) return;
        seen.add(key);
        const dx = (mesh.positions[a * 3] ?? 0) - (mesh.positions[b * 3] ?? 0);
        const dy = (mesh.positions[a * 3 + 1] ?? 0) - (mesh.positions[b * 3 + 1] ?? 0);
        const dz = (mesh.positions[a * 3 + 2] ?? 0) - (mesh.positions[b * 3 + 2] ?? 0);
        const d = Math.hypot(dx, dy, dz);
        adj[a]!.push(b);
        dist[a]!.push(d);
        adj[b]!.push(a);
        dist[b]!.push(d);
    };
    const t = (mesh.indices.length / 3) | 0;
    for (let i = 0; i < t; i++) {
        const a = mesh.indices[i * 3] ?? 0;
        const b = mesh.indices[i * 3 + 1] ?? 0;
        const c = mesh.indices[i * 3 + 2] ?? 0;
        add(a, b);
        add(b, c);
        add(c, a);
    }
    return { adj, dist };
}

/** Dijkstra shortest path on the mesh graph. Returns vertex indices, start→end. */
export function geodesicVertexPath(mesh: AfoTriMesh, start: number, end: number): number[] | null {
    const n = vertexCount(mesh);
    if (start < 0 || end < 0 || start >= n || end >= n) return null;
    if (start === end) return [start];
    const { adj, dist } = buildVertexGraph(mesh);
    const INF = Number.POSITIVE_INFINITY;
    const d = new Float64Array(n).fill(INF);
    const prev = new Int32Array(n).fill(-1);
    const used = new Uint8Array(n);
    d[start] = 0;
    for (let iter = 0; iter < n; iter++) {
        let u = -1;
        let best = INF;
        for (let i = 0; i < n; i++) {
            if (!used[i] && d[i]! < best) {
                best = d[i]!;
                u = i;
            }
        }
        if (u < 0 || best === INF) break;
        if (u === end) break;
        used[u] = 1;
        const nbrs = adj[u] ?? [];
        const nd = dist[u] ?? [];
        for (let k = 0; k < nbrs.length; k++) {
            const v = nbrs[k]!;
            const alt = d[u]! + (nd[k] ?? INF);
            if (alt < d[v]!) {
                d[v] = alt;
                prev[v] = u;
            }
        }
    }
    if (d[end] === INF) return null;
    const path: number[] = [];
    for (let cur = end; cur >= 0; cur = prev[cur]!) path.push(cur);
    path.reverse();
    return path;
}

export function pathToPoints(mesh: AfoTriMesh, path: number[]): AfoVec3[] {
    return path.map((i) => ({
        x: mesh.positions[i * 3] ?? 0,
        y: mesh.positions[i * 3 + 1] ?? 0,
        z: mesh.positions[i * 3 + 2] ?? 0,
    }));
}

export function geodesicPolyline(mesh: AfoTriMesh, vertices: number[], closed: boolean): AfoVec3[] {
    if (vertices.length === 0) return [];
    const pts: AfoVec3[] = [];
    const n = vertices.length;
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
        const a = vertices[i]!;
        const b = vertices[(i + 1) % n]!;
        const path = geodesicVertexPath(mesh, a, b);
        if (!path) continue;
        const start = i === 0 ? 0 : 1;
        for (let k = start; k < path.length; k++) {
            const vi = path[k]!;
            pts.push({
                x: mesh.positions[vi * 3] ?? 0,
                y: mesh.positions[vi * 3 + 1] ?? 0,
                z: mesh.positions[vi * 3 + 2] ?? 0,
            });
        }
    }
    return pts;
}
