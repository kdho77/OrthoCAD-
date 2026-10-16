// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import { minDistToLoopXY, pointInPoly } from "@/lib/geometry/procedural-wall/cdt-band";
import type { PolyPoint } from "@/lib/geometry/procedural-wall/curves";
import { TEXT_REGION_PAD_MM } from "./constants";
import { createOuterWallSampler, extractHostTextContext, lateralStations } from "./place";
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
        longestEdgeMm: number;
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
        floorFloorMaxDeg: number;
        wallWallMaxDeg: number;
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

function distToTextRegion(p: Vert3, meta: TextApplyMeta, outline: Vert3[]): number {
    const d3 = minDistToOutline(p, outline);
    if (meta.surface !== "bottom") return d3;
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

function fontCorners(loops: Array<Array<Vert3>>, thresh = 35): Vert3[] {
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
    const key = (p: Vert3) => `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`;
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

function hausdorff(a: Vert3[], b: Vert3[]): number {
    const gb = new VertGrid(b, 0.4);
    const ga = new VertGrid(a, 0.4);
    let max = 0;
    for (const p of a) max = Math.max(max, gb.nearest(p, 4));
    for (const p of b) max = Math.max(max, ga.nearest(p, 4));
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
    const wallN0 = meanNOut(meta);
    const resultVerts = allVerts(result);
    const hostVerts = allVerts(host);
    const resultGrid = new VertGrid(resultVerts, 0.25);
    const hostN = triCountOf(host);
    const resN = triCountOf(result);

    const hostOutsideVerts: Vert3[] = [];
    for (const v of hostVerts) {
        if (distToTextRegion(v, meta, outline) > padMm) hostOutsideVerts.push(v);
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
        if (
            distToTextRegion(a, meta, outline) > padMm &&
            distToTextRegion(b, meta, outline) > padMm &&
            distToTextRegion(c, meta, outline) > padMm
        ) {
            hostOutsideTris++;
        }
    }
    let resultOutsideTris = 0;
    const inRegion: Array<{ a: Vert3; b: Vert3; c: Vert3; n: Vert3; i: number }> = [];
    for (let t = 0; t < resN; t++) {
        const a = vertOf(result, idxOf(result, t, 0));
        const b = vertOf(result, idxOf(result, t, 1));
        const c = vertOf(result, idxOf(result, t, 2));
        if (
            distToTextRegion(a, meta, outline) > padMm &&
            distToTextRegion(b, meta, outline) > padMm &&
            distToTextRegion(c, meta, outline) > padMm
        ) {
            resultOutsideTris++;
            continue;
        }
        inRegion.push({ a, b, c, n: faceNormal(a, b, c), i: t });
    }

    const hostCtx = extractHostTextContext(host);
    const run = meta.surface === "wall" ? lateralStations(hostCtx) : [];
    const sampler = run.length >= 2 ? createOuterWallSampler(host, run) : null;
    const setDepth = meta.mode === "engrave" ? meta.depthMm : meta.heightMm;
    const floors: typeof inRegion = [];
    const walls: typeof inRegion = [];
    for (const tri of inRegion) {
        const c = {
            x: (tri.a.x + tri.b.x + tri.c.x) / 3,
            y: (tri.a.y + tri.b.y + tri.c.y) / 3,
            z: (tri.a.z + tri.b.z + tri.c.z) / 3,
        };
        const nOut = nearestNOut(c, meta, wallN0);
        const dot = Math.abs(tri.n.x * nOut.x + tri.n.y * nOut.y + tri.n.z * nOut.z);
        if (dot >= 0.7) {
            if (meta.surface === "bottom") {
                if (Math.abs(c.z - setDepth) <= 0.25) floors.push(tri);
            } else if (sampler) {
                const hit = sampler.closest(c);
                if (hit) {
                    const signed =
                        (hit.p.x - c.x) * hit.n.x + (hit.p.y - c.y) * hit.n.y + (hit.p.z - c.z) * hit.n.z;
                    if (Math.abs(Math.abs(signed) - setDepth) <= 0.25) floors.push(tri);
                }
            } else {
                floors.push(tri);
            }
        } else if (dot <= 0.35) {
            walls.push(tri);
        }
    }

    const feature = floors.concat(walls);
    const aspects: number[] = [];
    let longest = 0;
    let ge5 = 0;
    let minAngMin = 180;
    for (const tri of feature) {
        const ang = minAngleDeg(tri.a, tri.b, tri.c);
        if (ang >= 5) ge5++;
        if (ang < minAngMin) minAngMin = ang;
        aspects.push(aspectOf(tri.a, tri.b, tri.c));
        longest = Math.max(longest, longestOf(tri.a, tri.b, tri.c));
    }

    const depths: number[] = [];
    if (meta.surface === "wall" && sampler) {
        for (const tri of floors) {
            for (const v of [tri.a, tri.b, tri.c]) {
                const hit = sampler.closest(v);
                if (!hit) continue;
                const n = hit.n;
                const signed = (hit.p.x - v.x) * n.x + (hit.p.y - v.y) * n.y + (hit.p.z - v.z) * n.z;
                depths.push(Math.abs(signed));
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
    const adjFloor: Array<[Vert3, Vert3]> = [];
    let floorFloorMax = 0;
    let wallWallMax = 0;
    const seenF = new Map<string, Vert3>();
    const seenW = new Map<string, Vert3>();
    const crease = (
        store: Map<string, Vert3>,
        ia: number,
        ib: number,
        n: Vert3,
        update: (deg: number) => void,
    ) => {
        const k = edgeKey(ia, ib);
        const prev = store.get(k);
        if (prev) update(dihedralDeg(prev, n));
        else store.set(k, n);
    };
    for (const tri of floors) {
        const ia = idxOf(result, tri.i, 0);
        const ib = idxOf(result, tri.i, 1);
        const ic = idxOf(result, tri.i, 2);
        crease(seenF, ia, ib, tri.n, (d) => {
            if (d > floorFloorMax) floorFloorMax = d;
        });
        crease(seenF, ib, ic, tri.n, (d) => {
            if (d > floorFloorMax) floorFloorMax = d;
        });
        crease(seenF, ic, ia, tri.n, (d) => {
            if (d > floorFloorMax) floorFloorMax = d;
        });
        pushEdge(floorEdges, ia, ib, tri.n, tri.a, tri.b);
        pushEdge(floorEdges, ib, ic, tri.n, tri.b, tri.c);
        pushEdge(floorEdges, ic, ia, tri.n, tri.c, tri.a);
    }
    for (const tri of walls) {
        const ia = idxOf(result, tri.i, 0);
        const ib = idxOf(result, tri.i, 1);
        const ic = idxOf(result, tri.i, 2);
        crease(seenW, ia, ib, tri.n, (d) => {
            if (d > wallWallMax) wallWallMax = d;
        });
        crease(seenW, ib, ic, tri.n, (d) => {
            if (d > wallWallMax) wallWallMax = d;
        });
        crease(seenW, ic, ia, tri.n, (d) => {
            if (d > wallWallMax) wallWallMax = d;
        });
    }
    for (const e of floorEdges.values()) {
        if (e.count === 1) adjFloor.push([e.a, e.b]);
    }
    const boundLoops = chainBoundary(adjFloor);
    const outlineLoops: Array<Array<Vert3>> = [];
    for (const g of meta.outlineWorld ?? []) {
        outlineLoops.push(g.outer);
        outlineLoops.push(...g.holes);
    }
    const boundPts = boundLoops.flat();
    const outlineAll = outlineLoops.flat();
    const haus = outlineAll.length && boundPts.length ? hausdorff(outlineAll, boundPts) : 0;
    const corners = fontCorners(outlineLoops);
    const cornerGrid = new VertGrid(corners.length ? corners : outlineAll, 0.3);
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
            longestEdgeMm: longest,
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
        },
        outline: {
            hausdorffMm: haus,
            extraTurnGt30: extraTurn,
        },
    };
}
