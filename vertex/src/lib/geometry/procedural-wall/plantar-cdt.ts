// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { countOpenNonBoundaryEdges, minDistToLoopXY, pointInPoly } from "./cdt-band";
import { assertIEdges, assertLibraryDisk, libraryCdtInterior } from "./cdt-lib";
import { type PolyPoint, polygonSignedArea, polylineArcLengths, sampleClosedAtArc01 } from "./curves";
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
export const SLIVER_MIN_ANGLE_DEG = 5;

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

function nudgeInteriorDuplicates(
    points: PolyPoint[],
    nOuter: number,
    loop?: PolyPoint[],
    keep = 0,
    tol = 0.045,
): void {
    for (let i = 0; i < points.length; i++) {
        for (let j = Math.max(i + 1, nOuter); j < points.length; j++) {
            const a = points[i]!;
            const b = points[j]!;
            const d = Math.hypot(b.x - a.x, b.y - a.y);
            if (d >= tol) continue;
            let nx: number;
            let ny: number;
            if (loop) {
                const hit = nearestOnLoopXY(b.x, b.y, loop);
                let vx = b.x - hit.x;
                let vy = b.y - hit.y;
                let vlen = Math.hypot(vx, vy);
                if (vlen < 1e-12) {
                    const e = loop[(hit.i + 1) % loop.length]!;
                    const dx = e.x - loop[hit.i]!.x;
                    const dy = e.y - loop[hit.i]!.y;
                    const elen = Math.hypot(dx, dy) || 1;
                    vx = -dy / elen;
                    vy = dx / elen;
                    vlen = 1;
                }
                const ux = vx / vlen;
                const uy = vy / vlen;
                const side = j % 2 === 0 ? 1 : -1;
                nx = b.x + ux * tol + side * -uy * tol * 0.5;
                ny = b.y + uy * tol + side * ux * tol * 0.5;
            } else {
                const ang = (j * 2.399963) % (Math.PI * 2);
                nx = b.x + Math.cos(ang) * tol;
                ny = b.y + Math.sin(ang) * tol;
            }
            if (loop && keep > 0) {
                if (!pointInPoly(nx, ny, loop) || minDistToLoopXY(nx, ny, loop) < keep) continue;
            }
            b.x = nx;
            b.y = ny;
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

/**
 * One Steiner per I edge, inset along the interior normal. Does not depend on
 * Clipper or a hex seed, so a dense pair-insert ring still gets a collar when
 * the plantar disk's point-in-poly tests reject the grid.
 */
export function inwardEdgeSteiner(loop: PolyPoint[], dist: number, keep: number): PolyPoint[] {
    const n = loop.length;
    const out: PolyPoint[] = [];
    for (let i = 0; i < n; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % n]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-9) continue;
        const midX = (a.x + b.x) * 0.5;
        const midY = (a.y + b.y) * 0.5;
        const nx = -dy / len;
        const ny = dx / len;
        for (const s of [1, -1]) {
            const x = midX + s * nx * dist;
            const y = midY + s * ny * dist;
            if (!pointInPoly(x, y, loop)) continue;
            if (minDistToLoopXY(x, y, loop) < keep) continue;
            out.push({ x, y, z: 0 });
            break;
        }
    }
    return out;
}

function faceAspect(
    A: PolyPoint,
    B: PolyPoint,
    C: PolyPoint,
): { short: number; long: number; aspect: number } {
    const e1 = Math.hypot(B.x - A.x, B.y - A.y);
    const e2 = Math.hypot(C.x - B.x, C.y - B.y);
    const e3 = Math.hypot(A.x - C.x, A.y - C.y);
    const short = Math.min(e1, e2, e3);
    const long = Math.max(e1, e2, e3);
    return { short, long, aspect: short < 1e-9 ? Infinity : long / short };
}

export function faceMinAngleDeg(A: PolyPoint, B: PolyPoint, C: PolyPoint): number {
    const e1 = Math.hypot(B.x - A.x, B.y - A.y);
    const e2 = Math.hypot(C.x - B.x, C.y - B.y);
    const e3 = Math.hypot(A.x - C.x, A.y - C.y);
    if (e1 < 1e-12 || e2 < 1e-12 || e3 < 1e-12) return 0;
    const ang = (a: number, b: number, c: number): number => {
        const cos = (a * a + b * b - c * c) / (2 * a * b);
        return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
    };
    return Math.min(ang(e3, e1, e2), ang(e1, e2, e3), ang(e2, e3, e1));
}

export function maxBoundaryMinAngleDeg(
    points: PolyPoint[],
    faces: Array<[number, number, number]>,
    boundary: PolyPoint[],
    withinMm = PLANTAR_SLIVER_BAND_MM,
): number {
    let worst = 180;
    for (const f of faces) {
        const A = points[f[0]!]!;
        const B = points[f[1]!]!;
        const C = points[f[2]!]!;
        const cx = (A.x + B.x + C.x) / 3;
        const cy = (A.y + B.y + C.y) / 3;
        if (minDistToLoopXY(cx, cy, boundary) > withinMm) continue;
        worst = Math.min(worst, faceMinAngleDeg(A, B, C));
    }
    return worst;
}

function nearestOnLoopXY(
    x: number,
    y: number,
    loop: PolyPoint[],
): { x: number; y: number; i: number; d: number } {
    let best = { x: loop[0]!.x, y: loop[0]!.y, i: 0, d: Infinity };
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const len2 = ex * ex + ey * ey;
        const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / len2)) : 0;
        const px = a.x + ex * t;
        const py = a.y + ey * t;
        const d = Math.hypot(x - px, y - py);
        if (d < best.d) best = { x: px, y: py, i, d };
    }
    return best;
}

