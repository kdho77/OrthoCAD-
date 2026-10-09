// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BufferAttribute, BufferGeometry } from "three";
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
    polylineArcLengths,
    resampleClosedC2,
    resamplePolyline,
    startAtPosteriorHeel,
} from "./curves";
import { blendedFlareDeg } from "./defaults";
import { evalCubicHermite } from "./hermite";
import { defaultsFromStockCurves, outwardNormal, type StationBandFlare } from "./measure";
import { buildPlanformFrame } from "./planform";
import { offsetClosedInward } from "./stations";
import { DEFAULT_LOFT_N, type StockWallModel, type UvHeightField, type WallProfile } from "./types";

function minDistToLoopXY(x: number, y: number, loop: PolyPoint[]): number {
    let best = Infinity;
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const len2 = ex * ex + ey * ey;
        const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / len2)) : 0;
        const dx = x - (a.x + ex * t);
        const dy = y - (a.y + ey * t);
        const d = dx * dx + dy * dy;
        if (d < best) best = d;
    }
    return Math.sqrt(best);
}

const UV_CELL_MM = 0.4;
const OUTLINE_BINS = 360;
const OFFSET_H = [0, 0.06, 0.12, 0.18, 0.25, 0.32, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
const WALL_HASH_CELL = 2.5;
const WALL_SEARCH_MM = 16;
const PLANTAR_OUTLINE_Z_MM = 2;
const SOLE_FIELD_Z_MM = 3.5;
const PLANTAR_NZ_MAX = -0.5;
const PLANTAR_WELD_MM = 1e-5;
const WALL_FOOT_BAND_MM = 8;
const WALL_FOOT_CELL_MM = 4;
/** Drop band faces once tilt exceeds 30° from horizontal. */
const PLANTAR_TRIM_NZ = -0.866;
const PLANTAR_TRIM_Z_MM = 2.0;
const PLANTAR_INSET_MM = 1.5;
const PLANTAR_STRIP_MM = 2.5;

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
    const plantarSheet = extractPlantarSheet(geo, outlinePoly);
    if (plantarSheet.meshPositions && plantarSheet.rimLocal && plantarSheet.rimLocal.length >= 8) {
        const ppos = plantarSheet.meshPositions;
        const rimPts = plantarSheet.rimLocal.map((i) => ({
            x: ppos[i * 3]!,
            y: ppos[i * 3 + 1]!,
            z: ppos[i * 3 + 2]!,
            i,
        }));
        const ordered = startAtPosteriorHeel(ensureCcw(rimPts)) as Array<PolyPoint & { i: number }>;
        plantarSheet.rimLocal = ordered.map((p) => p.i);
        outlinePoly = ordered.map((p) => ({ x: p.x, y: p.y, z: p.z }));
    }
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
    // BottomOutline is a C2 fit of the actual plantar boundary. Planform
    // modifiers consume this curve; the stitch uses the native rim vertices.
    const outlineSpline = fitClosedC2Spline(outlinePoly);
    const outlineOnTrim = arcLengthMatch(
        trimSpline.controls,
        outlineSpline.controls.length === trimSpline.controls.length
            ? outlineSpline.controls
            : resamplePolyline(outlineSpline.controls, trimSpline.controls.length),
    );
    const plantarField = buildUvField(
        plantarSheet.meshPositions
            ? packSheetPoints(plantarSheet.meshPositions)
            : plantar.length
              ? plantar
              : outlineSpline.controls,
    );
    const wallPts = wall.length || plantar.length ? wall.concat(plantar) : top;
    // Measurement-only: equal-length resample. Not stored as BottomOutline.
    const measuredProfile = extractWallProfile(trimSpline.controls, outlineOnTrim, wallPts);
    const nSt = measuredProfile.flareDeg.length;
    const topBand = measuredProfile.offsetH.findIndex((h) => h >= 0.82);
    const botBand = measuredProfile.offsetH.findIndex((h) => h >= 0.12);
    const topMm = Array.from({ length: nSt }, (_, i) => Math.abs(measuredProfile.offsetMm[topBand]![i] ?? 0));
    const botMm = Array.from({ length: nSt }, (_, i) => Math.abs(measuredProfile.offsetMm[botBand]![i] ?? 0));
    const bandFlares = measureStationBandFlares(trimSpline.controls, outlineOnTrim, wallPts);
    const defaults = defaultsFromStockCurves(
        trimSpline.controls,
        outlineOnTrim,
        bounds,
        { topMm, botMm },
        bandFlares,
    );
    const planform = buildPlanformFrame(outlineSpline.controls, trimSpline.controls);

    const topSheet = copyTopMesh(geo);
    let trimFromSheet = trimSpline;
    let trimCount = topRim.points.length;
    if (topSheet.meshPositions && topSheet.rimLocal && topSheet.rimLocal.length >= 3) {
        const pos = topSheet.meshPositions;
        const rimPts = topSheet.rimLocal.map((i) => ({
            x: pos[i * 3]!,
            y: pos[i * 3 + 1]!,
            z: pos[i * 3 + 2]!,
            i,
        }));
        const ordered = startAtPosteriorHeel(ensureCcw(rimPts)) as Array<PolyPoint & { i: number }>;
        topSheet.rimLocal = ordered.map((p) => p.i);
        trimFromSheet = fitClosedC2Spline(ordered.map((p) => ({ x: p.x, y: p.y, z: p.z })));
        trimCount = ordered.length;
    }

    const wallProfile: WallProfile = {
        flareDeg: planform.columns.map((col) => {
            const u = Math.max(
                0,
                Math.min(1, (col.outline.x - bounds.minX) / Math.max(1e-3, bounds.maxX - bounds.minX)),
            );
            return blendedFlareDeg(u, col.outline.y, defaults.flareDeg);
        }),
        cupHeightMm: planform.columns.map((col) => col.rim.z - col.outline.z),
        filletMm: defaults.wallFilletBottomMm,
        filletMmAt: planform.columns.map(() => defaults.wallFilletBottomMm),
        wallFilletTopMm: defaults.wallFilletTopMm,
        wallFilletBottomMm: defaults.wallFilletBottomMm,
        offsetH: [],
        offsetMm: [],
        offsetXyz: [],
    };

    return {
        id: meta.id,
        name: meta.name,
        top: {
            field: buildUvField(topInterior.length ? topInterior : top.length ? top : trimSpline.controls),
            ...topSheet,
        },
        trim: { spline: trimFromSheet, sourceCount: trimCount },
        outline: {
            spline: outlineSpline,
            plantarZ: plantarField,
            sourceCount: outlinePoly.length,
            ...plantarSheet,
        },
        wall: wallProfile,
        planform,
        bounds,
        measuredVsBound: defaults.report,
        flareDiagnostics: defaults.flareDiagnostics,
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

/** Exact stock TopSheet (welded contact sheet + ordered rim). Never resampled. */
export function extractTopSheet(geo: BufferGeometry): {
    meshPositions?: Float32Array;
    meshIndices?: Uint32Array;
    rimLocal?: number[];
} {
    return copyTopMesh(geo);
}

function packSheetPoints(positions: Float32Array): PolyPoint[] {
    const out: PolyPoint[] = [];
    for (let i = 0; i < positions.length; i += 3) {
        out.push({ x: positions[i]!, y: positions[i + 1]!, z: positions[i + 2]! });
    }
    return out;
}

function measureStationBandFlares(
    trim: PolyPoint[],
    outline: PolyPoint[],
    wallPts: PolyPoint[],
): StationBandFlare[] {
    const n = Math.min(trim.length, outline.length);
    const hash = buildPointHash(wallPts, WALL_HASH_CELL);
    const centroid = polygonCentroid(outline);
    const out: StationBandFlare[] = [];
    for (let i = 0; i < n; i++) {
        const t = trim[i]!;
        const o = outline[i]!;
        const nxy = outwardNormal(outline, i, centroid);
        const hitAt = (frac: number): PolyPoint => {
            const cx = o.x + (t.x - o.x) * frac;
            const cy = o.y + (t.y - o.y) * frac;
            const cz = o.z + (t.z - o.z) * frac;
            return nearestInHash(hash, cx, cy, cz, WALL_HASH_CELL, WALL_SEARCH_MM) ?? { x: cx, y: cy, z: cz };
        };
        const p0 = o;
        const pLo = hitAt(1 / 3);
        const pHi0 = hitAt(2 / 3);
        const p1 = t;
        const local = (a: PolyPoint, b: PolyPoint): number => {
            const dn = (b.x - a.x) * nxy.x + (b.y - a.y) * nxy.y;
            const dz = b.z - a.z;
            return (Math.atan2(dn, Math.max(dz, 1e-6)) * 180) / Math.PI;
        };
        out.push({ lowerThirdDeg: local(p0, pLo), upperThirdDeg: local(pHi0, p1) });
    }
    return out;
}

type PlantarSheet = {
    meshPositions: Float32Array;
    meshIndices: Uint32Array;
    rimLocal: number[];
};

function snapLoopToMesh(pos: Float32Array, loop: PolyPoint[]): number[] {
    const n = pos.length / 3;
    if (n === 0) return [];
    const out: number[] = [];
    let last = 0;
    for (const p of loop) {
        let best = last;
        let bestD = Infinity;
        const start = Math.max(0, last - 24);
        const end = Math.min(n, last + 48);
        for (let pass = 0; pass < 2; pass++) {
            const a = pass === 0 ? start : 0;
            const b = pass === 0 ? end : n;
            for (let i = a; i < b; i++) {
                const d =
                    (pos[i * 3]! - p.x) ** 2 + (pos[i * 3 + 1]! - p.y) ** 2 + (pos[i * 3 + 2]! - p.z) ** 2;
                if (d < bestD) {
                    bestD = d;
                    best = i;
                }
            }
            if (bestD < 4) break;
        }
        if (out.length === 0 || out[out.length - 1] !== best) out.push(best);
        last = best;
    }
    return out;
}

function pointInPoly(x: number, y: number, poly: PolyPoint[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const yi = poly[i]!.y;
        const yj = poly[j]!.y;
        const xi = poly[i]!.x;
        const xj = poly[j]!.x;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-18) + xi) inside = !inside;
    }
    return inside;
}

