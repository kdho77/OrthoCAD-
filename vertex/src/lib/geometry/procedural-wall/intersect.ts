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

function sharedVertexCount(a: Tri, b: Tri): number {
    const B = [b.i0, b.i1, b.i2];
    let n = 0;
    if (B.includes(a.i0)) n++;
    if (B.includes(a.i1)) n++;
    if (B.includes(a.i2)) n++;
    return n;
}

function segmentsShareVertex(a: Tri, b: Tri): boolean {
    return sharedVertexCount(a, b) > 0;
}

function facesShareEdge(a: Tri, b: Tri): boolean {
    return sharedVertexCount(a, b) >= 2;
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

/** Coplanar neighbors across a stitch (duplicate-vert seams, first-ring slivers). */
function facesCoplanarNeighbors(a: Tri, b: Tri): boolean {
    const na = triNormal(a);
    const nb = triNormal(b);
    if (!na || !nb) return false;
    const dot = Math.abs(na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2]);
    if (dot < 0.999) return false;
    const dist = Math.abs((b.ax - a.ax) * na[0] + (b.ay - a.ay) * na[1] + (b.az - a.az) * na[2]);
    if (dist > 0.15) return false;
    if (
        a.maxX < b.minX - 0.4 ||
        a.minX > b.maxX + 0.4 ||
        a.maxY < b.minY - 0.4 ||
        a.minY > b.maxY + 0.4 ||
        a.maxZ < b.minZ - 0.4 ||
        a.minZ > b.maxZ + 0.4
    ) {
        return false;
    }
    const av = [
        [a.ax, a.ay, a.az],
        [a.bx, a.by, a.bz],
        [a.cx, a.cy, a.cz],
    ];
    const bv = [
        [b.ax, b.ay, b.az],
        [b.bx, b.by, b.bz],
        [b.cx, b.cy, b.cz],
    ];
    let minD = Infinity;
    for (const p of av) {
        for (const q of bv) {
            const d = Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!);
            if (d < minD) minD = d;
        }
    }
    return minD < 1.5;
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

/**
 * Count proper triangle-triangle intersections.
 * Skips pairs that share a vertex or edge, and coplanar neighbors across a stitch.
 */
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
    for (let i = 0; i < tris.length; i++) {
        const t = tris[i]!;
        const ext = Math.max(t.maxX - t.minX, t.maxY - t.minY, t.maxZ - t.minZ);
        if (!Number.isFinite(ext)) continue;
        // Index by centroid so each tri lives in one cell; query by AABB below.
        const cx = Math.floor(((t.minX + t.maxX) * 0.5) / CELL);
        const cy = Math.floor(((t.minY + t.maxY) * 0.5) / CELL);
        const cz = Math.floor(((t.minZ + t.maxZ) * 0.5) / CELL);
        const k = `${cx},${cy},${cz}`;
        let b = hash.get(k);
        if (!b) {
            b = [];
            hash.set(k, b);
        }
        b.push(i);
    }
    let hits = 0;
    const queried = new Set<number>();
    for (let i = 0; i < tris.length; i++) {
        const a = tris[i]!;
        const ext = Math.max(a.maxX - a.minX, a.maxY - a.minY, a.maxZ - a.minZ);
        if (!Number.isFinite(ext) || ext > 40) continue;
        const x0 = Math.floor(a.minX / CELL);
        const y0 = Math.floor(a.minY / CELL);
        const z0 = Math.floor(a.minZ / CELL);
        const x1 = Math.floor(a.maxX / CELL);
        const y1 = Math.floor(a.maxY / CELL);
        const z1 = Math.floor(a.maxZ / CELL);
        queried.clear();
        for (let z = z0; z <= z1; z++) {
            for (let y = y0; y <= y1; y++) {
                for (let x = x0; x <= x1; x++) {
                    const bucket = hash.get(`${x},${y},${z}`);
                    if (!bucket) continue;
                    for (const j of bucket) {
                        if (j <= i || queried.has(j)) continue;
                        queried.add(j);
                        const b = tris[j]!;
                        if (segmentsShareVertex(a, b) || facesShareEdge(a, b)) continue;
                        if (facesCoplanarNeighbors(a, b)) continue;
                        if (trianglesIntersect(a, b)) hits++;
                    }
                }
            }
        }
    }
    return hits;
}
