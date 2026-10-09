// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";

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

const CELL = 6;

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

function segmentsShareVertex(a: Tri, b: Tri): boolean {
    const A = [a.i0, a.i1, a.i2];
    const B = [b.i0, b.i1, b.i2];
    for (const i of A) if (B.includes(i)) return true;
    return false;
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

/** Count proper triangle-triangle intersections (shared-vertex pairs skipped). */
export function countSelfIntersections(geo: BufferGeometry): number {
    const pos = geo.getAttribute("position").array as Float32Array;
    const index = geo.getIndex();
    if (!index) return 0;
    const idx = index.array;
    const tris: Tri[] = [];
    for (let t = 0; t < idx.length; t += 3) {
        const i0 = idx[t]!;
        const i1 = idx[t + 1]!;
        const i2 = idx[t + 2]!;
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
    const hash = new Map<string, number[]>();
    const large: number[] = [];
    for (let i = 0; i < tris.length; i++) {
        const t = tris[i]!;
        const ext = Math.max(t.maxX - t.minX, t.maxY - t.minY, t.maxZ - t.minZ);
        if (!Number.isFinite(ext) || ext > 28) {
            large.push(i);
            continue;
        }
        const x0 = Math.floor(t.minX / CELL);
        const y0 = Math.floor(t.minY / CELL);
        const z0 = Math.floor(t.minZ / CELL);
        const x1 = Math.floor(t.maxX / CELL);
        const y1 = Math.floor(t.maxY / CELL);
        const z1 = Math.floor(t.maxZ / CELL);
        for (let z = z0; z <= z1; z++) {
            for (let y = y0; y <= y1; y++) {
                for (let x = x0; x <= x1; x++) {
                    const k = `${x},${y},${z}`;
                    let b = hash.get(k);
                    if (!b) {
                        b = [];
                        hash.set(k, b);
                    }
                    b.push(i);
                }
            }
        }
    }
    const seen = new Set<string>();
    let hits = 0;
    const consider = (ia: number, ib: number) => {
        const key = ia < ib ? `${ia}:${ib}` : `${ib}:${ia}`;
        if (seen.has(key)) return;
        seen.add(key);
        const a = tris[ia]!;
        const b = tris[ib]!;
        if (segmentsShareVertex(a, b)) return;
        if (trianglesIntersect(a, b)) hits++;
    };
    for (const bucket of hash.values()) {
        for (let i = 0; i < bucket.length; i++) {
            for (let j = i + 1; j < bucket.length; j++) consider(bucket[i]!, bucket[j]!);
        }
    }
    for (let i = 0; i < large.length; i++) {
        for (let j = i + 1; j < large.length; j++) consider(large[i]!, large[j]!);
        const L = tris[large[i]!]!;
        const x0 = Math.floor(L.minX / CELL);
        const y0 = Math.floor(L.minY / CELL);
        const z0 = Math.floor(L.minZ / CELL);
        const x1 = Math.floor(L.maxX / CELL);
        const y1 = Math.floor(L.maxY / CELL);
        const z1 = Math.floor(L.maxZ / CELL);
        const nearby = new Set<number>();
        for (let z = z0; z <= z1; z++) {
            for (let y = y0; y <= y1; y++) {
                for (let x = x0; x <= x1; x++) {
                    const b = hash.get(`${x},${y},${z}`);
                    if (!b) continue;
                    for (const id of b) nearby.add(id);
                }
            }
        }
        for (const id of nearby) consider(large[i]!, id);
    }
    return hits;
}
