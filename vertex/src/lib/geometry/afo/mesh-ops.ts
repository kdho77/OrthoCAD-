// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { BufferAttribute, BufferGeometry } from "three";
import { analyzeManifoldBuffers } from "@/lib/geometry/manifold-core";
import type { AfoTriMesh, AfoVec3 } from "./types";

export function cloneMesh(mesh: AfoTriMesh): AfoTriMesh {
    return {
        positions: new Float32Array(mesh.positions),
        indices: new Uint32Array(mesh.indices),
    };
}

/**
 * Merge corners that occupy the same position.
 * An imported OBJ component is a triangle soup: each face owns private
 * vertices, even when those coordinates are copies of one scan vertex.
 * Smoothing that soup treats every face as its own island and pulls it
 * toward its centroid, which is the sparse dot cast.
 * An already-indexed mesh with unique positions is returned unchanged.
 */
export function weldCoincidentVertices(mesh: AfoTriMesh): AfoTriMesh {
    const n = vertexCount(mesh);
    const first = new Map<string, number>();
    const remap = new Uint32Array(n);
    let shared = false;
    for (let i = 0; i < n; i++) {
        const x = mesh.positions[i * 3] ?? 0;
        const y = mesh.positions[i * 3 + 1] ?? 0;
        const z = mesh.positions[i * 3 + 2] ?? 0;
        const key = `${x},${y},${z}`;
        const prior = first.get(key);
        if (prior == null) {
            first.set(key, i);
            remap[i] = i;
        } else {
            remap[i] = prior;
            shared = true;
        }
    }
    if (!shared) return mesh;
    const compact = new Int32Array(n).fill(-1);
    const positions: number[] = [];
    const mapTo = (oldIndex: number): number => {
        const kept = remap[oldIndex] ?? oldIndex;
        const existing = compact[kept] ?? -1;
        if (existing >= 0) return existing;
        const id = positions.length / 3;
        compact[kept] = id;
        positions.push(
            mesh.positions[kept * 3] ?? 0,
            mesh.positions[kept * 3 + 1] ?? 0,
            mesh.positions[kept * 3 + 2] ?? 0,
        );
        return id;
    };
    const indices: number[] = [];
    const tris = (mesh.indices.length / 3) | 0;
    for (let t = 0; t < tris; t++) {
        const a = mapTo(mesh.indices[t * 3] ?? 0);
        const b = mapTo(mesh.indices[t * 3 + 1] ?? 0);
        const c = mapTo(mesh.indices[t * 3 + 2] ?? 0);
        if (a === b || b === c || c === a) continue;
        indices.push(a, b, c);
    }
    return {
        positions: new Float32Array(positions),
        indices: new Uint32Array(indices),
    };
}

export function vertexCount(mesh: AfoTriMesh): number {
    return (mesh.positions.length / 3) | 0;
}

export function triangleCount(mesh: AfoTriMesh): number {
    return (mesh.indices.length / 3) | 0;
}

export function getVertex(mesh: AfoTriMesh, i: number, out: AfoVec3): AfoVec3 {
    const o = i * 3;
    out.x = mesh.positions[o] ?? 0;
    out.y = mesh.positions[o + 1] ?? 0;
    out.z = mesh.positions[o + 2] ?? 0;
    return out;
}

export function setVertex(mesh: AfoTriMesh, i: number, p: AfoVec3): void {
    const o = i * 3;
    mesh.positions[o] = p.x;
    mesh.positions[o + 1] = p.y;
    mesh.positions[o + 2] = p.z;
}

export function meshCentroid(mesh: AfoTriMesh): AfoVec3 {
    const n = vertexCount(mesh);
    const c = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < n; i++) {
        const o = i * 3;
        c.x += mesh.positions[o] ?? 0;
        c.y += mesh.positions[o + 1] ?? 0;
        c.z += mesh.positions[o + 2] ?? 0;
    }
    if (n > 0) {
        c.x /= n;
        c.y /= n;
        c.z /= n;
    }
    return c;
}