interface PlantarFace {
    i0: number;
    i1: number;
    i2: number;
    cx: number;
    cy: number;
    cz: number;
    nz: number;
}

function wallFootKey(x: number, y: number): string {
    return `${Math.floor(x / WALL_FOOT_CELL_MM)},${Math.floor(y / WALL_FOOT_CELL_MM)}`;
}

/** Local wall-foot Z: min Z of nearby wall-like faces (|n_z| < 0.5). */
function buildWallFootGrid(faces: PlantarFace[]): Map<string, number> {
    const grid = new Map<string, number>();
    for (const f of faces) {
        if (Math.abs(f.nz) >= 0.5) continue;
        if (f.cz < 1.5) continue;
        const k = wallFootKey(f.cx, f.cy);
        const prev = grid.get(k);
        if (prev == null || f.cz < prev) grid.set(k, f.cz);
    }
    return grid;
}

function localWallFootZ(grid: Map<string, number>, x: number, y: number): number {
    const ix = Math.floor(x / WALL_FOOT_CELL_MM);
    const iy = Math.floor(y / WALL_FOOT_CELL_MM);
    let best = Infinity;
    for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
            const z = grid.get(`${ix + dx},${iy + dy}`);
            if (z != null && z < best) best = z;
        }
    }
    return best;
}

