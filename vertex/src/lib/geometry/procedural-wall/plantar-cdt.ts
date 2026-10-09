// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { cdtInteriorPolygon, countOpenNonBoundaryEdges, minDistToLoopXY, pointInPoly } from "./cdt-band";
import type { PolyPoint } from "./curves";
import { sampleUvField } from "./extract";
import { type DishZIndex, sampleDishZVertical } from "./height-xy";
import type { UvHeightField } from "./types";

export const PLANTAR_STEINER_MM = 1.8;
export const PLANTAR_MARGIN_MM = 1.5;
export const GRIND_REFINE_DZ_MM = 1.2;

export interface GeneratedPlantar {
    points: PolyPoint[];
    faces: Array<[number, number, number]>;
    boundaryCount: number;
    steinerCount: number;
    minZ: number;
    openEdges: number;
    missingBoundary: number;
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
    boundary: PolyPoint[],
    step = PLANTAR_STEINER_MM,
    margin = PLANTAR_MARGIN_MM,
): PolyPoint[] {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of boundary) {
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
            if (!pointInPoly(x, y, boundary)) continue;
            if (minDistToLoopXY(x, y, boundary) < margin) continue;
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

/** Plantar slope from horizontal along −h (inward), sampled 1–2 mm from B. */
export function samplePlantarSlopeAlongMinusH(
    points: PolyPoint[],
    faces: Array<[number, number, number]>,
    B: PolyPoint,
    h: { x: number; y: number },
): number {
    for (const s of [1.5, 2, 1]) {
        const z = interpolatePlantarZ(points, faces, B.x - h.x * s, B.y - h.y * s);
        if (z == null) continue;
        return Math.atan((z - B.z) / s);
    }
    return 0;
}

function insertSteiner(points: PolyPoint[], faces: Array<[number, number, number]>, p: PolyPoint): boolean {
    for (let i = 0; i < faces.length; i++) {
        const [a, b, c] = faces[i]!;
        const A = points[a]!;
        const B = points[b]!;
        const C = points[c]!;
        const w = barycentric(p.x, p.y, A.x, A.y, B.x, B.y, C.x, C.y);
        if (!w || w[0] < -1e-9 || w[1] < -1e-9 || w[2] < -1e-9) continue;
        const v = points.length;
        points.push({ ...p });
        faces.splice(i, 1);
        faces.push([a, b, v], [b, c, v], [c, a, v]);
        return true;
    }
    return false;
}

function grindRefine(
    boundary: PolyPoint[],
    points: PolyPoint[],
    faces: Array<[number, number, number]>,
): PolyPoint[] {
    const extra: PolyPoint[] = [];
    const seen = new Set<string>();
    const addMid = (a: number, b: number) => {
        if (a < boundary.length && b < boundary.length) return;
        const i = Math.min(a, b);
        const j = Math.max(a, b);
        const k = `${i},${j}`;
        if (seen.has(k)) return;
        seen.add(k);
        const pa = points[a]!;
        const pb = points[b]!;
        extra.push({ x: (pa.x + pb.x) * 0.5, y: (pa.y + pb.y) * 0.5, z: 0 });
    };
    for (const f of faces) {
        const e: Array<[number, number]> = [
            [f[0]!, f[1]!],
            [f[1]!, f[2]!],
            [f[2]!, f[0]!],
        ];
        for (const [a, b] of e) {
            const pa = points[a]!;
            const pb = points[b]!;
            const dz = Math.abs(pa.z - pb.z);
            const len = Math.hypot(pa.x - pb.x, pa.y - pb.y);
            if (dz < GRIND_REFINE_DZ_MM || len < PLANTAR_STEINER_MM) continue;
            if (!pointInPoly((pa.x + pb.x) * 0.5, (pa.y + pb.y) * 0.5, boundary)) continue;
            addMid(a, b);
        }
    }
    return extra;
}

export function assertPlantarDisk(faces: Array<[number, number, number]>, nBoundary: number): void {
    const { open, nonManifold, missingBoundary } = countOpenNonBoundaryEdges(faces, nBoundary);
    if (open !== 0 || nonManifold !== 0 || missingBoundary !== 0) {
        throw new Error(
            `[S1-CDT] plantar disk failed: open=${open} nonManifold=${nonManifold} ` +
                `missingBoundary=${missingBoundary}`,
        );
    }
}

/**
 * Constrained Delaunay of BottomOutline + Steiner grid. Boundary vertices stay
 * at indices 0..n-1 and are never split.
 */
export function triangulatePlantarXY(
    boundary: PolyPoint[],
    margin = PLANTAR_MARGIN_MM,
): {
    points: PolyPoint[];
    faces: Array<[number, number, number]>;
    boundaryCount: number;
    steinerCount: number;
} {
    const loop = boundary.map((p) => ({ ...p, z: 0 }));
    const steiner = hexSteiner(loop, PLANTAR_STEINER_MM, margin);
    const mesh = cdtInteriorPolygon(loop, steiner);
    return {
        points: mesh.points,
        faces: mesh.faces,
        boundaryCount: loop.length,
        steinerCount: mesh.points.length - loop.length,
    };
}

/**
 * Fully generated plantar: CDT of BottomOutline + ~1.8 mm Steiner grid.
 * Stock dish z is sampled first (clamped >= 0); posting / grind / zonal are
 * applied after triangulation; min z is re-anchored to 0.
 */
export function buildGeneratedPlantar(input: {
    boundary: PolyPoint[];
    dish: DishZIndex | null;
    field?: UvHeightField;
    zDelta: (x: number, y: number) => number;
    refineGrind?: boolean;
    marginMm?: number;
}): GeneratedPlantar {
    const boundary = input.boundary.map((p) => ({ ...p }));
    const mesh = triangulatePlantarXY(boundary, input.marginMm ?? PLANTAR_MARGIN_MM);
    applyPlantarFields(mesh.points, boundary, input.dish, input.field, input.zDelta);
    if (input.refineGrind) {
        const extra = grindRefine(boundary, mesh.points, mesh.faces);
        for (const p of extra) insertSteiner(mesh.points, mesh.faces, p);
        if (extra.length) applyPlantarFields(mesh.points, boundary, input.dish, input.field, input.zDelta);
    }
    reanchorPlantarMinZ(mesh.points);
    assertPlantarDisk(mesh.faces, boundary.length);
    const hygiene = countOpenNonBoundaryEdges(mesh.faces, boundary.length);
    let minZ = Infinity;
    for (const p of mesh.points) if (p.z < minZ) minZ = p.z;
    return {
        points: mesh.points,
        faces: mesh.faces,
        boundaryCount: boundary.length,
        steinerCount: mesh.points.length - boundary.length,
        minZ: Number.isFinite(minZ) ? minZ : 0,
        openEdges: hygiene.open,
        missingBoundary: hygiene.missingBoundary,
    };
}
