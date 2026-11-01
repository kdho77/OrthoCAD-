// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { BufferAttribute, type BufferGeometry } from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
    TEXT_HOST_REFINE_MAX_EDGE_MM,
    TEXT_HOST_REFINE_PAD_MM,
    TEXT_RESULT_MAX_EDGE_MM,
    TEXT_RESULT_SPLIT_ANGLE_DEG,
    TEXT_WELD_MM,
} from "./constants";
import type { MapTextPoint, TextGlyphGroup } from "./types";

interface Aabb {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
}

function edgeKey(a: number, b: number): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}

type SamplePoint = { x: number; y: number; z: number };

/**
 * Hash of the transformed footprint. The origin is the finite bbox min, so a
 * Y-mirrored (negative) glyph does not produce a negative or NaN cell index.
 * `nearest` ring-expands occupied cells only, at most ceil(maxDist/cell)
 * rings, then brute-forces the stored band.
 */
export class SampleGrid {
    private readonly buckets: Array<{ ix: number; iy: number; iz: number; pts: SamplePoint[] }> = [];
    private readonly band: SamplePoint[] = [];
    private readonly originX: number;
    private readonly originY: number;
    private readonly originZ: number;
    readonly cell: number;
    constructor(pts: SamplePoint[], cell = 0.5) {
        this.cell = cell > 0 && Number.isFinite(cell) ? cell : 0.5;
        let minX = Infinity;
        let minY = Infinity;
        let minZ = Infinity;
        const finite: SamplePoint[] = [];
        for (const p of pts) {
            if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) continue;
            finite.push(p);
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.z < minZ) minZ = p.z;
        }
        this.originX = Number.isFinite(minX) ? minX : 0;
        this.originY = Number.isFinite(minY) ? minY : 0;
        this.originZ = Number.isFinite(minZ) ? minZ : 0;
        const map = new Map<string, { ix: number; iy: number; iz: number; pts: SamplePoint[] }>();
        for (const p of finite) {
            this.band.push(p);
            const ix = Math.floor((p.x - this.originX) / this.cell);
            const iy = Math.floor((p.y - this.originY) / this.cell);
            const iz = Math.floor((p.z - this.originZ) / this.cell);
            if (!Number.isFinite(ix) || !Number.isFinite(iy) || !Number.isFinite(iz)) continue;
            const k = `${ix}|${iy}|${iz}`;
            let bucket = map.get(k);
            if (!bucket) {
                bucket = { ix, iy, iz, pts: [] };
                map.set(k, bucket);
                this.buckets.push(bucket);
            }
            bucket.pts.push(p);
        }
    }
    private brute(p: SamplePoint): number {
        let best = Infinity;
        for (const q of this.band) {
            const d = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
            if (d < best) best = d;
        }
        return best;
    }
    nearest(p: SamplePoint, maxMm: number): number {
        if (
            !Number.isFinite(p.x) ||
            !Number.isFinite(p.y) ||
            !Number.isFinite(p.z) ||
            !Number.isFinite(maxMm) ||
            !(maxMm >= 0)
        ) {
            return this.brute(p);
        }
        const rMax = Math.ceil(maxMm / this.cell);
        if (!Number.isFinite(rMax) || rMax < 0) return this.brute(p);
        const ix = Math.floor((p.x - this.originX) / this.cell);
        const iy = Math.floor((p.y - this.originY) / this.cell);
        const iz = Math.floor((p.z - this.originZ) / this.cell);
        if (!Number.isFinite(ix) || !Number.isFinite(iy) || !Number.isFinite(iz)) return this.brute(p);
        let best = Infinity;
        for (let ring = 0; ring <= rMax; ring++) {
            for (const bucket of this.buckets) {
                const cheb = Math.max(
                    Math.abs(bucket.ix - ix),
                    Math.abs(bucket.iy - iy),
                    Math.abs(bucket.iz - iz),
                );
                if (cheb !== ring) continue;
                for (const q of bucket.pts) {
                    const d = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
                    if (d < best) best = d;
                }
            }
            // Cells past this ring are at least `ring * cell` away.
            if (best <= ring * this.cell) return best;
        }
        return Number.isFinite(best) ? best : this.brute(p);
    }
}

