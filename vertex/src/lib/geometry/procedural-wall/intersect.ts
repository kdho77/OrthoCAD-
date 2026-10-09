// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";

export interface SelfIntersectionReport {
    /** Proper (non-coplanar) triangle-triangle hits. Must be 0. */
    real: number;
    /** Coplanar overlaps, reported separately. */
    coplanar: number;
    /** Pair-class breakdown (top / wall / plantar). */
    byClass?: Record<string, number>;
    /** Centroids of real wall-wall hits (for u-band STOP reports). */
    wallHitCentroids?: Array<{ x: number; y: number; z: number }>;
}

interface Tri {
    i0: number;
    i1: number;
    i2: number;
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
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
}

const WELD_MM = 1e-5;

function orient(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
    dx: number,
    dy: number,
    dz: number,
): number {
    const adx = ax - dx;
    const ady = ay - dy;
    const adz = az - dz;
    const bdx = bx - dx;
    const bdy = by - dy;
    const bdz = bz - dz;
    const cdx = cx - dx;
    const cdy = cy - dy;
    const cdz = cz - dz;
    return adx * (bdy * cdz - bdz * cdy) - ady * (bdx * cdz - bdz * cdx) + adz * (bdx * cdy - bdy * cdx);
}

function sharedVertexCount(a: Tri, b: Tri): number {
    const B = [b.i0, b.i1, b.i2];
    let n = 0;
    if (B.includes(a.i0)) n++;
    if (B.includes(a.i1)) n++;
    if (B.includes(a.i2)) n++;
    return n;
}

function triNormal(t: Tri): [number, number, number] | null {
    const ux = t.bx - t.ax;
    const uy = t.by - t.ay;
    const uz = t.bz - t.az;
    const vx = t.cx - t.ax;
    const vy = t.cy - t.ay;
    const vz = t.cz - t.az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) return null;
    return [nx / len, ny / len, nz / len];
}

function facesCoplanar(a: Tri, b: Tri): boolean {
    const na = triNormal(a);
    const nb = triNormal(b);
    if (!na || !nb) return false;
    const dot = Math.abs(na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2]);
    if (dot < 0.9995) return false;
    const dist = Math.abs((b.ax - a.ax) * na[0] + (b.ay - a.ay) * na[1] + (b.az - a.az) * na[2]);
    return dist <= 1e-3;
}

function pointInTri(px: number, py: number, pz: number, t: Tri): boolean {
    const abx = t.bx - t.ax;
    const aby = t.by - t.ay;
    const abz = t.bz - t.az;
    const acx = t.cx - t.ax;
    const acy = t.cy - t.ay;
    const acz = t.cz - t.az;
    const apx = px - t.ax;
    const apy = py - t.ay;
    const apz = pz - t.az;
    const nX = aby * acz - abz * acy;
    const nY = abz * acx - abx * acz;
    const nZ = abx * acy - aby * acx;
    const n2 = nX * nX + nY * nY + nZ * nZ;
    if (n2 < 1e-16) return false;
    const q = (apx * nX + apy * nY + apz * nZ) / n2;
    if (Math.abs(q) > 1e-4) return false;
    const cx = acy * nZ - acz * nY;
    const cy = acz * nX - acx * nZ;
    const cz = acx * nY - acy * nX;
    const v = (apx * cx + apy * cy + apz * cz) / n2;
    const bx = nY * abz - nZ * aby;
    const by = nZ * abx - nX * abz;
    const bz = nX * aby - nY * abx;
    const w = (apx * bx + apy * by + apz * bz) / n2;
    const u = 1 - v - w;
    return u >= -1e-4 && v >= -1e-4 && w >= -1e-4;
}

function edgeHitsTri(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    t: Tri,
): boolean {
    const o0 = orient(t.ax, t.ay, t.az, t.bx, t.by, t.bz, t.cx, t.cy, t.cz, ax, ay, az);
    const o1 = orient(t.ax, t.ay, t.az, t.bx, t.by, t.bz, t.cx, t.cy, t.cz, bx, by, bz);
    if (o0 * o1 > 0) return false;
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const denom = o1 - o0;
    const f = Math.abs(denom) < 1e-16 ? 0.5 : -o0 / denom;
    if (f < -1e-4 || f > 1 + 1e-4) return false;
    return pointInTri(ax + dx * f, ay + dy * f, az + dz * f, t);
}

