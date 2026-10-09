// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BufferAttribute, BufferGeometry, ShapeUtils, Vector2 } from "three";
import { analyzeManifold } from "@/lib/geometry/manifold";
import type { PolyPoint } from "./curves";
import { sampleUvField } from "./extract";
import { buildXyHeightIndex, sampleXyHeight, type XyHeightIndex } from "./height-xy";
import { loftWallGrid, wallTriangles } from "./loft";
import { applyCurveModifiers, type ProceduralModifierInput } from "./modifiers";
import type { StockWallModel, UvHeightField } from "./types";

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

function ringInwardNormals(ring: PolyPoint[]): Array<{ x: number; y: number }> {
    const n = ring.length;
    const out: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < n; i++) {
        const prev = ring[(i + n - 1) % n]!;
        const next = ring[(i + 1) % n]!;
        const tx = next.x - prev.x;
        const ty = next.y - prev.y;
        const len = Math.hypot(tx, ty) || 1;
        let nx = -ty / len;
        let ny = tx / len;
        const p = ring[i]!;
        if (!pointInPoly(p.x + nx * 0.6, p.y + ny * 0.6, ring)) {
            nx = -nx;
            ny = -ny;
        }
        out.push({ x: nx, y: ny });
    }
    return out;
}

function sampleZ(
    field: UvHeightField,
    height: XyHeightIndex | null,
    x: number,
    y: number,
    fallback: number,
    prefer: "min" | "max" = "max",
): number {
    if (height) {
        const z = sampleXyHeight(height, x, y, prefer);
        if (z != null) return z;
    }
    return sampleUvField(field, x, y) ?? fallback;
}

function fillCap(
    ring: PolyPoint[],
    field: UvHeightField,
    height: XyHeightIndex | null,
    ringIdx: number[],
    push: (p: PolyPoint) => number,
    pushTri: (a: number, b: number, c: number, flip?: boolean) => void,
    flip: boolean,
    prefer: "min" | "max",
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
        const c = push({ x: cx, y: cy, z: sampleZ(field, height, cx, cy, ring[0]!.z, prefer) });
        for (let i = 0; i < n; i++) pushTri(ringIdx[i]!, ringIdx[(i + 1) % n]!, c, flip);
        return;
    }
    const isBoundary = (a: number, b: number) => {
        const d = Math.abs(a - b);
        return d === 1 || d === n - 1;
    };
    type Face = [number, number, number];
    let work: Face[] = faces.map((f) => [f[0]!, f[1]!, f[2]!]);
    const localPos = ring.map((p) => ({ ...p }));
    const localIdx = ringIdx.slice();
    const add = (p: PolyPoint) => {
        localPos.push(p);
        localIdx.push(push(p));
        return localPos.length - 1;
    };
    for (let pass = 0; pass < 6; pass++) {
        const mid = new Map<string, number>();
        const getMid = (a: number, b: number) => {
            const lo = Math.min(a, b);
            const hi = Math.max(a, b);
            const key = `${lo},${hi}`;
            const hit = mid.get(key);
            if (hit !== undefined) return hit;
            const pa = localPos[a]!;
            const pb = localPos[b]!;
            const x = (pa.x + pb.x) * 0.5;
            const y = (pa.y + pb.y) * 0.5;
            const id = add({ x, y, z: sampleZ(field, height, x, y, (pa.z + pb.z) * 0.5, prefer) });
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
            const lca = Math.hypot(pa.x - pc.x, pc.y - pc.y);
            const splitAB = lab > 0.75 && !(a < n && b < n && isBoundary(a, b));
            const splitBC = lbc > 0.75 && !(b < n && c < n && isBoundary(b, c));
            const splitCA = lca > 0.75 && !(c < n && a < n && isBoundary(c, a));
            const nSplit = (splitAB ? 1 : 0) + (splitBC ? 1 : 0) + (splitCA ? 1 : 0);
            if (nSplit === 0) {
                next.push([a, b, c]);
                continue;
            }
            splits++;
            const ab = splitAB ? getMid(a, b) : -1;
            const bc = splitBC ? getMid(b, c) : -1;
            const ca = splitCA ? getMid(c, a) : -1;
            if (nSplit === 3) next.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
            else if (nSplit === 1) {
                if (splitAB) next.push([a, ab, c], [ab, b, c]);
                else if (splitBC) next.push([a, b, bc], [a, bc, c]);
                else next.push([a, b, ca], [b, c, ca]);
            } else if (splitAB && splitBC) next.push([a, ab, c], [ab, b, bc], [ab, bc, c]);
            else if (splitBC && splitCA) next.push([a, b, ca], [b, bc, ca], [bc, c, ca]);
            else next.push([a, ab, ca], [ab, b, c], [ab, c, ca]);
        }
        work = next;
        if (splits === 0) break;
    }
    for (const [a, b, c] of work) pushTri(localIdx[a]!, localIdx[b]!, localIdx[c]!, flip);
}

function signedArea(ring: PolyPoint[]): number {
    let s = 0;
    for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % ring.length]!;
        s += a.x * b.y - b.x * a.y;
    }
    return 0.5 * s;
}

