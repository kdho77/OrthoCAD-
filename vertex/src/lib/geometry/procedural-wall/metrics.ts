// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import { analyzeManifold } from "@/lib/geometry/manifold";
import { buildDishZIndex, sampleDishZVertical } from "./height-xy";
import type { FoldReport, HausdorffReport, StockWallModel, TieredHausdorffReport } from "./types";

interface Tri {
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

const HASH_CELL = 2.5;

function geometryTriangles(geo: BufferGeometry): { tris: Tri[]; verts: Float32Array } {
    const pos = geo.getAttribute("position");
    const verts = pos.array as Float32Array;
    const index = geo.getIndex();
    const tris: Tri[] = [];
    const triCount = index ? index.count / 3 : pos.count / 3;
    const vi = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);
    for (let t = 0; t < triCount; t++) {
        const ia = vi(t, 0);
        const ib = vi(t, 1);
        const ic = vi(t, 2);
        const ax = verts[ia * 3]!;
        const ay = verts[ia * 3 + 1]!;
        const az = verts[ia * 3 + 2]!;
        const bx = verts[ib * 3]!;
        const by = verts[ib * 3 + 1]!;
        const bz = verts[ib * 3 + 2]!;
        const cx = verts[ic * 3]!;
        const cy = verts[ic * 3 + 1]!;
        const cz = verts[ic * 3 + 2]!;
        tris.push({
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
    return { tris, verts };
}

function pointToTriDist(px: number, py: number, pz: number, t: Tri): number {
    const abx = t.bx - t.ax;
    const aby = t.by - t.ay;
    const abz = t.bz - t.az;
    const acx = t.cx - t.ax;
    const acy = t.cy - t.ay;
    const acz = t.cz - t.az;
    const apx = px - t.ax;
    const apy = py - t.ay;
    const apz = pz - t.az;
    const d1 = abx * apx + aby * apy + abz * apz;
    const d2 = acx * apx + acy * apy + acz * apz;
    if (d1 <= 0 && d2 <= 0) return Math.hypot(apx, apy, apz);
    const bpx = px - t.bx;
    const bpy = py - t.by;
    const bpz = pz - t.bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) return Math.hypot(bpx, bpy, bpz);
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        return Math.hypot(apx - abx * v, apy - aby * v, apz - abz * v);
    }
    const cpx = px - t.cx;
    const cpy = py - t.cy;
    const cpz = pz - t.cz;
    const d5 = abx * cpx + aby * cpy + abz * cpz;
    const d6 = acx * cpx + acy * cpy + acz * cpz;
    if (d6 >= 0 && d5 <= d6) return Math.hypot(cpx, cpy, cpz);
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
        const w = d2 / (d2 - d6);
        return Math.hypot(apx - acx * w, apy - acy * w, apz - acz * w);
    }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
        const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
        return Math.hypot(bpx + (t.cx - t.bx) * w, bpy + (t.cy - t.by) * w, bpz + (t.cz - t.bz) * w);
    }
    const denom = va + vb + vc;
    const v = vb / denom;
    const w = vc / denom;
    return Math.hypot(apx - abx * v - acx * w, apy - aby * v - acy * w, apz - abz * v - acz * w);
}

function hashInsert(map: Map<string, Tri[]>, t: Tri, cell: number): void {
    const x0 = Math.floor(t.minX / cell);
    const y0 = Math.floor(t.minY / cell);
    const z0 = Math.floor(t.minZ / cell);
    const x1 = Math.floor(t.maxX / cell);
    const y1 = Math.floor(t.maxY / cell);
    const z1 = Math.floor(t.maxZ / cell);
    for (let z = z0; z <= z1; z++) {
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const k = `${x},${y},${z}`;
                let b = map.get(k);
                if (!b) {
                    b = [];
                    map.set(k, b);
                }
                b.push(t);
            }
        }
    }
}

function nearestTriDist(
    map: Map<string, Tri[]>,
    px: number,
    py: number,
    pz: number,
    cell: number,
    fallback: number,
): number {
    const ix = Math.floor(px / cell);
    const iy = Math.floor(py / cell);
    const iz = Math.floor(pz / cell);
    let best = fallback;
    const seen = new Set<Tri>();
    for (let r = 0; r <= 12; r++) {
        for (let z = iz - r; z <= iz + r; z++) {
            for (let y = iy - r; y <= iy + r; y++) {
                for (let x = ix - r; x <= ix + r; x++) {
                    const bucket = map.get(`${x},${y},${z}`);
                    if (!bucket) continue;
                    for (const t of bucket) {
                        if (seen.has(t)) continue;
                        seen.add(t);
                        const d = pointToTriDist(px, py, pz, t);
                        if (d < best) best = d;
                    }
                }
            }
        }
        if (best < cell * (r + 0.5)) break;
    }
    return best;
}

function directedHausdorff(fromVerts: Float32Array, toTris: Map<string, Tri[]>, stride: number): number[] {
    const dists: number[] = [];
    const count = fromVerts.length / 3;
    const step = Math.max(1, stride);
    for (let i = 0; i < count; i += step) {
        const d = nearestTriDist(
            toTris,
            fromVerts[i * 3]!,
            fromVerts[i * 3 + 1]!,
            fromVerts[i * 3 + 2]!,
            HASH_CELL,
            50,
        );
        dists.push(d);
    }
    return dists;
}

function summarize(dists: number[]): HausdorffReport {
    if (dists.length === 0) return { maxMm: 0, p99Mm: 0, meanMm: 0, sampleCount: 0 };
    const sorted = dists.slice().sort((a, b) => a - b);
    const sum = sorted.reduce((s, v) => s + v, 0);
    const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))]!;
    return {
        maxMm: sorted[sorted.length - 1]!,
        p99Mm: p99,
        meanMm: sum / sorted.length,
        sampleCount: sorted.length,
    };
}