function trianglesIntersect(a: Tri, b: Tri): boolean {
    if (
        a.maxX < b.minX ||
        a.minX > b.maxX ||
        a.maxY < b.minY ||
        a.minY > b.maxY ||
        a.maxZ < b.minZ ||
        a.minZ > b.maxZ
    ) {
        return false;
    }
    if (edgeHitsTri(a.ax, a.ay, a.az, a.bx, a.by, a.bz, b)) return true;
    if (edgeHitsTri(a.bx, a.by, a.bz, a.cx, a.cy, a.cz, b)) return true;
    if (edgeHitsTri(a.cx, a.cy, a.cz, a.ax, a.ay, a.az, b)) return true;
    if (edgeHitsTri(b.ax, b.ay, b.az, b.bx, b.by, b.bz, a)) return true;
    if (edgeHitsTri(b.bx, b.by, b.bz, b.cx, b.cy, b.cz, a)) return true;
    if (edgeHitsTri(b.cx, b.cy, b.cz, b.ax, b.ay, b.az, a)) return true;
    return false;
}

function weldIndex(pos: Float32Array, tol = WELD_MM): Int32Array {
    const n = pos.length / 3;
    const map = new Int32Array(n);
    const cell = Math.max(tol, 1e-6);
    const hash = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
        const x = pos[i * 3]!;
        const y = pos[i * 3 + 1]!;
        const z = pos[i * 3 + 2]!;
        const k = `${Math.round(x / cell)},${Math.round(y / cell)},${Math.round(z / cell)}`;
        let bucket = hash.get(k);
        if (!bucket) {
            bucket = [];
            hash.set(k, bucket);
        }
        let canon = i;
        for (const j of bucket) {
            const d = Math.hypot(x - pos[j * 3]!, y - pos[j * 3 + 1]!, z - pos[j * 3 + 2]!);
            if (d <= tol) {
                canon = j;
                break;
            }
        }
        map[i] = canon;
        if (canon === i) bucket.push(i);
    }
    return map;
}

interface BvhNode {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
    left?: BvhNode;
    right?: BvhNode;
    start: number;
    count: number;
}

function buildBvh(tris: Tri[], order: number[]): BvhNode {
    const nodeOf = (start: number, count: number): BvhNode => {
        let minX = Infinity;
        let minY = Infinity;
        let minZ = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        let maxZ = -Infinity;
        for (let i = start; i < start + count; i++) {
            const t = tris[order[i]!]!;
            if (t.minX < minX) minX = t.minX;
            if (t.minY < minY) minY = t.minY;
            if (t.minZ < minZ) minZ = t.minZ;
            if (t.maxX > maxX) maxX = t.maxX;
            if (t.maxY > maxY) maxY = t.maxY;
            if (t.maxZ > maxZ) maxZ = t.maxZ;
        }
        const node: BvhNode = { minX, minY, minZ, maxX, maxY, maxZ, start, count };
        if (count <= 8) return node;
        const dx = maxX - minX;
        const dy = maxY - minY;
        const dz = maxZ - minZ;
        const axis = dx > dy && dx > dz ? 0 : dy > dz ? 1 : 2;
        const mid = start + (count >> 1);
        const slice = order.slice(start, start + count);
        slice.sort((ia, ib) => {
            const a = tris[ia]!;
            const b = tris[ib]!;
            const ca = axis === 0 ? a.minX + a.maxX : axis === 1 ? a.minY + a.maxY : a.minZ + a.maxZ;
            const cb = axis === 0 ? b.minX + b.maxX : axis === 1 ? b.minY + b.maxY : b.minZ + b.maxZ;
            return ca - cb;
        });
        for (let i = 0; i < slice.length; i++) order[start + i] = slice[i]!;
        node.left = nodeOf(start, mid - start);
        node.right = nodeOf(mid, start + count - mid);
        return node;
    };
    return nodeOf(0, order.length);
}

function aabbHit(a: BvhNode, b: Tri): boolean {
    return !(
        a.maxX < b.minX ||
        a.minX > b.maxX ||
        a.maxY < b.minY ||
        a.minY > b.maxY ||
        a.maxZ < b.minZ ||
        a.minZ > b.maxZ
    );
}

