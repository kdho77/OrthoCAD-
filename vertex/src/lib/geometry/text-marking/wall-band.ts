// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import { TEXT_BOOLEAN_OUTSET_MM } from "./constants";
import type { WallStation } from "./place";

/** Adjacent outer-wall normals steeper than this are a curvature fold. */
const FOLD_ANGLE_DEG = 30;
const H_BIN_MM = 0.25;
const PROJECT_MM = 8;

export interface WallBand {
    /** hBase intervals in which a block of `height` fits the eroded face. */
    hBaseSpans(sLeft: number, width: number, height: number): Array<[number, number]>;
    contains(sLeft: number, width: number, hBase: number, height: number): boolean;
    /** How far the block can still drop, in 0.5 mm steps, and stay inside the band. */
    roomDown(sLeft: number, width: number, hBase: number, height: number): number;
}

interface FaceAcc {
    n: number;
    nx: number;
    ny: number;
    nz: number;
    px: number;
    py: number;
    pz: number;
    /** Alignment of the kept normal with the station outward normal. */
    agree: number;
}

/**
 * Usable (s, h) band on one wall run.
 * The face is eroded by `depthMm + 0.5` from the rim, from z = 0, and from
 * folds (adjacent normals over 30°, or local radius under 2 × depth).
 * `floorOf` is an extra lower clip (fillet + edge clearance) and is not a seed.
 */
