// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import type { ColumnProfile, PlanformColumn } from "./types";
import { S1_PROFILE_POLES } from "./types";

interface NZ {
    n: number;
    z: number;
}

interface Seg {
    a: { x: number; y: number; z: number };
    b: { x: number; y: number; z: number };
}

function coxDeBoor(u: number, i: number, p: number, knots: number[]): number {
    if (p === 0) return u >= knots[i]! && u < knots[i + 1]! ? 1 : u === 1 && knots[i + 1] === 1 ? 1 : 0;
    const d1 = knots[i + p]! - knots[i]!;
    const d2 = knots[i + p + 1]! - knots[i + 1]!;
    const a = d1 > 1e-12 ? ((u - knots[i]!) / d1) * coxDeBoor(u, i, p - 1, knots) : 0;
    const b = d2 > 1e-12 ? ((knots[i + p + 1]! - u) / d2) * coxDeBoor(u, i + 1, p - 1, knots) : 0;
    return a + b;
}

function clampedKnots(nCtrl: number, degree = 3): number[] {
    const nKnots = nCtrl + degree + 1;
    const knots = new Array<number>(nKnots);
    for (let i = 0; i <= degree; i++) knots[i] = 0;
    const interior = nCtrl - degree - 1;
    for (let i = 1; i <= interior; i++) knots[degree + i] = i / (interior + 1);
    for (let i = nKnots - degree - 1; i < nKnots; i++) knots[i] = 1;
    return knots;
}

function basisRow(u: number, nCtrl: number, knots: number[], degree = 3): number[] {
    const uu = Math.min(1 - 1e-12, Math.max(0, u));
    const row = new Array<number>(nCtrl).fill(0);
    for (let i = 0; i < nCtrl; i++) row[i] = coxDeBoor(uu, i, degree, knots);
    const s = row.reduce((a, b) => a + b, 0);
    if (s > 1e-12) for (let i = 0; i < nCtrl; i++) row[i]! /= s;
    return row;
}

function solveSymmetric(M: number[][], b: number[]): number[] {
    const n = b.length;
    const a = M.map((r) => r.slice());
    const x = b.slice();
    for (let k = 0; k < n; k++) {
        let piv = k;
        for (let i = k + 1; i < n; i++) if (Math.abs(a[i]![k]!) > Math.abs(a[piv]![k]!)) piv = i;
        [a[k], a[piv]] = [a[piv]!, a[k]!];
        [x[k], x[piv]] = [x[piv]!, x[k]!];
        const diag = a[k]![k]!;
        if (Math.abs(diag) < 1e-14) continue;
        for (let i = k + 1; i < n; i++) {
            const f = a[i]![k]! / diag;
            for (let j = k; j < n; j++) a[i]![j]! -= f * a[k]![j]!;
            x[i]! -= f * x[k]!;
        }
    }
    for (let i = n - 1; i >= 0; i--) {
        let s = x[i]!;
        for (let j = i + 1; j < n; j++) s -= a[i]![j]! * x[j]!;
        x[i] = s / (a[i]![i]! || 1);
    }
    return x;
}

function solveLinear(A: number[][], bx: number[], by: number[]): { x: number[]; y: number[] } {
    const n = A[0]!.length;
    const ATA: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const cx = new Array<number>(n).fill(0);
    const cy = new Array<number>(n).fill(0);
    for (let i = 0; i < A.length; i++) {
        const row = A[i]!;
        for (let c = 0; c < n; c++) {
            cx[c]! += row[c]! * bx[i]!;
            cy[c]! += row[c]! * by[i]!;
            for (let d = 0; d < n; d++) ATA[c]![d]! += row[c]! * row[d]!;
        }
    }
    for (let i = 0; i < n; i++) ATA[i]![i]! += 1e-10;
    return { x: solveSymmetric(ATA, cx), y: solveSymmetric(ATA, cy) };
}

export function evalOpenCubic(poles: NZ[], t: number): NZ {
    const nCtrl = poles.length;
    if (nCtrl === 0) return { n: 0, z: 0 };
    if (nCtrl === 1) return { ...poles[0]! };
    const knots = clampedKnots(nCtrl);
    const row = basisRow(t, nCtrl, knots);
    let n = 0;
    let z = 0;
    for (let i = 0; i < nCtrl; i++) {
        n += row[i]! * poles[i]!.n;
        z += row[i]! * poles[i]!.z;
    }
    return { n, z };
}