function projectInsideKeep(loop: PolyPoint[], x: number, y: number, keep: number): PolyPoint | null {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const hit = nearestOnLoopXY(x, y, loop);
    const tryAt = (px: number, py: number): PolyPoint | null => {
        if (!pointInPoly(px, py, loop)) return null;
        if (minDistToLoopXY(px, py, loop) < keep - 1e-9) return null;
        return { x: px, y: py, z: 0 };
    };
    if (hit.d >= keep) return tryAt(x, y);
    let vx = x - hit.x;
    let vy = y - hit.y;
    let vlen = Math.hypot(vx, vy);
    if (vlen < 1e-12) {
        const a = loop[hit.i]!;
        const b = loop[(hit.i + 1) % loop.length]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        vx = -dy / len;
        vy = dx / len;
        vlen = 1;
    }
    const ux = vx / vlen;
    const uy = vy / vlen;
    for (const s of [1, -1]) {
        const p = tryAt(hit.x + s * ux * (keep + 1e-6), hit.y + s * uy * (keep + 1e-6));
        if (p) return p;
    }
    return null;
}

function pushSteiner(out: PolyPoint[], loop: PolyPoint[], x: number, y: number, keep: number): void {
    const p = projectInsideKeep(loop, x, y, keep);
    if (p) out.push(p);
}

function sliverFillSteiner(
    points: PolyPoint[],
    faces: Array<[number, number, number]>,
    loop: PolyPoint[],
    keep: number,
    limit: number,
    minAngOnly = false,
): { extra: PolyPoint[]; worst: Record<string, unknown> | null } {
    const nOuter = loop.length;
    const extra: PolyPoint[] = [];
    const dist = Math.max(keep + 0.15, 0.65);
    let worstAsp = 1;
    let worst: Record<string, unknown> | null = null;
    for (const f of faces) {
        const ia = f[0]!;
        const ib = f[1]!;
        const ic = f[2]!;
        const A = points[ia]!;
        const B = points[ib]!;
        const C = points[ic]!;
        const { aspect } = faceAspect(A, B, C);
        const minAng = faceMinAngleDeg(A, B, C);
        const cx = (A.x + B.x + C.x) / 3;
        const cy = (A.y + B.y + C.y) / 3;
        if (aspect > worstAsp) {
            worstAsp = aspect;
            worst = {
                ids: [ia, ib, ic],
                kind: [ia < nOuter ? "B" : "S", ib < nOuter ? "B" : "S", ic < nOuter ? "B" : "S"],
                aspect: Number(aspect.toFixed(2)),
                minAngle: Number(minAng.toFixed(2)),
                distB: Number(minDistToLoopXY(cx, cy, loop).toFixed(3)),
            };
        }
        if (minAngOnly) {
            if (minAng >= SLIVER_MIN_ANGLE_DEG) continue;
        } else if (aspect <= limit) {
            continue;
        }
        pushSteiner(extra, loop, cx, cy, keep);
        const pts = [A, B, C];
        for (let k = 0; k < 3; k++) {
            const a = pts[k]!;
            const b = pts[(k + 1) % 3]!;
            const third = pts[(k + 2) % 3]!;
            const midX = (a.x + b.x) * 0.5;
            const midY = (a.y + b.y) * 0.5;
            const tx = third.x - midX;
            const ty = third.y - midY;
            const tlen = Math.hypot(tx, ty);
            if (tlen > 1e-9) {
                pushSteiner(extra, loop, midX + (tx / tlen) * dist, midY + (ty / tlen) * dist, keep);
            }
        }
    }
    return { extra, worst };
}