export interface HausdorffHit {
    x: number;
    y: number;
    z: number;
    dist: number;
    source: "original" | "reconstruction";
}

/** Symmetric Hausdorff (sampled) between reconstruction and the original stock mesh. */
export function hausdorffReport(
    original: BufferGeometry,
    reconstruction: BufferGeometry,
    opts?: { hits?: HausdorffHit[] },
): HausdorffReport {
    const a = geometryTriangles(original);
    const b = geometryTriangles(reconstruction);
    const hashA = new Map<string, Tri[]>();
    const hashB = new Map<string, Tri[]>();
    for (const t of a.tris) hashInsert(hashA, t, HASH_CELL);
    for (const t of b.tris) hashInsert(hashB, t, HASH_CELL);
    // Original is dense (~250k); subsample so the test stays interactive.
    const strideA = Math.max(1, Math.floor(a.verts.length / 3 / 40_000));
    const ab = directedHausdorff(a.verts, hashB, strideA);
    const ba = directedHausdorff(b.verts, hashA, 1);
    if (opts?.hits) {
        const pushWorst = (
            verts: Float32Array,
            dists: number[],
            stride: number,
            source: HausdorffHit["source"],
        ) => {
            let bestI = 0;
            for (let i = 1; i < dists.length; i++) if (dists[i]! > dists[bestI]!) bestI = i;
            const vi = bestI * stride;
            opts.hits!.push({
                x: verts[vi * 3]!,
                y: verts[vi * 3 + 1]!,
                z: verts[vi * 3 + 2]!,
                dist: dists[bestI]!,
                source,
            });
        };
        pushWorst(a.verts, ab, strideA, "original");
        pushWorst(b.verts, ba, 1, "reconstruction");
    }
    return summarize(ab.concat(ba));
}

function faceNormal(pos: Float32Array, a: number, b: number, c: number): [number, number, number] | null {
    const ax = pos[a * 3]!;
    const ay = pos[a * 3 + 1]!;
    const az = pos[a * 3 + 2]!;
    const ux = pos[b * 3]! - ax;
    const uy = pos[b * 3 + 1]! - ay;
    const uz = pos[b * 3 + 2]! - az;
    const vx = pos[c * 3]! - ax;
    const vy = pos[c * 3 + 1]! - ay;
    const vz = pos[c * 3 + 2]! - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) return null;
    return [nx / len, ny / len, nz / len];
}

export interface FoldReportOptions {
    /**
     * Skip edges whose both endpoints sit in the stock TopSheet (pre-existing
     * creases are not "new"). Seams (one endpoint in the top) are reported
     * separately as `seamWorstDeg`.
     */
    topVertexCount?: number;
    /** Count of BottomOutline-ring verts (generated plantar outer ring). */
    outlineVertexCount?: number;
    /** First outline-ring vertex id. Defaults to `topVertexCount` (legacy stitch). */
    outlineVertexStart?: number;
    /** When true, measure the whole insole (wall + plantar + new edges). */
    wholeInsole?: boolean;
}

/**
 * Fold metrics. Default (S0 compat) still looks at mid-height wall edges.
 * S1 parametric gates use `{ wholeInsole: true, topVertexCount }` so stock
 * top-sheet creases are ignored and seams are scored separately.
 */