function footprintSamples(
    groups: TextGlyphGroup[],
    mapPoint: MapTextPoint,
): Array<{ x: number; y: number; z: number }> {
    const pts: Array<{ x: number; y: number; z: number }> = [];
    for (const g of groups) {
        for (const t of [0, 0.5, 1]) {
            for (const p of g.outer) pts.push(mapPoint(p, t));
            for (const hole of g.holes) for (const p of hole) pts.push(mapPoint(p, t));
        }
    }
    return pts;
}

function glyphAabbs(groups: TextGlyphGroup[], mapPoint: MapTextPoint, pad: number): Aabb[] {
    const boxes: Aabb[] = [];
    for (const g of groups) {
        let minX = Infinity;
        let minY = Infinity;
        let minZ = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        let maxZ = -Infinity;
        const consider = (p: { x: number; y: number }, t: number) => {
            const q = mapPoint(p, t);
            if (q.x < minX) minX = q.x;
            if (q.y < minY) minY = q.y;
            if (q.z < minZ) minZ = q.z;
            if (q.x > maxX) maxX = q.x;
            if (q.y > maxY) maxY = q.y;
            if (q.z > maxZ) maxZ = q.z;
        };
        for (const t of [0, 1]) {
            for (const p of g.outer) consider(p, t);
            for (const hole of g.holes) for (const p of hole) consider(p, t);
        }
        if (!Number.isFinite(minX)) continue;
        boxes.push({
            minX: minX - pad,
            minY: minY - pad,
            minZ: minZ - pad,
            maxX: maxX + pad,
            maxY: maxY + pad,
            maxZ: maxZ + pad,
        });
    }
    return boxes;
}

function indexedWatertight(geo: BufferGeometry): boolean {
    const pos = geo.getAttribute("position");
    const index = geo.getIndex();
    if (!pos || !index) return false;
    const edgeCount = new Map<string, number>();
    const src = index.array as ArrayLike<number>;
    for (let t = 0; t + 2 < index.count; t += 3) {
        const a = src[t] ?? 0;
        const b = src[t + 1] ?? 0;
        const c = src[t + 2] ?? 0;
        for (const [u, v] of [
            [a, b],
            [b, c],
            [c, a],
        ] as const) {
            const e = edgeKey(u, v);
            edgeCount.set(e, (edgeCount.get(e) ?? 0) + 1);
        }
    }
    for (const count of edgeCount.values()) {
        if (count !== 2) return false;
    }
    return true;
}

function xyzOf(pos: BufferAttribute, i: number): { x: number; y: number; z: number } {
    return { x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) };
}

function triOverlapsBox(pos: BufferAttribute, a: number, b: number, c: number, boxes: Aabb[]): boolean {
    const pa = xyzOf(pos, a);
    const pb = xyzOf(pos, b);
    const pc = xyzOf(pos, c);
    const minX = Math.min(pa.x, pb.x, pc.x);
    const minY = Math.min(pa.y, pb.y, pc.y);
    const minZ = Math.min(pa.z, pb.z, pc.z);
    const maxX = Math.max(pa.x, pb.x, pc.x);
    const maxY = Math.max(pa.y, pb.y, pc.y);
    const maxZ = Math.max(pa.z, pb.z, pc.z);
    for (const box of boxes) {
        if (maxX < box.minX || minX > box.maxX) continue;
        if (maxY < box.minY || minY > box.maxY) continue;
        if (maxZ < box.minZ || minZ > box.maxZ) continue;
        return true;
    }
    return false;
}

function dist2(pos: BufferAttribute, a: number, b: number): number {
    const pa = xyzOf(pos, a);
    const pb = xyzOf(pos, b);
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const dz = pb.z - pa.z;
    return dx * dx + dy * dy + dz * dz;
}

function minAngAndLongest(
    pos: BufferAttribute,
    a: number,
    b: number,
    c: number,
): { minAng: number; long: 0 | 1 | 2 } {
    const pa = xyzOf(pos, a);
    const pb = xyzOf(pos, b);
    const pc = xyzOf(pos, c);
    const lab = Math.hypot(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z);
    const lbc = Math.hypot(pc.x - pb.x, pc.y - pb.y, pc.z - pb.z);
    const lca = Math.hypot(pa.x - pc.x, pa.y - pc.y, pa.z - pc.z);
    const ang = (opp: number, u: number, v: number) => {
        const den = 2 * u * v;
        if (den < 1e-18) return 0;
        const cos = Math.max(-1, Math.min(1, (u * u + v * v - opp * opp) / den));
        return Math.acos(cos);
    };
    const minAng = Math.min(ang(lbc, lab, lca), ang(lca, lab, lbc), ang(lab, lca, lbc));
    let long: 0 | 1 | 2 = 0;
    let longL = lab;
    if (lbc > longL) {
        long = 1;
        longL = lbc;
    }
    if (lca > longL) long = 2;
    return { minAng, long };
}