function uvGridCap(
    field: UvHeightField,
    height: XyHeightIndex | null,
    boundaryIdx: number[],
    boundaryPts: PolyPoint[],
    push: (p: PolyPoint) => number,
    pushTri: (a: number, b: number, c: number, flip?: boolean) => void,
    flip: boolean,
    prefer: "min" | "max",
): void {
    const n = boundaryPts.length;
    const rings = 10;
    const step = 0.85;
    let prev = boundaryIdx;
    let inner = boundaryPts.map((p) => ({ ...p }));
    const poly = inner.map((p) => ({ ...p }));
    const area0 = Math.abs(signedArea(inner));
    for (let k = 1; k <= rings; k++) {
        const ns = ringInwardNormals(inner);
        const ring: PolyPoint[] = [];
        let insideN = 0;
        for (let i = 0; i < n; i++) {
            const base = inner[i]!;
            const nn = ns[i]!;
            const x = base.x + nn.x * step;
            const y = base.y + nn.y * step;
            const inside = pointInPoly(x, y, poly);
            if (inside) insideN++;
            const px = inside ? x : base.x + nn.x * step * 0.25;
            const py = inside ? y : base.y + nn.y * step * 0.25;
            const z = sampleZ(field, height, px, py, base.z, prefer);
            ring.push({ x: px, y: py, z });
        }
        const area = Math.abs(signedArea(ring));
        let minSp = Infinity;
        for (let i = 0; i < n; i++) {
            const a = ring[i]!;
            const b = ring[(i + 1) % n]!;
            minSp = Math.min(minSp, Math.hypot(b.x - a.x, b.y - a.y));
        }
        if (insideN < n * 0.7 || area < area0 * 0.18 || minSp < 0.28) {
            break;
        }
        const row = ring.map((p) => push(p));
        for (let i = 0; i < n; i++) {
            const i1 = (i + 1) % n;
            if (flip) {
                pushTri(prev[i]!, row[i]!, row[i1]!);
                pushTri(prev[i]!, row[i1]!, prev[i1]!);
            } else {
                pushTri(prev[i]!, prev[i1]!, row[i1]!);
                pushTri(prev[i]!, row[i1]!, row[i]!);
            }
        }
        prev = row;
        inner = ring;
    }
    fillCap(inner, field, height, prev, push, pushTri, flip, prefer);
}

export interface ReconstructOptions extends ProceduralModifierInput {
    n?: number;
    wallLayers?: number;
}

/**
 * S1 reconstruction: planform-column B-spline loft + UV-grid sole sharing
 * the wall's bottom s-samples. Viewer mesh; OCCT solid is a later S3 export.
 */
export function reconstructProceduralWalls(
    model: StockWallModel,
    options: ReconstructOptions = {},
): BufferGeometry {
    const { columns, profiles, frame } =
        model.planform && model.columns
            ? applyCurveModifiers(model, options)
            : {
                  columns: model.planform?.columns ?? [],
                  profiles: model.columns ?? [],
                  frame: model.planform!,
              };
    if (!columns.length || !profiles.length) {
        throw new Error("S1 reconstruction requires planform columns");
    }

    const grid = loftWallGrid(columns, profiles);
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

    // Wall vertices first so sole/top can reuse the exact boundary samples.
    const wallBase = positions.length / 3;
    for (let i = 0; i < grid.positions.length; i++) positions.push(grid.positions[i]!);
    const wallIdx = wallTriangles(grid);
    for (let i = 0; i < wallIdx.length; i += 3) {
        pushTri(wallBase + wallIdx[i]!, wallBase + wallIdx[i + 1]!, wallBase + wallIdx[i + 2]!);
    }

    const nS = grid.nS;
    const outlineRing = Array.from({ length: nS }, (_, i) => wallBase + i);
    const rimRing = Array.from({ length: nS }, (_, i) => wallBase + (grid.nT - 1) * nS + i);
    const outlinePts: PolyPoint[] = [];
    const rimPts: PolyPoint[] = [];
    for (let i = 0; i < nS; i++) {
        outlinePts.push({
            x: grid.positions[i * 3]!,
            y: grid.positions[i * 3 + 1]!,
            z: grid.positions[i * 3 + 2]!,
        });
        const o = ((grid.nT - 1) * nS + i) * 3;
        rimPts.push({
            x: grid.positions[o]!,
            y: grid.positions[o + 1]!,
            z: grid.positions[o + 2]!,
        });
    }

    const topHeight =
        model.top.meshPositions && model.top.meshIndices
            ? buildXyHeightIndex(model.top.meshPositions, model.top.meshIndices)
            : null;
    const plantarHeight =
        model.outline.meshPositions && model.outline.meshIndices
            ? buildXyHeightIndex(model.outline.meshPositions, model.outline.meshIndices)
            : null;

    uvGridCap(model.outline.plantarZ, plantarHeight, outlineRing, outlinePts, push, pushTri, true, "min");
    uvGridCap(model.top.field, topHeight, rimRing, rimPts, push, pushTri, false, "max");

    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    geo.userData = {
        wallModel: "procedural",
        stockId: model.id,
        loftN: nS,
        planform: {
            spacingOk: frame.spacingOk,
            detSignStable: frame.detSignStable,
            minRho: frame.minRho,
            maxProfileResidual: Math.max(0, ...profiles.map((p) => p.residualMm)),
        },
        manifoldHint: analyzeManifold(geo),
    };
    return geo;
}
