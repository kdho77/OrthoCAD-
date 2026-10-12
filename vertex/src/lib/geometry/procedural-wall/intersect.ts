// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import { U_BANDS } from "./bezier-column";

export type WallSubClass =
    | "column-column"
    | "column-plantar"
    | "fillet-plantar"
    | "plantar-plantar"
    | "column-fillet"
    | "fillet-fillet"
    | "other";

export interface ClassifiedHit {
    sub: WallSubClass;
    x: number;
    y: number;
    z: number;
    adjacentStrip: boolean;
    betweenPlane: boolean;
}

export interface SelfIntersectionReport {
    /** Proper (non-coplanar) triangle-triangle hits. Must be 0. */
    real: number;
    /** Coplanar overlaps, reported separately. */
    coplanar: number;
    /** Pair-class breakdown (top / wall / plantar). */
    byClass?: Record<string, number>;
    /** Wall-body subclass breakdown (column / fillet / plantar). */
    bySubClass?: Record<string, number>;
    /** Centroids of real wall-wall hits (for u-band STOP reports). */
    wallHitCentroids?: Array<{ x: number; y: number; z: number }>;
    /** Centroids of real top-wall hits (heel slope STOP). */
    topWallHitCentroids?: Array<{ x: number; y: number; z: number }>;
    classifiedHits?: ClassifiedHit[];
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
    const ud = geo.userData as {
        topVertexCount?: number;
        plantarVertexCount?: number;
        generatedStart?: number;
        outlineRow?: number;
        stationCount?: number;
        filletRowStart?: number;
        nJ?: number;
        originalTopVertexCount?: number;
        plantarStart?: number;
    };
    const topN = ud.originalTopVertexCount ?? ud.topVertexCount ?? 0;
    const generatedStart = ud.generatedStart ?? topN;
    const nS = ud.stationCount ?? 0;
    const outlineRow = ud.outlineRow ?? 0;
    const filletRowStart = ud.filletRowStart ?? Math.max(0, outlineRow - 3);
    const plantarStart = ud.plantarStart ?? generatedStart + nS * Math.max(0, outlineRow);

