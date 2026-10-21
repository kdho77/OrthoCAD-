// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import { minDistToLoopXY, pointInPoly } from "@/lib/geometry/procedural-wall/cdt-band";
import type { PolyPoint } from "@/lib/geometry/procedural-wall/curves";
import {
    isSideText,
    TEXT_FEATURE_CORNER_DEG,
    TEXT_HOST_SMOOTH_DIHEDRAL_DEG,
    TEXT_REGION_PAD_MM,
} from "./constants";
import { createOuterWallSampler, extractHostTextContext, stationsForSurface } from "./place";
import type { TextApplyMeta } from "./types";

export interface Vert3 {
    x: number;
    y: number;
    z: number;
}

export interface TextRegionQuality {
    triCount: number;
    outsideVertMaxMm: number;
    outsideHostVertsMissing: number;
    outsideTrisLost: number;
    inRegion: {
        count: number;
        pctMinAngleGe5: number;
        minAngleMinDeg: number;
        aspectP99: number;
        aspectMax: number;
        /** Longest floor / cap edge (gate 0.6 mm). */
        longestEdgeMm: number;
        /** Longest wall edge. Quad diagonals may reach 0.6·√2. */
        longestWallEdgeMm: number;
    };
    floor: {
        count: number;
        depthAbsMaxMm: number;
        depthStdMm: number;
        depthMeanMm: number;
    };
    sidewall: {
        count: number;
        pctDotLe01: number;
    };
    dihedral: {
        /** Non-feature edges only. Edges across a tagged glyph corner are excluded. */
        floorFloorMaxDeg: number;
        wallWallMaxDeg: number;
        /** Reported, not gated. Max dihedral of edges that cross a glyph corner. */
        featureFloorFloorMaxDeg: number;
        featureWallWallMaxDeg: number;
        /** Reported, not gated. Floor/wall and wall/insole rim dihedral. */
        featureRimMaxDeg: number;
        floorFloorAt: { x: number; y: number; z: number } | null;
        wallWallAt: { x: number; y: number; z: number } | null;
        /** Floor-floor dihedral that sits on an existing insole crease. Logged, not gated. */
        floorFloorCreaseDeg: number;
        floorFloorCreaseHostDeg: number;
        floorFloorCreaseAt: { x: number; y: number; z: number } | null;
        /** Non-feature edges still over 10°. Capped list plus the full count. */
        nonFeatureOver10: Array<{
            kind: "floor" | "wall";
            deg: number;
            at: { x: number; y: number; z: number };
            hostCreaseDeg: number;
        }>;
        nonFeatureOver10Count: number;
    };
    outline: {
        hausdorffMm: number;
        extraTurnGt30: number;
    };
}

function triCountOf(geo: BufferGeometry): number {
    const index = geo.getIndex();
    const pos = geo.getAttribute("position");
    return index ? index.count / 3 : pos.count / 3;
}

function idxOf(geo: BufferGeometry, t: number, k: number): number {
    const index = geo.getIndex();
    return index ? index.getX(t * 3 + k) : t * 3 + k;
}

function vertOf(geo: BufferGeometry, i: number): Vert3 {
    const pos = geo.getAttribute("position");
    return { x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) };
}

