// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { countOpenNonBoundaryEdges, minDistToLoopXY, pointInPoly } from "./cdt-band";
import { assertIEdges, assertLibraryDisk, libraryCdtInterior } from "./cdt-lib";
import { type PolyPoint, polylineArcLengths, sampleClosedAtArc01 } from "./curves";
import { sampleUvField } from "./extract";
import { type DishZIndex, sampleDishZVertical } from "./height-xy";
import { clipperRoundInset } from "./pattern-hygiene";
import type { UvHeightField } from "./types";

export const PLANTAR_STEINER_MM = 1.8;
export const PLANTAR_MARGIN_MM = 0.5;
export const PLANTAR_STEINER_OUTLINE_FRAC = 0.75;
export const PLANTAR_STEINER_EDGE_MIN_MM = 0.5;
export const PLANTAR_SLIVER_BAND_MM = 2;
export const PLANTAR_FALLBACK_INSET_MM = 1.5;
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
    usedSliverFallback: boolean;
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
    const outlineKeep = PLANTAR_STEINER_EDGE_MIN_MM;
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
    return maxBoundaryAspect(points, faces, points.slice(0, nOuter), PLANTAR_SLIVER_BAND_MM);
}

export function maxBoundaryAspect(
    points: PolyPoint[],
    faces: Array<[number, number, number]>,
    boundary: PolyPoint[],
    withinMm = PLANTAR_SLIVER_BAND_MM,
): number {
    let best = 1;
    for (const f of faces) {
        const A = points[f[0]!]!;
        const B = points[f[1]!]!;
        const C = points[f[2]!]!;
        const cx = (A.x + B.x + C.x) / 3;
        const cy = (A.y + B.y + C.y) / 3;
        if (minDistToLoopXY(cx, cy, boundary) > withinMm) continue;
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
    return assertBoundarySlivers(points, faces, points.slice(0, nOuter), limit);
}

export function assertBoundarySlivers(
    points: PolyPoint[],
    faces: Array<[number, number, number]>,
    boundary: PolyPoint[],
    limit = I_SLIVER_ASPECT,
): number {
    const aspect = maxBoundaryAspect(points, faces, boundary, PLANTAR_SLIVER_BAND_MM);
    if (aspect > limit) {
        throw new Error(
            `[S1-B] CDT sliver aspect ${aspect.toFixed(1)} > ${limit} within ${PLANTAR_SLIVER_BAND_MM} mm of B`,
        );
    }
    return aspect;
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

function minLoopEdge(loop: PolyPoint[]): number {
    let best = Infinity;
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        best = Math.min(best, Math.hypot(b.x - a.x, b.y - a.y));
    }
    return Number.isFinite(best) ? best : 1;
}

function resampleClosedSpacing(loop: PolyPoint[], spacingMm: number): PolyPoint[] {
    const { total } = polylineArcLengths(loop);
    const n = Math.max(3, Math.round(total / Math.max(spacingMm, 0.5)));
    const out: PolyPoint[] = [];
    for (let i = 0; i < n; i++) out.push({ ...sampleClosedAtArc01(loop, i / n), z: 0 });
    return out;
}

/**
 * Steiner collar ≥ 0.5 mm inside B. Breaks the 0.3 mm × 60 mm slivers a dense
 * pair-insert ring makes when the hex grid cannot sit in the boundary band.
 */
export function collarSteiner(loop: PolyPoint[], keep: number, spacingMm: number): PolyPoint[] {
    const insetMm = Math.max(keep + 0.15, 0.65);
    try {
        const inset = clipperRoundInset(loop, insetMm);
        return resampleClosedSpacing(inset, spacingMm).filter(
            (p) => pointInPoly(p.x, p.y, loop) && minDistToLoopXY(p.x, p.y, loop) >= keep,
        );
    } catch {
        return [];
    }
}

function cdtDiskOf(
    loop: PolyPoint[],
    extra: PolyPoint[],
    extraEdges: Array<[number, number]>,
    margin: number,
    opts?: { steiner?: boolean },
): {
    points: PolyPoint[];
    faces: Array<[number, number, number]>;
    steinerCount: number;
    sliverMaxAspect: number;
} {
    const minEdge = minLoopEdge(loop);
    const dense = loop.length > 300 || minEdge < 0.75;
    const keep = PLANTAR_STEINER_EDGE_MIN_MM;
    const step = dense ? Math.max(1.2, keep * 2) : PLANTAR_STEINER_MM;
    const wantSteiner = opts?.steiner !== false;
    const hex = wantSteiner
        ? hexSteiner(loop, step, Math.max(margin, keep)).filter(
              (p) => minDistToLoopXY(p.x, p.y, loop) >= keep,
          )
        : [];
    const collar = wantSteiner && dense ? collarSteiner(loop, keep, 0.9) : [];
    const steiner = [...collar, ...hex];
    const points = [...loop, ...extra, ...steiner];
    nudgeInteriorDuplicates(points, loop.length);
    const faces = libraryCdtInterior(points, loop.length, extraEdges);
    assertIEdges(faces, loop.length);
    assertLibraryDisk(faces, loop.length);
    const sliverMaxAspect = assertBoundarySlivers(points, faces, loop);
    return { points, faces, steinerCount: steiner.length, sliverMaxAspect };
}

function tryInsetStrip(
    loop: PolyPoint[],
    margin: number,
    insetMm: number,
): {
    points: PolyPoint[];
    faces: Array<[number, number, number]>;
    steinerCount: number;
    sliverMaxAspect: number;
    usedSliverFallback: boolean;
} {
    const inset = clipperRoundInset(loop, insetMm);
    const extra: PolyPoint[] = inset.map((p) => ({ ...p, z: 0 }));
    const extraEdges: Array<[number, number]> = [];
    const nB = loop.length;
    for (let i = 0; i < extra.length; i++) extraEdges.push([nB + i, nB + ((i + 1) % extra.length)]);
    return { ...cdtDiskOf(loop, extra, extraEdges, margin), usedSliverFallback: true };
}

function triangulateWithOffsetFallback(
    loop: PolyPoint[],
    margin: number,
): {
    points: PolyPoint[];
    faces: Array<[number, number, number]>;
    steinerCount: number;
    sliverMaxAspect: number;
    usedSliverFallback: boolean;
} {
    try {
        return { ...cdtDiskOf(loop, [], [], margin), usedSliverFallback: false };
    } catch (err) {
        const msg = String(err);
        if (!msg.includes("sliver") && !msg.includes("[S1-CDT]") && !msg.includes("[S1-B]")) {
            throw err;
        }
        const insets = [0.8, PLANTAR_FALLBACK_INSET_MM];
        let last: unknown = err;
        for (const insetMm of insets) {
            try {
                return tryInsetStrip(loop, margin, insetMm);
            } catch (next) {
                last = next;
            }
        }
        throw last;
    }
}

/**
 * Constrained Delaunay of B(i) + Steiner inside B. Boundary vertices stay at
 * 0..n-1 and are never split or welded. If B itself makes slivers, fall back
 * to a Clipper2 round-join inset plus a constrained strip CDT.
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
    usedSliverFallback: boolean;
} {
    const loop = boundary.map((p) => ({ ...p, z: 0 }));
    const mesh = triangulateWithOffsetFallback(loop, margin);
    return {
        points: mesh.points,
        faces: mesh.faces,
        boundaryCount: loop.length,
        bandCount: 0,
        steinerCount: mesh.steinerCount,
        collapsedIEdges: 0,
        sliverMaxAspect: mesh.sliverMaxAspect,
        usedSliverFallback: mesh.usedSliverFallback,
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
        usedSliverFallback: mesh.usedSliverFallback,
    };
}
