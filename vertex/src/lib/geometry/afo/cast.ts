// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AFO_TOE_BOX_PCT_RANGE } from "./defaults";
import { cloneMesh, vertexCount } from "./mesh-ops";
import { applyOffsetField, evaluateOffsetField, offsetInputFromDesign } from "./offset-field";
import type { AfoBoxParams, AfoCastState, AfoDesignState, AfoTriMesh, AfoVec3 } from "./types";

/**
 * Apply Cast-step operations to a working positive. Flatten / boxes are opt-in.
 * Toe-box height is `pct × max Z of the toe region` (100–130%).
 */
export function applyCastOps(mesh: AfoTriMesh, cast: AfoCastState): AfoTriMesh {
    let out = cloneMesh(mesh);
    if (cast.flattenBottom) out = flattenBottom(out, 0);
    if (cast.shinBox.enabled) out = clipAabb(out, shinAabb(cast.shinBox));
    if (cast.toeBox.enabled) out = applyToeBoxHeight(out, cast.toeBox);
    return out;
}

export function toeRegionMaxZ(mesh: AfoTriMesh): number {
    const n = vertexCount(mesh);
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) maxY = Math.max(maxY, mesh.positions[i * 3 + 1] ?? 0);
    const yCut = maxY * 0.6;
    let maxZ = 0;
    for (let i = 0; i < n; i++) {
        const y = mesh.positions[i * 3 + 1] ?? 0;
        if (y < yCut) continue;
        maxZ = Math.max(maxZ, mesh.positions[i * 3 + 2] ?? 0);
    }
    return maxZ;
}

export function clampToeBoxPct(pct: number): number {
    return Math.min(AFO_TOE_BOX_PCT_RANGE[1], Math.max(AFO_TOE_BOX_PCT_RANGE[0], pct));
}

/** Scale toe-region Z so max Z equals pct × original toe height. */
export function applyToeBoxHeight(mesh: AfoTriMesh, box: AfoBoxParams): AfoTriMesh {
    const out = cloneMesh(mesh);
    const pct = clampToeBoxPct(box.heightPct ?? 100);
    const toeH = toeRegionMaxZ(mesh);
    const target = (pct / 100) * toeH;
    if (toeH < 1e-6) return out;
    const scale = target / toeH;
    const n = vertexCount(out);
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) maxY = Math.max(maxY, out.positions[i * 3 + 1] ?? 0);
    const yCut = maxY * 0.6;
    for (let i = 0; i < n; i++) {
        const y = out.positions[i * 3 + 1] ?? 0;
        if (y < yCut) continue;
        out.positions[i * 3 + 2] = (out.positions[i * 3 + 2] ?? 0) * scale;
    }
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

export function applyClinicalCast(
    mesh: AfoTriMesh,
    afo: AfoDesignState,
    extras?: { medialMal?: AfoVec3; lateralMal?: AfoVec3 },
): { mesh: AfoTriMesh; featherMm: number; meshable: boolean } {
    const boxed = applyCastOps(mesh, afo.cast);
    const field = evaluateOffsetField(offsetInputFromDesign(boxed, afo, extras));
    return { mesh: applyOffsetField(boxed, field), featherMm: field.featherMm, meshable: field.meshable };
}
