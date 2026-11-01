// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { AfoTriMesh } from "./types";

const EPS = 1e-8;

/**
 * Count intersecting triangle pairs that do not share a vertex.
 * O(n²) with AABB cull — intended for the small synthetic / test shells.
 */
export function countTriangleSelfIntersections(mesh: AfoTriMesh): number {
    const t = (mesh.indices.length / 3) | 0;
    const boxes: { min: number[]; max: number[] }[] = new Array(t);
    for (let i = 0; i < t; i++) {
        boxes[i] = triAabb(mesh, i);
    }
    let hits = 0;
    for (let i = 0; i < t; i++) {
        const ia = mesh.indices[i * 3] ?? 0;
        const ib = mesh.indices[i * 3 + 1] ?? 0;
        const ic = mesh.indices[i * 3 + 2] ?? 0;
        const share = new Set([ia, ib, ic]);
        for (let j = i + 1; j < t; j++) {
            const ja = mesh.indices[j * 3] ?? 0;
            const jb = mesh.indices[j * 3 + 1] ?? 0;
            const jc = mesh.indices[j * 3 + 2] ?? 0;
            if (share.has(ja) || share.has(jb) || share.has(jc)) continue;
            if (!aabbOverlap(boxes[i]!, boxes[j]!)) continue;
            if (trianglesIntersect(mesh, i, j)) hits++;
        }
    }
    return hits;
}

function triAabb(mesh: AfoTriMesh, t: number): { min: number[]; max: number[] } {
    const ia = mesh.indices[t * 3] ?? 0;
    const ib = mesh.indices[t * 3 + 1] ?? 0;
    const ic = mesh.indices[t * 3 + 2] ?? 0;
    const xs = [mesh.positions[ia * 3] ?? 0, mesh.positions[ib * 3] ?? 0, mesh.positions[ic * 3] ?? 0];
    const ys = [
        mesh.positions[ia * 3 + 1] ?? 0,
        mesh.positions[ib * 3 + 1] ?? 0,
        mesh.positions[ic * 3 + 1] ?? 0,
    ];
    const zs = [
        mesh.positions[ia * 3 + 2] ?? 0,
        mesh.positions[ib * 3 + 2] ?? 0,
        mesh.positions[ic * 3 + 2] ?? 0,
    ];
    return {
        min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)],
        max: [Math.max(...xs), Math.max(...ys), Math.max(...zs)],
    };
}

function aabbOverlap(a: { min: number[]; max: number[] }, b: { min: number[]; max: number[] }): boolean {
    for (let k = 0; k < 3; k++) {
        if ((a.max[k] ?? 0) < (b.min[k] ?? 0) - EPS) return false;
        if ((b.max[k] ?? 0) < (a.min[k] ?? 0) - EPS) return false;
    }
    return true;
}

function trianglesIntersect(mesh: AfoTriMesh, i: number, j: number): boolean {
    const A = triVerts(mesh, i);
    const B = triVerts(mesh, j);
    return triTri(A, B);
}

function triVerts(mesh: AfoTriMesh, t: number): number[][] {
    const out: number[][] = [];
    for (let k = 0; k < 3; k++) {
        const i = mesh.indices[t * 3 + k] ?? 0;
        out.push([
            mesh.positions[i * 3] ?? 0,
            mesh.positions[i * 3 + 1] ?? 0,
            mesh.positions[i * 3 + 2] ?? 0,
        ]);
    }
    return out;
}

/** Möller triangle-triangle test (no coplanar special-case; those count as non-SI). */
function triTri(V: number[][], U: number[][]): boolean {
    const N1 = normal(V[0]!, V[1]!, V[2]!);
    const d1 = -dot(N1, V[0]!);
    const du = U.map((p) => dot(N1, p) + d1);
    if (sameSign(du[0]!, du[1]!, du[2]!)) return false;
    const N2 = normal(U[0]!, U[1]!, U[2]!);
    const d2 = -dot(N2, U[0]!);
    const dv = V.map((p) => dot(N2, p) + d2);
    if (sameSign(dv[0]!, dv[1]!, dv[2]!)) return false;
    const D = cross(N1, N2);
    const pv = V.map((p) => p[0]! * D[0]! + p[1]! * D[1]! + p[2]! * D[2]!);
    const pu = U.map((p) => p[0]! * D[0]! + p[1]! * D[1]! + p[2]! * D[2]!);
    const isect1 = interval(pv, dv);
    const isect2 = interval(pu, du);
    return isect1[0]! <= isect2[1]! + EPS && isect2[0]! <= isect1[1]! + EPS;
}

function sameSign(a: number, b: number, c: number): boolean {
    return (a > EPS && b > EPS && c > EPS) || (a < -EPS && b < -EPS && c < -EPS);
}

function interval(proj: number[], dist: number[]): [number, number] {
    const pts: number[] = [];
    for (let i = 0; i < 3; i++) {
        const a = dist[i]!;
        const b = dist[(i + 1) % 3]!;
        if (a * b < 0) {
            const t = a / (a - b);
            pts.push(proj[i]! + t * (proj[(i + 1) % 3]! - proj[i]!));
        }
        if (Math.abs(a) < EPS) pts.push(proj[i]!);
    }
    if (pts.length === 0) return [proj[0]!, proj[0]!];
    return [Math.min(...pts), Math.max(...pts)];
}

function normal(a: number[], b: number[], c: number[]): number[] {
    return cross(sub(b, a), sub(c, a));
}
function sub(a: number[], b: number[]): number[] {
    return [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
}
function cross(a: number[], b: number[]): number[] {
    return [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
}
function dot(a: number[], b: number[]): number {
    return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
}
