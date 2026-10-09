// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { countOpenNonBoundaryEdges, minDistToLoopXY, pointInPoly } from "./cdt-band";
import { assertIEdges, assertLibraryDisk, assertRemainingIEdges, libraryCdtInterior } from "./cdt-lib";
import type { PolyPoint } from "./curves";
import { sampleUvField } from "./extract";
import { type DishZIndex, sampleDishZVertical } from "./height-xy";
import type { UvHeightField } from "./types";

export const PLANTAR_STEINER_MM = 1.8;
export const PLANTAR_MARGIN_MM = 1.5;
export const PLANTAR_STEINER_OUTLINE_FRAC = 0.75;
export const PLANTAR_STEINER_EDGE_MIN_MM = 0.5;
export const GRIND_REFINE_DZ_MM = 1.2;
export const I_COLLAPSE_MM = 0.3;
export const I_SLIVER_ASPECT = 20;

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
    collapsedIEdges: number;
    sliverMaxAspect: number;
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
    const outlineKeep = Math.max(step * PLANTAR_STEINER_OUTLINE_FRAC, PLANTAR_STEINER_EDGE_MIN_MM, margin);
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
    opts?: { flat?: boolean },
): PlantarSampler {
    const raw = (x: number, y: number, fallback = 0): number =>
        (opts?.flat ? 0 : stockDishZ(x, y, dish, field, fallback)) + zDelta(x, y);
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

function findRoot(parent: number[], i: number): number {
    let x = i;
    while (parent[x] !== x) x = parent[x]!;
    return x;
}

function edgeKey(a: number, b: number): string {
    return a < b ? `${a},${b}` : `${b},${a}`;
}

/**
 * After the CDT, weld I edges shorter than 0.3 mm so triangles next to I
 * cannot form slivers. Wall stations stay 1:1; only the plantar disk merges.
 */
export function collapseShortIEdges(
    points: PolyPoint[],
    faces: Array<[number, number, number]>,
    nOuter: number,
    minEdge = I_COLLAPSE_MM,
): { faces: Array<[number, number, number]>; parent: number[]; collapsed: number } {
    const parent = points.map((_, i) => i);
    let collapsed = 0;
    for (let i = 0; i < nOuter; i++) {
        const j = (i + 1) % nOuter;
        const a = points[i]!;
        const b = points[j]!;
        if (Math.hypot(b.x - a.x, b.y - a.y) + Math.abs(b.z - a.z) >= minEdge) continue;
        const ra = findRoot(parent, i);
        const rb = findRoot(parent, j);
        if (ra === rb) continue;
        parent[rb] = ra;
        collapsed++;
    }
    const next: Array<[number, number, number]> = [];
    for (const f of faces) {
        const a = findRoot(parent, f[0]!);
        const b = findRoot(parent, f[1]!);
        const c = findRoot(parent, f[2]!);
        if (a === b || b === c || c === a) continue;
        next.push([a, b, c]);
    }
    return { faces: next, parent, collapsed };
}

export function maxIAspect(
    points: PolyPoint[],
    faces: Array<[number, number, number]>,
    nOuter: number,
): number {
    let best = 1;
    for (const f of faces) {
        if (f[0]! >= nOuter && f[1]! >= nOuter && f[2]! >= nOuter) continue;
        const A = points[f[0]!]!;
        const B = points[f[1]!]!;
        const C = points[f[2]!]!;
        const e1 = Math.hypot(B.x - A.x, B.y - A.y);
        const e2 = Math.hypot(C.x - B.x, C.y - B.y);
        const e3 = Math.hypot(A.x - C.x, A.y - C.y);
        const short = Math.min(e1, e2, e3);
        const long = Math.max(e1, e2, e3);
        if (short < 1e-9) {
            best = Infinity;
            continue;
        }
        best = Math.max(best, long / short);
    }
    return best;
}

export function assertISlivers(
    points: PolyPoint[],
    faces: Array<[number, number, number]>,
    nOuter: number,
    limit = I_SLIVER_ASPECT,
): number {
    const aspect = maxIAspect(points, faces, nOuter);
    if (aspect > limit) {
        throw new Error(`[S1-I] CDT sliver aspect ${aspect.toFixed(1)} > ${limit} next to I`);
    }
    return aspect;
}

function diskAgainstRemaining(
    faces: Array<[number, number, number]>,
    nOuter: number,
    parent: number[],
): { open: number; missingBoundary: number; nonManifold: number } {
    const bound = new Set<string>();
    for (let i = 0; i < nOuter; i++) {
        const a = findRoot(parent, i);
        const b = findRoot(parent, (i + 1) % nOuter);
        if (a !== b) bound.add(edgeKey(a, b));
    }
    const use = new Map<string, number>();
    for (const f of faces) {
        for (const [a, b] of [
            [f[0]!, f[1]!],
            [f[1]!, f[2]!],
            [f[2]!, f[0]!],
        ] as Array<[number, number]>) {
            const k = edgeKey(a, b);
            use.set(k, (use.get(k) ?? 0) + 1);
        }
    }
    let open = 0;
    let nonManifold = 0;
    let missingBoundary = 0;
    for (const [k, n] of use) {
        if (n === 1) {
            if (!bound.has(k)) open++;
        } else if (n !== 2) {
            nonManifold++;
        }
    }
    for (const k of bound) {
        if ((use.get(k) ?? 0) !== 1) missingBoundary++;
    }
    return { open, missingBoundary, nonManifold };
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
    collapsedIEdges: number;
    sliverMaxAspect: number;
} {
    const loop = boundary.map((p) => ({ ...p, z: 0 }));
    const steiner = hexSteiner(loop, PLANTAR_STEINER_MM, margin).filter(
        (p) => minDistToLoopXY(p.x, p.y, loop) >= PLANTAR_STEINER_EDGE_MIN_MM,
    );
    const points = [...loop, ...steiner];
    nudgeInteriorDuplicates(points, loop.length);
    let faces = libraryCdtInterior(points, loop.length);
    assertIEdges(faces, loop.length);
    assertLibraryDisk(faces, loop.length);
    const collapsed = collapseShortIEdges(points, faces, loop.length);
    faces = collapsed.faces;
    assertRemainingIEdges(faces, loop.length, collapsed.parent);
    const hygiene = diskAgainstRemaining(faces, loop.length, collapsed.parent);
    if (hygiene.open !== 0 || hygiene.missingBoundary !== 0 || hygiene.nonManifold !== 0) {
        throw new Error(
            `[S1-CDT] collapsed disk failed: open=${hygiene.open} ` +
                `missingBoundary=${hygiene.missingBoundary} nonManifold=${hygiene.nonManifold}`,
        );
    }
    const sliverMaxAspect = assertISlivers(points, faces, loop.length);
    return {
        points,
        faces,
        boundaryCount: loop.length,
        bandCount: 0,
        steinerCount: steiner.length,
        collapsedIEdges: collapsed.collapsed,
        sliverMaxAspect,
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
    flat?: boolean;
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
        collapsedIEdges: mesh.collapsedIEdges,
        sliverMaxAspect: mesh.sliverMaxAspect,
    };
}