export function meshBBox(mesh: AfoTriMesh): {
    min: AfoVec3;
    max: AfoVec3;
    size: AfoVec3;
} {
    const n = vertexCount(mesh);
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (let i = 0; i < n; i++) {
        const o = i * 3;
        const x = mesh.positions[o] ?? 0;
        const y = mesh.positions[o + 1] ?? 0;
        const z = mesh.positions[o + 2] ?? 0;
        if (x < min.x) min.x = x;
        if (y < min.y) min.y = y;
        if (z < min.z) min.z = z;
        if (x > max.x) max.x = x;
        if (y > max.y) max.y = y;
        if (z > max.z) max.z = z;
    }
    return {
        min,
        max,
        size: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z },
    };
}

export function meanRadiusFrom(mesh: AfoTriMesh, center: AfoVec3): number {
    const n = vertexCount(mesh);
    if (n === 0) return 0;
    let s = 0;
    for (let i = 0; i < n; i++) {
        const o = i * 3;
        const dx = (mesh.positions[o] ?? 0) - center.x;
        const dy = (mesh.positions[o + 1] ?? 0) - center.y;
        const dz = (mesh.positions[o + 2] ?? 0) - center.z;
        s += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    return s / n;
}

export function computeVertexNormals(mesh: AfoTriMesh): Float32Array {
    const n = vertexCount(mesh);
    const normals = new Float32Array(n * 3);
    const tri = triangleCount(mesh);
    for (let t = 0; t < tri; t++) {
        const ia = mesh.indices[t * 3] ?? 0;
        const ib = mesh.indices[t * 3 + 1] ?? 0;
        const ic = mesh.indices[t * 3 + 2] ?? 0;
        const ax = mesh.positions[ia * 3] ?? 0;
        const ay = mesh.positions[ia * 3 + 1] ?? 0;
        const az = mesh.positions[ia * 3 + 2] ?? 0;
        const bx = mesh.positions[ib * 3] ?? 0;
        const by = mesh.positions[ib * 3 + 1] ?? 0;
        const bz = mesh.positions[ib * 3 + 2] ?? 0;
        const cx = mesh.positions[ic * 3] ?? 0;
        const cy = mesh.positions[ic * 3 + 1] ?? 0;
        const cz = mesh.positions[ic * 3 + 2] ?? 0;
        const ux = bx - ax;
        const uy = by - ay;
        const uz = bz - az;
        const vx = cx - ax;
        const vy = cy - ay;
        const vz = cz - az;
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        for (const i of [ia, ib, ic]) {
            normals[i * 3] = (normals[i * 3] ?? 0) + nx;
            normals[i * 3 + 1] = (normals[i * 3 + 1] ?? 0) + ny;
            normals[i * 3 + 2] = (normals[i * 3 + 2] ?? 0) + nz;
        }
    }
    for (let i = 0; i < n; i++) {
        const ox = normals[i * 3] ?? 0;
        const oy = normals[i * 3 + 1] ?? 0;
        const oz = normals[i * 3 + 2] ?? 0;
        const len = Math.hypot(ox, oy, oz) || 1;
        normals[i * 3] = ox / len;
        normals[i * 3 + 1] = oy / len;
        normals[i * 3 + 2] = oz / len;
    }
    return normals;
}

export function afoMeshToGeometry(mesh: AfoTriMesh): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(mesh.positions), 3));
    g.setIndex(new BufferAttribute(new Uint32Array(mesh.indices), 1));
    g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
}

export function geometryToAfoMesh(geometry: BufferGeometry): AfoTriMesh {
    const pos = geometry.getAttribute("position");
    if (!pos) throw new Error("Geometry has no position attribute");
    const positions = new Float32Array(pos.array as ArrayLike<number>);
    const index = geometry.getIndex();
    let indices: Uint32Array;
    if (index) {
        indices = new Uint32Array(index.array as ArrayLike<number>);
    } else {
        const n = (positions.length / 3) | 0;
        indices = new Uint32Array(n);
        for (let i = 0; i < n; i++) indices[i] = i;
    }
    return { positions, indices };
}

