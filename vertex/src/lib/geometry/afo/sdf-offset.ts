// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { cloneMesh, computeVertexNormals, meshBBox, vertexCount } from "./mesh-ops";
import type { AfoOffsetOptions, AfoTriMesh, AfoVec3 } from "./types";

/**
 * Offset a triangle mesh by `distanceMm` millimetres.
 *
 * Distance 0 is a true identity (cloned buffers). Non-zero distances use a
 * signed-distance voxel field + marching tetrahedra. Positive = expand.
 */
export function offsetMesh(mesh: AfoTriMesh, options: AfoOffsetOptions): AfoTriMesh {
    const distance = options.distanceMm;
    options.onProgress?.(0, "offset");
    if (Math.abs(distance) < 1e-9) {
        options.onProgress?.(1, "identity");
        return cloneMesh(mesh);
    }
    const bbox = meshBBox(mesh);
    const pad = Math.abs(distance) + 2;
    const min = { x: bbox.min.x - pad, y: bbox.min.y - pad, z: bbox.min.z - pad };
    const max = { x: bbox.max.x + pad, y: bbox.max.y + pad, z: bbox.max.z + pad };
    const longest = Math.max(max.x - min.x, max.y - min.y, max.z - min.z);
    const cells = Math.max(10, Math.min(36, options.resolution ?? 24));
    const h = longest / cells;
    const nx = Math.max(8, Math.ceil((max.x - min.x) / h));
    const ny = Math.max(8, Math.ceil((max.y - min.y) / h));
    const nz = Math.max(8, Math.ceil((max.z - min.z) / h));

    const field = sampleSdfGrid(mesh, min, h, nx, ny, nz, (pct) => {
        options.onProgress?.(0.05 + pct * 0.7, "sdf");
    });
    // SDF: negative inside, positive outside. Positive offset extracts the outer iso.
    const iso = distance;
    const out = marchingTetrahedraGrid(field, min, h, nx, ny, nz, iso);
    options.onProgress?.(1, "extract");
    return out;
}

/**
 * Vertex-normal offset. Exact identity at 0. Used as a fast path for smooth
 * genus-0 bodies (sphere tests) and as a fallback if the SDF extract is empty.
 */
export function offsetMeshAlongNormals(mesh: AfoTriMesh, distanceMm: number): AfoTriMesh {
    if (Math.abs(distanceMm) < 1e-9) return cloneMesh(mesh);
    const out = cloneMesh(mesh);
    const nrm = computeVertexNormals(mesh);
    const n = vertexCount(mesh);
    for (let i = 0; i < n; i++) {
        out.positions[i * 3] = (mesh.positions[i * 3] ?? 0) + (nrm[i * 3] ?? 0) * distanceMm;
        out.positions[i * 3 + 1] = (mesh.positions[i * 3 + 1] ?? 0) + (nrm[i * 3 + 1] ?? 0) * distanceMm;
        out.positions[i * 3 + 2] = (mesh.positions[i * 3 + 2] ?? 0) + (nrm[i * 3 + 2] ?? 0) * distanceMm;
    }
    return out;
}

function sampleSdfGrid(
    mesh: AfoTriMesh,
    min: AfoVec3,
    h: number,
    nx: number,
    ny: number,
    nz: number,
    onProgress?: (pct: number) => void,
): Float32Array {
    const grid = new Float32Array((nx + 1) * (ny + 1) * (nz + 1));
    const acc = buildTriangleAccel(mesh);
    const gi = (i: number, j: number, k: number) => i + (nx + 1) * (j + (ny + 1) * k);
    for (let k = 0; k <= nz; k++) {
        const z = min.z + k * h;
        for (let j = 0; j <= ny; j++) {
            const y = min.y + j * h;
            for (let i = 0; i <= nx; i++) {
                const x = min.x + i * h;
                grid[gi(i, j, k)] = signedDistance(acc, x, y, z);
            }
        }
        onProgress?.((k + 1) / (nz + 1));
    }
    return grid;
}

interface Accel {
    mesh: AfoTriMesh;
    centroids: Float32Array;
    count: number;
}

function buildTriangleAccel(mesh: AfoTriMesh): Accel {
    const t = (mesh.indices.length / 3) | 0;
    const centroids = new Float32Array(t * 3);
    for (let i = 0; i < t; i++) {
        const ia = mesh.indices[i * 3] ?? 0;
        const ib = mesh.indices[i * 3 + 1] ?? 0;
        const ic = mesh.indices[i * 3 + 2] ?? 0;
        centroids[i * 3] =
            ((mesh.positions[ia * 3] ?? 0) + (mesh.positions[ib * 3] ?? 0) + (mesh.positions[ic * 3] ?? 0)) /
            3;
        centroids[i * 3 + 1] =
            ((mesh.positions[ia * 3 + 1] ?? 0) +
                (mesh.positions[ib * 3 + 1] ?? 0) +
                (mesh.positions[ic * 3 + 1] ?? 0)) /
            3;
        centroids[i * 3 + 2] =
            ((mesh.positions[ia * 3 + 2] ?? 0) +
                (mesh.positions[ib * 3 + 2] ?? 0) +
                (mesh.positions[ic * 3 + 2] ?? 0)) /
            3;
    }
    return { mesh, centroids, count: t };
}

