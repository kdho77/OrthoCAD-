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