function resampleNz(samples: NZ[], count: number): NZ[] {
    if (samples.length === 0) return [];
    if (samples.length === 1) return Array.from({ length: count }, () => ({ ...samples[0]! }));
    const cum = [0];
    for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1]!;
        const b = samples[i]!;
        cum.push(cum[i - 1]! + Math.hypot(b.n - a.n, b.z - a.z));
    }
    const total = cum[cum.length - 1]! || 1;
    const out: NZ[] = [];
    let j = 0;
    for (let k = 0; k < count; k++) {
        const t = (k / Math.max(1, count - 1)) * total;
        while (j < samples.length - 2 && cum[j + 1]! < t) j++;
        const a = samples[j]!;
        const b = samples[j + 1]!;
        const seg = cum[j + 1]! - cum[j]!;
        const f = seg > 1e-12 ? (t - cum[j]!) / seg : 0;
        out.push({ n: a.n + (b.n - a.n) * f, z: a.z + (b.z - a.z) * f });
    }
    return out;
}

function fitCubicPoles(samples: NZ[], nCtrl = S1_PROFILE_POLES): { poles: NZ[]; residualMm: number } {
    const m = samples.length;
    if (m < 4) {
        const poles = samples.length ? samples : [{ n: 0, z: 0 }];
        return { poles, residualMm: 0 };
    }
    const nP = Math.max(8, Math.min(12, nCtrl, m));
    const targets = resampleNz(samples, nP);
    const knots = clampedKnots(nP);
    const A = targets.map((_, i) => basisRow(i / Math.max(1, nP - 1), nP, knots));
    const { x, y } = solveLinear(
        A,
        targets.map((s) => s.n),
        targets.map((s) => s.z),
    );
    const poles: NZ[] = [];
    for (let i = 0; i < nP; i++) poles.push({ n: x[i]!, z: y[i]! });
    poles[0] = { ...samples[0]! };
    poles[nP - 1] = { ...samples[m - 1]! };
    let residual = 0;
    const cum = [0];
    for (let i = 1; i < m; i++) {
        const a = samples[i - 1]!;
        const b = samples[i]!;
        cum.push(cum[i - 1]! + Math.hypot(b.n - a.n, b.z - a.z));
    }
    const total = cum[m - 1]! || 1;
    for (let i = 0; i < m; i++) {
        const e = evalOpenCubic(poles, cum[i]! / total);
        residual = Math.max(residual, Math.hypot(e.n - samples[i]!.n, e.z - samples[i]!.z));
    }
    return { poles, residualMm: residual };
}

function toNz(p: { x: number; y: number; z: number }, col: PlanformColumn): NZ {
    return {
        n: (p.x - col.outline.x) * col.n.x + (p.y - col.outline.y) * col.n.y,
        z: p.z,
    };
}

function triPlaneSeg(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
    ox: number,
    oy: number,
    tx: number,
    ty: number,
): Seg | null {
    const dA = (ax - ox) * tx + (ay - oy) * ty;
    const dB = (bx - ox) * tx + (by - oy) * ty;
    const dC = (cx - ox) * tx + (cy - oy) * ty;
    const pts: Array<{ x: number; y: number; z: number }> = [];
    const edge = (
        x0: number,
        y0: number,
        z0: number,
        d0: number,
        x1: number,
        y1: number,
        z1: number,
        d1: number,
    ) => {
        if (d0 * d1 > 0) return;
        const denom = d1 - d0;
        if (Math.abs(d0) < 1e-10 && Math.abs(d1) < 1e-10) return;
        const f = Math.abs(denom) < 1e-14 ? 0 : -d0 / denom;
        if (f < -1e-5 || f > 1 + 1e-5) return;
        const ff = Math.max(0, Math.min(1, f));
        pts.push({
            x: x0 + (x1 - x0) * ff,
            y: y0 + (y1 - y0) * ff,
            z: z0 + (z1 - z0) * ff,
        });
    };
    edge(ax, ay, az, dA, bx, by, bz, dB);
    edge(bx, by, bz, dB, cx, cy, cz, dC);
    edge(cx, cy, cz, dC, ax, ay, az, dA);
    if (pts.length < 2) return null;
    let a = pts[0]!;
    let b = pts[1]!;
    let best = -1;
    for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
            const d = Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.y - pts[j]!.y, pts[i]!.z - pts[j]!.z);
            if (d > best) {
                best = d;
                a = pts[i]!;
                b = pts[j]!;
            }
        }
    }
    return { a, b };
}

