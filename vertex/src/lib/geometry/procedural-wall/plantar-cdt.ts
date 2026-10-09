// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { countOpenNonBoundaryEdges, minDistToLoopXY, pointInPoly } from "./cdt-band";
import { assertIEdges, assertLibraryDisk, libraryCdtInterior } from "./cdt-lib";
import type { PolyPoint } from "./curves";
import { sampleUvField } from "./extract";
import { type DishZIndex, sampleDishZVertical } from "./height-xy";
import type { UvHeightField } from "./types";

export const PLANTAR_STEINER_MM = 1.8;
export const PLANTAR_MARGIN_MM = 1.5;
export const PLANTAR_STEINER_OUTLINE_FRAC = 0.75;
export const GRIND_REFINE_DZ_MM = 1.2;

export interface GeneratedPlantar {
    points: PolyPoint[];
    faces: Array<[number, number, number]>;
    boundaryCount: number;
    bandCount: number;
    steinerCount: number;
    minZ: number;
    openEdges: number;
    missingBoundary: number;
    extraLift: number;
}

export interface PlantarSampler {
    z(x: number, y: number, fallback?: number): number;
    lift: number;
}

function stockDishZ(
    x: number,
    y: number,
    dish: DishZIndex | null,
    field: UvHeightField | undefined,
    fallback: number,
): number {
    let z = dish ? sampleDishZVertical(dish, x, y) : null;
    if (z == null && field) z = sampleUvField(field, x, y);
    if (z == null) z = fallback;
    return Math.max(0, z);
}

export function hexSteiner(
    outer: PolyPoint[],
    step = PLANTAR_STEINER_MM,
    margin = PLANTAR_MARGIN_MM,
    inner?: PolyPoint[],
): PolyPoint[] {
    const outlineKeep = Math.max(margin, step * PLANTAR_STEINER_OUTLINE_FRAC);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const clip = inner && inner.length >= 3 ? inner : outer;
    for (const p of clip) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    const rowH = step * 0.8660254037844386;
    const out: PolyPoint[] = [];
    let row = 0;
    for (let y = minY + margin; y <= maxY - margin; y += rowH, row++) {
        const x0 = minX + margin + (row % 2 === 1 ? step * 0.5 : 0);
        for (let x = x0; x <= maxX - margin; x += step) {
            if (!pointInPoly(x, y, clip)) continue;
            if (minDistToLoopXY(x, y, outer) < outlineKeep) continue;
            if (inner && inner.length >= 3 && minDistToLoopXY(x, y, inner) < margin * 0.5) continue;
            out.push({ x, y, z: 0 });
        }
    }
    return out;
}

export function applyPlantarFields(
    points: PolyPoint[],
    boundary: PolyPoint[],
    dish: DishZIndex | null,
    field: UvHeightField | undefined,
    zDelta: (x: number, y: number) => number,
): void {
    for (let i = 0; i < points.length; i++) {
        const p = points[i]!;
        const fb = i < boundary.length ? boundary[i]!.z : 0;
        p.z = stockDishZ(p.x, p.y, dish, field, fb) + zDelta(p.x, p.y);
    }
}

export function reanchorPlantarMinZ(points: PolyPoint[]): number {
    let minZ = Infinity;
    for (const p of points) if (p.z < minZ) minZ = p.z;
    const lift = Number.isFinite(minZ) && minZ < 0 ? -minZ : 0;
    if (lift) for (const p of points) p.z += lift;
    return lift;
}

/**
 * Dish + zDelta + a single re-anchor lift, computed before B / F / the band.
 * Every later z sample (B, band rows, CDT interior) uses this same field.
 */
export function makePlantarSampler(
    outline: PolyPoint[],
    dish: DishZIndex | null,
    field: UvHeightField | undefined,
    zDelta: (x: number, y: number) => number,
): PlantarSampler {
    const raw = (x: number, y: number, fallback = 0): number =>
        stockDishZ(x, y, dish, field, fallback) + zDelta(x, y);
    let minZ = Infinity;
    for (const p of outline) minZ = Math.min(minZ, raw(p.x, p.y, p.z));
    const probes = hexSteiner(outline, Math.max(PLANTAR_STEINER_MM, 3), 1);
    for (const p of probes) minZ = Math.min(minZ, raw(p.x, p.y, 0));
    const lift = Number.isFinite(minZ) && minZ < 0 ? -minZ : 0;
    return {
        lift,
        z: (x, y, fallback = 0) => raw(x, y, fallback) + lift,
    };
}

function barycentric(
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
): [number, number, number] | null {
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(den) < 1e-18) return null;
    const w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den;
    const w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den;
    const w2 = 1 - w0 - w1;
    return [w0, w1, w2];
}

