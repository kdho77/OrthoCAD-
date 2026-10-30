// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { ELEMENT_PROFILES, elementHeightAt } from "@/lib/geometry/elements";
import { type HeightFieldParams, heightAt, outlineHalfWidth } from "@/lib/geometry/height-field";
import { sampleDefaultOutline } from "@/lib/geometry/trimline";
import type { PlacedElement } from "@/types";
import type { HardnessRegion } from "../../../shared/print-recipe/hardness-region";
import {
    intersectPolygons,
    occupancyToPolygon,
    offsetPolygon,
    openClose,
    pointInPoly,
    snapVertices,
    type Xy,
} from "./clip2";
import {
    BOTTOM_CLAMP_MM,
    emptyMesh,
    GRID_MM,
    LIFT_THRESHOLD_MM,
    MIN_THICKNESS_MM,
    meshVolume,
    OUTLINE_CLIP_OFFSET_MM,
    OVERSHOOT_MM,
    type TriangleMesh,
} from "./mesh";

export interface SurfaceSampler {
    lengthMm: number;
    widthMm: number;
    outline: Xy[];
    zTop(x: number, y: number): number;
    /** Insole top without this element's lift (elements) or zTop (zones/freehand). */
    zBase(x: number, y: number): number;
}

export function xyToUv(
    x: number,
    y: number,
    lengthMm: number,
    widthMm: number,
): { u: number; vSigned: number } {
    const u = lengthMm > 1e-9 ? x / lengthMm : 0;
    const hw = outlineHalfWidth(u) * (widthMm / 2);
    const vSigned = hw > 1e-9 ? y / hw : 0;
    return { u, vSigned };
}

export function makeParametricSampler(params: HeightFieldParams, excludeElementId?: string): SurfaceSampler {
    const outline = sampleDefaultOutline(params.lengthMm, params.widthMm).points.map((p) => ({
        x: p.x,
        y: p.y,
    }));
    const others: PlacedElement[] = (params.elements ?? []).filter((e) => e.id !== excludeElementId);
    const baseParams: HeightFieldParams = { ...params, elements: others };
    return {
        lengthMm: params.lengthMm,
        widthMm: params.widthMm,
        outline,
        zTop: (x, y) => {
            const { u, vSigned } = xyToUv(x, y, params.lengthMm, params.widthMm);
            return heightAt(u, vSigned, params);
        },
        zBase: (x, y) => {
            const { u, vSigned } = xyToUv(x, y, params.lengthMm, params.widthMm);
            return heightAt(u, vSigned, baseParams);
        },
    };
}

function elementLiftAt(el: PlacedElement, x: number, y: number, lengthMm: number): number {
    return Math.abs(elementHeightAt([el], x, y, lengthMm));
}

function cellZs(
    region: HardnessRegion,
    sampler: SurfaceSampler,
    x: number,
    y: number,
): { top: number; bottom: number } | null {
    const zTopSurf = sampler.zTop(x, y);
    const top = zTopSurf + OVERSHOOT_MM;
    let bottom: number;
    if (region.depth.type === "full") {
        bottom = BOTTOM_CLAMP_MM;
    } else if (region.depth.type === "mm") {
        bottom = zTopSurf - region.depth.mm;
    } else {
        bottom = sampler.zBase(x, y) - region.depth.depthBelowMm;
    }
    bottom = Math.max(BOTTOM_CLAMP_MM, bottom);
    if (top - bottom < MIN_THICKNESS_MM) return null;
    return { top, bottom };
}

function footprintFromOccupancy(
    occ: boolean[][],
    originX: number,
    originY: number,
    outline: Xy[],
): Xy[] | null {
    const raw = occupancyToPolygon(occ, originX, originY, GRID_MM);
    if (!raw) return null;
    const closed = openClose(raw);
    if (!closed) return null;
    const outlineClip = offsetPolygon(outline, OUTLINE_CLIP_OFFSET_MM) ?? outline;
    const clipped = intersectPolygons(closed, outlineClip) ?? closed;
    const snapped = snapVertices(clipped);
    return snapped.length >= 3 ? snapped : null;
}

function rasterizePolygon(poly: Xy[], originX: number, originY: number, nx: number, ny: number): boolean[][] {
    const occ: boolean[][] = [];
    for (let iy = 0; iy < ny; iy++) {
        const row: boolean[] = [];
        const y = originY + (iy + 0.5) * GRID_MM;
        for (let ix = 0; ix < nx; ix++) {
            const x = originX + (ix + 0.5) * GRID_MM;
            row.push(pointInPoly(x, y, poly));
        }
        occ.push(row);
    }
    return occ;
}