function linkChains(segs: Seg[]): Array<Array<{ x: number; y: number; z: number }>> {
    const used = new Set<number>();
    const dist = (p: { x: number; y: number; z: number }, q: { x: number; y: number; z: number }) =>
        Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
    const SNAP = 0.22;
    const chains: Array<Array<{ x: number; y: number; z: number }>> = [];
    for (let s = 0; s < segs.length; s++) {
        if (used.has(s)) continue;
        used.add(s);
        const chain = [segs[s]!.a, segs[s]!.b];
        let grew = true;
        while (grew) {
            grew = false;
            for (let i = 0; i < segs.length; i++) {
                if (used.has(i)) continue;
                const p = segs[i]!.a;
                const q = segs[i]!.b;
                const head = chain[0]!;
                const tail = chain[chain.length - 1]!;
                if (dist(tail, p) < SNAP) {
                    chain.push(q);
                    used.add(i);
                    grew = true;
                } else if (dist(tail, q) < SNAP) {
                    chain.push(p);
                    used.add(i);
                    grew = true;
                } else if (dist(head, p) < SNAP) {
                    chain.unshift(q);
                    used.add(i);
                    grew = true;
                } else if (dist(head, q) < SNAP) {
                    chain.unshift(p);
                    used.add(i);
                    grew = true;
                }
            }
        }
        if (chain.length >= 3) chains.push(chain);
    }
    return chains;
}

function collectNearbyTris(hash: Map<string, number[]>, col: PlanformColumn, cell: number): number[] {
    const o = col.outline;
    const seen = new Set<number>();
    const out: number[] = [];
    for (let s = -4; s <= 16; s += cell) {
        const x = o.x + col.n.x * s;
        const y = o.y + col.n.y * s;
        const ix = Math.floor(x / cell);
        const iy = Math.floor(y / cell);
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const bucket = hash.get(`${ix + dx},${iy + dy}`);
                if (!bucket) continue;
                for (const t of bucket) {
                    if (seen.has(t)) continue;
                    seen.add(t);
                    out.push(t);
                }
            }
        }
    }
    return out;
}

function buildTriXyHash(pos: Float32Array, idx: ArrayLike<number>, cell: number): Map<string, number[]> {
    const hash = new Map<string, number[]>();
    const triCount = idx.length / 3;
    for (let t = 0; t < triCount; t++) {
        const i0 = idx[t * 3]!;
        const i1 = idx[t * 3 + 1]!;
        const i2 = idx[t * 3 + 2]!;
        const minX = Math.min(pos[i0 * 3]!, pos[i1 * 3]!, pos[i2 * 3]!);
        const maxX = Math.max(pos[i0 * 3]!, pos[i1 * 3]!, pos[i2 * 3]!);
        const minY = Math.min(pos[i0 * 3 + 1]!, pos[i1 * 3 + 1]!, pos[i2 * 3 + 1]!);
        const maxY = Math.max(pos[i0 * 3 + 1]!, pos[i1 * 3 + 1]!, pos[i2 * 3 + 1]!);
        const x0 = Math.floor(minX / cell);
        const y0 = Math.floor(minY / cell);
        const x1 = Math.floor(maxX / cell);
        const y1 = Math.floor(maxY / cell);
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const k = `${x},${y}`;
                let b = hash.get(k);
                if (!b) {
                    b = [];
                    hash.set(k, b);
                }
                b.push(t);
            }
        }
    }
    return hash;
}