export function meshIsWatertight(mesh: AfoTriMesh): boolean {
    const report = analyzeManifoldBuffers(mesh.positions, mesh.indices);
    return report.isWatertight;
}

export function positionsEqual(a: Float32Array, b: Float32Array, eps = 1e-9): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > eps) return false;
    }
    return true;
}

export interface MeshHit {
    point: AfoVec3;
    errorMm: number;
    normal: AfoVec3;
}

export interface MeshProjector {
    /** BVH closest point on the triangle mesh. */
    closest(p: AfoVec3): MeshHit;
    /**
     * Closest point, replaced by a normal-ray hit within ±rayMm when that hit
     * stays nearer the previous sample (stops the query jumping across a thin wall).
     */
    project(p: AfoVec3, prev: AfoVec3 | null, spacingMm: number, rayMm?: number): MeshHit;
}

interface ProjTri {
    ax: number;
    ay: number;
    az: number;
    bx: number;
    by: number;
    bz: number;
    cx: number;
    cy: number;
    cz: number;
    nx: number;
    ny: number;
    nz: number;
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
}

interface BNode {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
    left: number;
    right: number;
    start: number;
    count: number;
}

const projectorCache = new WeakMap<object, MeshProjector>();

export function meshProjector(mesh: AfoTriMesh): MeshProjector {
    const cached = projectorCache.get(mesh);
    if (cached) return cached;
    const built = buildMeshProjector(mesh);
    projectorCache.set(mesh, built);
    return built;
}