function floodFromLowest(candidates: number[], faces: PlantarFace[], maxStepZ = 1.2): number[] {
    if (candidates.length === 0) return [];
    const candSet = new Set(candidates);
    let seed = candidates[0]!;
    let seedZ = faces[seed]!.cz;
    for (const i of candidates) {
        if (faces[i]!.cz < seedZ) {
            seedZ = faces[i]!.cz;
            seed = i;
        }
    }
    const edgeFaces = new Map<string, number[]>();
    const add = (a: number, b: number, fi: number) => {
        const k = a < b ? `${a},${b}` : `${b},${a}`;
        let list = edgeFaces.get(k);
        if (!list) {
            list = [];
            edgeFaces.set(k, list);
        }
        list.push(fi);
    };
    for (const i of candidates) {
        const f = faces[i]!;
        add(f.i0, f.i1, i);
        add(f.i1, f.i2, i);
        add(f.i2, f.i0, i);
    }
    const nbrs = new Map<number, number[]>();
    for (const list of edgeFaces.values()) {
        for (let a = 0; a < list.length; a++) {
            for (let b = a + 1; b < list.length; b++) {
                const ia = list[a]!;
                const ib = list[b]!;
                if (!candSet.has(ia) || !candSet.has(ib)) continue;
                let la = nbrs.get(ia);
                if (!la) {
                    la = [];
                    nbrs.set(ia, la);
                }
                la.push(ib);
                let lb = nbrs.get(ib);
                if (!lb) {
                    lb = [];
                    nbrs.set(ib, lb);
                }
                lb.push(ia);
            }
        }
    }
    const seen = new Set<number>([seed]);
    const stack = [seed];
    while (stack.length) {
        const cur = stack.pop()!;
        for (const n of nbrs.get(cur) ?? []) {
            if (seen.has(n)) continue;
            if (faces[n]!.nz > -0.75) continue;
            if (faces[n]!.cz > faces[cur]!.cz + maxStepZ) continue;
            seen.add(n);
            stack.push(n);
        }
    }
    return [...seen];
}

function faceNzCz(
    pos: Float32Array,
    i0: number,
    i1: number,
    i2: number,
): { nz: number; cx: number; cy: number; cz: number } | null {
    const ax = pos[i0 * 3]!;
    const ay = pos[i0 * 3 + 1]!;
    const az = pos[i0 * 3 + 2]!;
    const bx = pos[i1 * 3]!;
    const by = pos[i1 * 3 + 1]!;
    const bz = pos[i1 * 3 + 2]!;
    const cx = pos[i2 * 3]!;
    const cy = pos[i2 * 3 + 1]!;
    const cz = pos[i2 * 3 + 2]!;
    const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) return null;
    return { nz: nz / len, cx: (ax + bx + cx) / 3, cy: (ay + by + cy) / 3, cz: (az + bz + cz) / 3 };
}