export function foldReport(reconstruction: BufferGeometry, opts?: FoldReportOptions): FoldReport {
    const pos = reconstruction.getAttribute("position").array as Float32Array;
    const index = reconstruction.getIndex();
    if (!index) return { worstDeg: 0, edgesAtLeast10Deg: 0, interiorEdgeCount: 0, seamWorstDeg: 0 };
    const idx = index.array as Uint32Array | Uint16Array;
    const z: number[] = [];
    let minZ = Infinity;
    let maxZ = -Infinity;
    const vCount = pos.length / 3;
    for (let i = 0; i < vCount; i++) {
        const zz = pos[i * 3 + 2]!;
        z[i] = zz;
        if (zz < minZ) minZ = zz;
        if (zz > maxZ) maxZ = zz;
    }
    const span = Math.max(1e-3, maxZ - minZ);
    // Face-normal folds only: skip sliver triangles (area < 1e-4 mm²).
    const areaOf = (f: number): number => {
        const a = idx[f]!;
        const b = idx[f + 1]!;
        const c = idx[f + 2]!;
        const ux = pos[b * 3]! - pos[a * 3]!;
        const uy = pos[b * 3 + 1]! - pos[a * 3 + 1]!;
        const uz = pos[b * 3 + 2]! - pos[a * 3 + 2]!;
        const vx = pos[c * 3]! - pos[a * 3]!;
        const vy = pos[c * 3 + 1]! - pos[a * 3 + 1]!;
        const vz = pos[c * 3 + 2]! - pos[a * 3 + 2]!;
        return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) * 0.5;
    };

    const edgeFaces = new Map<string, number[]>();
    for (let f = 0; f < idx.length; f += 3) {
        const a = idx[f]!;
        const b = idx[f + 1]!;
        const c = idx[f + 2]!;
        for (const [p, q] of [
            [a, b],
            [b, c],
            [c, a],
        ] as const) {
            const k = p < q ? `${p},${q}` : `${q},${p}`;
            let faces = edgeFaces.get(k);
            if (!faces) {
                faces = [];
                edgeFaces.set(k, faces);
            }
            faces.push(f);
        }
    }

    let worst = 0;
    let hard = 0;
    let interior = 0;
    let seamWorst = 0;
    for (const [key, faces] of edgeFaces) {
        if (faces.length !== 2) continue;
        const [sa, sb] = key.split(",").map(Number) as [number, number];
        const f1 = faces[0]!;
        const f2 = faces[1]!;
        if (areaOf(f1) < 1e-3 || areaOf(f2) < 1e-3) continue;
        const topN = opts?.topVertexCount ?? 0;
        const outN = opts?.outlineVertexCount ?? 0;
        const outStart = opts?.outlineVertexStart ?? topN;
        const bothTop = topN > 0 && sa < topN && sb < topN;
        const oneTop = topN > 0 && sa < topN !== sb < topN;
        const inOutline = (v: number) => outN > 0 && v >= outStart && v < outStart + outN;
        const oneOutline = inOutline(sa) !== inOutline(sb);
        if (opts?.wholeInsole) {
            const topFace = (f: number) =>
                topN > 0 && idx[f]! < topN && idx[f + 1]! < topN && idx[f + 2]! < topN;
            if (topFace(f1) && topFace(f2)) continue;
            if (bothTop) continue;
        } else {
            const za = (z[sa]! - minZ) / span;
            const zb = (z[sb]! - minZ) / span;
            const band = (t: number) => (t < 0.22 ? 0 : t > 0.82 ? 2 : 1);
            if (band(za) !== band(zb)) continue;
            if (band(za) !== 1 || band(zb) !== 1) continue;
        }
        const n1 = faceNormal(pos, idx[f1]!, idx[f1 + 1]!, idx[f1 + 2]!);
        const n2 = faceNormal(pos, idx[f2]!, idx[f2 + 1]!, idx[f2 + 2]!);
        if (!n1 || !n2) continue;
        const dot = Math.max(-1, Math.min(1, n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]));
        const raw = (Math.acos(dot) * 180) / Math.PI;
        const deg = Math.min(raw, 180 - raw);
        if (opts?.wholeInsole && (oneTop || oneOutline)) {
            if (deg > seamWorst) seamWorst = deg;
            continue;
        }
        interior++;
        if (deg > worst) worst = deg;
        if (deg >= 10) hard++;
    }

    return { worstDeg: worst, edgesAtLeast10Deg: hard, interiorEdgeCount: interior, seamWorstDeg: seamWorst };
}

/**
 * New folds on the medial-arch upper wall (u 0.42–0.60, high-rim side, upper third).
 * Top-sheet edges are excluded so the count is "new" wall folds.
 */
export function medialArchUpperWallFolds(
    reconstruction: BufferGeometry,
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
    topVertexCount = 0,
    medialYSign: 1 | -1 = 1,
): FoldReport {
    const pos = reconstruction.getAttribute("position").array as Float32Array;
    const index = reconstruction.getIndex();
    if (!index) return { worstDeg: 0, edgesAtLeast10Deg: 0, interiorEdgeCount: 0 };
    const idx = index.array;
    const length = Math.max(1e-3, bounds.maxX - bounds.minX);
    const zSpan = Math.max(1e-3, bounds.maxZ - bounds.minZ);
    const inRegion = (v: number): boolean => {
        const x = pos[v * 3]!;
        const y = pos[v * 3 + 1]!;
        const z = pos[v * 3 + 2]!;
        const u = (x - bounds.minX) / length;
        const zf = (z - bounds.minZ) / zSpan;
        return u >= 0.42 && u <= 0.6 && y * medialYSign > 0 && zf >= 0.55;
    };
    const areaOf = (f: number): number => {
        const a = idx[f]!;
        const b = idx[f + 1]!;
        const c = idx[f + 2]!;
        const ux = pos[b * 3]! - pos[a * 3]!;
        const uy = pos[b * 3 + 1]! - pos[a * 3 + 1]!;
        const uz = pos[b * 3 + 2]! - pos[a * 3 + 2]!;
        const vx = pos[c * 3]! - pos[a * 3]!;
        const vy = pos[c * 3 + 1]! - pos[a * 3 + 1]!;
        const vz = pos[c * 3 + 2]! - pos[a * 3 + 2]!;
        return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) * 0.5;
    };
    const edgeFaces = new Map<string, number[]>();
    for (let f = 0; f < idx.length; f += 3) {
        const a = idx[f]!;
        const b = idx[f + 1]!;
        const c = idx[f + 2]!;
        for (const [p, q] of [
            [a, b],
            [b, c],
            [c, a],
        ] as const) {
            const k = p < q ? `${p},${q}` : `${q},${p}`;
            let faces = edgeFaces.get(k);
            if (!faces) {
                faces = [];
                edgeFaces.set(k, faces);
            }
            faces.push(f);
        }
    }
    let worst = 0;
    let hard = 0;
    let interior = 0;
    const hardEdges: Array<{
        a: number;
        b: number;
        deg: number;
        u: number;
        y: number;
        z: number;
        alongColumn: boolean;
        kind: "along-column" | "across-station";
    }> = [];
    for (const [key, faces] of edgeFaces) {
        if (faces.length !== 2) continue;
        const [sa, sb] = key.split(",").map(Number) as [number, number];
        if (topVertexCount > 0 && sa < topVertexCount && sb < topVertexCount) continue;
        if (!inRegion(sa) && !inRegion(sb)) continue;
        if (areaOf(faces[0]!) < 1e-3 || areaOf(faces[1]!) < 1e-3) continue;
        const n1 = faceNormal(pos, idx[faces[0]!]!, idx[faces[0]! + 1]!, idx[faces[0]! + 2]!);
        const n2 = faceNormal(pos, idx[faces[1]!]!, idx[faces[1]! + 1]!, idx[faces[1]! + 2]!);
        if (!n1 || !n2) continue;
        const dot = Math.max(-1, Math.min(1, n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]));
        const ux = pos[sb * 3]! - pos[sa * 3]!;
        const uy = pos[sb * 3 + 1]! - pos[sa * 3 + 1]!;
        const uz = pos[sb * 3 + 2]! - pos[sa * 3 + 2]!;
        const cx = n1[1] * n2[2] - n1[2] * n2[1];
        const cy = n1[2] * n2[0] - n1[0] * n2[2];
        const cz = n1[0] * n2[1] - n1[1] * n2[0];
        const ori = Math.sign(cx * ux + cy * uy + cz * uz) || 1;
        const deg = (ori * (Math.acos(dot) * 180)) / Math.PI;
        interior++;
        if (Math.abs(deg) > worst) worst = Math.abs(deg);
        if (Math.abs(deg) >= 10) {
            hard++;
            const mx = 0.5 * (pos[sa * 3]! + pos[sb * 3]!);
            const my = 0.5 * (pos[sa * 3 + 1]! + pos[sb * 3 + 1]!);
            const mz = 0.5 * (pos[sa * 3 + 2]! + pos[sb * 3 + 2]!);
            const dxy = Math.hypot(ux, uy);
            // Same-row vertices (small |Δz|) are the along-column crease.
            const alongColumn = Math.abs(uz) < dxy;
            hardEdges.push({
                a: sa,
                b: sb,
                deg: Number(deg.toFixed(2)),
                u: Number(((mx - bounds.minX) / length).toFixed(4)),
                y: Number(my.toFixed(2)),
                z: Number(mz.toFixed(2)),
                alongColumn,
                kind: alongColumn ? "along-column" : "across-station",
            });
        }
    }
    if (hardEdges.length) {
        console.log("[S1-MEDIAL-ARCH-UPPER]", JSON.stringify({ n: hardEdges.length, edges: hardEdges }));
    }
    return { worstDeg: worst, edgesAtLeast10Deg: hard, interiorEdgeCount: interior, hardEdges };
}

