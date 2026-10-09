// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { PLANTAR_Z_MAX_MM } from "@/lib/geometry/base-modifier";
import { quinticSmoothstep } from "@/lib/geometry/height-field";
import {
    extractBoundaryLoopsBranchedWithIndices,
    extractOrderedBoundaryLoopWithIndices,
    submeshByVertexRange,
} from "@/lib/geometry/mesh-close";
import {
    arcLengthMatch,
    ensureCcw,
    fitClosedC2Spline,
    type PolyPoint,
    resamplePolyline,
    startAtPosteriorHeel,
} from "./curves";
import { DEFAULT_LOFT_N, type StockWallModel, type UvHeightField, type WallProfile } from "./types";

const UV_CELL_MM = 0.7;
const OUTLINE_BINS = 360;
const OFFSET_H = [0, 0.06, 0.12, 0.18, 0.25, 0.32, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
const WALL_HASH_CELL = 2.5;
const WALL_SEARCH_MM = 16;
const PLANTAR_OUTLINE_Z_MM = 2;
const SOLE_FIELD_Z_MM = 3.5;

function topVertexCountOf(geo: BufferGeometry): number {
    return (geo.userData as { topVertexCount?: number }).topVertexCount ?? 0;
}

function emptyField(): UvHeightField {
    return {
        originX: 0,
        originY: 0,
        sizeX: 1,
        sizeY: 1,
        nu: 1,
        nv: 1,
        z: new Float32Array([Number.NaN]),
        inside: new Uint8Array([0]),
        samples: new Float32Array(0),
    };
}

function buildUvField(points: Array<{ x: number; y: number; z: number }>, padMm = 1): UvHeightField {
    if (points.length === 0) return emptyField();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    const originX = minX - padMm;
    const originY = minY - padMm;
    const sizeX = Math.max(1e-3, maxX - minX + 2 * padMm);
    const sizeY = Math.max(1e-3, maxY - minY + 2 * padMm);
    const nu = Math.max(8, Math.ceil(sizeX / UV_CELL_MM) + 1);
    const nv = Math.max(8, Math.ceil(sizeY / UV_CELL_MM) + 1);
    const z = new Float32Array(nu * nv);
    const w = new Float32Array(nu * nv);
    const inside = new Uint8Array(nu * nv);
    z.fill(Number.NaN);

    for (const p of points) {
        const u = ((p.x - originX) / sizeX) * (nu - 1);
        const v = ((p.y - originY) / sizeY) * (nv - 1);
        const u0 = Math.max(0, Math.min(nu - 2, Math.floor(u)));
        const v0 = Math.max(0, Math.min(nv - 2, Math.floor(v)));
        const fu = u - u0;
        const fv = v - v0;
        const acc = (iu: number, iv: number, ww: number) => {
            if (ww <= 0) return;
            const i = iv * nu + iu;
            const prev = w[i]!;
            const nz = Number.isFinite(z[i]!) ? (z[i]! * prev + p.z * ww) / (prev + ww) : p.z;
            z[i] = nz;
            w[i] = prev + ww;
            inside[i] = 1;
        };
        acc(u0, v0, (1 - fu) * (1 - fv));
        acc(u0 + 1, v0, fu * (1 - fv));
        acc(u0, v0 + 1, (1 - fu) * fv);
        acc(u0 + 1, v0 + 1, fu * fv);
    }

    // Fill isolated holes by 4-neighbour average (keeps the field dense inside).
    for (let pass = 0; pass < 4; pass++) {
        const next = z.slice();
        for (let iv = 1; iv < nv - 1; iv++) {
            for (let iu = 1; iu < nu - 1; iu++) {
                const i = iv * nu + iu;
                if (inside[i]) continue;
                let s = 0;
                let c = 0;
                for (const [du, dv] of [
                    [1, 0],
                    [-1, 0],
                    [0, 1],
                    [0, -1],
                ] as const) {
                    const j = (iv + dv) * nu + (iu + du);
                    if (inside[j] && Number.isFinite(z[j]!)) {
                        s += z[j]!;
                        c++;
                    }
                }
                if (c >= 3) {
                    next[i] = s / c;
                    inside[i] = 1;
                }
            }
        }
        z.set(next);
    }

    const samples = new Float32Array(points.length * 3);
    for (let i = 0; i < points.length; i++) {
        samples[i * 3] = points[i]!.x;
        samples[i * 3 + 1] = points[i]!.y;
        samples[i * 3 + 2] = points[i]!.z;
    }
    return { originX, originY, sizeX, sizeY, nu, nv, z, inside, samples };
}

export function sampleUvField(field: UvHeightField, x: number, y: number): number | null {
    const u = ((x - field.originX) / field.sizeX) * (field.nu - 1);
    const v = ((y - field.originY) / field.sizeY) * (field.nv - 1);
    if (u < 0 || v < 0 || u > field.nu - 1 || v > field.nv - 1) return null;
    const u0 = Math.max(0, Math.min(field.nu - 2, Math.floor(u)));
    const v0 = Math.max(0, Math.min(field.nv - 2, Math.floor(v)));
    const fu = u - u0;
    const fv = v - v0;
    const zAt = (iu: number, iv: number): number | null => {
        const i = iv * field.nu + iu;
        if (!field.inside[i] || !Number.isFinite(field.z[i]!)) return null;
        return field.z[i]!;
    };
    const z00 = zAt(u0, v0);
    const z10 = zAt(u0 + 1, v0);
    const z01 = zAt(u0, v0 + 1);
    const z11 = zAt(u0 + 1, v0 + 1);
    const parts: Array<[number, number]> = [];
    if (z00 != null) parts.push([z00, (1 - fu) * (1 - fv)]);
    if (z10 != null) parts.push([z10, fu * (1 - fv)]);
    if (z01 != null) parts.push([z01, (1 - fu) * fv]);
    if (z11 != null) parts.push([z11, fu * fv]);
    if (parts.length === 0) return null;
    let s = 0;
    let w = 0;
    for (const [zz, ww] of parts) {
        s += zz * ww;
        w += ww;
    }
    if (w > 1e-12) return s / w;
    if (parts.length) return parts[0]![0];
    return nearestSampleZ(field, x, y);
}

const sampleHashCache = new WeakMap<UvHeightField, Map<string, number[]>>();

function nearestSampleZ(field: UvHeightField, x: number, y: number): number | null {
    const s = field.samples;
    if (!s || s.length < 3) return null;
    let hash = sampleHashCache.get(field);
    if (!hash) {
        hash = new Map();
        for (let i = 0; i < s.length; i += 3) {
            const k = `${Math.floor(s[i]! / 2)},${Math.floor(s[i + 1]! / 2)}`;
            let b = hash.get(k);
            if (!b) {
                b = [];
                hash.set(k, b);
            }
            b.push(i);
        }
        sampleHashCache.set(field, hash);
    }
    const ix = Math.floor(x / 2);
    const iy = Math.floor(y / 2);
    let best = 64;
    let z = Number.NaN;
    for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
            const bucket = hash.get(`${ix + dx},${iy + dy}`);
            if (!bucket) continue;
            for (const i of bucket) {
                const d = (s[i]! - x) ** 2 + (s[i + 1]! - y) ** 2;
                if (d < best) {
                    best = d;
                    z = s[i + 2]!;
                }
            }
        }
    }
    return Number.isFinite(z) ? z : null;
}