function buildPrismMesh(
    occ: boolean[][],
    originX: number,
    originY: number,
    region: HardnessRegion,
    sampler: SurfaceSampler,
): TriangleMesh {
    const ny = occ.length;
    const nx = occ[0]?.length ?? 0;
    if (nx === 0 || ny === 0) return emptyMesh();

    const topZ: number[] = [];
    const botZ: number[] = [];
    const valid: boolean[] = [];
    const idxOf = (ix: number, iy: number) => iy * (nx + 1) + ix;

    for (let iy = 0; iy <= ny; iy++) {
        for (let ix = 0; ix <= nx; ix++) {
            const used =
                (ix > 0 && iy > 0 && occ[iy - 1]?.[ix - 1]) ||
                (ix < nx && iy > 0 && occ[iy - 1]?.[ix]) ||
                (ix > 0 && iy < ny && occ[iy]?.[ix - 1]) ||
                (ix < nx && iy < ny && occ[iy]?.[ix]);
            if (!used) {
                topZ.push(0);
                botZ.push(0);
                valid.push(false);
                continue;
            }
            const x = originX + ix * GRID_MM;
            const y = originY + iy * GRID_MM;
            const zs = cellZs(region, sampler, x, y);
            if (!zs) {
                topZ.push(0);
                botZ.push(0);
                valid.push(false);
                continue;
            }
            topZ.push(zs.top);
            botZ.push(zs.bottom);
            valid.push(true);
        }
    }

    const positions: number[] = [];
    const topId: number[] = new Array((nx + 1) * (ny + 1)).fill(-1);
    const botId: number[] = new Array((nx + 1) * (ny + 1)).fill(-1);
    const push = (ix: number, iy: number, z: number, store: number[]): number => {
        const k = idxOf(ix, iy);
        if (store[k]! >= 0) return store[k]!;
        const id = positions.length / 3;
        store[k] = id;
        positions.push(originX + ix * GRID_MM, originY + iy * GRID_MM, z);
        return id;
    };

    const indices: number[] = [];
    const addQuad = (a: number, b: number, c: number, d: number, flip = false) => {
        if (flip) {
            indices.push(a, c, b, a, d, c);
        } else {
            indices.push(a, b, c, a, c, d);
        }
    };

    for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
            if (!occ[iy]![ix]) continue;
            const i00 = idxOf(ix, iy);
            const i10 = idxOf(ix + 1, iy);
            const i11 = idxOf(ix + 1, iy + 1);
            const i01 = idxOf(ix, iy + 1);
            if (!valid[i00] || !valid[i10] || !valid[i11] || !valid[i01]) continue;

            const t00 = push(ix, iy, topZ[i00]!, topId);
            const t10 = push(ix + 1, iy, topZ[i10]!, topId);
            const t11 = push(ix + 1, iy + 1, topZ[i11]!, topId);
            const t01 = push(ix, iy + 1, topZ[i01]!, topId);
            addQuad(t00, t10, t11, t01, false);

            const b00 = push(ix, iy, botZ[i00]!, botId);
            const b10 = push(ix + 1, iy, botZ[i10]!, botId);
            const b11 = push(ix + 1, iy + 1, botZ[i11]!, botId);
            const b01 = push(ix, iy + 1, botZ[i01]!, botId);
            addQuad(b00, b10, b11, b01, true);

            const occupied = (x: number, y: number) => occ[y]?.[x] === true;
            if (!occupied(ix, iy - 1)) {
                addQuad(
                    push(ix, iy, botZ[i00]!, botId),
                    push(ix + 1, iy, botZ[i10]!, botId),
                    push(ix + 1, iy, topZ[i10]!, topId),
                    push(ix, iy, topZ[i00]!, topId),
                    false,
                );
            }
            if (!occupied(ix, iy + 1)) {
                addQuad(
                    push(ix + 1, iy + 1, botZ[i11]!, botId),
                    push(ix, iy + 1, botZ[i01]!, botId),
                    push(ix, iy + 1, topZ[i01]!, topId),
                    push(ix + 1, iy + 1, topZ[i11]!, topId),
                    false,
                );
            }
            if (!occupied(ix - 1, iy)) {
                addQuad(
                    push(ix, iy + 1, botZ[i01]!, botId),
                    push(ix, iy, botZ[i00]!, botId),
                    push(ix, iy, topZ[i00]!, topId),
                    push(ix, iy + 1, topZ[i01]!, topId),
                    false,
                );
            }
            if (!occupied(ix + 1, iy)) {
                addQuad(
                    push(ix + 1, iy, botZ[i10]!, botId),
                    push(ix + 1, iy + 1, botZ[i11]!, botId),
                    push(ix + 1, iy + 1, topZ[i11]!, topId),
                    push(ix + 1, iy, topZ[i10]!, topId),
                    false,
                );
            }
        }
    }

    if (indices.length < 12) return emptyMesh();
    return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