/** Plantar-boundary z and face tilt (deg from horizontal) on the sheet rim. */
export function sheetBoundaryStats(
    positions: Float32Array | undefined,
    indices: Uint32Array | undefined,
    rimLocal: number[] | undefined,
): { zMax: number; tiltDegMax: number } {
    if (!positions || !rimLocal?.length) return { zMax: 0, tiltDegMax: 0 };
    let zMax = -Infinity;
    for (const i of rimLocal) {
        const z = positions[i * 3 + 2]!;
        if (z > zMax) zMax = z;
    }
    let tiltDegMax = 0;
    if (indices && indices.length >= 3) {
        const rimSet = new Set(rimLocal);
        for (let t = 0; t < indices.length; t += 3) {
            const a = indices[t]!;
            const b = indices[t + 1]!;
            const c = indices[t + 2]!;
            if (!rimSet.has(a) && !rimSet.has(b) && !rimSet.has(c)) continue;
            const ax = positions[a * 3]!;
            const ay = positions[a * 3 + 1]!;
            const az = positions[a * 3 + 2]!;
            const ux = positions[b * 3]! - ax;
            const uy = positions[b * 3 + 1]! - ay;
            const uz = positions[b * 3 + 2]! - az;
            const vx = positions[c * 3]! - ax;
            const vy = positions[c * 3 + 1]! - ay;
            const vz = positions[c * 3 + 2]! - az;
            const nx = uy * vz - uz * vy;
            const ny = uz * vx - ux * vz;
            const nz = ux * vy - uy * vx;
            const len = Math.hypot(nx, ny, nz);
            if (len < 1e-12) continue;
            const tilt = (Math.acos(Math.max(-1, Math.min(1, Math.abs(nz / len)))) * 180) / Math.PI;
            if (tilt > tiltDegMax) tiltDegMax = tilt;
        }
    }
    return {
        zMax: Number.isFinite(zMax) ? zMax : 0,
        tiltDegMax,
    };
}

/** Max distance from reconstructed stitch verts to the source plantar rim. */
export function stitchVertexDeltaMm(
    reconstruction: BufferGeometry,
    rimLocal: number[] | undefined,
    sheetPositions: Float32Array | undefined,
    topVertexCount: number,
): number {
    if (!rimLocal?.length || !sheetPositions) return 0;
    const pos = reconstruction.getAttribute("position").array as Float32Array;
    let max = 0;
    for (const li of rimLocal) {
        const sx = sheetPositions[li * 3]!;
        const sy = sheetPositions[li * 3 + 1]!;
        const sz = sheetPositions[li * 3 + 2]!;
        const ri = topVertexCount + li;
        const dx = pos[ri * 3]! - sx;
        const dy = pos[ri * 3 + 1]! - sy;
        const dz = pos[ri * 3 + 2]! - sz;
        const d = Math.hypot(dx, dy, dz);
        if (d > max) max = d;
    }
    return max;
}

function regionMask(verts: Float32Array, pred: (x: number, y: number, z: number) => boolean): Float32Array {
    const out: number[] = [];
    for (let i = 0; i < verts.length; i += 3) {
        if (pred(verts[i]!, verts[i + 1]!, verts[i + 2]!)) {
            out.push(verts[i]!, verts[i + 1]!, verts[i + 2]!);
        }
    }
    return new Float32Array(out);
}

function directedToMesh(from: Float32Array, toHash: Map<string, Tri[]>, stride: number): number[] {
    return directedHausdorff(from, toHash, stride);
}