function dist(a: Vert3, b: Vert3): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function sub(a: Vert3, b: Vert3): Vert3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a: Vert3, b: Vert3): Vert3 {
    return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function faceNormal(a: Vert3, b: Vert3, c: Vert3): Vert3 {
    const n = cross(sub(b, a), sub(c, a));
    const l = Math.hypot(n.x, n.y, n.z) || 1;
    return { x: n.x / l, y: n.y / l, z: n.z / l };
}

function minAngleDeg(a: Vert3, b: Vert3, c: Vert3): number {
    const lab = dist(a, b);
    const lac = dist(a, c);
    const lbc = dist(b, c);
    const ang = (opp: number, u: number, v: number) => {
        const den = 2 * u * v;
        if (den < 1e-18) return 0;
        const cos = Math.max(-1, Math.min(1, (u * u + v * v - opp * opp) / den));
        return (Math.acos(cos) * 180) / Math.PI;
    };
    return Math.min(ang(lbc, lab, lac), ang(lac, lab, lbc), ang(lab, lac, lbc));
}

function aspectOf(a: Vert3, b: Vert3, c: Vert3): number {
    const lab = dist(a, b);
    const lac = dist(a, c);
    const lbc = dist(b, c);
    const short = Math.min(lab, lac, lbc);
    const long = Math.max(lab, lac, lbc);
    return short < 1e-12 ? 1e6 : long / short;
}

function longestOf(a: Vert3, b: Vert3, c: Vert3): number {
    return Math.max(dist(a, b), dist(b, c), dist(c, a));
}

function percentile(sorted: number[], p: number): number {
    if (!sorted.length) return 0;
    const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[i]!;
}

function outlinePts(meta: TextApplyMeta): Vert3[] {
    const pts: Vert3[] = [];
    for (const g of meta.outlineWorld ?? []) {
        pts.push(...g.outer);
        for (const h of g.holes) pts.push(...h);
    }
    if (!pts.length) {
        for (const c of meta.centroids) pts.push({ x: c.x, y: c.y, z: c.z });
    }
    return pts;
}

function minDistToOutline(p: Vert3, outline: Vert3[]): number {
    let best = Infinity;
    for (const q of outline) {
        const d = dist(p, q);
        if (d < best) best = d;
    }
    return best;
}

function asPoly(pts: Vert3[]): PolyPoint[] {
    return pts.map((p) => ({ x: p.x, y: p.y, z: p.z }));
}

export function distToTextRegion(
    p: Vert3,
    meta: TextApplyMeta,
    outline: Vert3[],
    grid?: { nearest: (q: Vert3, maxMm: number) => number },
): number {
    const d3 = grid ? grid.nearest(p, 8) : minDistToOutline(p, outline);
    if (meta.surface !== "bottom") return d3;
    // Far from every outline sample: skip the O(loops) 2D walk.
    if (d3 > 8) return d3;
    let d2 = d3;
    for (const g of meta.outlineWorld ?? []) {
        const outer = asPoly(g.outer);
        if (outer.length >= 3) {
            if (pointInPoly(p.x, p.y, outer)) {
                let inHole = false;
                for (const h of g.holes) {
                    const hole = asPoly(h);
                    if (hole.length >= 3 && pointInPoly(p.x, p.y, hole)) {
                        inHole = true;
                        break;
                    }
                }
                if (!inHole) return 0;
            }
            d2 = Math.min(d2, minDistToLoopXY(p.x, p.y, outer));
        }
        for (const h of g.holes) {
            const hole = asPoly(h);
            if (hole.length >= 3) d2 = Math.min(d2, minDistToLoopXY(p.x, p.y, hole));
        }
    }
    return d2;
}

class VertGrid {
    private readonly cells = new Map<string, Vert3[]>();
    constructor(
        pts: Vert3[],
        readonly cell = 0.5,
    ) {
        for (const p of pts) {
            const k = this.key(p.x, p.y, p.z);
            const list = this.cells.get(k);
            if (list) list.push(p);
            else this.cells.set(k, [p]);
        }
    }
    private key(x: number, y: number, z: number): string {
        return `${Math.floor(x / this.cell)}|${Math.floor(y / this.cell)}|${Math.floor(z / this.cell)}`;
    }
    nearest(p: Vert3, maxMm: number): number {
        let best = Infinity;
        const r = Math.ceil(maxMm / this.cell);
        const ix = Math.floor(p.x / this.cell);
        const iy = Math.floor(p.y / this.cell);
        const iz = Math.floor(p.z / this.cell);
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                for (let dz = -r; dz <= r; dz++) {
                    const list = this.cells.get(`${ix + dx}|${iy + dy}|${iz + dz}`);
                    if (!list) continue;
                    for (const q of list) {
                        const d = dist(p, q);
                        if (d < best) best = d;
                    }
                }
            }
        }
        return best;
    }
}

function newellNormal(pts: Vert3[]): Vert3 {
    let x = 0;
    let y = 0;
    let z = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
        const a = pts[i]!;
        const b = pts[(i + 1) % n]!;
        x += (a.y - b.y) * (a.z + b.z);
        y += (a.z - b.z) * (a.x + b.x);
        z += (a.x - b.x) * (a.y + b.y);
    }
    const l = Math.hypot(x, y, z) || 1;
    return { x: x / l, y: y / l, z: z / l };
}

function basisFromN(n: Vert3): { r: Vert3; u: Vert3 } {
    let rx = -n.y;
    let ry = n.x;
    let rz = 0;
    let rl = Math.hypot(rx, ry, rz);
    if (rl < 1e-8) {
        rx = 0;
        ry = -n.z;
        rz = n.y;
        rl = Math.hypot(rx, ry, rz) || 1;
    }
    rx /= rl;
    ry /= rl;
    rz /= rl;
    const ux = n.y * rz - n.z * ry;
    const uy = n.z * rx - n.x * rz;
    const uz = n.x * ry - n.y * rx;
    const ul = Math.hypot(ux, uy, uz) || 1;
    return { r: { x: rx, y: ry, z: rz }, u: { x: ux / ul, y: uy / ul, z: uz / ul } };
}