export function buildWallUsableBand(
    geo: BufferGeometry,
    run: WallStation[],
    depthMm: number,
    floorOf: (s: number) => number,
): WallBand {
    const depth = Math.max(0, depthMm);
    const margin = depth + TEXT_BOOLEAN_OUTSET_MM;
    const radiusLimit = 2 * depth;
    const nS = run.length;
    let maxH = 0;
    for (const st of run) if (st.heightMm > maxH) maxH = st.heightMm;
    const nH = Math.max(2, Math.ceil(maxH / H_BIN_MM) + 1);
    const cellCount = nS * nH;
    const acc: Array<FaceAcc | null> = new Array(cellCount).fill(null);
    const project = stationProjector(run);

    const pos = geo.getAttribute("position");
    const index = geo.getIndex();
    const triCount = index ? index.count / 3 : pos.count / 3;
    const idxOf = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);
    const vert = (i: number) => ({ x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) });

    const stamp = (p: { x: number; y: number; z: number }, n: { x: number; y: number; z: number }) => {
        const hit = project(p);
        if (!hit) return;
        const st = run[hit.i]!;
        const agree = n.x * st.nOut.x + n.y * st.nOut.y + n.z * st.nOut.z;
        if (agree < 0.2) return;
        const j = Math.max(0, Math.min(nH - 1, Math.floor(hit.h / H_BIN_MM)));
        const id = hit.i * nH + j;
        let cell = acc[id];
        if (!cell) {
            cell = { n: 0, nx: 0, ny: 0, nz: 0, px: 0, py: 0, pz: 0, agree: -1 };
            acc[id] = cell;
        }
        const nl = Math.hypot(cell.nx, cell.ny, cell.nz);
        const dot = nl < 1e-8 ? 1 : (cell.nx * n.x + cell.ny * n.y + cell.nz * n.z) / nl;
        // A bin must stay on one face. Blending the wall with the rim round
        // invented folds along an otherwise smooth column.
        if (cell.n > 0 && dot < 0.94) {
            if (agree > cell.agree) {
                cell.n = 1;
                cell.nx = n.x;
                cell.ny = n.y;
                cell.nz = n.z;
                cell.px = p.x;
                cell.py = p.y;
                cell.pz = p.z;
                cell.agree = agree;
            }
            return;
        }
        cell.n++;
        cell.nx += n.x;
        cell.ny += n.y;
        cell.nz += n.z;
        cell.px += p.x;
        cell.py += p.y;
        cell.pz += p.z;
        if (agree > cell.agree) cell.agree = agree;
    };

    const faces: Array<{
        nx: number;
        ny: number;
        nz: number;
        v0: number;
        v1: number;
        v2: number;
        ax: number;
        ay: number;
        az: number;
        bx: number;
        by: number;
        bz: number;
        cx: number;
        cy: number;
        cz: number;
        cell: number;
    }> = [];
    for (let t = 0; t < triCount; t++) {
        const i0 = idxOf(t, 0);
        const i1 = idxOf(t, 1);
        const i2 = idxOf(t, 2);
        const a = vert(i0);
        const b = vert(i1);
        const c = vert(i2);
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const abz = b.z - a.z;
        const acx = c.x - a.x;
        const acy = c.y - a.y;
        const acz = c.z - a.z;
        let nx = aby * acz - abz * acy;
        let ny = abz * acx - abx * acz;
        let nz = abx * acy - aby * acx;
        const nl = Math.hypot(nx, ny, nz);
        if (nl < 1e-12) continue;
        nx /= nl;
        ny /= nl;
        nz /= nl;
        const n = { x: nx, y: ny, z: nz };
        const mid = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3, z: (a.z + b.z + c.z) / 3 };
        const midHit = project(mid);
        if (midHit) {
            const st = run[midHit.i]!;
            let agree = n.x * st.nOut.x + n.y * st.nOut.y + n.z * st.nOut.z;
            let fnx = n.x;
            let fny = n.y;
            let fnz = n.z;
            if (agree < 0) {
                fnx = -fnx;
                fny = -fny;
                fnz = -fnz;
                agree = -agree;
            }
            if (agree >= 0.2) {
                const j = Math.max(0, Math.min(nH - 1, Math.floor(midHit.h / H_BIN_MM)));
                faces.push({
                    nx: fnx,
                    ny: fny,
                    nz: fnz,
                    v0: i0,
                    v1: i1,
                    v2: i2,
                    ax: a.x,
                    ay: a.y,
                    az: a.z,
                    bx: b.x,
                    by: b.y,
                    bz: b.z,
                    cx: c.x,
                    cy: c.y,
                    cz: c.z,
                    cell: midHit.i * nH + j,
                });
            }
        }
        const samples = [
            a,
            b,
            c,
            { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3, z: (a.z + b.z + c.z) / 3 },
        ];
        const edges: Array<[{ x: number; y: number; z: number }, { x: number; y: number; z: number }]> = [
            [a, b],
            [b, c],
            [c, a],
        ];
        for (const [p, q] of edges) {
            const len = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
            const steps = Math.min(6, Math.max(0, Math.ceil(len / 0.5) - 1));
            for (let s = 1; s <= steps; s++) {
                const u = s / (steps + 1);
                samples.push({
                    x: p.x + (q.x - p.x) * u,
                    y: p.y + (q.y - p.y) * u,
                    z: p.z + (q.z - p.z) * u,
                });
            }
        }
        for (const p of samples) stamp(p, n);
    }

    const dist = new Float32Array(cellCount);
    dist.fill(Number.POSITIVE_INFINITY);
    const seed = (id: number, d: number) => {
        if (d < dist[id]!) dist[id] = d;
    };

    const normals: Array<{ x: number; y: number; z: number; px: number; py: number; pz: number } | null> =
        new Array(cellCount).fill(null);
    for (let id = 0; id < cellCount; id++) {
        const cell = acc[id];
        if (!cell || cell.n === 0) continue;
        const nl = Math.hypot(cell.nx, cell.ny, cell.nz) || 1;
        normals[id] = {
            x: cell.nx / nl,
            y: cell.ny / nl,
            z: cell.nz / nl,
            px: cell.px / cell.n,
            py: cell.py / cell.n,
            pz: cell.pz / cell.n,
        };
    }

    const angleDeg = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => {
        const c = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
        return (Math.acos(c) * 180) / Math.PI;
    };

    for (let i = 0; i < nS; i++) {
        let top = -1;
        let bot = -1;
        let botZ = Infinity;
        for (let j = 0; j < nH; j++) {
            const id = i * nH + j;
            const n = normals[id];
            if (!n) continue;
            if (top < 0 || j > top) top = j;
            if (bot < 0 || j < bot) {
                bot = j;
                botZ = n.pz;
            }
            if (n.pz <= 0.2) seed(id, 0);
        }
        if (top >= 0) seed(i * nH + top, 0);
        if (bot >= 0) seed(i * nH + bot, Math.max(0, botZ));
    }
    const edgeFaces = new Map<string, number[]>();
    const pushEdge = (f: number, a: number, b: number) => {
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        const list = edgeFaces.get(key);
        if (list) list.push(f);
        else edgeFaces.set(key, [f]);
    };
    for (let f = 0; f < faces.length; f++) {
        const face = faces[f]!;
        pushEdge(f, face.v0, face.v1);
        pushEdge(f, face.v1, face.v2);
        pushEdge(f, face.v2, face.v0);
    }
    for (const [key, list] of edgeFaces) {
        if (list.length < 2) continue;
        const f0 = faces[list[0]!]!;
        const f1 = faces[list[1]!]!;
        const ang = angleDeg({ x: f0.nx, y: f0.ny, z: f0.nz }, { x: f1.nx, y: f1.ny, z: f1.nz });
        const [ia, ib] = key.split("|").map((v) => Number(v));
        const pa =
            f0.v0 === ia
                ? { x: f0.ax, y: f0.ay, z: f0.az }
                : f0.v1 === ia
                  ? { x: f0.bx, y: f0.by, z: f0.bz }
                  : { x: f0.cx, y: f0.cy, z: f0.cz };
        const pb =
            f0.v0 === ib
                ? { x: f0.ax, y: f0.ay, z: f0.az }
                : f0.v1 === ib
                  ? { x: f0.bx, y: f0.by, z: f0.bz }
                  : { x: f0.cx, y: f0.cy, z: f0.cz };
        const edge = Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
        if (edge < 0.05) continue;
        // Local radius is the turning of the two faces across the hinge, not
        // the length of the hinge. A baseline under 0.35 mm is tessellation
        // noise (a few degrees over a sliver reads as R < 2 × depth).
        const step = dihedralStepMm(f0, f1, pa, pb);
        const rad = ang < 0.05 || step < 0.35 ? Infinity : step / ((ang * Math.PI) / 180);
        if (ang > FOLD_ANGLE_DEG || rad < radiusLimit) {
            seed(f0.cell, 0);
            seed(f1.cell, 0);
        }
    }

    const heapI: number[] = [];
    const heapD: number[] = [];
    const heapSwap = (a: number, b: number) => {
        const ti = heapI[a]!;
        heapI[a] = heapI[b]!;
        heapI[b] = ti;
        const td = heapD[a]!;
        heapD[a] = heapD[b]!;
        heapD[b] = td;
    };
    const heapPush = (id: number, d: number) => {
        let k = heapI.length;
        heapI.push(id);
        heapD.push(d);
        while (k > 0) {
            const p = (k - 1) >> 1;
            if (heapD[p]! <= heapD[k]!) break;
            heapSwap(p, k);
            k = p;
        }
    };
    const heapPop = (): [number, number] | null => {
        if (!heapI.length) return null;
        const id = heapI[0]!;
        const d = heapD[0]!;
        const li = heapI.pop()!;
        const ld = heapD.pop()!;
        if (heapI.length) {
            heapI[0] = li;
            heapD[0] = ld;
            let k = 0;
            for (;;) {
                const l = k * 2 + 1;
                const r = l + 1;
                let m = k;
                if (l < heapI.length && heapD[l]! < heapD[m]!) m = l;
                if (r < heapI.length && heapD[r]! < heapD[m]!) m = r;
                if (m === k) break;
                heapSwap(k, m);
                k = m;
            }
        }
        return [id, d];
    };
    for (let id = 0; id < cellCount; id++) {
        if (dist[id]! < 1e8) heapPush(id, dist[id]!);
    }
    const seen = new Uint8Array(cellCount);
    while (heapI.length) {
        const popped = heapPop();
        if (!popped) break;
        const [id, d] = popped;
        if (seen[id]) continue;
        if (d > dist[id]! + 1e-6) continue;
        seen[id] = 1;
        const i = Math.floor(id / nH);
        const j = id - i * nH;
        const a = normals[id];
        if (!a) continue;
        for (let di = -1; di <= 1; di++) {
            for (let dj = -1; dj <= 1; dj++) {
                if (di === 0 && dj === 0) continue;
                const ni = i + di;
                const nj = j + dj;
                if (ni < 0 || nj < 0 || ni >= nS || nj >= nH) continue;
                const nid = ni * nH + nj;
                const b = normals[nid];
                if (!b) continue;
                const step = Math.hypot(a.px - b.px, a.py - b.py, a.pz - b.pz);
                const nd = d + step;
                if (nd + 1e-6 < dist[nid]!) {
                    dist[nid] = nd;
                    heapPush(nid, nd);
                }
            }
        }
    }

    const spans: Array<Array<[number, number]>> = [];
    for (let i = 0; i < nS; i++) {
        const floor = floorOf(run[i]!.s);
        const col: Array<[number, number]> = [];
        let open = -1;
        let lastEnd = -1;
        let gap = 0;
        const close = () => {
            if (open >= 0 && lastEnd - open > 0.2) col.push([open, lastEnd]);
            open = -1;
            lastEnd = -1;
            gap = 0;
        };
        for (let j = 0; j < nH; j++) {
            const id = i * nH + j;
            const h0 = j * H_BIN_MM;
            const h1 = h0 + H_BIN_MM;
            const occupied = normals[id] != null;
            const usable = occupied && dist[id]! + 1e-6 >= margin && h1 > floor + 1e-6;
            if (usable) {
                if (open < 0) open = Math.max(h0, floor);
                lastEnd = h1;
                gap = 0;
                continue;
            }
            // Unsampled bins are gaps in the stamp, not a fold. Bridge a short hole.
            if (open >= 0 && !occupied && gap < 4) {
                gap++;
                continue;
            }
            if (open >= 0) close();
        }
        if (open >= 0) close();
        spans.push(col);
    }
    for (let i = 1; i < nS - 1; i++) {
        if (spans[i]!.length) continue;
        let filled = false;
        for (let j = 0; j < nH; j++) {
            if (normals[i * nH + j]) {
                filled = true;
                break;
            }
        }
        if (filled) continue;
        const left = spans[i - 1]!;
        const right = spans[i + 1]!;
        if (left.length && right.length) spans[i] = intersectSpans(left, right);
    }

    const indexAt = (s: number): number => {
        if (s <= run[0]!.s) return 0;
        const last = nS - 1;
        if (s >= run[last]!.s) return last;
        let lo = 0;
        let hi = last;
        while (lo + 1 < hi) {
            const mid = (lo + hi) >> 1;
            if (run[mid]!.s <= s) lo = mid;
            else hi = mid;
        }
        return run[hi]!.s - s < s - run[lo]!.s ? hi : lo;
    };
    const windowSpans = (sLeft: number, width: number): Array<[number, number]> => {
        const i0 = indexAt(sLeft);
        let i1 = indexAt(sLeft + width);
        if (i1 < i0) i1 = i0;
        if (i1 + 1 < nS && run[i1]!.s < sLeft + width - 1e-3) i1++;
        let acc = spans[i0] ?? [];
        for (let i = i0 + 1; i <= i1; i++) {
            acc = intersectSpans(acc, spans[i] ?? []);
            if (!acc.length) break;
        }
        return acc;
    };

    const containsAt = (sLeft: number, width: number, hBase: number, height: number): boolean => {
        const top = hBase + height;
        return windowSpans(sLeft, width).some((sp) => sp[0] <= hBase + 0.05 && sp[1] >= top - 0.05);
    };
    return {
        hBaseSpans(sLeft, width, height) {
            const out: Array<[number, number]> = [];
            for (const [lo, hi] of windowSpans(sLeft, width)) {
                if (hi - lo + 1e-3 < height) continue;
                out.push([lo, hi - height]);
            }
            return out;
        },
        contains: containsAt,
        roomDown(sLeft, width, hBase, height) {
            let dropped = 0;
            while (containsAt(sLeft, width, hBase - (dropped + 0.5), height)) dropped += 0.5;
            return dropped;
        },
    };
}

