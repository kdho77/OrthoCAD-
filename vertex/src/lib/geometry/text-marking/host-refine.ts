// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BufferAttribute, type BufferGeometry } from "three";
import { TEXT_HOST_REFINE_MAX_EDGE_MM, TEXT_HOST_REFINE_PAD_MM } from "./constants";
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

function inBoxes(x: number, y: number, z: number, boxes: Aabb[]): boolean {
    for (const b of boxes) {
        if (x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY && z >= b.minZ && z <= b.maxZ) {
            return true;
        }
    }
    return false;
}

/**
 * Split host edges inside (footprint + 1 mm) down to ≤ 0.4 mm. Vertices
 * outside the region keep their original float bits; the mesh stays watertight.
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

    const work = host.clone();
    work.userData = host.userData ?? {};
    if (!work.getIndex()) {
        const n = srcPos.count;
        const tri: number[] = [];
        for (let i = 0; i < n; i++) tri.push(i);
        work.setIndex(tri);
    }
    const max2 = maxEdgeMm * maxEdgeMm;
    const xyz = (pos: BufferAttribute, i: number) => ({
        x: pos.getX(i),
        y: pos.getY(i),
        z: pos.getZ(i),
    });
    for (let pass = 0; pass < 16; pass++) {
        const pos = work.getAttribute("position") as BufferAttribute;
        const index = work.getIndex();
        if (!pos || !index) break;
        const src = index.array as ArrayLike<number>;
        const mids = new Map<string, number>();
        const extra: number[] = [];
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
        const longInRegion = (a: number, b: number): boolean => {
            const pa = xyz(pos, a);
            const pb = xyz(pos, b);
            const dx = pb.x - pa.x;
            const dy = pb.y - pa.y;
            const dz = pb.z - pa.z;
            if (dx * dx + dy * dy + dz * dz <= max2) return false;
            const mx = (pa.x + pb.x) * 0.5;
            const my = (pa.y + pb.y) * 0.5;
            const mz = (pa.z + pb.z) * 0.5;
            return (
                inBoxes(pa.x, pa.y, pa.z, boxes) ||
                inBoxes(pb.x, pb.y, pb.z, boxes) ||
                inBoxes(mx, my, mz, boxes)
            );
        };
        const next: number[] = [];
        let splits = 0;
        for (let t = 0; t + 2 < index.count; t += 3) {
            const a = src[t] ?? 0;
            const b = src[t + 1] ?? 0;
            const c = src[t + 2] ?? 0;
            const ab = longInRegion(a, b);
            const bc = longInRegion(b, c);
            const ca = longInRegion(c, a);
            const n = (ab ? 1 : 0) + (bc ? 1 : 0) + (ca ? 1 : 0);
            if (!n) {
                next.push(a, b, c);
                continue;
            }
            splits++;
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
        if (!splits) break;
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
    return work;
}
