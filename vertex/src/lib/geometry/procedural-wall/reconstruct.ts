// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BufferAttribute, BufferGeometry, ShapeUtils, Vector2 } from "three";
import { quinticSmoothstep } from "@/lib/geometry/height-field";
import { analyzeManifold } from "@/lib/geometry/manifold";
import { arcLengthMatch, type PolyPoint, resamplePolyline } from "./curves";
import { matchedLoftCurves, sampleUvField } from "./extract";
import {
    DEFAULT_LOFT_N,
    DEFAULT_WALL_LAYERS,
    type LoftOptions,
    type StockWallModel,
    type UvHeightField,
    type WallProfile,
} from "./types";

function lerpOffsetXyz(
    profile: WallProfile,
    station: number,
    h: number,
): { x: number; y: number; z: number } {
    const hs = profile.offsetH;
    const nS = profile.flareDeg.length;
    const zero = { x: 0, y: 0, z: 0 };
    if (hs.length === 0 || nS === 0) return zero;

    const sWrap = ((station % nS) + nS) % nS;
    const s0 = Math.floor(sWrap);
    const s1 = (s0 + 1) % nS;
    const fs = sWrap - s0;

    const at = (hi: number, si: number) => {
        const p = profile.offsetXyz?.[hi]?.[si];
        return p ? { x: p.x, y: p.y, z: p.z } : zero;
    };
    const sampleH = (hi: number) => {
        const a = at(hi, s0);
        const b = at(hi, s1);
        return { x: a.x * (1 - fs) + b.x * fs, y: a.y * (1 - fs) + b.y * fs, z: a.z * (1 - fs) + b.z * fs };
    };

    if (h <= hs[0]!) return sampleH(0);
    if (h >= hs[hs.length - 1]!) return sampleH(hs.length - 1);
    for (let i = 0; i < hs.length - 1; i++) {
        const a = hs[i]!;
        const b = hs[i + 1]!;
        if (h >= a && h <= b) {
            const t = (h - a) / Math.max(b - a, 1e-12);
            const pa = sampleH(i);
            const pb = sampleH(i + 1);
            return {
                x: pa.x + (pb.x - pa.x) * t,
                y: pa.y + (pb.y - pa.y) * t,
                z: pa.z + (pb.z - pa.z) * t,
            };
        }
    }
    return zero;
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

function outwardXY(
    poly: PolyPoint[],
    i: number,
    centroid: { x: number; y: number },
): { x: number; y: number } {
    const n = poly.length;
    const prev = poly[(i + n - 1) % n]!;
    const next = poly[(i + 1) % n]!;
    const p = poly[i]!;
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    let nx = ty / len;
    let ny = -tx / len;
    if (nx * (p.x - centroid.x) + ny * (p.y - centroid.y) < 0) {
        nx = -nx;
        ny = -ny;
    }
    return { x: nx, y: ny };
}

function pointInPoly(x: number, y: number, poly: PolyPoint[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i]!.x;
        const yi = poly[i]!.y;
        const xj = poly[j]!.x;
        const yj = poly[j]!.y;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-18) + xi) {
            inside = !inside;
        }
    }
    return inside;
}

function sampleZ(field: UvHeightField, x: number, y: number, fallback: number): number {
    return sampleUvField(field, x, y) ?? fallback;
}

/** Walk the unique index-buffer boundary of an indexed disk. */
function indexedBoundaryLoop(positions: number[], indices: number[]): number[] {
    const edge = new Map<string, [number, number, number]>();
    const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
    for (let t = 0; t < indices.length; t += 3) {
        const a = indices[t]!;
        const b = indices[t + 1]!;
        const c = indices[t + 2]!;
        for (const [u, v] of [
            [a, b],
            [b, c],
            [c, a],
        ] as const) {
            const k = key(u, v);
            const prev = edge.get(k);
            edge.set(k, [u, v, (prev?.[2] ?? 0) + 1]);
        }
    }
    const adj = new Map<number, number[]>();
    for (const [, [u, v, n]] of edge) {
        if (n !== 1) continue;
        if (!adj.has(u)) adj.set(u, []);
        if (!adj.has(v)) adj.set(v, []);
        adj.get(u)!.push(v);
        adj.get(v)!.push(u);
    }
    if (adj.size < 3) return [];
    const start = adj.keys().next().value as number;
    const loop: number[] = [start];
    let prev = -1;
    let curr = start;
    for (let guard = 0; guard < adj.size + 2; guard++) {
        const next = (adj.get(curr) ?? []).find((x) => x !== prev);
        if (next === undefined) break;
        if (next === start) return loop;
        loop.push(next);
        prev = curr;
        curr = next;
    }
    return loop.length >= 3 ? loop : [];
}