function extractTopRim(geo: BufferGeometry): { points: PolyPoint[]; indices: number[] } {
    const topN = topVertexCountOf(geo);
    if (topN < 3) return { points: [], indices: [] };
    const topSub = submeshByVertexRange(geo, 0, topN);
    try {
        const ordered = extractOrderedBoundaryLoopWithIndices(topSub);
        return {
            points: ordered.positions.map((p) => ({ x: p.x, y: p.y, z: p.z })),
            indices: ordered.indices.slice(),
        };
    } finally {
        topSub.dispose();
    }
}

function followWallToPlantar(
    trim: PolyPoint,
    wallHash: Map<string, PolyPoint[]>,
    plantarHash: Map<string, PolyPoint[]>,
): PolyPoint {
    let x = trim.x;
    let y = trim.y;
    let z = trim.z;
    const steps = 14;
    for (let s = 1; s <= steps; s++) {
        const hz = trim.z * (1 - s / steps);
        const hit = nearestInHash(wallHash, x, y, hz, WALL_HASH_CELL, 12);
        if (hit) {
            x = hit.x;
            y = hit.y;
            z = hit.z;
        }
    }
    const foot = nearestInHash(plantarHash, x, y, Math.min(z, PLANTAR_Z_MAX_MM), 3, 16);
    if (foot) return { x: foot.x, y: foot.y, z: foot.z };
    return { x, y, z: Math.min(z, PLANTAR_Z_MAX_MM) };
}

