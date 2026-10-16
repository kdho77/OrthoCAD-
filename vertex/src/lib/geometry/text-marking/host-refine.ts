// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BufferAttribute, type BufferGeometry } from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { TEXT_HOST_REFINE_MAX_EDGE_MM, TEXT_HOST_REFINE_PAD_MM, TEXT_WELD_MM } from "./constants";
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
    const max2 = maxEdgeMm * maxEdgeMm;
    const xyz = (pos: BufferAttribute, i: number) => ({
        x: pos.getX(i),
        y: pos.getY(i),
        z: pos.getZ(i),
    });
    const triOverlaps = (pos: BufferAttribute, a: number, b: number, c: number): boolean => {
        const pa = xyz(pos, a);
        const pb = xyz(pos, b);
        const pc = xyz(pos, c);
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
    };
    const longEdge = (pos: BufferAttribute, a: number, b: number): boolean => {
        const pa = xyz(pos, a);
        const pb = xyz(pos, b);
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const dz = pb.z - pa.z;
        return dx * dx + dy * dy + dz * dz > max2;
    };

    for (let pass = 0; pass < 16; pass++) {
        const pos = work.getAttribute("position") as BufferAttribute;
        const index = work.getIndex();
        if (!pos || !index) break;
        const src = index.array as ArrayLike<number>;
        const marked = new Set<string>();
        for (let t = 0; t + 2 < index.count; t += 3) {
            const a = src[t] ?? 0;
            const b = src[t + 1] ?? 0;
            const c = src[t + 2] ?? 0;
            if (!triOverlaps(pos, a, b, c)) continue;
            if (longEdge(pos, a, b)) marked.add(edgeKey(a, b));
            if (longEdge(pos, b, c)) marked.add(edgeKey(b, c));
            if (longEdge(pos, c, a)) marked.add(edgeKey(c, a));
        }
        if (!marked.size) break;

        const extra: number[] = [];
        const mids = new Map<string, number>();
        const midOf = (a: number, b: number): number => {
            const k = edgeKey(a, b);
            let m = mids.get(k);
            if (m == null) {
                const pa = xyz(pos, a);
                const pb = xyz(pos, b);
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
            const old = pos.array as Float32Array;
            const grown = new Float32Array(old.length + extra.length);
            grown.set(old);
            grown.set(extra, old.length);
            work.setAttribute("position", new BufferAttribute(grown, 3));
        }
        work.setIndex(next);
    }
    work.computeVertexNormals();
    work.computeBoundingBox();
    if (!indexedWatertight(work)) {
        work.dispose();
        return host;
    }
    return work;
}
