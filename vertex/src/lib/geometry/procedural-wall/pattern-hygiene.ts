// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EndType, FillRule, inflatePathsD, isPositiveD, JoinType, unionD } from "clipper2-ts";
import { minDistToLoopXY, pointInPoly } from "./cdt-band";
import { ensureCcw, fitClosedC2Spline, type PolyPoint, polygonSignedArea, resampleClosedC2 } from "./curves";
import { masterCurveRadii, smoothClosedToMinRadius } from "./stations";

export const PATTERN_MIN_RADIUS_MM = 3;
export const PATTERN_RIM_CLEARANCE_MM = 0.5;
export const PATTERN_SOURCE_SYNTHETIC = "synthetic";

export interface HygieneReport {
    loop: PolyPoint[];
    turning: number;
    minRadiusMm: number;
    source: string;
}

function toPathD(loop: PolyPoint[]): Array<{ x: number; y: number }> {
    return loop.map((p) => ({ x: p.x, y: p.y }));
}

function fromPathD(path: Array<{ x: number; y: number }>, z = 0): PolyPoint[] {
    return path.map((p) => ({ x: p.x, y: p.y, z }));
}

function pathArea(path: Array<{ x: number; y: number }>): number {
    let s = 0;
    for (let i = 0; i < path.length; i++) {
        const a = path[i]!;
        const b = path[(i + 1) % path.length]!;
        s += a.x * b.y - b.x * a.y;
    }
    return 0.5 * s;
}

function largestPath(paths: Array<Array<{ x: number; y: number }>>): Array<{ x: number; y: number }> {
    let best = paths[0] ?? [];
    let bestA = -1;
    for (const path of paths) {
        const a = Math.abs(pathArea(path));
        if (a > bestA) {
            bestA = a;
            best = path;
        }
    }
    return best;
}

export function turningNumber(loop: PolyPoint[]): number {
    let sum = 0;
    const n = loop.length;
    for (let i = 0; i < n; i++) {
        const a = loop[(i + n - 1) % n]!;
        const b = loop[i]!;
        const c = loop[(i + 1) % n]!;
        const v1x = b.x - a.x;
        const v1y = b.y - a.y;
        const v2x = c.x - b.x;
        const v2y = c.y - b.y;
        sum += Math.atan2(v1x * v2y - v1y * v2x, v1x * v2x + v1y * v2y);
    }
    return sum / (Math.PI * 2);
}

/** Clipper2 self-union so the outline is a single simple polygon (turning +1). */
export function clipperUnion(loop: PolyPoint[]): PolyPoint[] {
    const subject = [toPathD(ensureCcw(loop.map((p) => ({ ...p, z: 0 }))))];
    const paths = unionD(subject, FillRule.NonZero);
    if (!paths.length) {
        throw new Error("[S1-PATTERN] Clipper2 union produced no path");
    }
    const best = largestPath(paths);
    if (best.length < 3) {
        throw new Error("[S1-PATTERN] Clipper2 union path has fewer than 3 vertices");
    }
    const pts = fromPathD(best);
    const oriented = isPositiveD(best) ? pts : pts.slice().reverse();
    return ensureCcw(oriented);
}

/** Clipper2 round-join inward offset. Used only as the CDT sliver fallback ring. */
export function clipperRoundInset(loop: PolyPoint[], deltaMm: number): PolyPoint[] {
    const src = ensureCcw(loop.map((p) => ({ ...p, z: 0 })));
    const area = polygonSignedArea(src);
    const signed = area >= 0 ? -Math.abs(deltaMm) : Math.abs(deltaMm);
    const paths = inflatePathsD([toPathD(src)], signed, JoinType.Round, EndType.Polygon, 2, 2);
    if (!paths.length) {
        throw new Error(`[S1-PATTERN] Clipper2 inset ${deltaMm} mm produced no path`);
    }
    const best = largestPath(paths);
    if (best.length < 3) {
        throw new Error("[S1-PATTERN] Clipper2 inset path has fewer than 3 vertices");
    }
    const pts = fromPathD(best);
    const oriented = isPositiveD(best) ? pts : pts.slice().reverse();
    return ensureCcw(oriented);
}