/**
 * Split marked long / needle edges on `work`. Neighbor faces that share a
 * marked edge also split, so the index graph stays watertight. Vertices
 * outside the boxes keep their coordinates.
 */
function triNearFootprint(
    pos: BufferAttribute,
    a: number,
    b: number,
    c: number,
    grid: SampleGrid,
    padMm: number,
): boolean {
    const pa = xyzOf(pos, a);
    const pb = xyzOf(pos, b);
    const pc = xyzOf(pos, c);
    const cx = (pa.x + pb.x + pc.x) / 3;
    const cy = (pa.y + pb.y + pc.y) / 3;
    const cz = (pa.z + pb.z + pc.z) / 3;
    const long = Math.sqrt(Math.max(dist2(pos, a, b), dist2(pos, b, c), dist2(pos, c, a)));
    const reach = padMm + long;
    return grid.nearest({ x: cx, y: cy, z: cz }, reach) <= reach;
}

function splitMarkedEdges(
    work: BufferGeometry,
    boxes: Aabb[],
    maxEdgeMm: number,
    minAngleDeg: number,
    footprint?: SampleGrid,
    padMm = TEXT_HOST_REFINE_PAD_MM,
    maxExtraVerts = 80_000,
): boolean {
    const max2 = maxEdgeMm * maxEdgeMm;
    const minAng = (Math.max(0, minAngleDeg) * Math.PI) / 180;
    const needleMax2 = maxEdgeMm * 2.5 * (maxEdgeMm * 2.5);
    let any = false;
    let extraVerts = 0;
    for (let pass = 0; pass < 12; pass++) {
        if (extraVerts > maxExtraVerts) break;
        const pos = work.getAttribute("position") as BufferAttribute;
        const index = work.getIndex();
        if (!pos || !index) break;
        const src = index.array as ArrayLike<number>;
        const marked = new Set<string>();
        for (let t = 0; t + 2 < index.count; t += 3) {
            const a = src[t] ?? 0;
            const b = src[t + 1] ?? 0;
            const c = src[t + 2] ?? 0;
            if (!triOverlapsBox(pos, a, b, c, boxes)) continue;
            if (footprint && !triNearFootprint(pos, a, b, c, footprint, padMm)) continue;
            const ab2 = dist2(pos, a, b);
            const bc2 = dist2(pos, b, c);
            const ca2 = dist2(pos, c, a);
            if (ab2 > max2) marked.add(edgeKey(a, b));
            if (bc2 > max2) marked.add(edgeKey(b, c));
            if (ca2 > max2) marked.add(edgeKey(c, a));
            // Only split needles that are already short — a 5° split on a
            // 40 mm leftover host face cascades into millions of slivers.
            if (minAng > 0 && Math.max(ab2, bc2, ca2) <= needleMax2) {
                const m = minAngAndLongest(pos, a, b, c);
                if (m.minAng < minAng) {
                    if (m.long === 0) marked.add(edgeKey(a, b));
                    else if (m.long === 1) marked.add(edgeKey(b, c));
                    else marked.add(edgeKey(c, a));
                }
            }
        }
        if (!marked.size) break;
        any = true;

        const extra: number[] = [];
        const mids = new Map<string, number>();
        const midOf = (a: number, b: number): number => {
            const k = edgeKey(a, b);
            let m = mids.get(k);
            if (m == null) {
                const pa = xyzOf(pos, a);
                const pb = xyzOf(pos, b);
                m = pos.count + extra.length / 3;
                extra.push((pa.x + pb.x) * 0.5, (pa.y + pb.y) * 0.5, (pa.z + pb.z) * 0.5);
                mids.set(k, m);
            }
            return m;
        };
        const next: number[] = [];
        for (let t = 0; t + 2 < index.count; t += 3) {
            const a = src[t] ?? 0;
            const b = src[t + 1] ?? 0;
            const c = src[t + 2] ?? 0;
            const ab = marked.has(edgeKey(a, b));
            const bc = marked.has(edgeKey(b, c));
            const ca = marked.has(edgeKey(c, a));
            const n = (ab ? 1 : 0) + (bc ? 1 : 0) + (ca ? 1 : 0);
            if (!n) {
                next.push(a, b, c);
                continue;
            }
            const mab = ab ? midOf(a, b) : -1;
            const mbc = bc ? midOf(b, c) : -1;
            const mca = ca ? midOf(c, a) : -1;
            if (n === 3) {
                next.push(a, mab, mca, mab, b, mbc, mca, mbc, c, mab, mbc, mca);
            } else if (n === 1) {
                if (ab) next.push(a, mab, c, mab, b, c);
                else if (bc) next.push(a, b, mbc, a, mbc, c);
                else next.push(a, b, mca, b, c, mca);
            } else if (ab && bc) {
                next.push(a, mab, c, mab, b, mbc, mab, mbc, c);
            } else if (bc && ca) {
                next.push(a, b, mbc, a, mbc, mca, mbc, c, mca);
            } else {
                next.push(a, mab, mca, mab, b, c, mca, mab, c);
            }
        }
        if (extra.length) {
            extraVerts += extra.length / 3;
            const old = pos.array as Float32Array;
            const grown = new Float32Array(old.length + extra.length);
            grown.set(old);
            grown.set(extra, old.length);
            work.setAttribute("position", new BufferAttribute(grown, 3));
        }
        work.setIndex(next);
    }
    return any;
}