function rasterLoops(
    glyphs: Array<{ outer: PolyPoint[]; holes: PolyPoint[][] }>,
    cell: number,
    padMm: number,
): { dist: (x: number, y: number) => number } {
    const keys = new Set<string>();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const thin = (pts: PolyPoint[]): PolyPoint[] => {
        const out: PolyPoint[] = [];
        for (const p of pts) {
            const prev = out[out.length - 1];
            if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < 0.4) continue;
            out.push(p);
        }
        return out.length >= 3 ? out : pts;
    };
    const thinned: Array<{ outer: PolyPoint[]; holes: PolyPoint[][] }> = [];
    for (const g of glyphs) {
        const outer = thin(g.outer);
        if (outer.length < 3) continue;
        const holes = g.holes.map((h) => thin(h)).filter((h) => h.length >= 3);
        thinned.push({ outer, holes });
        for (const p of outer) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        }
    }
    if (!thinned.length || !Number.isFinite(minX)) {
        return { dist: () => 99 };
    }
    minX -= 1 + padMm;
    minY -= 1 + padMm;
    maxX += 1 + padMm;
    maxY += 1 + padMm;
    const key = (ix: number, iy: number) => `${ix}|${iy}`;
    const ix0 = Math.floor(minX / cell);
    const iy0 = Math.floor(minY / cell);
    const ix1 = Math.floor(maxX / cell);
    const iy1 = Math.floor(maxY / cell);
    if (ix1 - ix0 > 500 || iy1 - iy0 > 500) {
        return { dist: () => 99 };
    }
    for (let iy = iy0; iy <= iy1; iy++) {
        for (let ix = ix0; ix <= ix1; ix++) {
            const x = (ix + 0.5) * cell;
            const y = (iy + 0.5) * cell;
            for (const g of thinned) {
                if (!pointInPoly(x, y, g.outer)) continue;
                let inHole = false;
                for (const h of g.holes) {
                    if (pointInPoly(x, y, h)) {
                        inHole = true;
                        break;
                    }
                }
                if (!inHole) {
                    keys.add(key(ix, iy));
                    break;
                }
            }
        }
    }
    const dilate = Math.max(1, Math.ceil(padMm / cell));
    if (dilate > 0 && keys.size) {
        const grown = new Set<string>();
        for (const k of keys) {
            const sep = k.indexOf("|");
            const ix = Number(k.slice(0, sep));
            const iy = Number(k.slice(sep + 1));
            for (let dy = -dilate; dy <= dilate; dy++) {
                for (let dx = -dilate; dx <= dilate; dx++) {
                    if (dx * dx + dy * dy > dilate * dilate) continue;
                    grown.add(key(ix + dx, iy + dy));
                }
            }
        }
        for (const k of grown) keys.add(k);
    }
    const ring = Math.max(3, dilate + 2);
    return {
        dist: (x: number, y: number) => {
            if (x < minX || x > maxX || y < minY || y > maxY) {
                return Math.hypot(Math.max(0, minX - x, x - maxX), Math.max(0, minY - y, y - maxY)) + 1;
            }
            const ix = Math.floor(x / cell);
            const iy = Math.floor(y / cell);
            if (keys.has(key(ix, iy))) return 0;
            let best = padMm + 1;
            for (let dy = -ring; dy <= ring; dy++) {
                for (let dx = -ring; dx <= ring; dx++) {
                    if (!keys.has(key(ix + dx, iy + dy))) continue;
                    const cx = (ix + dx + 0.5) * cell;
                    const cy = (iy + dy + 0.5) * cell;
                    const d = Math.hypot(x - cx, y - cy);
                    if (d < best) best = d;
                }
            }
            return best;
        },
    };
}

function rasterBottomGlyphs(
    meta: TextApplyMeta,
    cell: number,
    padMm: number,
): { dist: (x: number, y: number) => number } {
    const glyphs: Array<{ outer: PolyPoint[]; holes: PolyPoint[][] }> = [];
    for (const g of meta.outlineWorld ?? []) {
        glyphs.push({ outer: asPoly(g.outer), holes: g.holes.map((h) => asPoly(h)) });
    }
    return rasterLoops(glyphs, cell, padMm);
}

function rasterWallGlyphs(meta: TextApplyMeta, cell: number, padMm: number): { dist2: (p: Vert3) => number } {
    const frames: Array<{
        origin: Vert3;
        r: Vert3;
        u: Vert3;
        dist: (x: number, y: number) => number;
    }> = [];
    for (const g of meta.outlineWorld ?? []) {
        if (g.outer.length < 3) continue;
        const n = newellNormal(g.outer);
        const { r, u } = basisFromN(n);
        const origin = g.outer[0]!;
        const toUV = (p: Vert3): PolyPoint => ({
            x: (p.x - origin.x) * r.x + (p.y - origin.y) * r.y + (p.z - origin.z) * r.z,
            y: (p.x - origin.x) * u.x + (p.y - origin.y) * u.y + (p.z - origin.z) * u.z,
            z: 0,
        });
        const raster = rasterLoops(
            [{ outer: g.outer.map(toUV), holes: g.holes.map((h) => h.map(toUV)) }],
            cell,
            padMm,
        );
        frames.push({ origin, r, u, dist: raster.dist });
    }
    return {
        dist2: (p: Vert3) => {
            let best = 99;
            for (const f of frames) {
                const x =
                    (p.x - f.origin.x) * f.r.x + (p.y - f.origin.y) * f.r.y + (p.z - f.origin.z) * f.r.z;
                const y =
                    (p.x - f.origin.x) * f.u.x + (p.y - f.origin.y) * f.u.y + (p.z - f.origin.z) * f.u.z;
                const d = f.dist(x, y);
                if (d < best) best = d;
            }
            return best;
        },
    };
}

function allVerts(geo: BufferGeometry): Vert3[] {
    const pos = geo.getAttribute("position");
    const out: Vert3[] = [];
    for (let i = 0; i < pos.count; i++) out.push({ x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) });
    return out;
}

function meanNOut(meta: TextApplyMeta): Vert3 {
    let x = 0;
    let y = 0;
    let z = 0;
    let n = 0;
    for (const c of meta.centroids) {
        if (!c.nOut) continue;
        x += c.nOut.x;
        y += c.nOut.y;
        z += c.nOut.z;
        n++;
    }
    if (!n) return { x: 0, y: 0, z: 1 };
    const l = Math.hypot(x, y, z) || 1;
    return { x: x / l, y: y / l, z: z / l };
}

function nearestNOut(p: Vert3, meta: TextApplyMeta, fallback: Vert3): Vert3 {
    let best = fallback;
    let bestD = Infinity;
    for (const c of meta.centroids) {
        if (!c.nOut) continue;
        const d = dist(p, { x: c.x, y: c.y, z: c.z });
        if (d < bestD) {
            bestD = d;
            best = c.nOut;
        }
    }
    const l = Math.hypot(best.x, best.y, best.z) || 1;
    return { x: best.x / l, y: best.y / l, z: best.z / l };
}