export function tieredHausdorffReport(
    original: BufferGeometry,
    reconstruction: BufferGeometry,
    model: StockWallModel,
): TieredHausdorffReport {
    const a = geometryTriangles(original);
    const b = geometryTriangles(reconstruction);
    const hashA = new Map<string, Tri[]>();
    const hashB = new Map<string, Tri[]>();
    for (const t of a.tris) hashInsert(hashA, t, HASH_CELL);
    for (const t of b.tris) hashInsert(hashB, t, HASH_CELL);
    const minZ = model.bounds.minZ;
    const maxZ = model.bounds.maxZ;
    const span = Math.max(1e-3, maxZ - minZ);
    const minX = model.bounds.minX;
    const length = Math.max(1e-3, model.bounds.maxX - minX);
    const strideA = Math.max(1, Math.floor(a.verts.length / 3 / 30_000));

    const pair = (
        pred: (x: number, y: number, z: number) => boolean,
        strideFromOrig: number,
    ): HausdorffReport => {
        const va = regionMask(a.verts, pred);
        const vb = regionMask(b.verts, pred);
        if (va.length < 3 && vb.length < 3) return { maxMm: 0, p99Mm: 0, meanMm: 0, sampleCount: 0 };
        const ab = va.length >= 3 ? directedToMesh(va, hashB, strideFromOrig) : [];
        const ba = vb.length >= 3 ? directedToMesh(vb, hashA, 1) : [];
        return summarize(ab.concat(ba));
    };

    const top = pair((_, __, z) => (z - minZ) / span > 0.82, strideA);
    const plantar = pair((_, __, z) => (z - minZ) / span < 0.14, strideA);
    const wall = pair((_, __, z) => {
        const t = (z - minZ) / span;
        return t >= 0.14 && t <= 0.82;
    }, strideA);
    const heelCup = pair((x, _, z) => {
        const t = (z - minZ) / span;
        const u = (x - minX) / length;
        return t >= 0.14 && t <= 0.82 && u < 0.28;
    }, strideA);

    const rimOrig = model.trim.spline.controls;
    const outlineOrig = model.outline.spline.controls;
    const rimPacked = new Float32Array(rimOrig.length * 3);
    for (let i = 0; i < rimOrig.length; i++) {
        rimPacked[i * 3] = rimOrig[i]!.x;
        rimPacked[i * 3 + 1] = rimOrig[i]!.y;
        rimPacked[i * 3 + 2] = rimOrig[i]!.z;
    }
    const outPacked = new Float32Array(outlineOrig.length * 3);
    for (let i = 0; i < outlineOrig.length; i++) {
        outPacked[i * 3] = outlineOrig[i]!.x;
        outPacked[i * 3 + 1] = outlineOrig[i]!.y;
        outPacked[i * 3 + 2] = outlineOrig[i]!.z;
    }
    const rim = summarize(directedToMesh(rimPacked, hashB, 1));
    const outline = summarize(directedToMesh(outPacked, hashB, 1));

    return { top, plantar, rim, outline, wall, heelCup };
}

export function minWallThicknessMm(model: StockWallModel): number {
    const top = model.top.field;
    const bot = model.outline.plantarZ;
    const poly = model.outline.spline.controls;
    if (poly.length < 3) return 0;
    let min = Infinity;
    const minX = model.bounds.minX;
    const minY = model.bounds.minY;
    const sx = Math.max(1e-3, model.bounds.maxX - minX);
    const sy = Math.max(1e-3, model.bounds.maxY - minY);
    const pointIn = (x: number, y: number): boolean => {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i]!.x;
            const yi = poly[i]!.y;
            const xj = poly[j]!.x;
            const yj = poly[j]!.y;
            if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-18) + xi) inside = !inside;
        }
        return inside;
    };
    for (let iy = 0; iy < 18; iy++) {
        for (let ix = 0; ix < 28; ix++) {
            const x = minX + ((ix + 0.5) / 28) * sx;
            const y = minY + ((iy + 0.5) / 18) * sy;
            if (!pointIn(x, y)) continue;
            const tz = sampleUvFromModel(top, x, y);
            const bz = sampleUvFromModel(bot, x, y);
            if (tz == null || bz == null) continue;
            min = Math.min(min, tz - bz);
        }
    }
    return Number.isFinite(min) ? min : 0;
}

function sampleUvFromModel(field: import("./types").UvHeightField, x: number, y: number): number | null {
    const u = ((x - field.originX) / field.sizeX) * (field.nu - 1);
    const v = ((y - field.originY) / field.sizeY) * (field.nv - 1);
    if (u < 0 || v < 0 || u > field.nu - 1 || v > field.nv - 1) return null;
    const u0 = Math.max(0, Math.min(field.nu - 2, Math.floor(u)));
    const v0 = Math.max(0, Math.min(field.nv - 2, Math.floor(v)));
    const i = v0 * field.nu + u0;
    if (!field.inside[i] || !Number.isFinite(field.z[i]!)) return null;
    return field.z[i]!;
}

export function reconstructionManifold(geo: BufferGeometry) {
    const report = analyzeManifold(geo);
    return {
        watertight: report.isWatertight,
        openEdges: report.openEdges,
        nonManifoldEdges: report.nonManifoldEdges,
    };
}

/** Shared-prefix position delta. Extra verts (boundary splits) do not fail the surface. */
export function maxVertexDeltaMm(a: Float32Array, b: Float32Array): number {
    const n = Math.min(a.length, b.length);
    let max = 0;
    for (let i = 0; i < n; i++) max = Math.max(max, Math.abs(a[i]! - b[i]!));
    return max;
}