function compactFaces(
    pos: Float32Array,
    faces: Array<{ i0: number; i1: number; i2: number }>,
): { pos: number[]; idx: number[] } {
    const remap = new Map<number, number>();
    const outPos: number[] = [];
    const outIdx: number[] = [];
    for (const f of faces) {
        for (const old of [f.i0, f.i1, f.i2]) {
            let ni = remap.get(old);
            if (ni == null) {
                ni = outPos.length / 3;
                remap.set(old, ni);
                outPos.push(pos[old * 3]!, pos[old * 3 + 1]!, pos[old * 3 + 2]!);
            }
            outIdx.push(ni);
        }
    }
    return { pos: outPos, idx: outIdx };
}

/**
 * Keep interior inside the outline inset (1.5 mm). In the outer band drop
 * faces once tilt > 30° (nz > −0.866) or z > 2.0 mm, whichever comes first.
 */
function trimPlantarBand(
    positions: Float32Array,
    indices: Uint32Array,
    outline: PolyPoint[] | null,
): { positions: Float32Array; indices: Uint32Array } {
    const inset = outline && outline.length >= 8 ? offsetClosedInward(outline, PLANTAR_INSET_MM) : null;
    const keep: Array<{ i0: number; i1: number; i2: number }> = [];
    for (let t = 0; t < indices.length; t += 3) {
        const i0 = indices[t]!;
        const i1 = indices[t + 1]!;
        const i2 = indices[t + 2]!;
        const info = faceNzCz(positions, i0, i1, i2);
        if (!info) continue;
        const interior = inset ? pointInPoly(info.cx, info.cy, inset) : false;
        if (!interior && (info.nz > PLANTAR_TRIM_NZ || info.cz > PLANTAR_TRIM_Z_MM)) continue;
        keep.push({ i0, i1, i2 });
    }
    if (keep.length < 8) return { positions, indices };
    const compact = compactFaces(positions, keep);
    return {
        positions: new Float32Array(compact.pos),
        indices: new Uint32Array(compact.idx),
    };
}

function rimFaceSlope(
    pos: Float32Array,
    idx: Uint32Array,
    rim: number[],
): Array<{ n: number; z: number; nx: number; ny: number }> {
    const vfaces = new Map<number, number[]>();
    for (let t = 0; t < idx.length; t += 3) {
        for (const v of [idx[t]!, idx[t + 1]!, idx[t + 2]!]) {
            let list = vfaces.get(v);
            if (!list) {
                list = [];
                vfaces.set(v, list);
            }
            list.push(t);
        }
    }
    const rimPts = rim.map((i) => ({ x: pos[i * 3]!, y: pos[i * 3 + 1]!, z: pos[i * 3 + 2]! }));
    const c = { x: 0, y: 0 };
    for (const p of rimPts) {
        c.x += p.x;
        c.y += p.y;
    }
    c.x /= Math.max(1, rimPts.length);
    c.y /= Math.max(1, rimPts.length);
    return rim.map((vi, i) => {
        const nxy = outwardNormal(rimPts, i, c);
        let tn = 1;
        let tz = 0;
        let best = 1;
        for (const f of vfaces.get(vi) ?? []) {
            const info = faceNzCz(pos, idx[f]!, idx[f + 1]!, idx[f + 2]!);
            if (!info) continue;
            if (info.nz > best) continue;
            best = info.nz;
            const ia = idx[f]!;
            const ib = idx[f + 1]!;
            const ic = idx[f + 2]!;
            const ax = pos[ia * 3]!;
            const ay = pos[ia * 3 + 1]!;
            const az = pos[ia * 3 + 2]!;
            const ux = pos[ib * 3]! - ax;
            const uy = pos[ib * 3 + 1]! - ay;
            const uz = pos[ib * 3 + 2]! - az;
            const vx = pos[ic * 3]! - ax;
            const vy = pos[ic * 3 + 1]! - ay;
            const vz = pos[ic * 3 + 2]! - az;
            const nx = uy * vz - uz * vy;
            const ny = uz * vx - ux * vz;
            const nz = ux * vy - uy * vx;
            const len = Math.hypot(nx, ny, nz) || 1;
            const nnx = nx / len;
            const nny = ny / len;
            const nnz = nz / len;
            const dn = nxy.x * nnx + nxy.y * nny;
            tn = nxy.x * (nxy.x - dn * nnx) + nxy.y * (nxy.y - dn * nny);
            tz = -dn * nnz;
        }
        const mag = Math.hypot(tn, tz);
        if (mag < 1e-6) return { n: 1, z: 0, nx: nxy.x, ny: nxy.y };
        return { n: tn / mag, z: tz / mag, nx: nxy.x, ny: nxy.y };
    });
}