/**
 * Loft-blend walls between the trim curve and the plantar outline, then close
 * the bottom. Caps are a rim corridor + in-polygon triangulation so a concave
 * arch waist cannot fold. Both curves are resampled to the same N and
 * arc-length matched; walls use a quintic blend in h.
 */
export function reconstructProceduralWalls(model: StockWallModel, options: LoftOptions = {}): BufferGeometry {
    const n = options.n ?? DEFAULT_LOFT_N;
    const wallLayers = Math.max(3, options.wallLayers ?? DEFAULT_WALL_LAYERS);
    const corridorRings = 4;
    const corridorStepMm = 0.7;

    const curves = matchedLoftCurves(model, n);
    const trim = curves.trim;
    const outline = arcLengthMatch(trim, curves.outline);

    const positions: number[] = [];
    const indices: number[] = [];
    const push = (p: PolyPoint): number => {
        const i = positions.length / 3;
        positions.push(p.x, p.y, p.z);
        return i;
    };
    const pushTri = (a: number, b: number, c: number, flip = false): void => {
        if (flip) indices.push(a, c, b);
        else indices.push(a, b, c);
    };

    const useExactTop = Boolean(
        model.top.meshPositions && model.top.meshIndices && model.top.meshIndices.length,
    );
    let trimRing: number[] = [];
    if (useExactTop) {
        const tp = model.top.meshPositions!;
        const ti = model.top.meshIndices!;
        const base = positions.length / 3;
        for (let i = 0; i < tp.length; i++) positions.push(tp[i]!);
        for (let t = 0; t < ti.length; t += 3) {
            pushTri(base + ti[t]!, base + ti[t + 1]!, base + ti[t + 2]!);
        }
        const openLoop = indexedBoundaryLoop(positions, indices);
        if (openLoop.length >= 3) {
            trimRing = openLoop;
        } else {
            const rimLocal = model.top.rimLocal ?? [];
            if (rimLocal.length >= 3) trimRing = rimLocal.map((i) => base + i);
            else for (const p of trim) trimRing.push(push(p));
        }
    } else {
        for (const p of trim) trimRing.push(push(p));
    }

    const loftN = trimRing.length;
    const trimPts: PolyPoint[] = trimRing.map((vi) => ({
        x: positions[vi * 3]!,
        y: positions[vi * 3 + 1]!,
        z: positions[vi * 3 + 2]!,
    }));
    const outlinePts = arcLengthMatch(trimPts, resamplePolyline(model.outline.spline.controls, loftN));
    for (const o of outlinePts) {
        o.z = sampleZ(model.outline.plantarZ, o.x, o.y, Math.min(o.z, 1));
    }

    if (!useExactTop) {
        let prevTop = trimRing;
        let innerTopPoly = trim;
        for (let k = 1; k <= corridorRings; k++) {
            const poly: PolyPoint[] = [];
            const row: number[] = [];
            const centroid = polygonCentroid(trim);
            for (let i = 0; i < n; i++) {
                const p = trim[i]!;
                const inn = outwardXY(trim, i, centroid);
                const x = p.x - inn.x * corridorStepMm * k;
                const y = p.y - inn.y * corridorStepMm * k;
                const inside = pointInPoly(x, y, trim);
                const px = inside ? x : p.x - inn.x * corridorStepMm * 0.4;
                const py = inside ? y : p.y - inn.y * corridorStepMm * 0.4;
                const z = sampleZ(model.top.field, px, py, p.z);
                poly.push({ x: px, y: py, z });
                row.push(push({ x: px, y: py, z }));
            }
            for (let i = 0; i < n; i++) {
                const i1 = (i + 1) % n;
                pushTri(prevTop[i]!, prevTop[i1]!, row[i1]!);
                pushTri(prevTop[i]!, row[i1]!, row[i]!);
            }
            prevTop = row;
            innerTopPoly = poly;
        }
        fillCap(innerTopPoly, model.top.field, prevTop, push, pushTri, false);
    }

    // ---- Walls (quintic blend in h, unique q so rings stay distinct) ----
    const wallRing: number[][] = [trimRing];
    let prevQ = 0;
    const profileTrim = model.trim.spline.controls;
    const stationForTrim = (i: number): number => {
        const t = trimPts[i]!;
        let best = 0;
        let bestD = Number.POSITIVE_INFINITY;
        for (let j = 0; j < profileTrim.length; j++) {
            const p = profileTrim[j]!;
            const d = (p.x - t.x) ** 2 + (p.y - t.y) ** 2;
            if (d < bestD) {
                bestD = d;
                best = j;
            }
        }
        return best;
    };
    const sampleHs = model.wall.offsetH.filter((h) => h > 0.02 && h < 0.98);
    const extraHs = Array.from({ length: wallLayers }, (_, layer) => layer / (wallLayers - 1)).filter(
        (h) => h > 0.02 && h < 0.98,
    );
    const hs = [...new Set([...sampleHs, ...extraHs])].sort((a, b) => a - b);
    for (const h of hs) {
        const q = quinticSmoothstep(h);
        if (q - prevQ < 0.03) continue;
        prevQ = q;
        const row: number[] = [];
        for (let i = 0; i < loftN; i++) {
            const t = trimPts[i]!;
            const o = outlinePts[i]!;
            const off = lerpOffsetXyz(model.wall, stationForTrim(i), h);
            row.push(
                push({
                    x: o.x + (t.x - o.x) * q + off.x,
                    y: o.y + (t.y - o.y) * q + off.y,
                    z: o.z + (t.z - o.z) * q + off.z,
                }),
            );
        }
        wallRing.push(row);
    }
    const outlineRing: number[] = [];
    for (const o of outlinePts) outlineRing.push(push(o));
    wallRing.push(outlineRing);
    for (let k = 0; k < wallRing.length - 1; k++) {
        const a = wallRing[k]!;
        const b = wallRing[k + 1]!;
        for (let i = 0; i < loftN; i++) {
            const i1 = (i + 1) % loftN;
            pushTri(a[i]!, b[i]!, b[i1]!);
            pushTri(a[i]!, b[i1]!, a[i1]!);
        }
    }

    let prevBot = outlineRing;
    let innerBotPoly = outlinePts;
    const botCentroid = polygonCentroid(outlinePts);
    const botRings = 3;
    const botStep = 0.55;
    for (let k = 1; k <= botRings; k++) {
        const poly: PolyPoint[] = [];
        const row: number[] = [];
        for (let i = 0; i < loftN; i++) {
            const p = outlinePts[i]!;
            const inn = outwardXY(outlinePts, i, botCentroid);
            const x = p.x - inn.x * botStep * k;
            const y = p.y - inn.y * botStep * k;
            const inside = pointInPoly(x, y, outlinePts);
            const px = inside ? x : p.x - inn.x * botStep * 0.3;
            const py = inside ? y : p.y - inn.y * botStep * 0.3;
            const z = sampleZ(model.outline.plantarZ, px, py, p.z);
            poly.push({ x: px, y: py, z });
            row.push(push({ x: px, y: py, z }));
        }
        for (let i = 0; i < loftN; i++) {
            const i1 = (i + 1) % loftN;
            pushTri(prevBot[i]!, row[i]!, row[i1]!, false);
            pushTri(prevBot[i]!, row[i1]!, prevBot[i1]!, false);
        }
        prevBot = row;
        innerBotPoly = poly;
    }
    fillCap(innerBotPoly, model.outline.plantarZ, prevBot, push, pushTri, true);

    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    geo.userData = {
        wallModel: "procedural",
        stockId: model.id,
        loftN,
        manifoldHint: analyzeManifold(geo),
    };
    return geo;
}