/** Split top-surface identity: rim verts vs interior (3D mm). */
export function topSurfaceDeltas(
    recon: Float32Array,
    stock: Float32Array,
    rimLocal: number[],
): { rimMm: number; interiorMm: number } {
    const n = Math.min(recon.length, stock.length) / 3;
    const rim = new Set(rimLocal);
    let rimMm = 0;
    let interiorMm = 0;
    for (let i = 0; i < n; i++) {
        const d = Math.hypot(
            recon[i * 3]! - stock[i * 3]!,
            recon[i * 3 + 1]! - stock[i * 3 + 1]!,
            recon[i * 3 + 2]! - stock[i * 3 + 2]!,
        );
        if (rim.has(i)) rimMm = Math.max(rimMm, d);
        else interiorMm = Math.max(interiorMm, d);
    }
    return { rimMm, interiorMm };
}

/** Max XY distance from the last wall row to the B(i) used for the CDT. */
export function outlineExactOnBMm(reconstruction: BufferGeometry): number {
    const ring = (reconstruction.userData as { outlineRing?: Array<{ x: number; y: number }> }).outlineRing;
    const b = (reconstruction.userData as { bottomOutlineB?: Array<{ x: number; y: number }> })
        .bottomOutlineB;
    if (!ring?.length || !b?.length || ring.length !== b.length) {
        return ring?.length && b?.length ? Infinity : 0;
    }
    let max = 0;
    for (let i = 0; i < ring.length; i++) {
        max = Math.max(max, Math.hypot(ring[i]!.x - b[i]!.x, ring[i]!.y - b[i]!.y));
    }
    return max;
}

export function generatedMinWallMm(reconstruction: BufferGeometry): number {
    const frames =
        (reconstruction.userData as { wallFrames?: Array<{ heightMm?: number }> }).wallFrames ?? [];
    let min = Infinity;
    for (const f of frames) {
        if (typeof f.heightMm === "number") min = Math.min(min, f.heightMm);
    }
    return Number.isFinite(min) ? min : 0;
}

/** Max XY distance from the generated outline ring to BottomOutline. */
export function outlineRingDeviationMm(reconstruction: BufferGeometry, model: StockWallModel): number {
    const ring = (reconstruction.userData as { outlineRing?: Array<{ x: number; y: number }> }).outlineRing;
    const loop = model.outline.spline.controls;
    if (!ring?.length || loop.length < 2) return Infinity;
    let max = 0;
    for (const p of ring) {
        let best = Infinity;
        for (let i = 0; i < loop.length; i++) {
            const a = loop[i]!;
            const b = loop[(i + 1) % loop.length]!;
            const ex = b.x - a.x;
            const ey = b.y - a.y;
            const len2 = ex * ex + ey * ey;
            const t =
                len2 > 1e-12 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2)) : 0;
            const dx = p.x - (a.x + ex * t);
            const dy = p.y - (a.y + ey * t);
            const d = Math.hypot(dx, dy);
            if (d < best) best = d;
        }
        if (best > max) max = best;
    }
    return max;
}

/** Max |generated-plantar z − stock dish z| at interior samples. */
export function dishInteriorDeltaMm(
    reconstruction: BufferGeometry,
    model: StockWallModel,
    insetMm = 4,
): number {
    const pos = reconstruction.getAttribute("position").array as Float32Array;
    const outline = model.outline.spline.controls;
    if (outline.length < 3 || !model.outline.meshPositions || !model.outline.meshIndices) return 0;
    const dish = buildDishZIndex(model.outline.meshPositions, model.outline.meshIndices);
    const generatedStart = (reconstruction.userData as { generatedStart?: number }).generatedStart ?? 0;
    const generatedCount = (reconstruction.userData as { generatedCount?: number }).generatedCount ?? 0;
    const outlineRow = (reconstruction.userData as { outlineRow?: number }).outlineRow ?? 0;
    const nS = (reconstruction.userData as { stationCount?: number }).stationCount ?? 0;
    const plantarStart =
        (reconstruction.userData as { plantarStart?: number }).plantarStart ??
        generatedStart + Math.max(0, outlineRow) * nS;
    let max = 0;
    let n = 0;
    const start = plantarStart;
    const end = generatedStart + generatedCount;
    for (let i = start; i < end && i < pos.length / 3; i++) {
        const x = pos[i * 3]!;
        const y = pos[i * 3 + 1]!;
        const z = pos[i * 3 + 2]!;
        let inside = false;
        for (let a = 0, b = outline.length - 1; a < outline.length; b = a++) {
            const yi = outline[a]!.y;
            const yj = outline[b]!.y;
            const xi = outline[a]!.x;
            const xj = outline[b]!.x;
            if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-18) + xi) inside = !inside;
        }
        if (!inside) continue;
        const stock = sampleDishZVertical(dish, x, y);
        if (stock == null) continue;
        const d = Math.abs(z - stock);
        if (d > max) max = d;
        n++;
    }
    void insetMm;
    return n ? max : 0;
}

/** Max |plantar z| on generated plantar verts where the field delta is ~0. */
export function plantarFlatDeltaMm(
    geo: BufferGeometry,
    zDelta: (x: number, y: number) => number = () => 0,
    eps = 1e-6,
): number {
    const pos = geo.getAttribute("position").array as Float32Array;
    const plantarStart = (geo.userData as { plantarStart?: number }).plantarStart ?? 0;
    const n = pos.length / 3;
    let max = 0;
    for (let i = plantarStart; i < n; i++) {
        const x = pos[i * 3]!;
        const y = pos[i * 3 + 1]!;
        const z = pos[i * 3 + 2]!;
        if (Math.abs(zDelta(x, y)) > eps) continue;
        max = Math.max(max, Math.abs(z));
    }
    return max;
}