function smoothClosedPolyline(pts: PolyPoint[], passes: number, mix: number): PolyPoint[] {
    if (pts.length < 4) return pts;
    let cur = pts.map((p) => ({ ...p }));
    for (let pass = 0; pass < passes; pass++) {
        const next: PolyPoint[] = [];
        for (let i = 0; i < cur.length; i++) {
            const a = cur[(i + cur.length - 1) % cur.length]!;
            const b = cur[i]!;
            const c = cur[(i + 1) % cur.length]!;
            next.push({
                x: b.x * (1 - mix) + (a.x + c.x) * 0.5 * mix,
                y: b.y * (1 - mix) + (a.y + c.y) * 0.5 * mix,
                z: b.z * (1 - mix) + (a.z + c.z) * 0.5 * mix,
            });
        }
        cur = next;
    }
    return cur;
}

function extractPlantarOutline(geo: BufferGeometry, trim: PolyPoint[]): PolyPoint[] {
    const pos = geo.getAttribute("position");
    const topN = topVertexCountOf(geo);
    const start = topN > 0 && topN < pos.count ? topN : 0;
    const band: PolyPoint[] = [];
    const allBot: PolyPoint[] = [];
    for (let i = start; i < pos.count; i++) {
        const p = { x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) };
        allBot.push(p);
        if (p.z <= PLANTAR_OUTLINE_Z_MM) band.push(p);
    }
    const pool = band.length >= 16 ? band : allBot;
    if (pool.length === 0) return [];

    if (trim.length >= 8) {
        const hash = buildPointHash(pool.length >= 16 ? pool : allBot, 3);
        const wallHash = buildPointHash(allBot, WALL_HASH_CELL);
        const paired: PolyPoint[] = [];
        for (const t of trim) {
            paired.push(followWallToPlantar(t, wallHash, hash));
        }
        return startAtPosteriorHeel(ensureCcw(smoothClosedPolyline(paired, 2, 0.25)));
    }

    let cx = 0;
    let cy = 0;
    for (const p of pool) {
        cx += p.x;
        cy += p.y;
    }
    cx /= pool.length;
    cy /= pool.length;
    const minZ = new Float64Array(OUTLINE_BINS).fill(Infinity);
    for (const p of pool) {
        const ang = Math.atan2(p.y - cy, p.x - cx);
        const bin = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * OUTLINE_BINS) % OUTLINE_BINS;
        if (p.z < minZ[bin]!) minZ[bin] = p.z;
    }
    const bestR = new Float64Array(OUTLINE_BINS).fill(-Infinity);
    const best: PolyPoint[] = new Array(OUTLINE_BINS);
    for (const p of pool) {
        const ang = Math.atan2(p.y - cy, p.x - cx);
        const bin = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * OUTLINE_BINS) % OUTLINE_BINS;
        if (p.z > minZ[bin]! + 0.6) continue;
        const r = Math.hypot(p.x - cx, p.y - cy);
        if (r > bestR[bin]!) {
            bestR[bin] = r;
            best[bin] = p;
        }
    }
    const pts: PolyPoint[] = [];
    for (let i = 0; i < OUTLINE_BINS; i++) {
        if (best[i]) pts.push(best[i]!);
    }
    return startAtPosteriorHeel(ensureCcw(pts));
}

function collectWallAndPlantar(geo: BufferGeometry): {
    wall: PolyPoint[];
    plantar: PolyPoint[];
    top: PolyPoint[];
} {
    const pos = geo.getAttribute("position");
    const topN = topVertexCountOf(geo);
    const wall: PolyPoint[] = [];
    const plantar: PolyPoint[] = [];
    const top: PolyPoint[] = [];
    for (let i = 0; i < pos.count; i++) {
        const p = { x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) };
        if (topN > 0 && i < topN) {
            top.push(p);
            continue;
        }
        if (p.z <= SOLE_FIELD_Z_MM) plantar.push(p);
        else wall.push(p);
    }
    return { wall, plantar, top };
}

