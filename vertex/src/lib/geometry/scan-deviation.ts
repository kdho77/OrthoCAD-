// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Scan-to-base deviation overlay against RAW L0 top surface.
 * Nearest-point signed distance (surface normal), never vertical Z gap.
 * Fixed legend ±5 mm — never auto-scaled.
 */

import type { BufferGeometry } from "three";
import * as THREE from "three";

/** Fixed clinical legend — do not auto-scale. */
export const DEVIATION_LEGEND_MM = 5;

export type ScanDeviationResult = {
    /** Per-scan-vertex signed mm (positive = scan above base along base normal). */
    perVertexMm: Float32Array;
    legendMinMm: number;
    legendMaxMm: number;
    /** True when |d| exceeded the legend at any sample. */
    clamped: boolean;
    elapsedMs: number;
};

type Bucket = { indices: number[] };

/**
 * Uniform XY bucket grid over top vertices for nearest-point queries.
 * Native only — no BVH dependency.
 */
function buildTopXyBuckets(
    positions: ArrayLike<number>,
    topN: number,
    cellMm: number,
): {
    buckets: Map<string, Bucket>;
    normals: Float32Array;
    cellMm: number;
} {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < topN; i++) {
        const x = positions[i * 3]!;
        const y = positions[i * 3 + 1]!;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    }

    // Estimate normals from a local XY ring (flat-ish top). Prefer attribute if present.
    const normals = new Float32Array(topN * 3);
    // Default dorsal +Z; refined below from neighbour cross products when possible.
    for (let i = 0; i < topN; i++) {
        normals[i * 3 + 2] = 1;
    }

    const buckets = new Map<string, Bucket>();
    const keyOf = (x: number, y: number) =>
        `${Math.floor((x - minX) / cellMm)},${Math.floor((y - minY) / cellMm)}`;

    for (let i = 0; i < topN; i++) {
        const k = keyOf(positions[i * 3]!, positions[i * 3 + 1]!);
        let b = buckets.get(k);
        if (!b) {
            b = { indices: [] };
            buckets.set(k, b);
        }
        b.indices.push(i);
    }

    // Approximate vertex normals from neighbouring top verts in the same + adjacent buckets.
    for (let i = 0; i < topN; i++) {
        const ix = Math.floor((positions[i * 3]! - minX) / cellMm);
        const iy = Math.floor((positions[i * 3 + 1]! - minY) / cellMm);
        const neighbors: number[] = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const b = buckets.get(`${ix + dx},${iy + dy}`);
                if (!b) continue;
                for (const j of b.indices) {
                    if (j !== i) neighbors.push(j);
                }
            }
        }
        if (neighbors.length < 2) continue;
        const ox = positions[i * 3]!;
        const oy = positions[i * 3 + 1]!;
        const oz = positions[i * 3 + 2]!;
        const j0 = neighbors[0]!;
        const j1 = neighbors[Math.min(1, neighbors.length - 1)]!;
        const e0 = new THREE.Vector3(
            positions[j0 * 3]! - ox,
            positions[j0 * 3 + 1]! - oy,
            positions[j0 * 3 + 2]! - oz,
        );
        const e1 = new THREE.Vector3(
            positions[j1 * 3]! - ox,
            positions[j1 * 3 + 1]! - oy,
            positions[j1 * 3 + 2]! - oz,
        );
        const n = new THREE.Vector3().crossVectors(e0, e1);
        if (n.lengthSq() < 1e-12) continue;
        n.normalize();
        if (n.z < 0) n.negate();
        normals[i * 3] = n.x;
        normals[i * 3 + 1] = n.y;
        normals[i * 3 + 2] = n.z;
    }

    return { buckets, normals, cellMm };
}