export function meshVertexMinZ(geo: BufferGeometry): number {
    const pos = geo.getAttribute("position").array as Float32Array;
    let minZ = Infinity;
    for (let i = 2; i < pos.length; i += 3) minZ = Math.min(minZ, pos[i]!);
    return Number.isFinite(minZ) ? minZ : 0;
}

export function countDegenerateFaces(geo: BufferGeometry): { zeroArea: number; duplicates: number } {
    const pos = geo.getAttribute("position").array as Float32Array;
    const index = geo.getIndex();
    if (!index) return { zeroArea: 0, duplicates: 0 };
    const idx = index.array;
    const seen = new Set<string>();
    let zeroArea = 0;
    let duplicates = 0;
    for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t]!;
        const b = idx[t + 1]!;
        const c = idx[t + 2]!;
        if (a === b || b === c || c === a) {
            zeroArea++;
            continue;
        }
        const ax = pos[a * 3]!;
        const ay = pos[a * 3 + 1]!;
        const az = pos[a * 3 + 2]!;
        const ux = pos[b * 3]! - ax;
        const uy = pos[b * 3 + 1]! - ay;
        const uz = pos[b * 3 + 2]! - az;
        const vx = pos[c * 3]! - ax;
        const vy = pos[c * 3 + 1]! - ay;
        const vz = pos[c * 3 + 2]! - az;
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        if (nx * nx + ny * ny + nz * nz < 1e-20) {
            zeroArea++;
            continue;
        }
        const canon = [a, b, c]
            .slice()
            .sort((x, y) => x - y)
            .join(",");
        if (seen.has(canon)) duplicates++;
        else seen.add(canon);
    }
    return { zeroArea, duplicates };
}

/** Faces that touch `bandVerts` with longest/shortest edge > 20. */
export function countJunctionBandSlivers(
    geo: BufferGeometry,
    bandVerts: Iterable<number>,
    aspectLimit = 20,
): number {
    const pos = geo.getAttribute("position").array as Float32Array;
    const index = geo.getIndex();
    if (!index) return 0;
    const idx = index.array;
    const band = bandVerts instanceof Set ? bandVerts : new Set(bandVerts);
    let n = 0;
    for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t]!;
        const b = idx[t + 1]!;
        const c = idx[t + 2]!;
        if (!band.has(a) && !band.has(b) && !band.has(c)) continue;
        const e1 = Math.hypot(
            pos[b * 3]! - pos[a * 3]!,
            pos[b * 3 + 1]! - pos[a * 3 + 1]!,
            pos[b * 3 + 2]! - pos[a * 3 + 2]!,
        );
        const e2 = Math.hypot(
            pos[c * 3]! - pos[b * 3]!,
            pos[c * 3 + 1]! - pos[b * 3 + 1]!,
            pos[c * 3 + 2]! - pos[b * 3 + 2]!,
        );
        const e3 = Math.hypot(
            pos[a * 3]! - pos[c * 3]!,
            pos[a * 3 + 1]! - pos[c * 3 + 1]!,
            pos[a * 3 + 2]! - pos[c * 3 + 2]!,
        );
        const short = Math.min(e1, e2, e3);
        const long = Math.max(e1, e2, e3);
        if (short < 1e-9 || long / short > aspectLimit) n++;
    }
    return n;
}

export function groundDriftMm(
    geo: BufferGeometry,
    outline: Array<{ x: number; y: number; z: number }>,
): number {
    const pos = geo.getAttribute("position").array as Float32Array;
    let minZ = Infinity;
    for (let i = 0; i < pos.length; i += 3) minZ = Math.min(minZ, pos[i + 2]!);
    let ref = Infinity;
    for (const p of outline) ref = Math.min(ref, p.z);
    if (!Number.isFinite(minZ) || !Number.isFinite(ref)) return 0;
    return minZ - ref;
}

export function cupHeightAtU(
    pts: Array<{ x: number; y: number; z: number }>,
    outline: Array<{ x: number; y: number; z: number }>,
    bounds: { minX: number; maxX: number },
    uTarget: number,
): number {
    const length = Math.max(1e-3, bounds.maxX - bounds.minX);
    let bestH = 0;
    let bestD = Infinity;
    const n = Math.min(pts.length, outline.length);
    for (let i = 0; i < n; i++) {
        const u = (outline[i]!.x - bounds.minX) / length;
        const d = Math.abs(u - uTarget);
        if (d < bestD) {
            bestD = d;
            bestH = pts[i]!.z - outline[i]!.z;
        }
    }
    return bestH;
}

export function heelInnerWidthAtU(
    outline: Array<{ x: number; y: number; z: number }>,
    bounds: { minX: number; maxX: number },
    u0 = 0.1,
    u1 = 0.14,
): number {
    const length = Math.max(1e-3, bounds.maxX - bounds.minX);
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const p of outline) {
        const u = (p.x - bounds.minX) / length;
        if (u < u0 || u > u1) continue;
        yMin = Math.min(yMin, p.y);
        yMax = Math.max(yMax, p.y);
    }
    return Number.isFinite(yMin) ? yMax - yMin : 0;
}

/** Measure chord flare (deg) of rebuilt wall stations in a region. */
/**
 * Seam dihedral at each outline station (deg, folded into [0, 90]).
 * Used to gate the rebuilt wall against the stock join, not a fixed angle.
 */