function signedDistance(acc: Accel, x: number, y: number, z: number): number {
    const { mesh, centroids, count } = acc;
    let best = Infinity;
    let bestTri = 0;
    for (let t = 0; t < count; t++) {
        const dx = (centroids[t * 3] ?? 0) - x;
        const dy = (centroids[t * 3 + 1] ?? 0) - y;
        const dz = (centroids[t * 3 + 2] ?? 0) - z;
        const d0 = dx * dx + dy * dy + dz * dz;
        if (d0 < best) {
            best = d0;
            bestTri = t;
        }
    }
    // Refine against a neighbourhood of triangles (all, for small test meshes).
    let minU = Infinity;
    for (let t = 0; t < count; t++) {
        const ia = mesh.indices[t * 3] ?? 0;
        const ib = mesh.indices[t * 3 + 1] ?? 0;
        const ic = mesh.indices[t * 3 + 2] ?? 0;
        const d = pointTriangleDistanceSq(
            x,
            y,
            z,
            mesh.positions[ia * 3] ?? 0,
            mesh.positions[ia * 3 + 1] ?? 0,
            mesh.positions[ia * 3 + 2] ?? 0,
            mesh.positions[ib * 3] ?? 0,
            mesh.positions[ib * 3 + 1] ?? 0,
            mesh.positions[ib * 3 + 2] ?? 0,
            mesh.positions[ic * 3] ?? 0,
            mesh.positions[ic * 3 + 1] ?? 0,
            mesh.positions[ic * 3 + 2] ?? 0,
        );
        if (d < minU) minU = d;
    }
    const unsigned = Math.sqrt(minU);
    const inside = windingInside(mesh, x, y, z, bestTri);
    return inside ? -unsigned : unsigned;
}

function windingInside(mesh: AfoTriMesh, x: number, y: number, z: number, _hint: number): boolean {
    // Ray +X, count triangle crossings.
    let hits = 0;
    const tCount = (mesh.indices.length / 3) | 0;
    for (let t = 0; t < tCount; t++) {
        const ia = mesh.indices[t * 3] ?? 0;
        const ib = mesh.indices[t * 3 + 1] ?? 0;
        const ic = mesh.indices[t * 3 + 2] ?? 0;
        if (
            rayHitsTriangle(
                x,
                y,
                z,
                1,
                0,
                0,
                mesh.positions[ia * 3] ?? 0,
                mesh.positions[ia * 3 + 1] ?? 0,
                mesh.positions[ia * 3 + 2] ?? 0,
                mesh.positions[ib * 3] ?? 0,
                mesh.positions[ib * 3 + 1] ?? 0,
                mesh.positions[ib * 3 + 2] ?? 0,
                mesh.positions[ic * 3] ?? 0,
                mesh.positions[ic * 3 + 1] ?? 0,
                mesh.positions[ic * 3 + 2] ?? 0,
            )
        ) {
            hits++;
        }
    }
    return hits % 2 === 1;
}

function rayHitsTriangle(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
): boolean {
    const eps = 1e-8;
    const e1x = bx - ax;
    const e1y = by - ay;
    const e1z = bz - az;
    const e2x = cx - ax;
    const e2y = cy - ay;
    const e2z = cz - az;
    const px = dy * e2z - dz * e2y;
    const py = dz * e2x - dx * e2z;
    const pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < eps) return false;
    const inv = 1 / det;
    const tx = ox - ax;
    const ty = oy - ay;
    const tz = oz - az;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) return false;
    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) return false;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    return t > eps;
}

function pointTriangleDistanceSq(
    px: number,
    py: number,
    pz: number,
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
    const apx = px - ax;
    const apy = py - ay;
    const apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz;
    const d2 = acx * apx + acy * apy + acz * apz;
    if (d1 <= 0 && d2 <= 0) return apx * apx + apy * apy + apz * apz;
    const bpx = px - bx;
    const bpy = py - by;
    const bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) return bpx * bpx + bpy * bpy + bpz * bpz;
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        const dx = apx - abx * v;
        const dy = apy - aby * v;
        const dz = apz - abz * v;
        return dx * dx + dy * dy + dz * dz;
    }
    const cpx = px - cx;
    const cpy = py - cy;
    const cpz = pz - cz;
    const d5 = abx * cpx + aby * cpy + abz * cpz;
    const d6 = acx * cpx + acy * cpy + acz * cpz;
    if (d6 >= 0 && d5 <= d6) return cpx * cpx + cpy * cpy + cpz * cpz;
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
        const w = d2 / (d2 - d6);
        const dx = apx - acx * w;
        const dy = apy - acy * w;
        const dz = apz - acz * w;
        return dx * dx + dy * dy + dz * dz;
    }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
        const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
        const dx = bpx + (cx - bx) * w;
        const dy = bpy + (cy - by) * w;
        const dz = bpz + (cz - bz) * w;
        return dx * dx + dy * dy + dz * dz;
    }
    const denom = 1 / (va + vb + vc);
    const v = vb * denom;
    const w = vc * denom;
    const dx = apx - abx * v - acx * w;
    const dy = apy - aby * v - acy * w;
    const dz = apz - abz * v - acz * w;
    return dx * dx + dy * dy + dz * dz;
}

