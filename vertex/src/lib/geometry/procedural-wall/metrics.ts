// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import { analyzeManifold } from "@/lib/geometry/manifold";
import type { FoldReport, HausdorffReport } from "./types";

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

/**
 * Welded-topology fold metrics on interior same-region edges.
 * Region seams (top↔wall, wall↔bottom) are excluded — those dihedrals are the
 * designed cup, not a fold.
 */
export function foldReport(reconstruction: BufferGeometry): FoldReport {
    const pos = reconstruction.getAttribute("position").array as Float32Array;
    const index = reconstruction.getIndex();
    if (!index) return { worstDeg: 0, edgesAtLeast10Deg: 0, interiorEdgeCount: 0 };
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
    for (const [key, faces] of edgeFaces) {
        if (faces.length !== 2) continue;
        const [sa, sb] = key.split(",").map(Number) as [number, number];
        const f1 = faces[0]!;
        const f2 = faces[1]!;
        if (areaOf(f1) < 1e-3 || areaOf(f2) < 1e-3) continue;
        // Designed cup/plantar seams: skip edges whose endpoints sit on
        // different height bands (top sheet vs wall vs plantar).
        const za = (z[sa]! - minZ) / span;
        const zb = (z[sb]! - minZ) / span;
        const band = (t: number) => (t < 0.22 ? 0 : t > 0.82 ? 2 : 1);
        if (band(za) !== band(zb)) continue;
        // Exact stock top sheet carries pre-existing sliver creases; S0 fold
        // gate is the lofted wall (mid-height band on both endpoints).
        if (band(za) !== 1 || band(zb) !== 1) continue;
        const n1 = faceNormal(pos, idx[f1]!, idx[f1 + 1]!, idx[f1 + 2]!);
        const n2 = faceNormal(pos, idx[f2]!, idx[f2 + 1]!, idx[f2 + 2]!);
        if (!n1 || !n2) continue;
        const dot = Math.max(-1, Math.min(1, n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]));
        const deg = (Math.acos(dot) * 180) / Math.PI;
        interior++;
        if (deg > worst) worst = deg;
        if (deg >= 10) hard++;
    }

    return { worstDeg: worst, edgesAtLeast10Deg: hard, interiorEdgeCount: interior };
}

export function reconstructionManifold(geo: BufferGeometry) {
    const report = analyzeManifold(geo);
    return {
        watertight: report.isWatertight,
        openEdges: report.openEdges,
        nonManifoldEdges: report.nonManifoldEdges,
    };
}
