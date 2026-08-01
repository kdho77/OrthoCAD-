// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BufferAttribute, type BufferGeometry } from "three";

/**
 * Compute smooth vertex normals into a Float32Array (stride-3) without Three.js
 * BufferAttribute getX/getY/getZ accessors. Indexed and non-indexed meshes supported.
 */
export function computeNormalsFloat32(
    positions: Float32Array,
    indices: ArrayLike<number> | null,
    out?: Float32Array,
): Float32Array {
    const vertexCount = positions.length / 3;
    const normals = out && out.length === positions.length ? out : new Float32Array(positions.length);
    normals.fill(0);

    const triCount = indices ? indices.length / 3 : vertexCount / 3;
    for (let t = 0; t < triCount; t++) {
        const i0 = indices ? indices[t * 3]! : t * 3;
        const i1 = indices ? indices[t * 3 + 1]! : t * 3 + 1;
        const i2 = indices ? indices[t * 3 + 2]! : t * 3 + 2;
        const ax = positions[i0 * 3]!;
        const ay = positions[i0 * 3 + 1]!;
        const az = positions[i0 * 3 + 2]!;
        const bx = positions[i1 * 3]!;
        const by = positions[i1 * 3 + 1]!;
        const bz = positions[i1 * 3 + 2]!;
        const cx = positions[i2 * 3]!;
        const cy = positions[i2 * 3 + 1]!;
        const cz = positions[i2 * 3 + 2]!;
        const abx = bx - ax;
        const aby = by - ay;
        const abz = bz - az;
        const acx = cx - ax;
        const acy = cy - ay;
        const acz = cz - az;
        const nx = aby * acz - abz * acy;
        const ny = abz * acx - abx * acz;
        const nz = abx * acy - aby * acx;
        normals[i0 * 3]! += nx;
        normals[i0 * 3 + 1]! += ny;
        normals[i0 * 3 + 2]! += nz;
        normals[i1 * 3]! += nx;
        normals[i1 * 3 + 1]! += ny;
        normals[i1 * 3 + 2]! += nz;
        normals[i2 * 3]! += nx;
        normals[i2 * 3 + 1]! += ny;
        normals[i2 * 3 + 2]! += nz;
    }

    for (let i = 0; i < vertexCount; i++) {
        const x = normals[i * 3]!;
        const y = normals[i * 3 + 1]!;
        const z = normals[i * 3 + 2]!;
        const len = Math.hypot(x, y, z) || 1;
        normals[i * 3] = x / len;
        normals[i * 3 + 1] = y / len;
        normals[i * 3 + 2] = z / len;
    }
    return normals;
}

/** Axis-aligned bounds from a stride-3 position buffer (no Three accessors). */
export function boundsFromPositions(positions: Float32Array): {
    min: [number, number, number];
    max: [number, number, number];
} {
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    const n = positions.length / 3;
    for (let i = 0; i < n; i++) {
        const x = positions[i * 3]!;
        const y = positions[i * 3 + 1]!;
        const z = positions[i * 3 + 2]!;
        if (x < min[0]) min[0] = x;
        if (y < min[1]) min[1] = y;
        if (z < min[2]) min[2] = z;
        if (x > max[0]) max[0] = x;
        if (y > max[1]) max[1] = y;
        if (z > max[2]) max[2] = z;
    }
    return { min, max };
}

/** Write Float32 normals onto a BufferGeometry without using getX/setXYZ. */
export function applyNormalsToGeometry(geometry: BufferGeometry, normals: Float32Array): void {
    const existing = geometry.getAttribute("normal");
    if (existing && (existing.array as Float32Array).length === normals.length) {
        (existing.array as Float32Array).set(normals);
        existing.needsUpdate = true;
        return;
    }
    geometry.setAttribute("normal", new BufferAttribute(normals, 3));
}