export function marchingTetrahedraGrid(
    grid: Float32Array,
    min: AfoVec3,
    h: number,
    nx: number,
    ny: number,
    nz: number,
    iso: number,
): AfoTriMesh {
    const gi = (i: number, j: number, k: number) => i + (nx + 1) * (j + (ny + 1) * k);
    const positions: number[] = [];
    const indices: number[] = [];
    const vertKey = new Map<string, number>();
    const snap = (x: number, y: number, z: number): number => {
        const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
        const existing = vertKey.get(key);
        if (existing !== undefined) return existing;
        const id = vertKey.size;
        vertKey.set(key, id);
        positions.push(x, y, z);
        return id;
    };
    const tets: [number, number, number, number][] = [
        [0, 1, 3, 7],
        [0, 1, 5, 7],
        [0, 4, 5, 7],
        [0, 2, 3, 7],
        [0, 2, 6, 7],
        [0, 4, 6, 7],
    ];
    const edges: [number, number][] = [
        [0, 1],
        [0, 2],
        [0, 3],
        [1, 2],
        [1, 3],
        [2, 3],
    ];
    const cases: number[][] = [
        [],
        [0, 1, 2],
        [0, 3, 4],
        [1, 2, 4, 1, 4, 3],
        [1, 5, 3],
        [0, 5, 2, 0, 3, 5],
        [0, 1, 5, 0, 5, 4],
        [2, 4, 5],
        [2, 5, 4],
        [0, 4, 5, 0, 5, 1],
        [0, 2, 5, 0, 5, 3],
        [1, 3, 5],
        [1, 3, 4, 1, 4, 2],
        [0, 4, 3],
        [0, 2, 1],
        [],
    ];

    for (let k = 0; k < nz; k++) {
        for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
                const corners = [
                    { x: min.x + i * h, y: min.y + j * h, z: min.z + k * h, v: grid[gi(i, j, k)] ?? 1 },
                    {
                        x: min.x + (i + 1) * h,
                        y: min.y + j * h,
                        z: min.z + k * h,
                        v: grid[gi(i + 1, j, k)] ?? 1,
                    },
                    {
                        x: min.x + i * h,
                        y: min.y + (j + 1) * h,
                        z: min.z + k * h,
                        v: grid[gi(i, j + 1, k)] ?? 1,
                    },
                    {
                        x: min.x + (i + 1) * h,
                        y: min.y + (j + 1) * h,
                        z: min.z + k * h,
                        v: grid[gi(i + 1, j + 1, k)] ?? 1,
                    },
                    {
                        x: min.x + i * h,
                        y: min.y + j * h,
                        z: min.z + (k + 1) * h,
                        v: grid[gi(i, j, k + 1)] ?? 1,
                    },
                    {
                        x: min.x + (i + 1) * h,
                        y: min.y + j * h,
                        z: min.z + (k + 1) * h,
                        v: grid[gi(i + 1, j, k + 1)] ?? 1,
                    },
                    {
                        x: min.x + i * h,
                        y: min.y + (j + 1) * h,
                        z: min.z + (k + 1) * h,
                        v: grid[gi(i, j + 1, k + 1)] ?? 1,
                    },
                    {
                        x: min.x + (i + 1) * h,
                        y: min.y + (j + 1) * h,
                        z: min.z + (k + 1) * h,
                        v: grid[gi(i + 1, j + 1, k + 1)] ?? 1,
                    },
                ];
                for (const tet of tets) {
                    const p = tet.map((t) => corners[t]!);
                    let mask = 0;
                    for (let c = 0; c < 4; c++) if ((p[c]?.v ?? 1) < iso) mask |= 1 << c;
                    const tri = cases[mask] ?? [];
                    const interp = (a: number, b: number) => {
                        const pa = p[a]!;
                        const pb = p[b]!;
                        const d = pb.v - pa.v;
                        const t = Math.abs(d) < 1e-12 ? 0.5 : (iso - pa.v) / d;
                        return snap(
                            pa.x + (pb.x - pa.x) * t,
                            pa.y + (pb.y - pa.y) * t,
                            pa.z + (pb.z - pa.z) * t,
                        );
                    };
                    for (let t = 0; t + 2 < tri.length; t += 3) {
                        const e0 = edges[tri[t] ?? 0]!;
                        const e1 = edges[tri[t + 1] ?? 0]!;
                        const e2 = edges[tri[t + 2] ?? 0]!;
                        const ia = interp(e0[0], e0[1]);
                        const ib = interp(e1[0], e1[1]);
                        const ic = interp(e2[0], e2[1]);
                        if (ia !== ib && ib !== ic && ic !== ia) indices.push(ia, ib, ic);
                    }
                }
            }
        }
    }
    return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}