export function interpolatePlantarZ(
    points: PolyPoint[],
    faces: Array<[number, number, number]>,
    x: number,
    y: number,
): number | null {
    for (const f of faces) {
        const A = points[f[0]!]!;
        const B = points[f[1]!]!;
        const C = points[f[2]!]!;
        const w = barycentric(x, y, A.x, A.y, B.x, B.y, C.x, C.y);
        if (!w) continue;
        if (w[0] < -1e-7 || w[1] < -1e-7 || w[2] < -1e-7) continue;
        return w[0] * A.z + w[1] * B.z + w[2] * C.z;
    }
    return null;
}

/** Plantar slope from horizontal, sampled 1–2 mm inward of B. */
export function samplePlantarSlopeAlongMinusH(
    points: PolyPoint[],
    faces: Array<[number, number, number]>,
    B: PolyPoint,
    h: { x: number; y: number },
    outer?: PolyPoint[],
): number {
    const dirs = [
        { x: h.x, y: h.y },
        { x: -h.x, y: -h.y },
    ];
    for (const dir of dirs) {
        const probe = { x: B.x + dir.x * 1.5, y: B.y + dir.y * 1.5 };
        if (outer && !pointInPoly(probe.x, probe.y, outer)) continue;
        for (const s of [1.5, 2, 1]) {
            const z = interpolatePlantarZ(points, faces, B.x + dir.x * s, B.y + dir.y * s);
            if (z == null) continue;
            const alongH = dir.x * h.x + dir.y * h.y;
            return Math.atan(((z - B.z) / s) * Math.sign(alongH || 1));
        }
    }
    return 0;
}

function nudgeInteriorDuplicates(points: PolyPoint[], nOuter: number, tol = 0.045): void {
    for (let i = 0; i < points.length; i++) {
        for (let j = Math.max(i + 1, nOuter); j < points.length; j++) {
            const a = points[i]!;
            const b = points[j]!;
            const d = Math.hypot(b.x - a.x, b.y - a.y);
            if (d >= tol) continue;
            const ang = (j * 2.399963) % (Math.PI * 2);
            b.x += Math.cos(ang) * tol;
            b.y += Math.sin(ang) * tol;
        }
    }
}

export function assertPlantarDisk(faces: Array<[number, number, number]>, nBoundary: number): void {
    assertIEdges(faces, nBoundary);
    assertLibraryDisk(faces, nBoundary);
}

/**
 * Constrained Delaunay of the inner band ring I + Steiner inside I.
 * Boundary vertices stay at 0..n-1 and are never split. The structured
 * band is not a CDT constraint.
 */
export function triangulatePlantarXY(
    boundary: PolyPoint[],
    margin = PLANTAR_MARGIN_MM,
): {
    points: PolyPoint[];
    faces: Array<[number, number, number]>;
    boundaryCount: number;
    bandCount: number;
    steinerCount: number;
} {
    const loop = boundary.map((p) => ({ ...p, z: 0 }));
    const steiner = hexSteiner(loop, PLANTAR_STEINER_MM, margin);
    const points = [...loop, ...steiner];
    nudgeInteriorDuplicates(points, loop.length);
    const faces = libraryCdtInterior(points, loop.length);
    assertIEdges(faces, loop.length);
    assertLibraryDisk(faces, loop.length);
    return {
        points,
        faces,
        boundaryCount: loop.length,
        bandCount: 0,
        steinerCount: steiner.length,
    };
}

export function buildGeneratedPlantar(input: {
    boundary: PolyPoint[];
    dish: DishZIndex | null;
    field?: UvHeightField;
    zDelta: (x: number, y: number) => number;
    refineGrind?: boolean;
    marginMm?: number;
    sampler?: PlantarSampler;
}): GeneratedPlantar {
    const boundary = input.boundary.map((p) => ({ ...p }));
    const mesh = triangulatePlantarXY(boundary, input.marginMm ?? PLANTAR_MARGIN_MM);
    const sampler = input.sampler;
    if (sampler) {
        for (const p of mesh.points) p.z = sampler.z(p.x, p.y, 0);
    } else {
        applyPlantarFields(mesh.points, boundary, input.dish, input.field, input.zDelta);
    }
    const extraLift = reanchorPlantarMinZ(mesh.points);
    assertPlantarDisk(mesh.faces, boundary.length);
    const hygiene = countOpenNonBoundaryEdges(mesh.faces, boundary.length);
    let minZ = Infinity;
    for (const p of mesh.points) if (p.z < minZ) minZ = p.z;
    return {
        points: mesh.points,
        faces: mesh.faces,
        boundaryCount: boundary.length,
        bandCount: mesh.bandCount,
        steinerCount: mesh.steinerCount,
        minZ: Number.isFinite(minZ) ? minZ : 0,
        openEdges: hygiene.open,
        missingBoundary: hygiene.missingBoundary,
        extraLift,
    };
}