function dihedralStepMm(
    f0: {
        ax: number;
        ay: number;
        az: number;
        bx: number;
        by: number;
        bz: number;
        cx: number;
        cy: number;
        cz: number;
    },
    f1: {
        ax: number;
        ay: number;
        az: number;
        bx: number;
        by: number;
        bz: number;
        cx: number;
        cy: number;
        cz: number;
    },
    pa: { x: number; y: number; z: number },
    pb: { x: number; y: number; z: number },
): number {
    const ex = pb.x - pa.x;
    const ey = pb.y - pa.y;
    const ez = pb.z - pa.z;
    const el = Math.hypot(ex, ey, ez) || 1;
    const ux = ex / el;
    const uy = ey / el;
    const uz = ez / el;
    const dist = (f: {
        ax: number;
        ay: number;
        az: number;
        bx: number;
        by: number;
        bz: number;
        cx: number;
        cy: number;
        cz: number;
    }) => {
        const cx = (f.ax + f.bx + f.cx) / 3 - pa.x;
        const cy = (f.ay + f.by + f.cy) / 3 - pa.y;
        const cz = (f.az + f.bz + f.cz) / 3 - pa.z;
        const along = cx * ux + cy * uy + cz * uz;
        return Math.hypot(cx - along * ux, cy - along * uy, cz - along * uz);
    };
    return dist(f0) + dist(f1);
}