export interface RawModifier {
    region: HardnessRegion;
    mesh: TriangleMesh;
    footprint: Xy[];
    volumeMm3: number;
}

function gridOrigin(
    poly: Xy[],
    pad = GRID_MM * 2,
): { originX: number; originY: number; nx: number; ny: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of poly) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
    }
    const originX = Math.floor((minX - pad) / GRID_MM) * GRID_MM;
    const originY = Math.floor((minY - pad) / GRID_MM) * GRID_MM;
    const nx = Math.max(2, Math.ceil((maxX + pad - originX) / GRID_MM));
    const ny = Math.max(2, Math.ceil((maxY + pad - originY) / GRID_MM));
    return { originX, originY, nx, ny };
}

function elementLocalGrid(el: PlacedElement, sampler: SurfaceSampler) {
    if (el.kind === "custom") return gridOrigin(sampler.outline);
    const p = ELEMENT_PROFILES[el.kind];
    const rx = Math.max(2, p.rxMm * el.scale.x) + 6;
    const ry = Math.max(2, p.ryMm * el.scale.y) + 6;
    const cx = sampler.lengthMm / 2 + el.position.x;
    const cy = el.position.y;
    const rot = (el.rotationDeg * Math.PI) / 180;
    const c = Math.abs(Math.cos(rot));
    const s = Math.abs(Math.sin(rot));
    const hx = rx * c + ry * s;
    const hy = rx * s + ry * c;
    return gridOrigin([
        { x: cx - hx, y: cy - hy },
        { x: cx + hx, y: cy - hy },
        { x: cx + hx, y: cy + hy },
        { x: cx - hx, y: cy + hy },
    ]);
}

export function buildElementFootprint(el: PlacedElement, sampler: SurfaceSampler): Xy[] | null {
    const { originX, originY, nx, ny } = elementLocalGrid(el, sampler);
    const occ: boolean[][] = [];
    for (let iy = 0; iy < ny; iy++) {
        const row: boolean[] = [];
        const y = originY + (iy + 0.5) * GRID_MM;
        for (let ix = 0; ix < nx; ix++) {
            const x = originX + (ix + 0.5) * GRID_MM;
            row.push(elementLiftAt(el, x, y, sampler.lengthMm) >= LIFT_THRESHOLD_MM);
        }
        occ.push(row);
    }
    return footprintFromOccupancy(occ, originX, originY, sampler.outline);
}

export function buildRegionFootprint(
    region: HardnessRegion,
    sampler: SurfaceSampler,
    el?: PlacedElement,
): Xy[] | null {
    if (region.kind === "element") {
        if (!el) return region.polygon && region.polygon.length >= 3 ? region.polygon : null;
        return buildElementFootprint(el, sampler);
    }
    if (!region.polygon || region.polygon.length < 3) return null;
    const closed = openClose(region.polygon) ?? region.polygon;
    const outlineClip = offsetPolygon(sampler.outline, OUTLINE_CLIP_OFFSET_MM) ?? sampler.outline;
    const clipped = intersectPolygons(closed, outlineClip) ?? closed;
    const snapped = snapVertices(clipped);
    return snapped.length >= 3 ? snapped : null;
}

export function buildHeightFieldPrism(
    region: HardnessRegion,
    sampler: SurfaceSampler,
    el?: PlacedElement,
): RawModifier | null {
    const footprint = buildRegionFootprint(region, sampler, el);
    if (!footprint) return null;
    const { originX, originY, nx, ny } = gridOrigin(footprint);
    const occ = rasterizePolygon(footprint, originX, originY, nx, ny);
    // Drop thin cells (center + four corners so skipped cells cannot punch holes).
    const cornerOk = (x: number, y: number) => cellZs(region, sampler, x, y) !== null;
    for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
            if (!occ[iy]![ix]) continue;
            const x0 = originX + ix * GRID_MM;
            const y0 = originY + iy * GRID_MM;
            const x1 = x0 + GRID_MM;
            const y1 = y0 + GRID_MM;
            if (
                !cornerOk(x0, y0) ||
                !cornerOk(x1, y0) ||
                !cornerOk(x1, y1) ||
                !cornerOk(x0, y1) ||
                !cellZs(region, sampler, originX + (ix + 0.5) * GRID_MM, originY + (iy + 0.5) * GRID_MM)
            ) {
                occ[iy]![ix] = false;
            }
        }
    }
    const mesh = buildPrismMesh(occ, originX, originY, region, sampler);
    if (mesh.indices.length === 0) return null;
    return { region, mesh, footprint, volumeMm3: meshVolume(mesh) };
}