function nearestOnLoopXY(x: number, y: number, loop: PolyPoint[]): PolyPoint {
    let best = loop[0] ?? { x, y, z: 0 };
    let bestD = Infinity;
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const len2 = ex * ex + ey * ey;
        const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / len2)) : 0;
        const px = a.x + ex * t;
        const py = a.y + ey * t;
        const d = (px - x) ** 2 + (py - y) ** 2;
        if (d < bestD) {
            bestD = d;
            best = { x: px, y: py, z: a.z + (b.z - a.z) * t };
        }
    }
    return best;
}

function pullInsideLoop(loop: PolyPoint[], container: PolyPoint[]): PolyPoint[] {
    if (container.length < 3) return loop;
    let cx = 0;
    let cy = 0;
    for (const p of container) {
        cx += p.x;
        cy += p.y;
    }
    cx /= container.length;
    cy /= container.length;
    return loop.map((p) => {
        if (pointInPoly(p.x, p.y, container)) return p;
        const near = nearestOnLoopXY(p.x, p.y, container);
        const dx = cx - near.x;
        const dy = cy - near.y;
        const len = Math.hypot(dx, dy) || 1;
        return { x: near.x + (dx / len) * 0.05, y: near.y + (dy / len) * 0.05, z: p.z };
    });
}

export function assertInsideRim(
    pattern: PolyPoint[],
    rimPlan: PolyPoint[],
    clearanceMm = PATTERN_RIM_CLEARANCE_MM,
): void {
    if (rimPlan.length < 3) return;
    for (let i = 0; i < pattern.length; i++) {
        const p = pattern[i]!;
        const d = minDistToLoopXY(p.x, p.y, rimPlan);
        if (!pointInPoly(p.x, p.y, rimPlan) && d > 1e-4) {
            throw new Error(
                `[S1-PATTERN] station ${i} (${p.x.toFixed(2)},${p.y.toFixed(2)}) is outside the TopSheet rim`,
            );
        }
        if (d < clearanceMm - 1e-6) {
            throw new Error(
                `[S1-PATTERN] station ${i} (${p.x.toFixed(2)},${p.y.toFixed(2)}) is ` +
                    `${d.toFixed(3)} mm from the rim (need >= ${clearanceMm} mm)`,
            );
        }
    }
}

/**
 * Pattern hygiene before stations: Clipper2 union (turning +1), C2 smooth to
 * min radius >= 3 mm, arc-length resample. Optionally reject if the pattern
 * is not inside the TopSheet rim plan minus 0.5 mm.
 */
export function hygieneBottomPattern(
    loop: PolyPoint[],
    opts?: {
        rimPlan?: PolyPoint[];
        requireInsideRim?: boolean;
        clearanceMm?: number;
        source?: string;
        resampleN?: number;
    },
): HygieneReport {
    const unioned = clipperUnion(loop);
    const tn = turningNumber(unioned);
    if (Math.abs(tn - 1) > 0.05) {
        throw new Error(`[S1-PATTERN] turning number ${tn.toFixed(3)} is not +1 after Clipper2 union`);
    }
    const smoothed = smoothClosedToMinRadius(unioned, PATTERN_MIN_RADIUS_MM, unioned.length);
    const minRadiusMm = masterCurveRadii(smoothed).minRadiusMm;
    if (minRadiusMm + 1e-6 < PATTERN_MIN_RADIUS_MM) {
        throw new Error(
            `[S1-PATTERN] min radius of curvature ${minRadiusMm.toFixed(2)} < ${PATTERN_MIN_RADIUS_MM} mm`,
        );
    }
    const n = Math.max(opts?.resampleN ?? 0, 160, smoothed.length);
    const resampled = pullInsideLoop(resampleClosedC2(fitClosedC2Spline(smoothed), n), smoothed);
    if (opts?.requireInsideRim && opts.rimPlan?.length) {
        assertInsideRim(resampled, opts.rimPlan, opts.clearanceMm ?? PATTERN_RIM_CLEARANCE_MM);
    }
    const source = opts?.source ?? "pattern";
    return { loop: resampled, turning: turningNumber(resampled), minRadiusMm, source };
}
