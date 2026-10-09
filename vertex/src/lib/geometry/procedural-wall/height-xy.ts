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

interface DishBvhNode {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    left?: DishBvhNode;
    right?: DishBvhNode;
    start: number;
    count: number;
}

export interface DishZIndex {
    tris: XyTri[];
    order: number[];
    root: DishBvhNode | null;
}

function buildDishBvh(tris: XyTri[], order: number[], start: number, count: number): DishBvhNode {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = start; i < start + count; i++) {
        const t = tris[order[i]!]!;
        if (t.minX < minX) minX = t.minX;
        if (t.minY < minY) minY = t.minY;
        if (t.maxX > maxX) maxX = t.maxX;
        if (t.maxY > maxY) maxY = t.maxY;
    }
    const node: DishBvhNode = { minX, minY, maxX, maxY, start, count };
    if (count <= 8) return node;
    const dx = maxX - minX;
    const dy = maxY - minY;
    const axis = dx >= dy ? 0 : 1;
    const slice = order.slice(start, start + count);
    slice.sort((a, b) => {
        const ta = tris[a]!;
        const tb = tris[b]!;
        const ca = axis === 0 ? (ta.minX + ta.maxX) * 0.5 : (ta.minY + ta.maxY) * 0.5;
        const cb = axis === 0 ? (tb.minX + tb.maxX) * 0.5 : (tb.minY + tb.maxY) * 0.5;
        return ca - cb;
    });
    for (let i = 0; i < slice.length; i++) order[start + i] = slice[i]!;
    const mid = start + (count >> 1);
    node.left = buildDishBvh(tris, order, start, mid - start);
    node.right = buildDishBvh(tris, order, mid, start + count - mid);
    return node;
}

/** BVH over the stock dish for vertical (x,y) → z rays. */
export function buildDishZIndex(positions: Float32Array, indices: ArrayLike<number>): DishZIndex {
    const xy = buildXyHeightIndex(positions, indices);
    const order = xy.tris.map((_, i) => i);
    const root = xy.tris.length ? buildDishBvh(xy.tris, order, 0, xy.tris.length) : null;
    return { tris: xy.tris, order, root };
}

function rayHitNode(
    node: DishBvhNode,
    index: DishZIndex,
    x: number,
    y: number,
    prefer: "min" | "max",
): number | null {
    if (x < node.minX - 1e-6 || x > node.maxX + 1e-6 || y < node.minY - 1e-6 || y > node.maxY + 1e-6) {
        return null;
    }
    if (!node.left || !node.right) {
        let best: number | null = null;
        for (let i = node.start; i < node.start + node.count; i++) {
            const z = barycentricZ(index.tris[index.order[i]!]!, x, y);
            if (z == null) continue;
            if (best == null) best = z;
            else if (prefer === "min" ? z < best : z > best) best = z;
        }
        return best;
    }
    const a = rayHitNode(node.left, index, x, y, prefer);
    const b = rayHitNode(node.right, index, x, y, prefer);
    if (a == null) return b;
    if (b == null) return a;
    return prefer === "min" ? Math.min(a, b) : Math.max(a, b);
}

/** Vertical ray against the stock dish. Returns the lowest (plantar) hit. */
export function sampleDishZVertical(index: DishZIndex, x: number, y: number): number | null {
    if (!index.root) return null;
    return rayHitNode(index.root, index, x, y, "min");
}