function refineMinAngle(
    loop: PolyPoint[],
    extra: PolyPoint[],
    extraEdges: Array<[number, number]>,
    keep: number,
    baseSteiner: PolyPoint[],
    seed: {
        points: PolyPoint[];
        faces: Array<[number, number, number]>;
        steinerCount: number;
        sliverMaxAspect: number;
    },
    wantSteiner: boolean,
): {
    points: PolyPoint[];
    faces: Array<[number, number, number]>;
    steinerCount: number;
    sliverMaxAspect: number;
} {
    if (!wantSteiner) return seed;
    let good = seed;
    const refine: PolyPoint[] = [];
    for (let pass = 0; pass < 4; pass++) {
        const minAng = maxBoundaryMinAngleDeg(good.points, good.faces, loop, PLANTAR_SLIVER_BAND_MM);
        if (minAng >= SLIVER_MIN_ANGLE_DEG) return good;
        const filled = sliverFillSteiner(good.points, good.faces, loop, keep, I_SLIVER_ASPECT, true);
        if (!filled.extra.length) return good;
        refine.push(...filled.extra);
        const steiner = [...baseSteiner, ...refine];
        const points = [...loop, ...extra, ...steiner];
        nudgeInteriorDuplicates(points, loop.length, loop, keep);
        const faces = libraryCdtInterior(points, loop.length, extraEdges);
        assertIEdges(faces, loop.length);
        assertLibraryDisk(faces, loop.length);
        const aspect = maxBoundaryAspect(points, faces, loop, PLANTAR_SLIVER_BAND_MM);
        if (aspect > I_SLIVER_ASPECT) return good;
        good = { points, faces, steinerCount: steiner.length, sliverMaxAspect: aspect };
    }
    return good;
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
    const inward = wantSteiner && dense ? inwardEdgeSteiner(loop, Math.max(keep + 0.15, 0.65), keep) : [];
    const refine: PolyPoint[] = [];
    let points: PolyPoint[] = [];
    let faces: Array<[number, number, number]> = [];
    let sliverMaxAspect = 1;
    let best: {
        points: PolyPoint[];
        faces: Array<[number, number, number]>;
        steinerCount: number;
        sliverMaxAspect: number;
        minAng: number;
    } | null = null;
    for (let pass = 0; pass < 10; pass++) {
        const steiner = wantSteiner ? [...collar, ...inward, ...hex, ...refine] : [];
        points = [...loop, ...extra, ...steiner];
        nudgeInteriorDuplicates(points, loop.length, loop, keep);
        faces = libraryCdtInterior(points, loop.length, extraEdges);
        assertIEdges(faces, loop.length);
        assertLibraryDisk(faces, loop.length);
        sliverMaxAspect = maxBoundaryAspect(points, faces, loop, PLANTAR_SLIVER_BAND_MM);
        const minAng = maxBoundaryMinAngleDeg(points, faces, loop, PLANTAR_SLIVER_BAND_MM);
        if (
            sliverMaxAspect <= I_SLIVER_ASPECT &&
            (!best || minAng > best.minAng || sliverMaxAspect < best.sliverMaxAspect)
        ) {
            best = {
                points,
                faces,
                steinerCount: steiner.length,
                sliverMaxAspect,
                minAng,
            };
        }
        if (sliverMaxAspect <= I_SLIVER_ASPECT) {
            if (dense) {
                console.log(
                    "[S1-CDT-STEINER]",
                    JSON.stringify({
                        n: loop.length,
                        area: Number(polygonSignedArea(loop).toFixed(1)),
                        hex: hex.length,
                        collar: collar.length,
                        inward: inward.length,
                        refine: refine.length,
                        aspect: Number(sliverMaxAspect.toFixed(2)),
                        minAng: Number(minAng.toFixed(2)),
                        pass,
                    }),
                );
            }
            const angled = refineMinAngle(
                loop,
                extra,
                extraEdges,
                keep,
                [...collar, ...inward, ...hex, ...refine],
                { points, faces, steinerCount: steiner.length, sliverMaxAspect },
                wantSteiner,
            );
            return angled;
        }
        if (!wantSteiner) break;
        const filled = sliverFillSteiner(points, faces, loop, keep, I_SLIVER_ASPECT);
        if (dense && pass === 0) {
            console.log("[S1-CDT-SLIVER]", JSON.stringify(filled.worst));
        }
        if (!filled.extra.length) break;
        refine.push(...filled.extra);
    }
    if (best) {
        return refineMinAngle(
            loop,
            extra,
            extraEdges,
            keep,
            [...collar, ...inward, ...hex, ...refine],
            best,
            wantSteiner,
        );
    }
    const steiner = wantSteiner ? [...collar, ...inward, ...hex, ...refine] : [];
    if (dense) {
        console.log(
            "[S1-CDT-STEINER]",
            JSON.stringify({
                n: loop.length,
                area: Number(polygonSignedArea(loop).toFixed(1)),
                hex: hex.length,
                collar: collar.length,
                inward: inward.length,
                refine: refine.length,
                aspect: Number(sliverMaxAspect.toFixed(2)),
                failed: true,
            }),
        );
    }
    assertBoundarySlivers(points, faces, loop);
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
        if (!msg.includes("[S1-CDT]") && !msg.includes("[S1-I]")) {
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
    let extraLift = 0;
    if (sampler) {
        for (const p of mesh.points) p.z = sampler.z(p.x, p.y, 0);
        for (const p of mesh.points) extraLift = Math.max(extraLift, p.z < 0 ? -p.z : 0);
        if (extraLift) for (const p of mesh.points) p.z += extraLift;
    } else {
        applyPlantarFields(mesh.points, boundary, input.dish, input.field, input.zDelta);
        extraLift = reanchorPlantarMinZ(mesh.points);
    }
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
