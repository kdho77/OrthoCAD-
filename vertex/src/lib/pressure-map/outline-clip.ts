// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { BufferGeometry } from "three";

export interface OutlinePoint {
    x: number;
    y: number;
}

/**
 * Top-view silhouette of a mesh in geometry XY.
 * The loop follows the outer boundary of the rasterized triangles, so a
 * concave arch is kept. Accuracy is about one cell (default 0.4 mm).
 */
export function meshLocalTopOutline(geo: BufferGeometry, cellMm = 0.4): OutlinePoint[] {
    const pos = geo.getAttribute("position");
    if (!pos || pos.count < 3) return [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    }
    if (!Number.isFinite(minX) || !(maxX > minX) || !(maxY > minY)) return [];

    let cell = cellMm;
    const pad = 2;
    let gw = Math.ceil((maxX - minX) / cell) + 1 + pad * 2;
    let gh = Math.ceil((maxY - minY) / cell) + 1 + pad * 2;
    if (gw * gh > 900_000) {
        const scale = Math.sqrt((gw * gh) / 900_000);
        cell *= scale;
        gw = Math.ceil((maxX - minX) / cell) + 1 + pad * 2;
        gh = Math.ceil((maxY - minY) / cell) + 1 + pad * 2;
    }
    const originX = minX - pad * cell;
    const originY = minY - pad * cell;
    const mask = new Uint8Array(gw * gh);
    const index = geo.getIndex();
    const triCount = index ? Math.floor(index.count / 3) : Math.floor(pos.count / 3);
    const vert = (slot: number): [number, number] => {
        const i = index ? index.getX(slot) : slot;
        return [pos.getX(i), pos.getY(i)];
    };
    for (let t = 0; t < triCount; t++) {
        const [ax, ay] = vert(t * 3);
        const [bx, by] = vert(t * 3 + 1);
        const [cx, cy] = vert(t * 3 + 2);
        rasterTriangle(mask, gw, gh, originX, originY, cell, ax, ay, bx, by, cx, cy);
    }
    const loop = longestMarchingLoop(mask, gw, gh);
    return loop.map((p) => ({ x: originX + p.x * cell, y: originY + p.y * cell }));
}

export function pointInPolygon(x: number, y: number, poly: readonly OutlinePoint[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const pi = poly[i];
        const pj = poly[j];
        if (!pi || !pj) continue;
        const crosses = pi.y > y !== pj.y > y;
        if (!crosses) continue;
        const xAt = ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y) + pi.x;
        if (x < xAt) inside = !inside;
    }
    return inside;
}

function rasterTriangle(
    mask: Uint8Array,
    gw: number,
    gh: number,
    originX: number,
    originY: number,
    cell: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
): void {
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-8) return;
    const minWX = Math.min(ax, bx, cx);
    const maxWX = Math.max(ax, bx, cx);
    const minWY = Math.min(ay, by, cy);
    const maxWY = Math.max(ay, by, cy);
    let i0 = Math.floor((minWX - originX) / cell);
    let i1 = Math.floor((maxWX - originX) / cell);
    let j0 = Math.floor((minWY - originY) / cell);
    let j1 = Math.floor((maxWY - originY) / cell);
    if (i0 < 0) i0 = 0;
    if (j0 < 0) j0 = 0;
    if (i1 >= gw) i1 = gw - 1;
    if (j1 >= gh) j1 = gh - 1;
    for (let j = j0; j <= j1; j++) {
        const cy0 = originY + (j + 0.5) * cell;
        const row = j * gw;
        for (let i = i0; i <= i1; i++) {
            const cx0 = originX + (i + 0.5) * cell;
            const w0 = (bx - cx0) * (cy - cy0) - (cx - cx0) * (by - cy0);
            const w1 = (cx - cx0) * (ay - cy0) - (ax - cx0) * (cy - cy0);
            const w2 = (ax - cx0) * (by - cy0) - (bx - cx0) * (ay - cy0);
            const inside = area > 0 ? w0 >= 0 && w1 >= 0 && w2 >= 0 : w0 <= 0 && w1 <= 0 && w2 <= 0;
            if (inside) mask[row + i] = 1;
        }
    }
}

/** code → pairs of edges (0 top, 1 right, 2 bottom, 3 left) on cell (i, j). */
const MARCH: readonly (readonly (readonly [number, number])[])[] = [
    [],
    [[3, 0]],
    [[0, 1]],
    [[3, 1]],
    [[1, 2]],
    [
        [3, 0],
        [1, 2],
    ],
    [[0, 2]],
    [[3, 2]],
    [[2, 3]],
    [[0, 2]],
    [
        [0, 1],
        [2, 3],
    ],
    [[1, 2]],
    [[1, 3]],
    [[0, 1]],
    [[3, 0]],
    [],
];

function edgePoint(edge: number, i: number, j: number): [number, number] {
    if (edge === 0) return [i + 0.5, j];
    if (edge === 1) return [i + 1, j + 0.5];
    if (edge === 2) return [i + 0.5, j + 1];
    return [i, j + 0.5];
}

function keyOf(x: number, y: number): string {
    return `${Math.round(x * 2)},${Math.round(y * 2)}`;
}

function longestMarchingLoop(mask: Uint8Array, gw: number, gh: number): OutlinePoint[] {
    const adj = new Map<string, OutlinePoint[]>();
    const add = (a: OutlinePoint, b: OutlinePoint) => {
        const ka = keyOf(a.x, a.y);
        const kb = keyOf(b.x, b.y);
        if (ka === kb) return;
        const la = adj.get(ka);
        if (la) la.push(b);
        else adj.set(ka, [b]);
        const lb = adj.get(kb);
        if (lb) lb.push(a);
        else adj.set(kb, [a]);
    };
    const sample = (i: number, j: number) => {
        if (i < 0 || j < 0 || i >= gw || j >= gh) return 0;
        return mask[j * gw + i] ? 1 : 0;
    };
    for (let j = -1; j < gh; j++) {
        for (let i = -1; i < gw; i++) {
            const code =
                sample(i, j) |
                (sample(i + 1, j) << 1) |
                (sample(i + 1, j + 1) << 2) |
                (sample(i, j + 1) << 3);
            const pairs = MARCH[code] ?? [];
            for (const pair of pairs) {
                const e0 = pair[0];
                const e1 = pair[1];
                const [x0, y0] = edgePoint(e0, i, j);
                const [x1, y1] = edgePoint(e1, i, j);
                add({ x: x0, y: y0 }, { x: x1, y: y1 });
            }
        }
    }
    let best: OutlinePoint[] = [];
    const used = new Set<string>();
    for (const start of adj.keys()) {
        const nbrs = adj.get(start);
        const first = nbrs?.[0];
        if (!first) continue;
        const edgeKey = `${start}>${keyOf(first.x, first.y)}`;
        if (used.has(edgeKey)) continue;
        const loop: OutlinePoint[] = [];
        let prev = "";
        let cur = start;
        for (let step = 0; step < adj.size + 2; step++) {
            const opts = adj.get(cur);
            if (!opts) break;
            const nxt = opts.find((p) => keyOf(p.x, p.y) !== prev);
            if (!nxt) break;
            const nk = keyOf(nxt.x, nxt.y);
            used.add(`${cur}>${nk}`);
            used.add(`${nk}>${cur}`);
            if (nk === start) {
                const [sx, sy] = start.split(",").map(Number);
                loop.push({ x: (sx ?? 0) / 2, y: (sy ?? 0) / 2 });
                break;
            }
            loop.push(nxt);
            prev = cur;
            cur = nk;
        }
        if (loop.length > best.length) best = loop;
    }
    return best;
}