function buildMeshProjector(mesh: AfoTriMesh): MeshProjector {
    const tcount = triangleCount(mesh);
    const tris: ProjTri[] = [];
    const center = meshCentroid(mesh);
    for (let t = 0; t < tcount; t++) {
        const ia = mesh.indices[t * 3] ?? 0;
        const ib = mesh.indices[t * 3 + 1] ?? 0;
        const ic = mesh.indices[t * 3 + 2] ?? 0;
        const a = vertAt(mesh, ia);
        const b = vertAt(mesh, ib);
        const c = vertAt(mesh, ic);
        const ux = b.x - a.x;
        const uy = b.y - a.y;
        const uz = b.z - a.z;
        const vx = c.x - a.x;
        const vy = c.y - a.y;
        const vz = c.z - a.z;
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const nl = Math.hypot(nx, ny, nz);
        if (nl < 1e-12) continue;
        nx /= nl;
        ny /= nl;
        nz /= nl;
        const mx = (a.x + b.x + c.x) / 3;
        const my = (a.y + b.y + c.y) / 3;
        const mz = (a.z + b.z + c.z) / 3;
        if (nx * (mx - center.x) + ny * (my - center.y) + nz * (mz - center.z) < 0) {
            nx = -nx;
            ny = -ny;
            nz = -nz;
        }
        tris.push({
            ax: a.x,
            ay: a.y,
            az: a.z,
            bx: b.x,
            by: b.y,
            bz: b.z,
            cx: c.x,
            cy: c.y,
            cz: c.z,
            nx,
            ny,
            nz,
            minX: Math.min(a.x, b.x, c.x),
            minY: Math.min(a.y, b.y, c.y),
            minZ: Math.min(a.z, b.z, c.z),
            maxX: Math.max(a.x, b.x, c.x),
            maxY: Math.max(a.y, b.y, c.y),
            maxZ: Math.max(a.z, b.z, c.z),
        });
    }
    const order = tris.map((_, i) => i);
    const nodes: BNode[] = [];
    const build = (start: number, count: number): number => {
        let minX = Infinity;
        let minY = Infinity;
        let minZ = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        let maxZ = -Infinity;
        for (let i = 0; i < count; i++) {
            const tri = tris[order[start + i]!]!;
            if (tri.minX < minX) minX = tri.minX;
            if (tri.minY < minY) minY = tri.minY;
            if (tri.minZ < minZ) minZ = tri.minZ;
            if (tri.maxX > maxX) maxX = tri.maxX;
            if (tri.maxY > maxY) maxY = tri.maxY;
            if (tri.maxZ > maxZ) maxZ = tri.maxZ;
        }
        const idx = nodes.length;
        nodes.push({ minX, minY, minZ, maxX, maxY, maxZ, left: -1, right: -1, start, count });
        if (count <= 8) return idx;
        const ex = maxX - minX;
        const ey = maxY - minY;
        const ez = maxZ - minZ;
        const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
        const slice = order.slice(start, start + count);
        slice.sort((ia, ib) => triMid(tris[ia]!, axis) - triMid(tris[ib]!, axis));
        for (let i = 0; i < count; i++) order[start + i] = slice[i]!;
        const mid = count >> 1;
        const left = build(start, mid);
        const right = build(start + mid, count - mid);
        nodes[idx]!.left = left;
        nodes[idx]!.right = right;
        return idx;
    };
    if (order.length > 0) build(0, order.length);

    const closest = (p: AfoVec3): MeshHit => {
        if (nodes.length === 0) return { point: p, errorMm: Infinity, normal: { x: 0, y: 0, z: 1 } };
        let bestD = Infinity;
        let best = p;
        let bestN = { x: 0, y: 0, z: 1 };
        const stack = [0];
        while (stack.length) {
            const node = nodes[stack.pop()!]!;
            if (boxDistSq(node, p) >= bestD) continue;
            if (node.left < 0) {
                for (let i = 0; i < node.count; i++) {
                    const tri = tris[order[node.start + i]!]!;
                    const q = closestOnTri(p, tri);
                    const dx = p.x - q.x;
                    const dy = p.y - q.y;
                    const dz = p.z - q.z;
                    const d = dx * dx + dy * dy + dz * dz;
                    if (d < bestD) {
                        bestD = d;
                        best = q;
                        bestN = { x: tri.nx, y: tri.ny, z: tri.nz };
                    }
                }
            } else {
                const dl = boxDistSq(nodes[node.left]!, p);
                const dr = boxDistSq(nodes[node.right]!, p);
                if (dl < dr) {
                    stack.push(node.right, node.left);
                } else {
                    stack.push(node.left, node.right);
                }
            }
        }
        return { point: best, errorMm: Math.sqrt(bestD), normal: bestN };
    };

    const project = (p: AfoVec3, prev: AfoVec3 | null, spacingMm: number, rayMm = 5): MeshHit => {
        const near = closest(p);
        const ray = rayOnNormal(p, near.normal, rayMm, tris, order, nodes);
        if (!ray || ray.errorMm > rayMm) return near;
        if (!prev) return ray.errorMm <= near.errorMm ? ray : near;
        if (dist3(near.point, prev) > dist3(ray.point, prev) + spacingMm * 0.25) return ray;
        return near;
    };

    return { closest, project };
}

function vertAt(mesh: AfoTriMesh, i: number): AfoVec3 {
    return {
        x: mesh.positions[i * 3] ?? 0,
        y: mesh.positions[i * 3 + 1] ?? 0,
        z: mesh.positions[i * 3 + 2] ?? 0,
    };
}

function triMid(tri: ProjTri, axis: number): number {
    if (axis === 0) return (tri.minX + tri.maxX) * 0.5;
    if (axis === 1) return (tri.minY + tri.maxY) * 0.5;
    return (tri.minZ + tri.maxZ) * 0.5;
}

function boxDistSq(node: BNode, p: AfoVec3): number {
    const dx = p.x < node.minX ? node.minX - p.x : p.x > node.maxX ? p.x - node.maxX : 0;
    const dy = p.y < node.minY ? node.minY - p.y : p.y > node.maxY ? p.y - node.maxY : 0;
    const dz = p.z < node.minZ ? node.minZ - p.z : p.z > node.maxZ ? p.z - node.maxZ : 0;
    return dx * dx + dy * dy + dz * dz;
}