function intersectSpans(a: Array<[number, number]>, b: Array<[number, number]>): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (const [a0, a1] of a) {
        for (const [b0, b1] of b) {
            const lo = Math.max(a0, b0);
            const hi = Math.min(a1, b1);
            if (hi - lo > 0.2) out.push([lo, hi]);
        }
    }
    return out;
}

function stationProjector(run: WallStation[]): (p: { x: number; y: number; z: number }) => {
    i: number;
    h: number;
} | null {
    const cell = 6;
    const buckets = new Map<string, number[]>();
    const key = (x: number, y: number, z: number) =>
        `${Math.floor(x / cell)}|${Math.floor(y / cell)}|${Math.floor(z / cell)}`;
    const add = (i: number, x: number, y: number, z: number) => {
        const k = key(x, y, z);
        const list = buckets.get(k);
        if (list) list.push(i);
        else buckets.set(k, [i]);
    };
    for (let i = 0; i < run.length; i++) {
        const st = run[i]!;
        for (let t = 0; t <= 4; t++) {
            const u = t / 4;
            add(
                i,
                st.B.x + (st.R.x - st.B.x) * u,
                st.B.y + (st.R.y - st.B.y) * u,
                st.B.z + (st.R.z - st.B.z) * u,
            );
        }
    }
    return (p) => {
        const ix = Math.floor(p.x / cell);
        const iy = Math.floor(p.y / cell);
        const iz = Math.floor(p.z / cell);
        let bestI = -1;
        let bestD = PROJECT_MM * PROJECT_MM;
        let bestH = 0;
        const seen = new Set<number>();
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const list = buckets.get(`${ix + dx}|${iy + dy}|${iz + dz}`);
                    if (!list) continue;
                    for (const i of list) {
                        if (seen.has(i)) continue;
                        seen.add(i);
                        const st = run[i]!;
                        const rx = st.R.x - st.B.x;
                        const ry = st.R.y - st.B.y;
                        const rz = st.R.z - st.B.z;
                        const hLen2 = rx * rx + ry * ry + rz * rz || 1;
                        const vx = p.x - st.B.x;
                        const vy = p.y - st.B.y;
                        const vz = p.z - st.B.z;
                        let t = (vx * rx + vy * ry + vz * rz) / hLen2;
                        if (t < 0) t = 0;
                        else if (t > 1) t = 1;
                        const qx = st.B.x + rx * t;
                        const qy = st.B.y + ry * t;
                        const qz = st.B.z + rz * t;
                        const d2 = (p.x - qx) ** 2 + (p.y - qy) ** 2 + (p.z - qz) ** 2;
                        if (d2 < bestD) {
                            bestD = d2;
                            bestI = i;
                            bestH = t * st.heightMm;
                        }
                    }
                }
            }
        }
        if (bestI < 0) return null;
        return { i: bestI, h: bestH };
    };
}
