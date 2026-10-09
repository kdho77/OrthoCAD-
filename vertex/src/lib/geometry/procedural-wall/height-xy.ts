// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/** XY → Z sampler from a triangle mesh that is a graph over the footprint. */

export interface XyTri {
    ax: number;
    ay: number;
    az: number;
    bx: number;
    by: number;
    bz: number;
    cx: number;
    cy: number;
    cz: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

export interface XyHeightIndex {
    cell: number;
    hash: Map<string, number[]>;
    tris: XyTri[];
    samples: Float32Array;
}

const CELL = 2.5;

function barycentricZ(t: XyTri, x: number, y: number): number | null {
    const v0x = t.bx - t.ax;
    const v0y = t.by - t.ay;
    const v1x = t.cx - t.ax;
    const v1y = t.cy - t.ay;
    const v2x = x - t.ax;
    const v2y = y - t.ay;
    const den = v0x * v1y - v1x * v0y;
    if (Math.abs(den) < 1e-14) return null;
    const v = (v2x * v1y - v1x * v2y) / den;
    const w = (v0x * v2y - v2x * v0y) / den;
    const u = 1 - v - w;
    if (u < -1e-3 || v < -1e-3 || w < -1e-3) return null;
    return u * t.az + v * t.bz + w * t.cz;
}

export function buildXyHeightIndex(
    positions: Float32Array,
    indices: ArrayLike<number> | undefined,
    cell = CELL,
): XyHeightIndex {
    const tris: XyTri[] = [];
    const hash = new Map<string, number[]>();
    const triCount = indices ? indices.length / 3 : positions.length / 9;
    for (let t = 0; t < triCount; t++) {
        const ia = indices ? indices[t * 3]! : t * 3;
        const ib = indices ? indices[t * 3 + 1]! : t * 3 + 1;
        const ic = indices ? indices[t * 3 + 2]! : t * 3 + 2;
        const ax = positions[ia * 3]!;
        const ay = positions[ia * 3 + 1]!;
        const az = positions[ia * 3 + 2]!;
        const bx = positions[ib * 3]!;
        const by = positions[ib * 3 + 1]!;
        const bz = positions[ib * 3 + 2]!;
        const cx = positions[ic * 3]!;
        const cy = positions[ic * 3 + 1]!;
        const cz = positions[ic * 3 + 2]!;
        const minX = Math.min(ax, bx, cx);
        const minY = Math.min(ay, by, cy);
        const maxX = Math.max(ax, bx, cx);
        const maxY = Math.max(ay, by, cy);
        const id = tris.length;
        tris.push({ ax, ay, az, bx, by, bz, cx, cy, cz, minX, minY, maxX, maxY });
        const x0 = Math.floor(minX / cell);
        const y0 = Math.floor(minY / cell);
        const x1 = Math.floor(maxX / cell);
        const y1 = Math.floor(maxY / cell);
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const k = `${x},${y}`;
                let b = hash.get(k);
                if (!b) {
                    b = [];
                    hash.set(k, b);
                }
                b.push(id);
            }
        }
    }
    return { cell, hash, tris, samples: positions };
}

export function sampleXyHeight(
    index: XyHeightIndex,
    x: number,
    y: number,
    prefer: "min" | "max" = "max",
): number | null {
    const ix = Math.floor(x / index.cell);
    const iy = Math.floor(y / index.cell);
    let best: number | null = null;
    const seen = new Set<number>();
    for (let r = 0; r <= 2; r++) {
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                const bucket = index.hash.get(`${ix + dx},${iy + dy}`);
                if (!bucket) continue;
                for (const id of bucket) {
                    if (seen.has(id)) continue;
                    seen.add(id);
                    const z = barycentricZ(index.tris[id]!, x, y);
                    if (z != null) {
                        if (best == null) best = z;
                        else if (prefer === "max" ? z > best : z < best) best = z;
                    }
                }
            }
        }
        if (best != null) return best;
    }
    return null;
}