function dist3(a: AfoVec3, b: AfoVec3): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function closestOnTri(p: AfoVec3, t: ProjTri): AfoVec3 {
    const abx = t.bx - t.ax;
    const aby = t.by - t.ay;
    const abz = t.bz - t.az;
    const acx = t.cx - t.ax;
    const acy = t.cy - t.ay;
    const acz = t.cz - t.az;
    const apx = p.x - t.ax;
    const apy = p.y - t.ay;
    const apz = p.z - t.az;
    const d1 = abx * apx + aby * apy + abz * apz;
    const d2 = acx * apx + acy * apy + acz * apz;
    if (d1 <= 0 && d2 <= 0) return { x: t.ax, y: t.ay, z: t.az };
    const bpx = p.x - t.bx;
    const bpy = p.y - t.by;
    const bpz = p.z - t.bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) return { x: t.bx, y: t.by, z: t.bz };
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3 || 1);
        return { x: t.ax + abx * v, y: t.ay + aby * v, z: t.az + abz * v };
    }
    const cpx = p.x - t.cx;
    const cpy = p.y - t.cy;
    const cpz = p.z - t.cz;
    const d5 = abx * cpx + aby * cpy + abz * cpz;
    const d6 = acx * cpx + acy * cpy + acz * cpz;
    if (d6 >= 0 && d5 <= d6) return { x: t.cx, y: t.cy, z: t.cz };
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
        const w = d2 / (d2 - d6 || 1);
        return { x: t.ax + acx * w, y: t.ay + acy * w, z: t.az + acz * w };
    }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
        const w = (d4 - d3) / (d4 - d3 + (d5 - d6) || 1);
        return {
            x: t.bx + (t.cx - t.bx) * w,
            y: t.by + (t.cy - t.by) * w,
            z: t.bz + (t.cz - t.bz) * w,
        };
    }
    const denom = 1 / (va + vb + vc || 1);
    const v = vb * denom;
    const w = vc * denom;
    return { x: t.ax + abx * v + acx * w, y: t.ay + aby * v + acy * w, z: t.az + abz * v + acz * w };
}

function rayOnNormal(
    p: AfoVec3,
    normal: AfoVec3,
    rayMm: number,
    tris: ProjTri[],
    order: number[],
    nodes: BNode[],
): MeshHit | null {
    const origin = {
        x: p.x - normal.x * rayMm,
        y: p.y - normal.y * rayMm,
        z: p.z - normal.z * rayMm,
    };
    const dir = { x: normal.x, y: normal.y, z: normal.z };
    const span = rayMm * 2;
    if (nodes.length === 0 || span < 1e-6) return null;
    let bestT = Infinity;
    let best: MeshHit | null = null;
    const stack = [0];
    while (stack.length) {
        const node = nodes[stack.pop()!]!;
        if (!rayBox(origin, dir, span, node)) continue;
        if (node.left < 0) {
            for (let i = 0; i < node.count; i++) {
                const tri = tris[order[node.start + i]!]!;
                const hit = rayTri(origin, dir, span, tri);
                if (hit == null || hit >= bestT) continue;
                bestT = hit;
                const q = {
                    x: origin.x + dir.x * hit,
                    y: origin.y + dir.y * hit,
                    z: origin.z + dir.z * hit,
                };
                best = {
                    point: q,
                    errorMm: Math.abs(hit - rayMm),
                    normal: { x: tri.nx, y: tri.ny, z: tri.nz },
                };
            }
        } else {
            stack.push(node.left, node.right);
        }
    }
    return best;
}

function rayBox(origin: AfoVec3, dir: AfoVec3, span: number, node: BNode): boolean {
    let tMin = 0;
    let tMax = span;
    const mins = [node.minX, node.minY, node.minZ];
    const maxs = [node.maxX, node.maxY, node.maxZ];
    const o = [origin.x, origin.y, origin.z];
    const d = [dir.x, dir.y, dir.z];
    for (let a = 0; a < 3; a++) {
        const da = d[a] ?? 0;
        const oa = o[a] ?? 0;
        if (Math.abs(da) < 1e-12) {
            if (oa < (mins[a] ?? 0) || oa > (maxs[a] ?? 0)) return false;
            continue;
        }
        let t1 = ((mins[a] ?? 0) - oa) / da;
        let t2 = ((maxs[a] ?? 0) - oa) / da;
        if (t1 > t2) {
            const s = t1;
            t1 = t2;
            t2 = s;
        }
        if (t1 > tMin) tMin = t1;
        if (t2 < tMax) tMax = t2;
        if (tMin > tMax) return false;
    }
    return true;
}