function fillCap(
    ring: PolyPoint[],
    field: UvHeightField,
    ringIdx: number[],
    push: (p: PolyPoint) => number,
    pushTri: (a: number, b: number, c: number, flip?: boolean) => void,
    flip: boolean,
): void {
    const n = ring.length;
    if (n < 3) return;
    const contour = ring.map((p) => new Vector2(p.x, p.y));
    let faces: number[][];
    try {
        faces = ShapeUtils.triangulateShape(contour, []);
    } catch {
        faces = [];
    }
    if (faces.length === 0) {
        let cx = 0;
        let cy = 0;
        for (const p of ring) {
            cx += p.x;
            cy += p.y;
        }
        cx /= n;
        cy /= n;
        const cz = sampleZ(field, cx, cy, ring[0]!.z);
        const c = push({ x: cx, y: cy, z: cz });
        for (let i = 0; i < n; i++) pushTri(ringIdx[i]!, ringIdx[(i + 1) % n]!, c, flip);
        return;
    }

    const isBoundaryEdge = (la: number, lb: number): boolean => {
        const d = Math.abs(la - lb);
        return d === 1 || d === n - 1;
    };

    type Face = [number, number, number];
    let work: Face[] = faces.map((f) => [f[0]!, f[1]!, f[2]!]);
    const localPos: PolyPoint[] = ring.map((p) => ({ ...p }));
    const localIdx: number[] = ringIdx.slice();

    const addVert = (p: PolyPoint): number => {
        localPos.push(p);
        localIdx.push(push(p));
        return localPos.length - 1;
    };

    for (let pass = 0; pass < 8; pass++) {
        const mid = new Map<string, number>();
        const getMid = (a: number, b: number): number => {
            const lo = Math.min(a, b);
            const hi = Math.max(a, b);
            const key = `${lo},${hi}`;
            const hit = mid.get(key);
            if (hit !== undefined) return hit;
            const pa = localPos[a]!;
            const pb = localPos[b]!;
            const x = (pa.x + pb.x) * 0.5;
            const y = (pa.y + pb.y) * 0.5;
            const z = sampleZ(field, x, y, (pa.z + pb.z) * 0.5);
            const id = addVert({ x, y, z });
            mid.set(key, id);
            return id;
        };
        const next: Face[] = [];
        let splits = 0;
        for (const [a, b, c] of work) {
            const pa = localPos[a]!;
            const pb = localPos[b]!;
            const pc = localPos[c]!;
            const lab = Math.hypot(pb.x - pa.x, pb.y - pa.y);
            const lbc = Math.hypot(pc.x - pb.x, pc.y - pb.y);
            const lca = Math.hypot(pa.x - pc.x, pa.y - pc.y);
            const splitAB = lab > 0.9 && !(a < n && b < n && isBoundaryEdge(a, b));
            const splitBC = lbc > 0.9 && !(b < n && c < n && isBoundaryEdge(b, c));
            const splitCA = lca > 0.9 && !(c < n && a < n && isBoundaryEdge(c, a));
            const nSplit = (splitAB ? 1 : 0) + (splitBC ? 1 : 0) + (splitCA ? 1 : 0);
            if (nSplit === 0) {
                next.push([a, b, c]);
                continue;
            }
            splits++;
            const ab = splitAB ? getMid(a, b) : -1;
            const bc = splitBC ? getMid(b, c) : -1;
            const ca = splitCA ? getMid(c, a) : -1;
            if (nSplit === 3) {
                next.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
            } else if (nSplit === 1) {
                if (splitAB) next.push([a, ab, c], [ab, b, c]);
                else if (splitBC) next.push([a, b, bc], [a, bc, c]);
                else next.push([a, b, ca], [b, c, ca]);
            } else if (splitAB && splitBC) {
                next.push([a, ab, c], [ab, b, bc], [ab, bc, c]);
            } else if (splitBC && splitCA) {
                next.push([a, b, ca], [b, bc, ca], [bc, c, ca]);
            } else {
                next.push([a, ab, ca], [ab, b, c], [ab, c, ca]);
            }
        }
        work = next;
        if (splits === 0) break;
    }

    for (const [a, b, c] of work) {
        pushTri(localIdx[a]!, localIdx[b]!, localIdx[c]!, flip);
    }
}