function nearestTopIndex(
    x: number,
    y: number,
    z: number,
    positions: ArrayLike<number>,
    buckets: Map<string, Bucket>,
    minX: number,
    minY: number,
    cellMm: number,
): number {
    const ix = Math.floor((x - minX) / cellMm);
    const iy = Math.floor((y - minY) / cellMm);
    let best = -1;
    let bestD2 = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            const b = buckets.get(`${ix + dx},${iy + dy}`);
            if (!b) continue;
            for (const i of b.indices) {
                const px = positions[i * 3]!;
                const py = positions[i * 3 + 1]!;
                const pz = positions[i * 3 + 2]!;
                const d2 = (px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2;
                if (d2 < bestD2) {
                    bestD2 = d2;
                    best = i;
                }
            }
        }
    }
    if (best >= 0) return best;
    // Fallback: exhaustive (rare — off-grid samples)
    for (let i = 0; i < positions.length / 3; i++) {
        const px = positions[i * 3]!;
        const py = positions[i * 3 + 1]!;
        const pz = positions[i * 3 + 2]!;
        const d2 = (px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2;
        if (d2 < bestD2) {
            bestD2 = d2;
            best = i;
        }
    }
    return best;
}

/**
 * Signed nearest-point distance from registered scan vertices to RAW base TOP.
 * Legend fixed at ±DEVIATION_LEGEND_MM.
 */
export function computeScanDeviationAgainstRaw(
    scanGeometry: BufferGeometry,
    registrationMatrix: THREE.Matrix4,
    rawBaseGeometry: BufferGeometry,
): ScanDeviationResult {
    const t0 = performance.now();
    const basePosAttr = rawBaseGeometry.getAttribute("position");
    if (!basePosAttr) {
        return {
            perVertexMm: new Float32Array(0),
            legendMinMm: -DEVIATION_LEGEND_MM,
            legendMaxMm: DEVIATION_LEGEND_MM,
            clamped: false,
            elapsedMs: 0,
        };
    }
    const basePos = basePosAttr.array as Float32Array;
    const topN =
        (rawBaseGeometry.userData as { topVertexCount?: number }).topVertexCount ?? basePosAttr.count;

    const cellMm = 3;
    const { buckets, normals } = buildTopXyBuckets(basePos, topN, cellMm);

    let minX = Infinity;
    let minY = Infinity;
    for (let i = 0; i < topN; i++) {
        const x = basePos[i * 3]!;
        const y = basePos[i * 3 + 1]!;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
    }

    const scanPos = scanGeometry.getAttribute("position");
    const nScan = scanPos?.count ?? 0;
    const perVertexMm = new Float32Array(nScan);
    let clamped = false;
    const p = new THREE.Vector3();

    for (let i = 0; i < nScan; i++) {
        p.set(scanPos!.getX(i), scanPos!.getY(i), scanPos!.getZ(i));
        p.applyMatrix4(registrationMatrix);
        const bi = nearestTopIndex(p.x, p.y, p.z, basePos, buckets, minX, minY, cellMm);
        if (bi < 0) {
            perVertexMm[i] = 0;
            continue;
        }
        const bx = basePos[bi * 3]!;
        const by = basePos[bi * 3 + 1]!;
        const bz = basePos[bi * 3 + 2]!;
        const nx = normals[bi * 3]!;
        const ny = normals[bi * 3 + 1]!;
        const nz = normals[bi * 3 + 2]!;
        // Signed distance along base normal (not vertical Z).
        const d = (p.x - bx) * nx + (p.y - by) * ny + (p.z - bz) * nz;
        if (Math.abs(d) > DEVIATION_LEGEND_MM) clamped = true;
        perVertexMm[i] = d;
    }

    return {
        perVertexMm,
        legendMinMm: -DEVIATION_LEGEND_MM,
        legendMaxMm: DEVIATION_LEGEND_MM,
        clamped,
        elapsedMs: performance.now() - t0,
    };
}

/** Map signed mm → RGB for overlay (blue negative … white 0 … red positive). Clamped at ±5. */
export function deviationColor(mm: number, out: THREE.Color): THREE.Color {
    const t = Math.max(-1, Math.min(1, mm / DEVIATION_LEGEND_MM));
    if (t < 0) {
        // blue → white
        const u = 1 + t;
        return out.setRGB(u, u, 1);
    }
    // white → red
    return out.setRGB(1, 1 - t, 1 - t);
}