/**
 * Replace the outer 2–3 mm of the trimmed sheet with a regular C1 strip
 * whose outer loop is the C2 of the trim contour (z ≤ 2 mm, tilt ≤ 30°).
 */
function rebuildC1BoundaryStrip(
    positions: Float32Array,
    indices: Uint32Array,
    rimLocal: number[],
): PlantarSheet | null {
    if (rimLocal.length < 8) return null;
    const rimPts = rimLocal.map((i) => ({
        x: positions[i * 3]!,
        y: positions[i * 3 + 1]!,
        z: positions[i * 3 + 2]!,
    }));
    const contour = startAtPosteriorHeel(ensureCcw(rimPts));
    const keep: Array<{ i0: number; i1: number; i2: number }> = [];
    for (let t = 0; t < indices.length; t += 3) {
        const i0 = indices[t]!;
        const i1 = indices[t + 1]!;
        const i2 = indices[t + 2]!;
        const info = faceNzCz(positions, i0, i1, i2);
        if (!info) continue;
        if (minDistToLoopXY(info.cx, info.cy, contour) < PLANTAR_STRIP_MM) continue;
        keep.push({ i0, i1, i2 });
    }
    if (keep.length < 8) return null;
    const compact = compactFaces(positions, keep);
    const tmp = new BufferGeometry();
    tmp.setAttribute("position", new BufferAttribute(new Float32Array(compact.pos), 3));
    tmp.setIndex(compact.idx);
    const welded = mergeVertices(tmp, PLANTAR_WELD_MM);
    if (welded !== tmp) tmp.dispose();
    try {
        const wpos = welded.getAttribute("position");
        const widx = welded.getIndex();
        if (!wpos || !widx) return null;
        const pos = new Float32Array(wpos.array as ArrayLike<number>);
        const idx = new Uint32Array(widx.array as ArrayLike<number>);
        let innerRim = extractOrderedBoundaryLoopWithIndices(welded).indices.slice();
        if (innerRim.length < 8) {
            const cycles = extractBoundaryLoopsBranchedWithIndices(welded);
            let best = cycles[0];
            let bestLen = best?.positions.length ?? 0;
            for (const c of cycles) {
                if (c.positions.length > bestLen) {
                    best = c;
                    bestLen = c.positions.length;
                }
            }
            innerRim = best?.indices.slice() ?? [];
        }
        if (innerRim.length < 8) return null;
        const innerPts = innerRim.map((i) => ({
            x: pos[i * 3]!,
            y: pos[i * 3 + 1]!,
            z: pos[i * 3 + 2]!,
            i,
        }));
        const innerOrdered = startAtPosteriorHeel(ensureCcw(innerPts)) as Array<PolyPoint & { i: number }>;
        const innerIdx = innerOrdered.map((p) => p.i);
        const nOut = DEFAULT_LOFT_N;
        const outerSpline = fitClosedC2Spline(contour);
        const outer = resampleClosedC2(outerSpline, nOut);
        const innerLoop = innerOrdered.map((p) => ({ x: p.x, y: p.y, z: p.z }));
        const cInner = { x: 0, y: 0 };
        for (const p of innerLoop) {
            cInner.x += p.x;
            cInner.y += p.y;
        }
        cInner.x /= Math.max(1, innerLoop.length);
        cInner.y /= Math.max(1, innerLoop.length);
        const slopes = rimFaceSlope(pos, idx, innerIdx);
        const outPos = Array.from(pos);
        const outIdx = Array.from(idx);
        const midIdx: number[] = [];
        const outerIdx: number[] = [];
        const maxDz = PLANTAR_STRIP_MM * Math.tan(Math.PI / 6);
        for (let i = 0; i < nOut; i++) {
            const o = outer[i]!;
            const nxy = outwardNormal(outer, i, cInner);
            const sl = slopes[Math.round((i / nOut) * innerIdx.length) % innerIdx.length] ?? {
                n: 1,
                z: 0,
                nx: nxy.x,
                ny: nxy.y,
            };
            const iz = innerLoop[Math.round((i / nOut) * innerLoop.length) % innerLoop.length]!.z;
            o.z = Math.min(PLANTAR_TRIM_Z_MM, iz + maxDz);
            o.z = Math.max(iz, o.z);
            const T0 = { n: sl.n * PLANTAR_STRIP_MM, z: sl.z * PLANTAR_STRIP_MM };
            const T1 = { n: PLANTAR_STRIP_MM, z: 0 };
            const midNZ = evalCubicHermite({ n: 0, z: iz }, T0, { n: PLANTAR_STRIP_MM, z: o.z }, T1, 0.45);
            midIdx.push(outPos.length / 3);
            outPos.push(o.x - nxy.x * PLANTAR_STRIP_MM * 0.5, o.y - nxy.y * PLANTAR_STRIP_MM * 0.5, midNZ.z);
            outerIdx.push(outPos.length / 3);
            outPos.push(o.x, o.y, o.z);
        }
        const asPts = (ids: number[]): PolyPoint[] =>
            ids.map((i) => ({ x: outPos[i * 3]!, y: outPos[i * 3 + 1]!, z: outPos[i * 3 + 2]! }));
        const zip = (aIdx: number[], bIdx: number[]) => {
            const nA = aIdx.length;
            const nB = bIdx.length;
            if (nA < 2 || nB < 2) return;
            const sA = polylineArcLengths(asPts(aIdx));
            const sB = polylineArcLengths(asPts(bIdx));
            const totA = sA.total || 1;
            const totB = sB.total || 1;
            let i = 0;
            let j = 0;
            for (let step = 0; step < nA + nB; step++) {
                const a0 = aIdx[i % nA]!;
                const b0 = bIdx[j % nB]!;
                if (i >= nA && j >= nB) break;
                const nextA = sA.cum[Math.min(i + 1, nA)]! / totA;
                const nextB = sB.cum[Math.min(j + 1, nB)]! / totB;
                if (i < nA && (j >= nB || nextA <= nextB)) {
                    outIdx.push(a0, aIdx[(i + 1) % nA]!, b0);
                    i++;
                } else {
                    outIdx.push(a0, bIdx[(j + 1) % nB]!, b0);
                    j++;
                }
            }
        };
        zip(innerIdx, midIdx);
        for (let i = 0; i < nOut; i++) {
            const j = (i + 1) % nOut;
            outIdx.push(midIdx[i]!, midIdx[j]!, outerIdx[j]!, midIdx[i]!, outerIdx[j]!, outerIdx[i]!);
        }
        const sheet = new BufferGeometry();
        sheet.setAttribute("position", new BufferAttribute(new Float32Array(outPos), 3));
        sheet.setIndex(outIdx);
        const weldedStrip = mergeVertices(sheet, PLANTAR_WELD_MM);
        if (weldedStrip !== sheet) sheet.dispose();
        try {
            const sp = weldedStrip.getAttribute("position");
            const si = weldedStrip.getIndex();
            if (!sp || !si) return null;
            const meshPositions = new Float32Array(sp.array as ArrayLike<number>);
            const meshIndices = new Uint32Array(si.array as ArrayLike<number>);
            const snap = outerIdx.map((oi) => {
                const x = outPos[oi * 3]!;
                const y = outPos[oi * 3 + 1]!;
                const z = outPos[oi * 3 + 2]!;
                let best = 0;
                let bestD = Infinity;
                for (let v = 0; v < meshPositions.length / 3; v++) {
                    const d =
                        (meshPositions[v * 3]! - x) ** 2 +
                        (meshPositions[v * 3 + 1]! - y) ** 2 +
                        (meshPositions[v * 3 + 2]! - z) ** 2;
                    if (d < bestD) {
                        bestD = d;
                        best = v;
                    }
                }
                return best;
            });
            const seen = new Set<number>();
            const rim: number[] = [];
            for (const v of snap) {
                if (seen.has(v)) continue;
                seen.add(v);
                rim.push(v);
            }
            if (rim.length < 8) return null;
            return { meshPositions, meshIndices, rimLocal: rim };
        } finally {
            weldedStrip.dispose();
        }
    } finally {
        welded.dispose();
    }
}