function sliceByPlane(
    col: PlanformColumn,
    pos: Float32Array,
    idx: ArrayLike<number>,
    candidates: number[],
): NZ[] {
    const o = col.outline;
    const rimN = (col.rim.x - o.x) * col.n.x + (col.rim.y - o.y) * col.n.y;
    const offMin = -4;
    const offMax = Math.max(8, Math.abs(rimN) + 6);
    const zMin = o.z - 2;
    const zMax = col.rim.z + 3;
    const segs: Seg[] = [];
    const keep = (p: { x: number; y: number; z: number }): boolean => {
        const off = (p.x - o.x) * col.n.x + (p.y - o.y) * col.n.y;
        return off >= offMin && off <= offMax && p.z >= zMin && p.z <= zMax;
    };
    for (const t of candidates) {
        const i0 = idx![t * 3]!;
        const i1 = idx![t * 3 + 1]!;
        const i2 = idx![t * 3 + 2]!;
        const ax = pos[i0 * 3]!;
        const ay = pos[i0 * 3 + 1]!;
        const az = pos[i0 * 3 + 2]!;
        const bx = pos[i1 * 3]!;
        const by = pos[i1 * 3 + 1]!;
        const bz = pos[i1 * 3 + 2]!;
        const cx = pos[i2 * 3]!;
        const cy = pos[i2 * 3 + 1]!;
        const cz = pos[i2 * 3 + 2]!;
        const minOff = Math.min(
            (ax - o.x) * col.n.x + (ay - o.y) * col.n.y,
            (bx - o.x) * col.n.x + (by - o.y) * col.n.y,
            (cx - o.x) * col.n.x + (cy - o.y) * col.n.y,
        );
        const maxOff = Math.max(
            (ax - o.x) * col.n.x + (ay - o.y) * col.n.y,
            (bx - o.x) * col.n.x + (by - o.y) * col.n.y,
            (cx - o.x) * col.n.x + (cy - o.y) * col.n.y,
        );
        if (maxOff < offMin - 1 || minOff > offMax + 1) continue;
        if (Math.max(az, bz, cz) < zMin - 1 || Math.min(az, bz, cz) > zMax + 1) continue;
        const sideTol = 2.4;
        const maxSide = Math.max(
            Math.abs((ax - o.x) * col.tangent.x + (ay - o.y) * col.tangent.y),
            Math.abs((bx - o.x) * col.tangent.x + (by - o.y) * col.tangent.y),
            Math.abs((cx - o.x) * col.tangent.x + (cy - o.y) * col.tangent.y),
        );
        if (maxSide > sideTol + Math.hypot(bx - ax, by - ay, bz - az)) continue;
        const seg = triPlaneSeg(ax, ay, az, bx, by, bz, cx, cy, cz, o.x, o.y, col.tangent.x, col.tangent.y);
        if (!seg) continue;
        if (!keep(seg.a) && !keep(seg.b)) continue;
        segs.push(seg);
    }
    if (segs.length < 3) return [];
    const chains = linkChains(segs);
    let best: Array<{ x: number; y: number; z: number }> | null = null;
    let bestScore = Infinity;
    for (const chain of chains) {
        let iOut = 0;
        let iRim = 0;
        let dOut = Infinity;
        let dRim = Infinity;
        for (let i = 0; i < chain.length; i++) {
            const p = chain[i]!;
            const d0 = Math.hypot(p.x - o.x, p.y - o.y, p.z - o.z);
            const d1 = Math.hypot(p.x - col.rim.x, p.y - col.rim.y, p.z - col.rim.z);
            if (d0 < dOut) {
                dOut = d0;
                iOut = i;
            }
            if (d1 < dRim) {
                dRim = d1;
                iRim = i;
            }
        }
        if (dOut > 4 || dRim > 6) continue;
        const lo = Math.min(iOut, iRim);
        const hi = Math.max(iOut, iRim);
        const slice = chain.slice(lo, hi + 1);
        if (iOut > iRim) slice.reverse();
        if (slice.length < 4) continue;
        let mean = 0;
        for (const p of slice) mean += Math.abs(toNz(p, col).n);
        mean /= slice.length;
        const score = mean + dOut + dRim;
        if (score < bestScore) {
            bestScore = score;
            best = slice;
        }
    }
    if (!best) return [];
    const path: NZ[] = [{ n: 0, z: o.z }];
    for (const p of best) {
        const nz = toNz(p, col);
        const last = path[path.length - 1]!;
        if (Math.hypot(nz.n - last.n, nz.z - last.z) < 0.08) continue;
        path.push(nz);
    }
    path.push({
        n: rimN,
        z: col.rim.z,
    });
    return path;
}