function hashKey(x: number, y: number, z: number, cell: number): string {
    return `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
}

function buildPointHash(points: PolyPoint[], cell: number): Map<string, PolyPoint[]> {
    const map = new Map<string, PolyPoint[]>();
    for (const p of points) {
        const k = hashKey(p.x, p.y, p.z, cell);
        let b = map.get(k);
        if (!b) {
            b = [];
            map.set(k, b);
        }
        b.push(p);
    }
    return map;
}

function nearestInHash(
    hash: Map<string, PolyPoint[]>,
    x: number,
    y: number,
    z: number,
    cell: number,
    maxR: number,
): PolyPoint | null {
    const rCells = Math.ceil(maxR / cell);
    const ix = Math.floor(x / cell);
    const iy = Math.floor(y / cell);
    const iz = Math.floor(z / cell);
    let best: PolyPoint | null = null;
    let bestD = maxR * maxR;
    for (let dz = -rCells; dz <= rCells; dz++) {
        for (let dy = -rCells; dy <= rCells; dy++) {
            for (let dx = -rCells; dx <= rCells; dx++) {
                const bucket = hash.get(`${ix + dx},${iy + dy},${iz + dz}`);
                if (!bucket) continue;
                for (const p of bucket) {
                    const d = (p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2;
                    if (d < bestD) {
                        bestD = d;
                        best = p;
                    }
                }
            }
        }
    }
    return best;
}

function polygonCentroid(poly: PolyPoint[]): { x: number; y: number } {
    let x = 0;
    let y = 0;
    for (const p of poly) {
        x += p.x;
        y += p.y;
    }
    const n = Math.max(1, poly.length);
    return { x: x / n, y: y / n };
}

function outwardNormal(
    poly: PolyPoint[],
    i: number,
    centroid: { x: number; y: number },
): { x: number; y: number } {
    const n = poly.length;
    const prev = poly[(i + n - 1) % n]!;
    const next = poly[(i + 1) % n]!;
    const a = poly[i]!;
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    let nx = ty / len;
    let ny = -tx / len;
    if (nx * (a.x - centroid.x) + ny * (a.y - centroid.y) < 0) {
        nx = -nx;
        ny = -ny;
    }
    return { x: nx, y: ny };
}

function extractWallProfile(trim: PolyPoint[], outline: PolyPoint[], wallPts: PolyPoint[]): WallProfile {
    const n = trim.length;
    const hash = buildPointHash(wallPts, WALL_HASH_CELL);
    const flareDeg: number[] = [];
    const cupHeightMm: number[] = [];
    const filletMmAt: number[] = [];
    const offsetMm: number[][] = OFFSET_H.map(() => new Array<number>(n).fill(0));
    const offsetXyz: Array<Array<{ x: number; y: number; z: number }>> = OFFSET_H.map(() =>
        Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0 })),
    );

    const centroid = polygonCentroid(outline);
    for (let i = 0; i < n; i++) {
        const t = trim[i]!;
        const o = outline[i]!;
        const dx = t.x - o.x;
        const dy = t.y - o.y;
        const dz = t.z - o.z;
        const horiz = Math.hypot(dx, dy);
        const flare = (Math.atan2(horiz, Math.max(dz, 1e-6)) * 180) / Math.PI;
        flareDeg.push(flare);
        cupHeightMm.push(dz);
        const nxy = outwardNormal(outline, i, centroid);

        let fillet = 0;
        for (let h = 0; h < OFFSET_H.length; h++) {
            const s = OFFSET_H[h]!;
            const q = quinticSmoothstep(s);
            const cx = o.x + dx * q;
            const cy = o.y + dy * q;
            const cz = o.z + dz * q;
            const hit = nearestInHash(hash, cx, cy, cz, WALL_HASH_CELL, WALL_SEARCH_MM);
            if (!hit) continue;
            const rx = hit.x - cx;
            const ry = hit.y - cy;
            const rz = hit.z - cz;
            const off = rx * nxy.x + ry * nxy.y;
            offsetMm[h]![i] = off;
            offsetXyz[h]![i] = { x: rx, y: ry, z: rz };
            if (s > 0.05 && s < 0.3) fillet = Math.max(fillet, Math.abs(off));
        }
        filletMmAt.push(fillet);
    }

    for (const ring of offsetXyz) {
        const copy = ring.map((p) => ({ ...p }));
        for (let i = 0; i < n; i++) {
            const a = copy[(i + n - 1) % n]!;
            const b = copy[i]!;
            const c = copy[(i + 1) % n]!;
            ring[i] = {
                x: b.x * 0.5 + (a.x + c.x) * 0.25,
                y: b.y * 0.5 + (a.y + c.y) * 0.25,
                z: b.z * 0.5 + (a.z + c.z) * 0.25,
            };
        }
    }

    let filletSum = 0;
    for (const f of filletMmAt) filletSum += f;
    return {
        flareDeg,
        cupHeightMm,
        filletMm: n ? filletSum / n : 0,
        filletMmAt,
        offsetH: OFFSET_H.slice(),
        offsetMm,
        offsetXyz,
    };
}

export function extractStockWallModel(
    geo: BufferGeometry,
    meta: { id: string; name: string },
    _loftN = DEFAULT_LOFT_N,
): StockWallModel {
    if (!geo.boundingBox) geo.computeBoundingBox();
    const box = geo.boundingBox;
    const bounds = box
        ? {
              minX: box.min.x,
              minY: box.min.y,
              minZ: box.min.z,
              maxX: box.max.x,
              maxY: box.max.y,
              maxZ: box.max.z,
          }
        : { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 };

    const { wall, plantar, top } = collectWallAndPlantar(geo);
    const topRim = extractTopRim(geo);
    const rimSet = new Set(topRim.points.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`));
    const topInterior = top.filter((p) => !rimSet.has(`${p.x.toFixed(3)},${p.y.toFixed(3)}`));
    let outlinePoly = extractPlantarOutline(geo, topRim.points);
    if (outlinePoly.length < 8) {
        // Last resort: longest branched bottom cycle projected to its low-Z verts.
        const topN = topVertexCountOf(geo);
        const botSub = submeshByVertexRange(geo, topN, geo.getAttribute("position").count);
        try {
            const cycles = extractBoundaryLoopsBranchedWithIndices(botSub);
            const outer = cycles[0]?.positions ?? [];
            outlinePoly = outer.map((p) => ({ x: p.x, y: p.y, z: Math.min(p.z, PLANTAR_Z_MAX_MM) }));
        } finally {
            botSub.dispose();
        }
    }

    const trimSpline = fitClosedC2Spline(topRim.points.length >= 3 ? topRim.points : top);
    const outlineSpline = fitClosedC2Spline(outlinePoly);
    const outlineOnTrim = arcLengthMatch(
        trimSpline.controls,
        outlineSpline.controls.length === trimSpline.controls.length
            ? outlineSpline.controls
            : resamplePolyline(outlineSpline.controls, trimSpline.controls.length),
    );
    outlineSpline.controls = outlineOnTrim;
    const plantarField = buildUvField(plantar.length ? plantar : outlineOnTrim);
    for (const p of outlineOnTrim) {
        p.z = sampleUvField(plantarField, p.x, p.y) ?? Math.min(p.z, PLANTAR_Z_MAX_MM);
    }
    const wallPts = wall.length || plantar.length ? wall.concat(plantar) : top;
    const wallProfile = extractWallProfile(trimSpline.controls, outlineOnTrim, wallPts);

    return {
        id: meta.id,
        name: meta.name,
        top: {
            field: buildUvField(topInterior.length ? topInterior : top.length ? top : trimSpline.controls),
            ...copyTopMesh(geo),
        },
        trim: { spline: trimSpline, sourceCount: topRim.points.length },
        outline: {
            spline: outlineSpline,
            plantarZ: plantarField,
            sourceCount: outlinePoly.length,
        },
        wall: wallProfile,
        bounds,
    };
}

function copyTopMesh(geo: BufferGeometry):
    | {
          meshPositions: Float32Array;
          meshIndices: Uint32Array;
          rimLocal: number[];
      }
    | Record<string, never> {
    const topN = topVertexCountOf(geo);
    if (topN < 3) return {};
    const topSub = submeshByVertexRange(geo, 0, topN);
    const welded = mergeVertices(topSub, 1e-4);
    if (welded !== topSub) topSub.dispose();
    try {
        const pos = welded.getAttribute("position");
        const meshPositions = new Float32Array(pos.array as ArrayLike<number>);
        const idx = welded.getIndex();
        const meshIndices = idx ? new Uint32Array(idx.array as ArrayLike<number>) : new Uint32Array(0);
        const rim = extractOrderedBoundaryLoopWithIndices(welded);
        return { meshPositions, meshIndices, rimLocal: rim.indices.slice() };
    } finally {
        welded.dispose();
    }
}

export function matchedLoftCurves(
    model: StockWallModel,
    n = DEFAULT_LOFT_N,
): { trim: PolyPoint[]; outline: PolyPoint[] } {
    return {
        trim: resamplePolyline(model.trim.spline.controls, n),
        outline: resamplePolyline(model.outline.spline.controls, n),
    };
}
