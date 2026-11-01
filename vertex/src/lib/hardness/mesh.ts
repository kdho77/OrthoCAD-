// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { BufferGeometry } from "three";
import { sha256Bytes } from "./hash";

export interface TriangleMesh {
    /** Packed xyz xyz xyz … (length = 3 * vertexCount). */
    positions: Float32Array;
    /** Triangle indices (length = 3 * triCount). */
    indices: Uint32Array;
}

export const GRID_MM = 0.25;
export const SNAP_XY_MM = 0.3;
export const OVERSHOOT_MM = 0.5;
export const MIN_THICKNESS_MM = 0.6;
export const BOTTOM_CLAMP_MM = -0.5;
export const LIFT_THRESHOLD_MM = 0.2;
export const CLIPPER_CLOSE_MM = 0.5;
export const OUTLINE_CLIP_OFFSET_MM = 0.5;
export const SLIVER_VOLUME_MM3 = 2;
export const SLIVER_THICKNESS_MM = 0.8;
export const SHEET_SIMPLIFY_MM = 0.02;
export const INTERSECT_EPS_MM3 = 1e-3;
export const COPLANAR_GAP_MM = 0.05;
export const COPLANAR_ANGLE_DEG = 1;
export const COPLANAR_AREA_MM2 = 1;
export const VOXEL_REL_TOL = 0.005;
export const DEPTH_TOL_MM = 0.05;
export const OVERSHOOT_MIN_MM = 0.4;

export function emptyMesh(): TriangleMesh {
    return { positions: new Float32Array(0), indices: new Uint32Array(0) };
}

export function meshVertexCount(m: TriangleMesh): number {
    return m.positions.length / 3;
}

export function meshTriCount(m: TriangleMesh): number {
    return m.indices.length / 3;
}

export function meshSignedVolume(m: TriangleMesh): number {
    let v = 0;
    const p = m.positions;
    const ix = m.indices;
    for (let t = 0; t < ix.length; t += 3) {
        const a = ix[t]! * 3;
        const b = ix[t + 1]! * 3;
        const c = ix[t + 2]! * 3;
        const ax = p[a]!;
        const ay = p[a + 1]!;
        const az = p[a + 2]!;
        const bx = p[b]!;
        const by = p[b + 1]!;
        const bz = p[b + 2]!;
        const cx = p[c]!;
        const cy = p[c + 1]!;
        const cz = p[c + 2]!;
        v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    }
    return v / 6;
}

export function meshVolume(m: TriangleMesh): number {
    return Math.abs(meshSignedVolume(m));
}

export function meshSha(m: TriangleMesh): string {
    const pos = new Uint8Array(m.positions.buffer, m.positions.byteOffset, m.positions.byteLength);
    const ind = new Uint8Array(m.indices.buffer, m.indices.byteOffset, m.indices.byteLength);
    const buf = new Uint8Array(8 + pos.length + ind.length);
    const view = new DataView(buf.buffer);
    view.setUint32(0, m.positions.length, true);
    view.setUint32(4, m.indices.length, true);
    buf.set(pos, 8);
    buf.set(ind, 8 + pos.length);
    return sha256Bytes(buf);
}

export function meshIsWatertight(m: TriangleMesh): boolean {
    if (meshTriCount(m) < 4) return false;
    const edges = new Map<string, number>();
    const ix = m.indices;
    for (let t = 0; t < ix.length; t += 3) {
        const a = ix[t]!;
        const b = ix[t + 1]!;
        const c = ix[t + 2]!;
        for (const [u, v] of [
            [a, b],
            [b, c],
            [c, a],
        ] as const) {
            const lo = Math.min(u, v);
            const hi = Math.max(u, v);
            const key = `${lo}:${hi}`;
            edges.set(key, (edges.get(key) ?? 0) + 1);
        }
    }
    for (const n of edges.values()) {
        if (n !== 2) return false;
    }
    return meshVolume(m) > 1e-9;
}

export function bboxOf(m: TriangleMesh): { min: [number, number, number]; max: [number, number, number] } {
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    const p = m.positions;
    for (let i = 0; i < p.length; i += 3) {
        min[0] = Math.min(min[0], p[i]!);
        min[1] = Math.min(min[1], p[i + 1]!);
        min[2] = Math.min(min[2], p[i + 2]!);
        max[0] = Math.max(max[0], p[i]!);
        max[1] = Math.max(max[1], p[i + 1]!);
        max[2] = Math.max(max[2], p[i + 2]!);
    }
    return { min, max };
}

export function thicknessOf(m: TriangleMesh): number {
    if (m.positions.length === 0) return 0;
    const b = bboxOf(m);
    return b.max[2] - b.min[2];
}

export function boxMesh(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
): TriangleMesh {
    const positions = new Float32Array([
        x0,
        y0,
        z0,
        x1,
        y0,
        z0,
        x1,
        y1,
        z0,
        x0,
        y1,
        z0,
        x0,
        y0,
        z1,
        x1,
        y0,
        z1,
        x1,
        y1,
        z1,
        x0,
        y1,
        z1,
    ]);
    const indices = new Uint32Array([
        0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3,
        4, 7,
    ]);
    return { positions, indices };
}

export function bufferGeometryToMesh(geometry: BufferGeometry): TriangleMesh {
    const position = geometry.getAttribute("position");
    if (!position) throw new Error("Geometry has no position attribute");
    const index = geometry.getIndex();
    const triCount = index ? index.count / 3 : position.count / 3;
    const positions = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
        positions[i * 3] = position.getX(i);
        positions[i * 3 + 1] = position.getY(i);
        positions[i * 3 + 2] = position.getZ(i);
    }
    const indices = new Uint32Array(triCount * 3);
    for (let t = 0; t < triCount; t++) {
        indices[t * 3] = index ? index.getX(t * 3) : t * 3;
        indices[t * 3 + 1] = index ? index.getX(t * 3 + 1) : t * 3 + 1;
        indices[t * 3 + 2] = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    }
    return { positions, indices };
}

export function parseBinaryStl(buffer: ArrayBuffer): TriangleMesh {
    const view = new DataView(buffer);
    const triCount = view.getUint32(80, true);
    const positions: number[] = [];
    const indices: number[] = [];
    const keyToIndex = new Map<string, number>();
    const quant = 1e5;
    const vert = (x: number, y: number, z: number): number => {
        const key = `${Math.round(x * quant)}:${Math.round(y * quant)}:${Math.round(z * quant)}`;
        const existing = keyToIndex.get(key);
        if (existing !== undefined) return existing;
        const i = positions.length / 3;
        keyToIndex.set(key, i);
        positions.push(x, y, z);
        return i;
    };
    const expected = 84 + triCount * 50;
    if (view.byteLength < expected) {
        throw new Error(`binary STL truncated: ${view.byteLength} < ${expected} bytes`);
    }
    for (let t = 0; t < triCount; t++) {
        const offset = 84 + t * 50 + 12;
        const ax = view.getFloat32(offset, true);
        const ay = view.getFloat32(offset + 4, true);
        const az = view.getFloat32(offset + 8, true);
        const bx = view.getFloat32(offset + 12, true);
        const by = view.getFloat32(offset + 16, true);
        const bz = view.getFloat32(offset + 20, true);
        const cx = view.getFloat32(offset + 24, true);
        const cy = view.getFloat32(offset + 28, true);
        const cz = view.getFloat32(offset + 32, true);
        indices.push(vert(ax, ay, az), vert(bx, by, bz), vert(cx, cy, cz));
    }
    return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

export function fmtMm(n: number): string {
    return n.toFixed(6);
}