/**
 * Split host edges inside (footprint + 1 mm) down to ≤ 0.4 mm. Only long
 * edges are marked; every neighbor that shares a marked edge splits it, so
 * the surface stays indexed-watertight. Outside vertices keep their bits.
 */
export function refineHostLocally(
    host: BufferGeometry,
    groups: TextGlyphGroup[],
    mapPoint: MapTextPoint,
    padMm = TEXT_HOST_REFINE_PAD_MM,
    maxEdgeMm = TEXT_HOST_REFINE_MAX_EDGE_MM,
): BufferGeometry {
    const srcPos = host.getAttribute("position");
    if (!srcPos) return host;
    const boxes = glyphAabbs(groups, mapPoint, padMm);
    if (!boxes.length) return host;

    const clone = host.clone();
    clone.userData = host.userData ?? {};
    if (!clone.getIndex()) {
        const n = srcPos.count;
        const tri: number[] = [];
        for (let i = 0; i < n; i++) tri.push(i);
        clone.setIndex(tri);
    }
    for (const name of Object.keys(clone.attributes)) {
        if (name !== "position") clone.deleteAttribute(name);
    }
    const work = mergeVertices(clone, TEXT_WELD_MM);
    if (work !== clone) clone.dispose();
    work.userData = host.userData ?? {};
    if (!indexedWatertight(work)) {
        work.dispose();
        return host;
    }
    const samples = footprintSamples(groups, mapPoint);
    const footprint = samples.length ? new SampleGrid(samples, 0.5) : undefined;
    splitMarkedEdges(work, boxes, maxEdgeMm, 0, footprint, padMm, 24_000);
    work.computeVertexNormals();
    work.computeBoundingBox();
    if (!indexedWatertight(work)) {
        work.dispose();
        return host;
    }
    return work;
}

/**
 * After the boolean: split leftover long / needle edges in the text AABB
 * without welding. Midpoints lie on existing edges, so outside vertices
 * keep their coordinates and the surface stays a 2-manifold.
 */
export function splitLongRegionEdges(
    geo: BufferGeometry,
    groups: TextGlyphGroup[],
    mapPoint: MapTextPoint,
    padMm: number,
    maxEdgeMm = TEXT_RESULT_MAX_EDGE_MM,
    minAngleDeg = TEXT_RESULT_SPLIT_ANGLE_DEG,
): BufferGeometry {
    const boxes = glyphAabbs(groups, mapPoint, padMm);
    if (!boxes.length) return geo;
    const work = geo.clone();
    work.userData = geo.userData ?? {};
    if (!work.getIndex()) {
        const n = work.getAttribute("position").count;
        const tri: number[] = [];
        for (let i = 0; i < n; i++) tri.push(i);
        work.setIndex(tri);
    }
    if (!indexedWatertight(work)) {
        work.dispose();
        return geo;
    }
    const samples = footprintSamples(groups, mapPoint);
    const footprint = samples.length ? new SampleGrid(samples, 0.5) : undefined;
    splitMarkedEdges(work, boxes, maxEdgeMm, minAngleDeg, footprint, padMm, 20_000);
    work.computeVertexNormals();
    work.computeBoundingBox();
    if (!indexedWatertight(work)) {
        work.dispose();
        return geo;
    }
    return work;
}