function dihedralDeg(n0: Vert3, n1: Vert3): number {
    const c = Math.max(-1, Math.min(1, n0.x * n1.x + n0.y * n1.y + n0.z * n1.z));
    return (Math.acos(c) * 180) / Math.PI;
}

function turningDeg(a: Vert3, b: Vert3, c: Vert3): number {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const bcx = c.x - b.x;
    const bcy = c.y - b.y;
    const bcz = c.z - b.z;
    const lab = Math.hypot(abx, aby, abz);
    const lbc = Math.hypot(bcx, bcy, bcz);
    if (lab < 1e-9 || lbc < 1e-9) return 0;
    const cos = Math.max(-1, Math.min(1, (abx * bcx + aby * bcy + abz * bcz) / (lab * lbc)));
    return (Math.acos(cos) * 180) / Math.PI;
}

function fontCorners(loops: Array<Array<Vert3>>, thresh = TEXT_FEATURE_CORNER_DEG): Vert3[] {
    const corners: Vert3[] = [];
    for (const loop of loops) {
        const n = loop.length;
        if (n < 3) continue;
        for (let i = 0; i < n; i++) {
            const a = loop[(i - 1 + n) % n]!;
            const b = loop[i]!;
            const c = loop[(i + 1) % n]!;
            if (turningDeg(a, b, c) >= thresh) corners.push(b);
        }
    }
    return corners;
}

function chainBoundary(edges: Array<[Vert3, Vert3]>): Array<Vert3[]> {
    const key = (p: Vert3) => `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`;
    const adj = new Map<string, Vert3[]>();
    const point = new Map<string, Vert3>();
    const add = (a: Vert3, b: Vert3) => {
        const ka = key(a);
        point.set(ka, a);
        const list = adj.get(ka);
        if (list) list.push(b);
        else adj.set(ka, [b]);
    };
    for (const [a, b] of edges) {
        add(a, b);
        add(b, a);
    }
    const used = new Set<string>();
    const loops: Array<Vert3[]> = [];
    for (const [ka, a] of point) {
        if (used.has(ka)) continue;
        const loop: Vert3[] = [a];
        used.add(ka);
        let cur = a;
        for (let step = 0; step < edges.length + 2; step++) {
            const nbrs = adj.get(key(cur)) ?? [];
            let next: Vert3 | null = null;
            for (const n of nbrs) {
                const kn = key(n);
                if (used.has(kn)) continue;
                next = n;
                break;
            }
            if (!next) break;
            loop.push(next);
            used.add(key(next));
            cur = next;
        }
        if (loop.length >= 3) loops.push(loop);
    }
    return loops;
}

function stddev(xs: number[]): number {
    if (xs.length < 2) return 0;
    const m = xs.reduce((s, v) => s + v, 0) / xs.length;
    let v = 0;
    for (const x of xs) v += (x - m) ** 2;
    return Math.sqrt(v / xs.length);
}

function hostSmoothEdgeGrid(host: BufferGeometry): {
    dihedralAt: (a: Vert3, b: Vert3) => number;
} {
    const pos = host.getAttribute("position");
    const index = host.getIndex();
    const empty = { dihedralAt: () => 0 };
    if (!pos || !index) return empty;
    const edgeN = new Map<string, Vert3>();
    const mids: Array<{ p: Vert3; deg: number }> = [];
    const edgeKey = (u: number, v: number) => (u < v ? `${u}|${v}` : `${v}|${u}`);
    const nTri = index.count / 3;
    for (let t = 0; t < nTri; t++) {
        const ia = index.getX(t * 3);
        const ib = index.getX(t * 3 + 1);
        const ic = index.getX(t * 3 + 2);
        const a = vertOf(host, ia);
        const b = vertOf(host, ib);
        const c = vertOf(host, ic);
        const n = faceNormal(a, b, c);
        const push = (u: number, v: number) => {
            const k = edgeKey(u, v);
            const prev = edgeN.get(k);
            if (prev) {
                const d = dihedralDeg(prev, n);
                const pu = vertOf(host, u);
                const pv = vertOf(host, v);
                mids.push({
                    p: { x: (pu.x + pv.x) * 0.5, y: (pu.y + pv.y) * 0.5, z: (pu.z + pv.z) * 0.5 },
                    deg: d,
                });
            } else edgeN.set(k, n);
        };
        push(ia, ib);
        push(ib, ic);
        push(ic, ia);
    }
    // 0.4 mm cells. A crease in the next cell is still within the 0.6 mm query.
    const cell = 0.4;
    const reach = 0.6;
    const buckets = new Map<string, Array<{ p: Vert3; deg: number }>>();
    const keyOf = (x: number, y: number, z: number) =>
        `${Math.floor(x / cell)}|${Math.floor(y / cell)}|${Math.floor(z / cell)}`;
    for (const m of mids) {
        const k = keyOf(m.p.x, m.p.y, m.p.z);
        const list = buckets.get(k);
        if (list) list.push(m);
        else buckets.set(k, [m]);
    }
    const r = Math.ceil(reach / cell);
    return {
        dihedralAt: (a, b) => {
            const mx = (a.x + b.x) * 0.5;
            const my = (a.y + b.y) * 0.5;
            const mz = (a.z + b.z) * 0.5;
            const ix = Math.floor(mx / cell);
            const iy = Math.floor(my / cell);
            const iz = Math.floor(mz / cell);
            let best = 0;
            for (let dx = -r; dx <= r; dx++) {
                for (let dy = -r; dy <= r; dy++) {
                    for (let dz = -r; dz <= r; dz++) {
                        const list = buckets.get(`${ix + dx}|${iy + dy}|${iz + dz}`);
                        if (!list) continue;
                        for (const m of list) {
                            if (m.deg <= best) continue;
                            const d = Math.hypot(m.p.x - mx, m.p.y - my, m.p.z - mz);
                            if (d <= reach) best = m.deg;
                        }
                    }
                }
            }
            return best;
        },
    };
}