const SLAB_MM = 0.85;

function sliceColumnVerts(col: PlanformColumn, pts: Float32Array): NZ[] {
    const o = col.outline;
    const rimN = (col.rim.x - o.x) * col.n.x + (col.rim.y - o.y) * col.n.y;
    const cloud: NZ[] = [];
    for (let i = 0; i < pts.length; i += 3) {
        const x = pts[i]!;
        const y = pts[i + 1]!;
        const z = pts[i + 2]!;
        const side = (x - o.x) * col.tangent.x + (y - o.y) * col.tangent.y;
        if (Math.abs(side) > SLAB_MM) continue;
        const off = (x - o.x) * col.n.x + (y - o.y) * col.n.y;
        if (off < -3.5 || off > Math.max(6, Math.abs(rimN) + 5)) continue;
        if (z < o.z - 1.5 || z > col.rim.z + 2.5) continue;
        cloud.push({ n: off, z });
    }
    const plantar = { n: 0, z: o.z };
    const rim = { n: rimN, z: col.rim.z };
    if (cloud.length < 4) return [plantar, rim];
    const path: NZ[] = [rim];
    const used = new Set<number>();
    let cur = rim;
    for (let step = 0; step < 36; step++) {
        let best = -1;
        let bestD = 2.8;
        for (let i = 0; i < cloud.length; i++) {
            if (used.has(i)) continue;
            const p = cloud[i]!;
            if (p.z > cur.z + 0.25) continue;
            const d = Math.hypot(p.n - cur.n, p.z - cur.z);
            if (d < bestD) {
                bestD = d;
                best = i;
            }
        }
        if (best < 0) break;
        used.add(best);
        cur = cloud[best]!;
        path.push(cur);
        if (cur.z <= plantar.z + 0.3) break;
    }
    path.push(plantar);
    path.reverse();
    path[0] = plantar;
    path[path.length - 1] = rim;
    return path;
}

export function fitColumnProfiles(
    frame: { columns: PlanformColumn[] },
    geo: BufferGeometry,
): ColumnProfile[] {
    const pos = geo.getAttribute("position").array as Float32Array;
    const index = geo.getIndex();
    const idx = index ? (index.array as ArrayLike<number>) : null;
    const cell = 3;
    const hash = idx ? buildTriXyHash(pos, idx, cell) : null;
    const out: ColumnProfile[] = [];
    for (const col of frame.columns) {
        let samples: NZ[] = [];
        if (idx && hash) {
            samples = sliceByPlane(col, pos, idx, collectNearbyTris(hash, col, cell));
        }
        if (samples.length < 6) samples = sliceColumnVerts(col, pos);
        let { poles, residualMm } = fitCubicPoles(samples, S1_PROFILE_POLES);
        if (residualMm > 0.1 && samples.length >= 12) {
            const retry = fitCubicPoles(samples, 12);
            if (retry.residualMm < residualMm) {
                poles = retry.poles;
                residualMm = retry.residualMm;
            }
        }
        out.push({
            s01: col.s01,
            poles,
            residualMm,
            plantar: { n: 0, z: col.outline.z },
            rim: {
                n: (col.rim.x - col.outline.x) * col.n.x + (col.rim.y - col.outline.y) * col.n.y,
                z: col.rim.z,
            },
        });
    }
    return out;
}

/** Affine rescale of a profile so endpoints ride new plantar/rim (n,z). */
export function rescaleProfileAffine(profile: ColumnProfile, plantar: NZ, rim: NZ): ColumnProfile {
    const z0 = profile.plantar.z;
    const z1 = profile.rim.z;
    const n0 = profile.plantar.n;
    const n1 = profile.rim.n;
    const sz = (rim.z - plantar.z) / Math.max(z1 - z0, 1e-6);
    const sn = Math.abs(n1 - n0) > 1e-6 ? (rim.n - plantar.n) / (n1 - n0) : 1;
    const poles = profile.poles.map((p) => ({
        n: plantar.n + (p.n - n0) * sn,
        z: plantar.z + (p.z - z0) * sz,
    }));
    return {
        ...profile,
        poles,
        plantar,
        rim,
    };
}
