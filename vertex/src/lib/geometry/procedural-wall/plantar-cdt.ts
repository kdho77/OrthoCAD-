// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { cdtInteriorPolygon, minDistToLoopXY, pointInPoly } from "./cdt-band";
import type { PolyPoint } from "./curves";
import { sampleUvField } from "./extract";
import { type DishZIndex, sampleDishZVertical } from "./height-xy";
import type { UvHeightField } from "./types";

export const PLANTAR_STEINER_MM = 1.8;
export const PLANTAR_MARGIN_MM = 1.0;
export const GRIND_REFINE_DZ_MM = 1.2;

export interface GeneratedPlantar {
    points: PolyPoint[];
    faces: Array<[number, number, number]>;
    boundaryCount: number;
    steinerCount: number;
    minZ: number;
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

function hexSteiner(
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

function applyZ(
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

function reanchorMinZ(points: PolyPoint[]): number {
    let minZ = Infinity;
    for (const p of points) if (p.z < minZ) minZ = p.z;
    const lift = Number.isFinite(minZ) && minZ < 0 ? -minZ : 0;
    if (lift) for (const p of points) p.z += lift;
    return lift;
}

function grindRefine(
    boundary: PolyPoint[],
    points: PolyPoint[],
    faces: Array<[number, number, number]>,
): PolyPoint[] {
    const extra: PolyPoint[] = [];
    const seen = new Set<string>();
    const addMid = (a: number, b: number) => {
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
}): GeneratedPlantar {
    const boundary = input.boundary.map((p) => ({ ...p }));
    let steiner = hexSteiner(boundary);
    let mesh = cdtInteriorPolygon(boundary, steiner);
    applyZ(mesh.points, boundary, input.dish, input.field, input.zDelta);
    if (input.refineGrind) {
        const extra = grindRefine(boundary, mesh.points, mesh.faces);
        if (extra.length) {
            steiner = steiner.concat(extra);
            mesh = cdtInteriorPolygon(boundary, steiner);
            applyZ(mesh.points, boundary, input.dish, input.field, input.zDelta);
        }
    }
    reanchorMinZ(mesh.points);
    let minZ = Infinity;
    for (const p of mesh.points) if (p.z < minZ) minZ = p.z;
    return {
        points: mesh.points,
        faces: mesh.faces,
        boundaryCount: boundary.length,
        steinerCount: mesh.points.length - boundary.length,
        minZ: Number.isFinite(minZ) ? minZ : 0,
    };
}