function hausdorff(a: Vert3[], b: Vert3[]): number {
    const gb = new VertGrid(b, 0.4);
    const ga = new VertGrid(a, 0.4);
    let max = 0;
    for (const p of a) max = Math.max(max, gb.nearest(p, 3));
    for (const p of b) max = Math.max(max, ga.nearest(p, 3));
    return Number.isFinite(max) ? max : 99;
}

/** Quality of the exported marked STL vs the pre-boolean host. */
export function measureTextRegionQuality(
    result: BufferGeometry,
    host: BufferGeometry,
    meta: TextApplyMeta,
    padMm = TEXT_REGION_PAD_MM,
): TextRegionQuality {
    const outline = outlinePts(meta);
    const outlineGrid = new VertGrid(outline, 0.3);
    const setDepth = meta.mode === "engrave" ? meta.depthMm : meta.heightMm;
    const bottomOcc = meta.surface === "bottom" ? rasterBottomGlyphs(meta, 0.4, padMm) : null;
    const wallOcc = isSideText(meta.surface) ? rasterWallGlyphs(meta, 0.4, padMm) : null;
    const near = (p: Vert3) => {
        if (meta.surface === "bottom" && bottomOcc) return bottomOcc.dist(p.x, p.y);
        if (isSideText(meta.surface) && wallOcc) {
            const d = wallOcc.dist2(p);
            if (d < 50) return d;
            return outlineGrid.nearest(p, padMm + setDepth + 0.6);
        }
        return outlineGrid.nearest(p, padMm + 0.6);
    };
    const wallN0 = meanNOut(meta);
    const resultVerts = allVerts(result);
    const hostVerts = allVerts(host);
    const resultGrid = new VertGrid(resultVerts, 0.25);
    const hostN = triCountOf(host);
    const resN = triCountOf(result);

    const hostOutsideVerts: Vert3[] = [];
    for (const v of hostVerts) {
        if (near(v) > padMm) hostOutsideVerts.push(v);
    }
    let outsideVertMax = 0;
    let missing = 0;
    for (const v of hostOutsideVerts) {
        const d = resultGrid.nearest(v, 0.5);
        if (!Number.isFinite(d) || d > 0.5) missing++;
        else if (d > outsideVertMax) outsideVertMax = d;
    }

    let hostOutsideTris = 0;
    for (let t = 0; t < hostN; t++) {
        const a = vertOf(host, idxOf(host, t, 0));
        const b = vertOf(host, idxOf(host, t, 1));
        const c = vertOf(host, idxOf(host, t, 2));
        if (near(a) > padMm && near(b) > padMm && near(c) > padMm) {
            hostOutsideTris++;
        }
    }
    const rawTags = (result.userData as { faceClass?: unknown } | undefined)?.faceClass;
    const faceTags: number[] | null = Array.isArray(rawTags)
        ? (rawTags as number[])
        : rawTags instanceof Uint8Array
          ? Array.from(rawTags)
          : null;
    const useTags = faceTags != null && faceTags.length === resN && faceTags.some((v) => v === 1 || v === 2);
    const tagged = (t: number) => useTags && ((faceTags?.[t] ?? 0) === 1 || (faceTags?.[t] ?? 0) === 2);
    let resultOutsideTris = 0;
    const inRegion: Array<{ a: Vert3; b: Vert3; c: Vert3; n: Vert3; i: number }> = [];
    for (let t = 0; t < resN; t++) {
        const a = vertOf(result, idxOf(result, t, 0));
        const b = vertOf(result, idxOf(result, t, 1));
        const c = vertOf(result, idxOf(result, t, 2));
        if (near(a) > padMm && near(b) > padMm && near(c) > padMm && !tagged(t)) {
            resultOutsideTris++;
            continue;
        }
        inRegion.push({ a, b, c, n: faceNormal(a, b, c), i: t });
    }

    const hostCtx = extractHostTextContext(host);
    const run = isSideText(meta.surface) ? stationsForSurface(hostCtx, meta.surface) : [];
    const sampler = run.length >= 2 ? createOuterWallSampler(host, run) : null;
    const floors: typeof inRegion = [];
    const walls: typeof inRegion = [];
    for (const tri of inRegion) {
        if (useTags) {
            const cls = faceTags?.[tri.i] ?? 0;
            if (cls === 1) floors.push(tri);
            else if (cls === 2) walls.push(tri);
            continue;
        }
        const c = {
            x: (tri.a.x + tri.b.x + tri.c.x) / 3,
            y: (tri.a.y + tri.b.y + tri.c.y) / 3,
            z: (tri.a.z + tri.b.z + tri.c.z) / 3,
        };
        const nOut = nearestNOut(c, meta, wallN0);
        const signedN = tri.n.x * nOut.x + tri.n.y * nOut.y + tri.n.z * nOut.z;
        const dot = Math.abs(signedN);
        if (dot >= 0.7) {
            if (meta.surface === "bottom") {
                if (Math.abs(c.z - setDepth) <= 0.08 && near(c) <= padMm) {
                    floors.push(tri);
                }
            } else if (sampler) {
                const along = sampler.alongOut(c, nOut);
                if (along != null && Math.abs(Math.abs(along) - setDepth) <= 0.08 && near(c) <= padMm) {
                    floors.push(tri);
                }
            } else if (near(c) <= padMm) {
                floors.push(tri);
            }
        } else if (dot <= 0.35 && near(c) <= padMm) {
            if (meta.surface === "bottom") {
                if (c.z > 0.15 && c.z < setDepth - 0.1) walls.push(tri);
            } else if (sampler) {
                const along = sampler.alongOut(c, nOut);
                if (along != null && Math.abs(along) > 0.08 && Math.abs(along) < setDepth - 0.08)
                    walls.push(tri);
            } else {
                walls.push(tri);
            }
        }
    }

    const feature = floors.concat(walls);
    const aspects: number[] = [];
    let longestFloor = 0;
    let longestWall = 0;
    let ge5 = 0;
    let minAngMin = 180;
    for (const tri of floors) {
        const ang = minAngleDeg(tri.a, tri.b, tri.c);
        if (ang >= 5) ge5++;
        if (ang < minAngMin) minAngMin = ang;
        aspects.push(aspectOf(tri.a, tri.b, tri.c));
        longestFloor = Math.max(longestFloor, longestOf(tri.a, tri.b, tri.c));
    }
    for (const tri of walls) {
        const ang = minAngleDeg(tri.a, tri.b, tri.c);
        if (ang >= 5) ge5++;
        if (ang < minAngMin) minAngMin = ang;
        aspects.push(aspectOf(tri.a, tri.b, tri.c));
        longestWall = Math.max(longestWall, longestOf(tri.a, tri.b, tri.c));
    }

    const depths: number[] = [];
    if (isSideText(meta.surface) && sampler) {
        for (const tri of floors) {
            const nOut = nearestNOut(
                {
                    x: (tri.a.x + tri.b.x + tri.c.x) / 3,
                    y: (tri.a.y + tri.b.y + tri.c.y) / 3,
                    z: (tri.a.z + tri.b.z + tri.c.z) / 3,
                },
                meta,
                wallN0,
            );
            for (const v of [tri.a, tri.b, tri.c]) {
                const along = sampler.alongOut(v, nOut);
                if (along == null) continue;
                depths.push(Math.abs(along));
            }
        }
    } else {
        for (const tri of floors) {
            for (const v of [tri.a, tri.b, tri.c]) depths.push(v.z);
        }
    }
    const depthErr = depths.map((d) => d - setDepth);
    const depthAbsMax = depthErr.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    const depthMean = depths.length ? depths.reduce((s, v) => s + v, 0) / depths.length : 0;

    let sideOk = 0;
    for (const tri of walls) {
        const c = {
            x: (tri.a.x + tri.b.x + tri.c.x) / 3,
            y: (tri.a.y + tri.b.y + tri.c.y) / 3,
            z: (tri.a.z + tri.b.z + tri.c.z) / 3,
        };
        const nOut = nearestNOut(c, meta, wallN0);
        const dot = Math.abs(tri.n.x * nOut.x + tri.n.y * nOut.y + tri.n.z * nOut.z);
        if (dot <= 0.1) sideOk++;
    }

    const edgeKey = (u: number, v: number) => (u < v ? `${u}|${v}` : `${v}|${u}`);
    const floorEdges = new Map<string, { count: number; n: Vert3; a: Vert3; b: Vert3 }>();
    const pushEdge = (
        map: Map<string, { count: number; n: Vert3; a: Vert3; b: Vert3 }>,
        ia: number,
        ib: number,
        n: Vert3,
        pa: Vert3,
        pb: Vert3,
    ) => {
        const k = edgeKey(ia, ib);
        const prev = map.get(k);
        if (prev) prev.count++;
        else map.set(k, { count: 1, n, a: pa, b: pb });
    };
    const hostEdges = hostSmoothEdgeGrid(host);
    const adjFloor: Array<[Vert3, Vert3]> = [];
    const floorSide: Array<[Vert3, Vert3]> = [];
    const wallEdgeKeys = new Set<string>();
    let floorFloorMax = 0;
    let wallWallMax = 0;
    let featureFloorFloorMax = 0;
    let featureWallWallMax = 0;
    const outlineLoops: Array<Array<Vert3>> = [];
    for (const g of meta.outlineWorld ?? []) {
        outlineLoops.push(g.outer);
        outlineLoops.push(...g.holes);
    }
    const outlineAllEarly = outlineLoops.flat();
    const cornersEarly = fontCorners(outlineLoops);
    const cornerGridEarly = cornersEarly.length ? new VertGrid(cornersEarly, 0.25) : null;
    const cornerSamples: Vert3[] = [];
    for (const c of cornersEarly) {
        cornerSamples.push(c);
        const n = nearestNOut(c, meta, wallN0);
        cornerSamples.push({
            x: c.x + n.x * setDepth,
            y: c.y + n.y * setDepth,
            z: c.z + n.z * setDepth,
        });
        cornerSamples.push({
            x: c.x - n.x * setDepth,
            y: c.y - n.y * setDepth,
            z: c.z - n.z * setDepth,
        });
    }
    const featureCornerGrid = cornerSamples.length ? new VertGrid(cornerSamples, 0.25) : null;
    const isCornerVert = (p: Vert3): boolean =>
        featureCornerGrid != null && featureCornerGrid.nearest(p, 0.35) <= 0.35;
    // (a) both ends are glyph-corner samples (vertical wall corners).
    // (c) dihedral ≥ 60° and the edge touches a glyph-corner sample.
    // Rims are recorded separately.
    const isFeatureEdge = (pa: Vert3, pb: Vert3, deg: number): boolean => {
        const ca = isCornerVert(pa);
        const cb = isCornerVert(pb);
        if (ca && cb) return true;
        return deg >= 60 && (ca || cb);
    };
    let featureRimMax = 0;
    let floorFloorAt: Vert3 | null = null;
    let wallWallAt: Vert3 | null = null;
    let floorFloorCreaseDeg = 0;
    let floorFloorCreaseHostDeg = 0;
    let floorFloorCreaseAt: Vert3 | null = null;
    const nonFeatureOver10: TextRegionQuality["dihedral"]["nonFeatureOver10"] = [];
    let nonFeatureOver10Count = 0;
    const noteOver10 = (kind: "floor" | "wall", deg: number, mid: Vert3, hostCreaseDeg: number) => {
        if (deg <= 10) return;
        nonFeatureOver10Count++;
        if (nonFeatureOver10.length < 12) nonFeatureOver10.push({ kind, deg, at: mid, hostCreaseDeg });
    };
    const crease = (
        store: Map<string, { n: Vert3; c: Vert3 }>,
        ia: number,
        ib: number,
        n: Vert3,
        centroid: Vert3,
        update: (deg: number, mid: Vert3) => void,
    ) => {
        const k = edgeKey(ia, ib);
        const prev = store.get(k);
        const pa = vertOf(result, ia);
        const pb = vertOf(result, ib);
        const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2, z: (pa.z + pb.z) / 2 };
        if (prev) {
            const d = dihedralDeg(prev.n, n);
            // Opposite-orientation pairs are leftover sheets, not a crease.
            if (d <= 90) update(d, mid);
        } else store.set(k, { n, c: centroid });
    };
    const seenFC = new Map<string, { n: Vert3; c: Vert3 }>();
    const seenWC = new Map<string, { n: Vert3; c: Vert3 }>();
    for (const tri of floors) {
        const ia = idxOf(result, tri.i, 0);
        const ib = idxOf(result, tri.i, 1);
        const ic = idxOf(result, tri.i, 2);
        const centroid = {
            x: (tri.a.x + tri.b.x + tri.c.x) / 3,
            y: (tri.a.y + tri.b.y + tri.c.y) / 3,
            z: (tri.a.z + tri.b.z + tri.c.z) / 3,
        };
        const noteFloor = (d: number, mid: Vert3, pa: Vert3, pb: Vert3) => {
            if (isFeatureEdge(pa, pb, d)) {
                if (d > featureFloorFloorMax) featureFloorFloorMax = d;
                return;
            }
            const hostD = hostEdges.dihedralAt(pa, pb);
            if (hostD > TEXT_HOST_SMOOTH_DIHEDRAL_DEG) {
                if (d > floorFloorCreaseDeg) {
                    floorFloorCreaseDeg = d;
                    floorFloorCreaseHostDeg = hostD;
                    floorFloorCreaseAt = mid;
                }
                return;
            }
            if (d > floorFloorMax) {
                floorFloorMax = d;
                floorFloorAt = mid;
            }
            noteOver10("floor", d, mid, hostD);
        };
        crease(seenFC, ia, ib, tri.n, centroid, (d, mid) => {
            noteFloor(d, mid, vertOf(result, ia), vertOf(result, ib));
        });
        crease(seenFC, ib, ic, tri.n, centroid, (d, mid) => {
            noteFloor(d, mid, vertOf(result, ib), vertOf(result, ic));
        });
        crease(seenFC, ic, ia, tri.n, centroid, (d, mid) => {
            noteFloor(d, mid, vertOf(result, ic), vertOf(result, ia));
        });
        pushEdge(floorEdges, ia, ib, tri.n, tri.a, tri.b);
        pushEdge(floorEdges, ib, ic, tri.n, tri.b, tri.c);
        pushEdge(floorEdges, ic, ia, tri.n, tri.c, tri.a);
    }
    for (const tri of walls) {
        const ia = idxOf(result, tri.i, 0);
        const ib = idxOf(result, tri.i, 1);
        const ic = idxOf(result, tri.i, 2);
        wallEdgeKeys.add(edgeKey(ia, ib));
        wallEdgeKeys.add(edgeKey(ib, ic));
        wallEdgeKeys.add(edgeKey(ic, ia));
        const centroid = {
            x: (tri.a.x + tri.b.x + tri.c.x) / 3,
            y: (tri.a.y + tri.b.y + tri.c.y) / 3,
            z: (tri.a.z + tri.b.z + tri.c.z) / 3,
        };
        const noteWall = (d: number, mid: Vert3, pa: Vert3, pb: Vert3) => {
            if (isFeatureEdge(pa, pb, d)) {
                if (d > featureWallWallMax) featureWallWallMax = d;
                return;
            }
            const hostD = hostEdges.dihedralAt(pa, pb);
            if (hostD > TEXT_HOST_SMOOTH_DIHEDRAL_DEG) return;
            if (d > wallWallMax) {
                wallWallMax = d;
                wallWallAt = mid;
            }
            noteOver10("wall", d, mid, hostD);
        };
        crease(seenWC, ia, ib, tri.n, centroid, (d, mid) => {
            noteWall(d, mid, vertOf(result, ia), vertOf(result, ib));
        });
        crease(seenWC, ib, ic, tri.n, centroid, (d, mid) => {
            noteWall(d, mid, vertOf(result, ib), vertOf(result, ic));
        });
        crease(seenWC, ic, ia, tri.n, centroid, (d, mid) => {
            noteWall(d, mid, vertOf(result, ic), vertOf(result, ia));
        });
    }
    const triClass = new Uint8Array(resN);
    if (useTags && faceTags) {
        for (let t = 0; t < resN; t++) triClass[t] = faceTags[t] ?? 0;
    } else {
        for (const tri of floors) triClass[tri.i] = 1;
        for (const tri of walls) triClass[tri.i] = 2;
    }
    const rimEdge = new Map<string, { cls: number; n: Vert3 }>();
    for (let t = 0; t < resN; t++) {
        const cls = triClass[t] ?? 0;
        const ia = idxOf(result, t, 0);
        const ib = idxOf(result, t, 1);
        const ic = idxOf(result, t, 2);
        const n = faceNormal(vertOf(result, ia), vertOf(result, ib), vertOf(result, ic));
        for (const [u, v] of [
            [ia, ib],
            [ib, ic],
            [ic, ia],
        ] as const) {
            const k = edgeKey(u, v);
            const prev = rimEdge.get(k);
            if (!prev) {
                rimEdge.set(k, { cls, n });
                continue;
            }
            const a = prev.cls;
            const b = cls;
            const floorWall = (a === 1 && b === 2) || (a === 2 && b === 1);
            const wallInsole = (a === 2 && b === 0) || (a === 0 && b === 2);
            const capWall = floorWall;
            if (!capWall && !wallInsole) continue;
            const d = dihedralDeg(prev.n, n);
            if (d <= 90 && d > featureRimMax) featureRimMax = d;
        }
    }
    for (const [k, e] of floorEdges) {
        if (e.count === 1) adjFloor.push([e.a, e.b]);
        if (wallEdgeKeys.has(k)) floorSide.push([e.a, e.b]);
    }
    const boundLoops = chainBoundary(adjFloor);
    const outlineAll = outlineAllEarly;
    const projectBound = (v: Vert3): Vert3 => {
        if (meta.surface === "bottom") {
            const zRef = outlineAll[0]?.z ?? v.z;
            return { x: v.x, y: v.y, z: zRef };
        }
        const n = nearestNOut(v, meta, wallN0);
        return {
            x: v.x + n.x * setDepth,
            y: v.y + n.y * setDepth,
            z: v.z + n.z * setDepth,
        };
    };
    const floorSidePts = (floorSide.length ? floorSide : adjFloor).flat().map(projectBound);
    const boundPts = floorSidePts;
    const resampled = outlineAll;
    const haus = resampled.length && boundPts.length ? hausdorff(resampled, boundPts) : 0;
    const cornerGrid = cornerGridEarly;
    let extraTurn = 0;
    for (const loop of boundLoops) {
        const n = loop.length;
        for (let i = 0; i < n; i++) {
            const a = loop[(i - 1 + n) % n]!;
            const b = loop[i]!;
            const c = loop[(i + 1) % n]!;
            if (turningDeg(a, b, c) <= 30) continue;
            if (minDistToOutline(b, outlineAll) > 0.2) continue;
            if (cornerGrid.nearest(b, 0.4) > 0.35) extraTurn++;
        }
    }

    aspects.sort((a, b) => a - b);
    return {
        triCount: resN,
        outsideVertMaxMm: outsideVertMax,
        outsideHostVertsMissing: missing,
        outsideTrisLost: Math.max(0, hostOutsideTris - resultOutsideTris),
        inRegion: {
            count: feature.length,
            pctMinAngleGe5: feature.length ? (100 * ge5) / feature.length : 100,
            minAngleMinDeg: feature.length ? minAngMin : 180,
            aspectP99: percentile(aspects, 99),
            aspectMax: aspects.length ? aspects[aspects.length - 1]! : 0,
            longestEdgeMm: longestFloor,
            longestWallEdgeMm: longestWall,
        },
        floor: {
            count: floors.length,
            depthAbsMaxMm: depthAbsMax,
            depthStdMm: stddev(depthErr),
            depthMeanMm: depthMean,
        },
        sidewall: {
            count: walls.length,
            pctDotLe01: walls.length ? (100 * sideOk) / walls.length : 100,
        },
        dihedral: {
            floorFloorMaxDeg: floorFloorMax,
            wallWallMaxDeg: wallWallMax,
            featureFloorFloorMaxDeg: featureFloorFloorMax,
            featureWallWallMaxDeg: featureWallWallMax,
            featureRimMaxDeg: featureRimMax,
            floorFloorAt,
            wallWallAt,
            floorFloorCreaseDeg,
            floorFloorCreaseHostDeg,
            floorFloorCreaseAt,
            nonFeatureOver10,
            nonFeatureOver10Count,
        },
        outline: {
            hausdorffMm: haus,
            extraTurnGt30: extraTurn,
        },
    };
}