export function outlineSeamDihedrals(
    geo: BufferGeometry,
    outline: Array<{ x: number; y: number; z: number }> = [],
    _tolMm = 0.85,
): { worstDeg: number; meanDeg: number; perStation: number[] } {
    const pos = geo.getAttribute("position").array as Float32Array;
    const index = geo.getIndex();
    const ud = geo.userData as { outlineVertexStart?: number; outlineVertexCount?: number };
    const start = ud.outlineVertexStart;
    const nRing = ud.outlineVertexCount;
    const n = nRing && nRing >= 3 ? nRing : outline.length;
    const empty = { worstDeg: 0, meanDeg: 0, perStation: Array.from({ length: n }, () => 0) };
    if (!index || n < 3) return empty;
    const idx = index.array;
    const edgeFaces = new Map<string, number[]>();
    for (let f = 0; f < idx.length; f += 3) {
        const a = idx[f]!;
        const b = idx[f + 1]!;
        const c = idx[f + 2]!;
        for (const [p, q] of [
            [a, b],
            [b, c],
            [c, a],
        ] as const) {
            const k = p < q ? `${p},${q}` : `${q},${p}`;
            let faces = edgeFaces.get(k);
            if (!faces) {
                faces = [];
                edgeFaces.set(k, faces);
            }
            faces.push(f);
        }
    }
    const perStation = Array.from({ length: n }, () => 0);
    const ringIndex = (i: number): [number, number] | null => {
        if (typeof start === "number" && nRing && nRing >= 3) {
            return [start + i, start + ((i + 1) % nRing)];
        }
        return null;
    };
    for (let i = 0; i < n; i++) {
        const pair = ringIndex(i);
        let faces: number[] | undefined;
        if (pair) {
            const [sa, sb] = pair;
            faces = edgeFaces.get(sa < sb ? `${sa},${sb}` : `${sb},${sa}`);
        }
        if (!faces || faces.length !== 2) continue;
        const n1 = faceNormal(pos, idx[faces[0]!]!, idx[faces[0]! + 1]!, idx[faces[0]! + 2]!);
        const n2 = faceNormal(pos, idx[faces[1]!]!, idx[faces[1]! + 1]!, idx[faces[1]! + 2]!);
        if (!n1 || !n2) continue;
        const dot = Math.max(-1, Math.min(1, n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]));
        perStation[i] = (Math.acos(dot) * 180) / Math.PI;
    }
    let worst = 0;
    let sum = 0;
    let c = 0;
    for (const d of perStation) {
        if (d > worst) worst = d;
        if (d > 0) {
            sum += d;
            c++;
        }
    }
    return { worstDeg: worst, meanDeg: c ? sum / c : 0, perStation };
}

export interface WindingReport {
    signedVolume: number;
    oppositeEdgeMismatch: number;
    consistent: boolean;
}

/** Outward winding: positive volume and every welded-mesh edge used once each way. */
export function windingReport(geo: BufferGeometry): WindingReport {
    const pos = geo.getAttribute("position").array as Float32Array;
    const index = geo.getIndex();
    if (!index) return { signedVolume: 0, oppositeEdgeMismatch: 0, consistent: false };
    const idx = index.array;
    const q = 1e-4;
    const weldOf = (i: number): string =>
        `${Math.round(pos[i * 3]! / q)},${Math.round(pos[i * 3 + 1]! / q)},${Math.round(pos[i * 3 + 2]! / q)}`;
    const directed = new Map<string, number>();
    let vol6 = 0;
    for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t]!;
        const b = idx[t + 1]!;
        const c = idx[t + 2]!;
        const ax = pos[a * 3]!;
        const ay = pos[a * 3 + 1]!;
        const az = pos[a * 3 + 2]!;
        const bx = pos[b * 3]!;
        const by = pos[b * 3 + 1]!;
        const bz = pos[b * 3 + 2]!;
        const cx = pos[c * 3]!;
        const cy = pos[c * 3 + 1]!;
        const cz = pos[c * 3 + 2]!;
        vol6 += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
        const wa = weldOf(a);
        const wb = weldOf(b);
        const wc = weldOf(c);
        for (const [p, qid] of [
            [wa, wb],
            [wb, wc],
            [wc, wa],
        ] as const) {
            if (p === qid) continue;
            const k = `${p}>${qid}`;
            directed.set(k, (directed.get(k) ?? 0) + 1);
        }
    }
    let mismatch = 0;
    const seen = new Set<string>();
    for (const key of directed.keys()) {
        const sep = key.indexOf(">");
        const p = key.slice(0, sep);
        const qq = key.slice(sep + 1);
        const und = p < qq ? `${p}|${qq}` : `${qq}|${p}`;
        if (seen.has(und)) continue;
        seen.add(und);
        const fwd = directed.get(`${p}>${qq}`) ?? 0;
        const back = directed.get(`${qq}>${p}`) ?? 0;
        if (fwd !== 1 || back !== 1) mismatch++;
    }
    const signedVolume = vol6 / 6;
    return {
        signedVolume,
        oppositeEdgeMismatch: mismatch,
        consistent: signedVolume > 0 && mismatch === 0,
    };
}

export function measureReconFlareDeg(
    stations: Array<{
        outline: { x: number; y: number; z: number };
        rim: { x: number; y: number; z: number };
        n: { x: number; y: number };
        u: number;
    }>,
    pred: (s: { u: number; y: number }) => boolean,
): number {
    let s = 0;
    let c = 0;
    for (const st of stations) {
        if (!pred({ u: st.u, y: st.outline.y })) continue;
        const h = st.rim.z - st.outline.z;
        const off = (st.rim.x - st.outline.x) * st.n.x + (st.rim.y - st.outline.y) * st.n.y;
        s += (Math.atan2(off, Math.max(h, 1e-6)) * 180) / Math.PI;
        c++;
    }
    return c ? s / c : 0;
}