/**
 * Stock plantar sheet: n_z < -0.5 and below the wall-foot band, flood-filled
 * from the lowest face, then welded. Native triangles and Z; no ear-clip.
 * After the flood, the outer band is trimmed at 30° / z=2 and a 2–3 mm C1
 * strip is rebuilt to the trimmed contour.
 */
export function extractPlantarSheet(geo: BufferGeometry, outline?: PolyPoint[]): Partial<PlantarSheet> {
    const posAttr = geo.getAttribute("position");
    const index = geo.getIndex();
    if (!posAttr || !index) return {};
    const pos = posAttr.array as Float32Array;
    const idx = index.array;
    const topN = topVertexCountOf(geo);
    const hull = outline && outline.length >= 8 ? outline : null;
    const faces: PlantarFace[] = [];
    for (let t = 0; t < idx.length; t += 3) {
        const i0 = idx[t]!;
        const i1 = idx[t + 1]!;
        const i2 = idx[t + 2]!;
        if (topN > 0 && i0 < topN && i1 < topN && i2 < topN) continue;
        const ax = pos[i0 * 3]!;
        const ay = pos[i0 * 3 + 1]!;
        const az = pos[i0 * 3 + 2]!;
        const bx = pos[i1 * 3]!;
        const by = pos[i1 * 3 + 1]!;
        const bz = pos[i1 * 3 + 2]!;
        const cx = pos[i2 * 3]!;
        const cy = pos[i2 * 3 + 1]!;
        const cz = pos[i2 * 3 + 2]!;
        const ux = bx - ax;
        const uy = by - ay;
        const uz = bz - az;
        const vx = cx - ax;
        const vy = cy - ay;
        const vz = cz - az;
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz);
        if (len < 1e-12) continue;
        faces.push({
            i0,
            i1,
            i2,
            cx: (ax + bx + cx) / 3,
            cy: (ay + by + cy) / 3,
            cz: (az + bz + cz) / 3,
            nz: nz / len,
        });
    }
    const footGrid = buildWallFootGrid(faces);
    const candidates: number[] = [];
    for (let i = 0; i < faces.length; i++) {
        const f = faces[i]!;
        if (f.nz >= PLANTAR_NZ_MAX) continue;
        const footZ = localWallFootZ(footGrid, f.cx, f.cy);
        if (Number.isFinite(footZ) && f.cz > footZ + WALL_FOOT_BAND_MM) continue;
        candidates.push(i);
    }
    if (candidates.length < 8) return {};
    const used = new Map<number, number>();
    const newPos: number[] = [];
    const newIdx: number[] = [];
    for (const ci of candidates) {
        const tri = faces[ci]!;
        for (const old of [tri.i0, tri.i1, tri.i2]) {
            let ni = used.get(old);
            if (ni == null) {
                ni = newPos.length / 3;
                used.set(old, ni);
                newPos.push(pos[old * 3]!, pos[old * 3 + 1]!, pos[old * 3 + 2]!);
            }
            newIdx.push(ni);
        }
    }
    const tmp = new BufferGeometry();
    tmp.setAttribute("position", new BufferAttribute(new Float32Array(newPos), 3));
    tmp.setIndex(newIdx);
    const weldedAll = mergeVertices(tmp, PLANTAR_WELD_MM);
    if (weldedAll !== tmp) tmp.dispose();
    const wposAll = weldedAll.getAttribute("position");
    const widxAll = weldedAll.getIndex();
    if (!wposAll || !widxAll) {
        weldedAll.dispose();
        return {};
    }
    const wposArr = wposAll.array as Float32Array;
    const widxArr = widxAll.array;
    const wfaces: PlantarFace[] = [];
    for (let t = 0; t < widxArr.length; t += 3) {
        const i0 = widxArr[t]!;
        const i1 = widxArr[t + 1]!;
        const i2 = widxArr[t + 2]!;
        const ax = wposArr[i0 * 3]!;
        const ay = wposArr[i0 * 3 + 1]!;
        const az = wposArr[i0 * 3 + 2]!;
        const bx = wposArr[i1 * 3]!;
        const by = wposArr[i1 * 3 + 1]!;
        const bz = wposArr[i1 * 3 + 2]!;
        const cx = wposArr[i2 * 3]!;
        const cy = wposArr[i2 * 3 + 1]!;
        const cz = wposArr[i2 * 3 + 2]!;
        const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
        const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
        const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        const len = Math.hypot(nx, ny, nz) || 1;
        wfaces.push({
            i0,
            i1,
            i2,
            cx: (ax + bx + cx) / 3,
            cy: (ay + by + cy) / 3,
            cz: (az + bz + cz) / 3,
            nz: nz / len,
        });
    }
    const wids = wfaces.map((_, i) => i);
    const areaOf = (ids: number[]): number => {
        let a = 0;
        for (const i of ids) {
            const f = wfaces[i]!;
            a += Math.abs(
                (wposArr[f.i1 * 3]! - wposArr[f.i0 * 3]!) *
                    (wposArr[f.i2 * 3 + 1]! - wposArr[f.i0 * 3 + 1]!) -
                    (wposArr[f.i1 * 3 + 1]! - wposArr[f.i0 * 3 + 1]!) *
                        (wposArr[f.i2 * 3]! - wposArr[f.i0 * 3]!),
            );
        }
        return a * 0.5;
    };
    const zSpanOf = (ids: number[]): number => {
        let lo = Infinity;
        let hi = -Infinity;
        for (const i of ids) {
            const z = wfaces[i]!.cz;
            if (z < lo) lo = z;
            if (z > hi) hi = z;
        }
        return hi - lo;
    };
    let flooded = floodFromLowest(wids, wfaces, 1.2);
    if (zSpanOf(flooded) < 0.8) {
        const usedLow = new Set(flooded);
        const rest = wids.filter((i) => !usedLow.has(i));
        const second = floodFromLowest(rest, wfaces, 1.2);
        if (areaOf(second) > areaOf(flooded) || zSpanOf(second) > zSpanOf(flooded)) {
            flooded = second;
        }
    }
    let live = flooded.length >= 8 ? flooded.slice() : wids.slice();
    for (let pass = 0; pass < 2; pass++) {
        const edgeN = new Map<string, number>();
        const addE = (a: number, b: number) => {
            const k = a < b ? `${a},${b}` : `${b},${a}`;
            edgeN.set(k, (edgeN.get(k) ?? 0) + 1);
        };
        for (const i of live) {
            const f = wfaces[i]!;
            addE(f.i0, f.i1);
            addE(f.i1, f.i2);
            addE(f.i2, f.i0);
        }
        const next: number[] = [];
        for (const i of live) {
            const f = wfaces[i]!;
            const b =
                (edgeN.get(f.i0 < f.i1 ? `${f.i0},${f.i1}` : `${f.i1},${f.i0}`) ?? 0) === 1 ||
                (edgeN.get(f.i1 < f.i2 ? `${f.i1},${f.i2}` : `${f.i2},${f.i1}`) ?? 0) === 1 ||
                (edgeN.get(f.i2 < f.i0 ? `${f.i2},${f.i0}` : `${f.i0},${f.i2}`) ?? 0) === 1;
            if (b && f.nz > -0.85) continue;
            next.push(i);
        }
        if (next.length < 8) break;
        live = next;
    }
    const compactPos: number[] = [];
    const compactIdx: number[] = [];
    const remap = new Map<number, number>();
    for (const i of live) {
        const f = wfaces[i]!;
        for (const old of [f.i0, f.i1, f.i2]) {
            let ni = remap.get(old);
            if (ni == null) {
                ni = compactPos.length / 3;
                remap.set(old, ni);
                compactPos.push(wposArr[old * 3]!, wposArr[old * 3 + 1]!, wposArr[old * 3 + 2]!);
            }
            compactIdx.push(ni);
        }
    }
    const sheet = new BufferGeometry();
    sheet.setAttribute("position", new BufferAttribute(new Float32Array(compactPos), 3));
    sheet.setIndex(compactIdx);
    const welded = mergeVertices(sheet, PLANTAR_WELD_MM);
    if (welded !== sheet) sheet.dispose();
    weldedAll.dispose();
    try {
        const wpos = welded.getAttribute("position");
        const meshPositions = new Float32Array(wpos.array as ArrayLike<number>);
        const widx = welded.getIndex();
        const meshIndices = widx ? new Uint32Array(widx.array as ArrayLike<number>) : new Uint32Array(0);
        let rimLocal = extractOrderedBoundaryLoopWithIndices(welded).indices.slice();
        if (rimLocal.length < 8) {
            const cycles = extractBoundaryLoopsBranchedWithIndices(welded);
            let best = cycles[0];
            let bestLen = best?.positions.length ?? 0;
            for (const c of cycles) {
                if (c.positions.length > bestLen) {
                    best = c;
                    bestLen = c.positions.length;
                }
            }
            rimLocal = best?.indices.slice() ?? [];
        }
        if (rimLocal.length < 8 && hull) {
            rimLocal = snapLoopToMesh(meshPositions, hull);
        }
        if (rimLocal.length < 8) return { meshPositions, meshIndices };
        const trimmed = trimPlantarBand(meshPositions, meshIndices, hull);
        const trimGeo = new BufferGeometry();
        trimGeo.setAttribute("position", new BufferAttribute(trimmed.positions, 3));
        trimGeo.setIndex(Array.from(trimmed.indices));
        const trimWeld = mergeVertices(trimGeo, PLANTAR_WELD_MM);
        if (trimWeld !== trimGeo) trimGeo.dispose();
        try {
            const tp = trimWeld.getAttribute("position");
            const ti = trimWeld.getIndex();
            if (!tp || !ti) return { meshPositions, meshIndices, rimLocal };
            const tpos = new Float32Array(tp.array as ArrayLike<number>);
            const tidx = new Uint32Array(ti.array as ArrayLike<number>);
            let trimRim = extractOrderedBoundaryLoopWithIndices(trimWeld).indices.slice();
            if (trimRim.length < 8) {
                const cycles = extractBoundaryLoopsBranchedWithIndices(trimWeld);
                let best = cycles[0];
                let bestLen = best?.positions.length ?? 0;
                for (const c of cycles) {
                    if (c.positions.length > bestLen) {
                        best = c;
                        bestLen = c.positions.length;
                    }
                }
                trimRim = best?.indices.slice() ?? [];
            }
            if (trimRim.length < 8) return { meshPositions: tpos, meshIndices: tidx };
            const strip = rebuildC1BoundaryStrip(tpos, tidx, trimRim);
            return strip ?? { meshPositions: tpos, meshIndices: tidx, rimLocal: trimRim };
        } finally {
            trimWeld.dispose();
        }
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