/**
 * BVH tri-tri test. Pairs that share a vertex or edge (after a 1e-5 mm weld)
 * are excluded. Coplanar overlaps are counted separately from real hits.
 */
export function countSelfIntersections(geo: BufferGeometry): SelfIntersectionReport {
    const pos = geo.getAttribute("position").array as Float32Array;
    const index = geo.getIndex();
    if (!index) return { real: 0, coplanar: 0 };
    const idx = index.array;
    const weld = weldIndex(pos, WELD_MM);
    const tris: Tri[] = [];
    for (let t = 0; t < idx.length; t += 3) {
        const i0 = weld[idx[t]!]!;
        const i1 = weld[idx[t + 1]!]!;
        const i2 = weld[idx[t + 2]!]!;
        if (i0 === i1 || i1 === i2 || i2 === i0) continue;
        const ax = pos[i0 * 3]!;
        const ay = pos[i0 * 3 + 1]!;
        const az = pos[i0 * 3 + 2]!;
        const bx = pos[i1 * 3]!;
        const by = pos[i1 * 3 + 1]!;
        const bz = pos[i1 * 3 + 2]!;
        const cx = pos[i2 * 3]!;
        const cy = pos[i2 * 3 + 1]!;
        const cz = pos[i2 * 3 + 2]!;
        tris.push({
            i0,
            i1,
            i2,
            ax,
            ay,
            az,
            bx,
            by,
            bz,
            cx,
            cy,
            cz,
            minX: Math.min(ax, bx, cx),
            minY: Math.min(ay, by, cy),
            minZ: Math.min(az, bz, cz),
            maxX: Math.max(ax, bx, cx),
            maxY: Math.max(ay, by, cy),
            maxZ: Math.max(az, bz, cz),
        });
    }
    const topN = (geo.userData as { topVertexCount?: number }).topVertexCount ?? 0;
    const plantarN = (geo.userData as { plantarVertexCount?: number }).plantarVertexCount ?? 0;
    const classOf = (t: Tri): string => {
        const vs = [t.i0, t.i1, t.i2];
        const allTop = vs.every((v) => v < topN);
        const allPlantar = vs.every((v) => v >= topN && v < topN + plantarN);
        if (allTop) return "top";
        if (allPlantar) return "plantar";
        return "wall";
    };
    const pairKey = (a: string, b: string): string => (a < b ? `${a}-${b}` : `${b}-${a}`);
    const order = Array.from({ length: tris.length }, (_, i) => i);
    const root = tris.length ? buildBvh(tris, order) : null;
    let real = 0;
    let coplanar = 0;
    const byClass: Record<string, number> = {};
    const wallHitCentroids: Array<{ x: number; y: number; z: number }> = [];
    const collect = (node: BvhNode, a: Tri, ai: number, out: number[]) => {
        if (!aabbHit(node, a)) return;
        if (!node.left || !node.right) {
            for (let k = node.start; k < node.start + node.count; k++) {
                const j = order[k]!;
                if (j <= ai) continue;
                out.push(j);
            }
            return;
        }
        collect(node.left, a, ai, out);
        collect(node.right, a, ai, out);
    };
    const buf: number[] = [];
    for (let i = 0; i < tris.length; i++) {
        const a = tris[i]!;
        if (!root) break;
        buf.length = 0;
        collect(root, a, i, buf);
        for (const j of buf) {
            const b = tris[j]!;
            if (sharedVertexCount(a, b) > 0) continue;
            if (!trianglesIntersect(a, b)) continue;
            if (facesCoplanar(a, b)) coplanar++;
            else {
                real++;
                const key = pairKey(classOf(a), classOf(b));
                byClass[key] = (byClass[key] ?? 0) + 1;
                if (key === "wall-wall") {
                    wallHitCentroids.push({
                        x: (a.ax + a.bx + a.cx + b.ax + b.bx + b.cx) / 6,
                        y: (a.ay + a.by + a.cy + b.ay + b.by + b.cy) / 6,
                        z: (a.az + a.bz + a.cz + b.az + b.bz + b.cz) / 6,
                    });
                }
            }
        }
    }
    return { real, coplanar, byClass, wallHitCentroids };
}
