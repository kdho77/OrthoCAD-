// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { minDistToLoopXY, pointInPoly } from "./cdt-band";
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

function orient2(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function inTri(
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
): boolean {
    const o0 = orient2(ax, ay, bx, by, px, py);
    const o1 = orient2(bx, by, cx, cy, px, py);
    const o2 = orient2(cx, cy, ax, ay, px, py);
    return o0 >= -1e-9 && o1 >= -1e-9 && o2 >= -1e-9;
}

function earClip(poly: PolyPoint[]): Array<[number, number, number]> {
    const n = poly.length;
    if (n < 3) return [];
    const next = Int32Array.from({ length: n }, (_, i) => (i + 1) % n);
    const prev = Int32Array.from({ length: n }, (_, i) => (i - 1 + n) % n);
    const reflex = (i: number): boolean =>
        orient2(
            poly[prev[i]!]!.x,
            poly[prev[i]!]!.y,
            poly[i]!.x,
            poly[i]!.y,
            poly[next[i]!]!.x,
            poly[next[i]!]!.y,
        ) <= 1e-12;
    const isEar = (i: number): boolean => {
        if (reflex(i)) return false;
        const a = prev[i]!;
        const b = i;
        const c = next[i]!;
        const pa = poly[a]!;
        const pb = poly[b]!;
        const pc = poly[c]!;
        if (orient2(pa.x, pa.y, pb.x, pb.y, pc.x, pc.y) <= 1e-12) return false;
        for (let k = next[c]!; k !== a; k = next[k]!) {
            if (!reflex(k)) continue;
            const p = poly[k]!;
            if (inTri(p.x, p.y, pa.x, pa.y, pb.x, pb.y, pc.x, pc.y)) return false;
        }
        return true;
    };
    const faces: Array<[number, number, number]> = [];
    let remaining = n;
    let i = 0;
    let fail = 0;
    while (remaining > 3 && fail < remaining * 8) {
        const a0 = prev[i]!;
        const c0 = next[i]!;
        const o = orient2(poly[a0]!.x, poly[a0]!.y, poly[i]!.x, poly[i]!.y, poly[c0]!.x, poly[c0]!.y);
        if (Math.abs(o) <= 1e-8) {
            next[a0] = c0;
            prev[c0] = a0;
            remaining--;
            fail = 0;
            i = c0;
            continue;
        }
        if (isEar(i)) {
            if (o > 0) faces.push([a0, i, c0]);
            else faces.push([a0, c0, i]);
            next[a0] = c0;
            prev[c0] = a0;
            remaining--;
            fail = 0;
            i = c0;
        } else {
            fail++;
            i = next[i]!;
        }
    }
    if (remaining === 3) {
        const a = i;
        const b = next[a]!;
        const c = next[b]!;
        if (orient2(poly[a]!.x, poly[a]!.y, poly[b]!.x, poly[b]!.y, poly[c]!.x, poly[c]!.y) > 0) {
            faces.push([a, b, c]);
        } else {
            faces.push([a, c, b]);
        }
    }
    return faces;
}

function insertSteiner(points: PolyPoint[], faces: Array<[number, number, number]>, p: PolyPoint): boolean {
    for (let i = 0; i < faces.length; i++) {
        const [a, b, c] = faces[i]!;
        const A = points[a]!;
        const B = points[b]!;
        const C = points[c]!;
        if (!inTri(p.x, p.y, A.x, A.y, B.x, B.y, C.x, C.y)) continue;
        const v = points.length;
        points.push({ ...p });
        faces.splice(i, 1);
        faces.push([a, b, v], [b, c, v], [c, a, v]);
        return true;
    }
    return false;
}

function triangulateInterior(
    boundary: PolyPoint[],
    steiner: PolyPoint[],
): {
    points: PolyPoint[];
    faces: Array<[number, number, number]>;
} {
    const points = boundary.map((p) => ({ ...p }));
    const faces = earClip(points);
    for (const s of steiner) insertSteiner(points, faces, s);
    return { points, faces };
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
    const steiner = hexSteiner(boundary);
    const mesh = triangulateInterior(boundary, steiner);
    applyZ(mesh.points, boundary, input.dish, input.field, input.zDelta);
    if (input.refineGrind) {
        const extra = grindRefine(boundary, mesh.points, mesh.faces);
        for (const p of extra) insertSteiner(mesh.points, mesh.faces, p);
        if (extra.length) applyZ(mesh.points, boundary, input.dish, input.field, input.zDelta);
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