function rayTri(origin: AfoVec3, dir: AfoVec3, span: number, t: ProjTri): number | null {
    const eps = 1e-8;
    const abx = t.bx - t.ax;
    const aby = t.by - t.ay;
    const abz = t.bz - t.az;
    const acx = t.cx - t.ax;
    const acy = t.cy - t.ay;
    const acz = t.cz - t.az;
    const px = dir.y * acz - dir.z * acy;
    const py = dir.z * acx - dir.x * acz;
    const pz = dir.x * acy - dir.y * acx;
    const det = abx * px + aby * py + abz * pz;
    if (det > -eps && det < eps) return null;
    const inv = 1 / det;
    const tx = origin.x - t.ax;
    const ty = origin.y - t.ay;
    const tz = origin.z - t.az;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) return null;
    const qx = ty * abz - tz * aby;
    const qy = tz * abx - tx * abz;
    const qz = tx * aby - ty * abx;
    const v = (dir.x * qx + dir.y * qy + dir.z * qz) * inv;
    if (v < 0 || u + v > 1) return null;
    const hit = (acx * qx + acy * qy + acz * qz) * inv;
    if (hit < 0 || hit > span) return null;
    return hit;
}

/** Directed edges used by more than one triangle. A consistent shell has none. */
export function duplicateDirectedEdgeCount(mesh: AfoTriMesh): number {
    const seen = new Map<string, number>();
    const t = triangleCount(mesh);
    let dup = 0;
    for (let i = 0; i < t; i++) {
        const a = mesh.indices[i * 3] ?? 0;
        const b = mesh.indices[i * 3 + 1] ?? 0;
        const c = mesh.indices[i * 3 + 2] ?? 0;
        if (a === b || b === c || c === a) continue;
        for (const key of [`${a}>${b}`, `${b}>${c}`, `${c}>${a}`]) {
            const n = (seen.get(key) ?? 0) + 1;
            seen.set(key, n);
            if (n === 2) dup++;
        }
    }
    return dup;
}

/** Positive when triangle normals point out of a closed solid. */
export function meshSignedVolume(mesh: AfoTriMesh): number {
    let v = 0;
    const t = triangleCount(mesh);
    for (let i = 0; i < t; i++) {
        const ai = mesh.indices[i * 3] ?? 0;
        const bi = mesh.indices[i * 3 + 1] ?? 0;
        const ci = mesh.indices[i * 3 + 2] ?? 0;
        const ax = mesh.positions[ai * 3] ?? 0;
        const ay = mesh.positions[ai * 3 + 1] ?? 0;
        const az = mesh.positions[ai * 3 + 2] ?? 0;
        const bx = mesh.positions[bi * 3] ?? 0;
        const by = mesh.positions[bi * 3 + 1] ?? 0;
        const bz = mesh.positions[bi * 3 + 2] ?? 0;
        const cx = mesh.positions[ci * 3] ?? 0;
        const cy = mesh.positions[ci * 3 + 1] ?? 0;
        const cz = mesh.positions[ci * 3 + 2] ?? 0;
        v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    }
    return v / 6;
}

/**
 * Make every directed edge unique and turn the solid outward.
 * Marching-tet fixtures can traverse the same directed edge twice; clicks
 * then hit the back wall. Neighbor faces are walked so a shared edge is
 * opposite in the two triangles, then the whole body is flipped if the
 * signed volume is negative.
 */