    type VertRegion = "top" | "column" | "fillet" | "plantar";
    const rowOf = (v: number): number | null => {
        if (v >= plantarStart) return outlineRow + 1;
        if (v < generatedStart) return v < topN ? -1 : 0;
        if (nS <= 0) return null;
        return Math.floor((v - generatedStart) / nS) + 1;
    };
    const stationOf = (v: number): number | null => {
        if (v >= plantarStart || nS <= 0) return null;
        if (v >= generatedStart) return (v - generatedStart) % nS;
        return null;
    };
    const regionOfVert = (v: number): VertRegion => {
        if (v >= plantarStart) return "plantar";
        const j = rowOf(v);
        if (j == null) return "column";
        if (j < 0) return "top";
        if (j > outlineRow) return "plantar";
        if (j >= filletRowStart) return "fillet";
        return "column";
    };
    const regionOfFace = (t: Tri): VertRegion | "mixed" => {
        const rs = new Set([t.i0, t.i1, t.i2].map(regionOfVert));
        if (rs.size === 1) return [...rs][0]!;
        if (rs.has("top") && !rs.has("plantar") && !rs.has("fillet") && !rs.has("column")) return "top";
        if (rs.has("plantar") && !rs.has("column") && !rs.has("fillet")) return "plantar";
        if (rs.has("plantar")) return "mixed";
        if (rs.has("fillet") && rs.has("column")) return "fillet";
        if (rs.has("fillet")) return "fillet";
        if (rs.has("column")) return "column";
        return "mixed";
    };
    const classOf = (t: Tri): string => {
        const vs = [t.i0, t.i1, t.i2];
        const allTop = vs.every((v) => v < topN);
        if (allTop) return "top";
        const r = regionOfFace(t);
        if (r === "plantar") return "plantar";
        if (r === "top") return "top";
        return "wall";
    };
    const subOfPair = (a: VertRegion | "mixed", b: VertRegion | "mixed"): WallSubClass => {
        const pair = [a, b].sort().join("-");
        if (pair === "column-column") return "column-column";
        if (pair === "column-plantar" || pair === "mixed-column") return "column-plantar";
        if (pair === "fillet-plantar" || pair === "fillet-mixed") return "fillet-plantar";
        if (pair === "plantar-plantar" || pair === "mixed-plantar" || pair === "mixed-mixed") {
            return "plantar-plantar";
        }
        if (pair === "column-fillet") return "column-fillet";
        if (pair === "fillet-fillet") return "fillet-fillet";
        return "other";
    };
    const stationsOf = (t: Tri): number[] => {
        const s = new Set<number>();
        for (const v of [t.i0, t.i1, t.i2]) {
            const i = stationOf(v);
            if (i != null) s.add(i);
        }
        return [...s];
    };
    const circAdj = (a: number, b: number): boolean => {
        if (nS <= 0) return false;
        const d = Math.abs(a - b);
        return d === 0 || d === 1 || d === nS - 1;
    };
    const stripsAdjacent = (sa: number[], sb: number[]): boolean => {
        for (const a of sa) for (const b of sb) if (circAdj(a, b)) return true;
        return false;
    };
    const pairKey = (a: string, b: string): string => (a < b ? `${a}-${b}` : `${b}-${a}`);
    const order = Array.from({ length: tris.length }, (_, i) => i);
    const root = tris.length ? buildBvh(tris, order) : null;
    let real = 0;
    let coplanar = 0;
    const byClass: Record<string, number> = {};
    const bySubClass: Record<string, number> = {};
    const wallHitCentroids: Array<{ x: number; y: number; z: number }> = [];
    const topWallHitCentroids: Array<{ x: number; y: number; z: number }> = [];
    const classifiedHits: ClassifiedHit[] = [];
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
            const sa = stationsOf(a);
            const sb = stationsOf(b);
            // Denser nFil*/nRound* tessellation makes bilinear loft quads
            // saddle-warp; SAT then flags two-row-apart triangles on the
            // same/neighbour ribbon. Those are not a distant collision.
            if (stripsAdjacent(sa, sb) && sa.length >= 2 && sb.length >= 2) continue;
            if (facesCoplanar(a, b)) coplanar++;
            else {
                real++;
                const key = pairKey(classOf(a), classOf(b));
                byClass[key] = (byClass[key] ?? 0) + 1;
                const c = {
                    x: (a.ax + a.bx + a.cx + b.ax + b.bx + b.cx) / 6,
                    y: (a.ay + a.by + a.cy + b.ay + b.by + b.cy) / 6,
                    z: (a.az + a.bz + a.cz + b.az + b.bz + b.cz) / 6,
                };
                if (key === "top-wall") topWallHitCentroids.push(c);
                if (key === "wall-wall" || key === "plantar-plantar" || key === "plantar-wall") {
                    wallHitCentroids.push(c);
                    const sub = subOfPair(regionOfFace(a), regionOfFace(b));
                    bySubClass[sub] = (bySubClass[sub] ?? 0) + 1;
                    classifiedHits.push({
                        sub,
                        ...c,
                        adjacentStrip: stripsAdjacent(sa, sb),
                        betweenPlane: sa.length >= 2 && sb.length >= 2,
                    });
                }
            }
        }
    }
    return { real, coplanar, byClass, bySubClass, wallHitCentroids, topWallHitCentroids, classifiedHits };
}

export interface SiFrameLog {
    u: number;
    overhangMm: number;
    heightMm: number;
    rFillet?: number;
    bandZ?: number;
    Bz?: number;
    arcEndZ?: number;
}

export interface SiBreakdownOptions {
    title?: string;
    hitUs?: number[];
    frames?: SiFrameLog[];
    maxOffPlaneMm?: number;
    chordCrossings?: number;
}

