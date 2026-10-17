// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { cloneMesh, vertexCount } from "./mesh-ops";
import type { AfoBoxParams, AfoCastState, AfoTriMesh } from "./types";

/**
 * Apply Cast-step operations to a working positive. Operations are opt-in via
 * flags so identity (all off) clones the input.
 */
export function applyCastOps(mesh: AfoTriMesh, cast: AfoCastState): AfoTriMesh {
    let out = cloneMesh(mesh);
    if (cast.flattenBottom) out = flattenBottom(out, 0);
    if (cast.shinBox.enabled) out = clipAabb(out, shinAabb(cast.shinBox));
    if (cast.toeBox.enabled) out = clipAabb(out, toeAabb(cast.toeBox));
    return out;
}

export function flattenBottom(mesh: AfoTriMesh, planeZ = 0): AfoTriMesh {
    const out = cloneMesh(mesh);
    const n = vertexCount(out);
    for (let i = 0; i < n; i++) {
        const z = out.positions[i * 3 + 2] ?? 0;
        if (z < planeZ) out.positions[i * 3 + 2] = planeZ;
    }
    return out;
}

function shinAabb(box: AfoBoxParams): { min: number[]; max: number[] } {
    const hx = box.widthMm * 0.5;
    const hy = box.depthMm * 0.5;
    return { min: [-hx, 0, 40], max: [hx, hy * 2, 40 + box.heightMm] };
}

function toeAabb(box: AfoBoxParams): { min: number[]; max: number[] } {
    const hx = box.widthMm * 0.5;
    return { min: [-hx, 100, 0], max: [hx, 100 + box.depthMm, box.heightMm] };
}

/** Keep triangles whose centroid is inside the AABB. Degenerate but test-safe. */
export function clipAabb(mesh: AfoTriMesh, aabb: { min: number[]; max: number[] }): AfoTriMesh {
    const keep: number[] = [];
    const t = (mesh.indices.length / 3) | 0;
    for (let i = 0; i < t; i++) {
        const ia = mesh.indices[i * 3] ?? 0;
        const ib = mesh.indices[i * 3 + 1] ?? 0;
        const ic = mesh.indices[i * 3 + 2] ?? 0;
        const cx =
            ((mesh.positions[ia * 3] ?? 0) + (mesh.positions[ib * 3] ?? 0) + (mesh.positions[ic * 3] ?? 0)) /
            3;
        const cy =
            ((mesh.positions[ia * 3 + 1] ?? 0) +
                (mesh.positions[ib * 3 + 1] ?? 0) +
                (mesh.positions[ic * 3 + 1] ?? 0)) /
            3;
        const cz =
            ((mesh.positions[ia * 3 + 2] ?? 0) +
                (mesh.positions[ib * 3 + 2] ?? 0) +
                (mesh.positions[ic * 3 + 2] ?? 0)) /
            3;
        if (
            cx >= (aabb.min[0] ?? 0) &&
            cx <= (aabb.max[0] ?? 0) &&
            cy >= (aabb.min[1] ?? 0) &&
            cy <= (aabb.max[1] ?? 0) &&
            cz >= (aabb.min[2] ?? 0) &&
            cz <= (aabb.max[2] ?? 0)
        ) {
            keep.push(ia, ib, ic);
        }
    }
    if (keep.length === 0) return cloneMesh(mesh);
    return compactMesh(mesh, keep);
}

function compactMesh(mesh: AfoTriMesh, indices: number[]): AfoTriMesh {
    const map = new Map<number, number>();
    const positions: number[] = [];
    const outIdx: number[] = [];
    for (const old of indices) {
        let ni = map.get(old);
        if (ni === undefined) {
            ni = map.size;
            map.set(old, ni);
            positions.push(
                mesh.positions[old * 3] ?? 0,
                mesh.positions[old * 3 + 1] ?? 0,
                mesh.positions[old * 3 + 2] ?? 0,
            );
        }
        outIdx.push(ni);
    }
    return { positions: new Float32Array(positions), indices: new Uint32Array(outIdx) };
}