export function orientMeshOutward(mesh: AfoTriMesh): AfoTriMesh {
    const indices = new Uint32Array(mesh.indices);
    const t = (indices.length / 3) | 0;
    if (t === 0) return cloneMesh(mesh);
    const undirected = new Map<string, number[]>();
    const addEdge = (a: number, b: number, f: number) => {
        const k = a < b ? `${a}|${b}` : `${b}|${a}`;
        const list = undirected.get(k);
        if (list) list.push(f);
        else undirected.set(k, [f]);
    };
    for (let i = 0; i < t; i++) {
        const a = indices[i * 3] ?? 0;
        const b = indices[i * 3 + 1] ?? 0;
        const c = indices[i * 3 + 2] ?? 0;
        addEdge(a, b, i);
        addEdge(b, c, i);
        addEdge(c, a, i);
    }
    const faceVerts = (i: number) =>
        [indices[i * 3] ?? 0, indices[i * 3 + 1] ?? 0, indices[i * 3 + 2] ?? 0] as const;
    const hasDirected = (f: number, a: number, b: number) => {
        const v = faceVerts(f);
        for (let k = 0; k < 3; k++) if (v[k] === a && v[(k + 1) % 3] === b) return true;
        return false;
    };
    const flip = (f: number) => {
        const i = f * 3;
        const tmp = indices[i + 1] ?? 0;
        indices[i + 1] = indices[i + 2] ?? 0;
        indices[i + 2] = tmp;
    };
    const visited = new Uint8Array(t);
    const queue: number[] = [];
    for (let seed = 0; seed < t; seed++) {
        if (visited[seed]) continue;
        visited[seed] = 1;
        queue.push(seed);
        while (queue.length) {
            const f = queue.pop()!;
            const v = faceVerts(f);
            for (let k = 0; k < 3; k++) {
                const a = v[k]!;
                const b = v[(k + 1) % 3]!;
                const key = a < b ? `${a}|${b}` : `${b}|${a}`;
                for (const nf of undirected.get(key) ?? []) {
                    if (nf === f || visited[nf]) continue;
                    visited[nf] = 1;
                    if (hasDirected(nf, a, b)) flip(nf);
                    queue.push(nf);
                }
            }
        }
    }
    const out: AfoTriMesh = { positions: new Float32Array(mesh.positions), indices };
    if (meshSignedVolume(out) < 0) {
        for (let i = 0; i < t; i++) flip(i);
    }
    return out;
}

/** Connected triangle components. A printable shell is one body. */
export function countMeshBodies(mesh: AfoTriMesh): number {
    const t = triangleCount(mesh);
    const edgeFaces = new Map<string, number[]>();
    const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (let i = 0; i < t; i++) {
        const vs = [mesh.indices[i * 3] ?? 0, mesh.indices[i * 3 + 1] ?? 0, mesh.indices[i * 3 + 2] ?? 0];
        for (let e = 0; e < 3; e++) {
            const k = key(vs[e]!, vs[(e + 1) % 3]!);
            const list = edgeFaces.get(k);
            if (list) list.push(i);
            else edgeFaces.set(k, [i]);
        }
    }
    const neighbors: number[][] = Array.from({ length: t }, () => []);
    for (const faces of edgeFaces.values()) {
        for (let i = 0; i < faces.length; i++) {
            for (let j = i + 1; j < faces.length; j++) {
                neighbors[faces[i]!]!.push(faces[j]!);
                neighbors[faces[j]!]!.push(faces[i]!);
            }
        }
    }
    const seen = new Uint8Array(t);
    let bodies = 0;
    for (let i = 0; i < t; i++) {
        if (seen[i]) continue;
        bodies++;
        const stack = [i];
        seen[i] = 1;
        while (stack.length) {
            const f = stack.pop()!;
            for (const nb of neighbors[f] ?? []) {
                if (seen[nb]) continue;
                seen[nb] = 1;
                stack.push(nb);
            }
        }
    }
    return bodies;
}

export function nearestVertex(mesh: AfoTriMesh, p: AfoVec3): { index: number; distSq: number } {
    const n = vertexCount(mesh);
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
        const o = i * 3;
        const dx = (mesh.positions[o] ?? 0) - p.x;
        const dy = (mesh.positions[o + 1] ?? 0) - p.y;
        const dz = (mesh.positions[o + 2] ?? 0) - p.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) {
            bestD = d;
            best = i;
        }
    }
    return { index: best, distSq: bestD };
}