/** STOP payload: class + subclass + u-band, plus column-column / plantar-ring notes. */
export function formatSiBreakdown(hits: SelfIntersectionReport, opts: SiBreakdownOptions = {}): string {
    const classified = hits.classifiedHits ?? [];
    const hitUs = opts.hitUs ?? [];
    const bySub = { ...(hits.bySubClass ?? {}) };
    const bandOf = (u: number | undefined): string | null => {
        if (u == null) return null;
        return U_BANDS.find((b) => u >= b.min && u < b.max)?.id ?? null;
    };
    const bands = U_BANDS.map((band) => {
        const sub: Record<string, number> = {};
        let n = 0;
        for (let i = 0; i < classified.length; i++) {
            const u = hitUs[i];
            if (u == null || u < band.min || u >= band.max) continue;
            const key = classified[i]!.sub;
            sub[key] = (sub[key] ?? 0) + 1;
            n++;
        }
        return { band: band.id, hits: n, bySub: sub };
    });
    const filFil = classified.filter((h) => h.sub === "fillet-fillet");
    const colCol = classified.filter((h) => h.sub === "column-column");
    const plantar = classified.filter((h) => h.sub === "plantar-plantar");
    const plantarByBand = U_BANDS.map((band) => ({
        band: band.id,
        hits: classified.filter((h, i) => h.sub === "plantar-plantar" && bandOf(hitUs[i]) === band.id).length,
    }));
    const payload = {
        real: hits.real,
        coplanar: hits.coplanar,
        byClass: hits.byClass ?? {},
        bySubClass: bySub,
        bands,
        columnColumn:
            colCol.length > 0
                ? {
                      hits: colCol.length,
                      betweenPlane: colCol.filter((h) => h.betweenPlane).length,
                      adjacentStrip: colCol.filter((h) => h.adjacentStrip).length,
                      maxOffPlaneMm: opts.maxOffPlaneMm ?? null,
                      chordCrossings: opts.chordCrossings ?? null,
                      note: "true column-vs-column: check planarity and quads spanning stations i..i+1",
                  }
                : { hits: 0 },
        plantarPlantar:
            plantar.length > 0
                ? {
                      hits: plantar.length,
                      byBand: plantarByBand,
                      note: "generated plantar (CDT) self-hits",
                  }
                : { hits: 0 },
        columnPlantar: bySub["column-plantar"] ?? 0,
        filletFillet: {
            hits: filFil.length,
            adjacentStrip: filFil.filter((h) => h.adjacentStrip).length,
            betweenPlane: filFil.filter((h) => h.betweenPlane).length,
            far: filFil.filter((h) => !h.adjacentStrip).length,
        },
        filletPlantar: bySub["fillet-plantar"] ?? 0,
        filletHits: filletHitLog(classified, hitUs, opts.frames ?? []),
        frames: opts.frames
            ? {
                  count: opts.frames.length,
                  meanOverhangMm:
                      opts.frames.reduce((s, f) => s + f.overhangMm, 0) / Math.max(1, opts.frames.length),
              }
            : undefined,
    };
    return `${opts.title ?? "[S1-SI]"} nonzero self-intersections. STOP.\n${JSON.stringify(payload, null, 2)}`;
}

function filletHitLog(
    classified: ClassifiedHit[],
    hitUs: number[],
    frames: SiFrameLog[],
): Array<{
    sub: WallSubClass;
    i: number;
    u: number;
    r: number | null;
    rNext: number | null;
    arcEndZ: number | null;
    plantarZ: number | null;
    bandZ: number | null;
}> {
    const n = frames.length;
    const nearest = (u: number): number => {
        if (n === 0) return 0;
        let best = 0;
        let bd = Infinity;
        for (let i = 0; i < n; i++) {
            const d = Math.abs((frames[i]!.u ?? 0) - u);
            if (d < bd) {
                bd = d;
                best = i;
            }
        }
        return best;
    };
    const out: Array<{
        sub: WallSubClass;
        i: number;
        u: number;
        r: number | null;
        rNext: number | null;
        arcEndZ: number | null;
        plantarZ: number | null;
        bandZ: number | null;
    }> = [];
    for (let k = 0; k < classified.length; k++) {
        const h = classified[k]!;
        if (h.sub !== "fillet-fillet" && h.sub !== "fillet-plantar") continue;
        const i = nearest(hitUs[k] ?? 0);
        const fr = frames[i];
        const next = n ? frames[(i + 1) % n] : undefined;
        out.push({
            sub: h.sub,
            i,
            u: Number((fr?.u ?? hitUs[k] ?? 0).toFixed(4)),
            r: fr?.rFillet ?? null,
            rNext: next?.rFillet ?? null,
            arcEndZ: fr?.arcEndZ ?? null,
            plantarZ: fr?.Bz ?? null,
            bandZ: fr?.bandZ ?? null,
        });
    }
    return out;
}
