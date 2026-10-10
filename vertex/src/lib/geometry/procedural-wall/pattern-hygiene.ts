// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EndType, FillRule, inflatePathsD, isPositiveD, JoinType, unionD } from "clipper2-ts";
import { minDistToLoopXY, pointInPoly } from "./cdt-band";
import {
    ensureCcw,
    fitClosedC2Spline,
    type PolyPoint,
    polygonSignedArea,
    resampleClosedC2,
    resamplePolyline,
} from "./curves";
import { scaleToMinInset } from "./faired-pattern";
import { masterCurveRadii, smoothClosedToMinRadius } from "./stations";

export const PATTERN_MIN_RADIUS_MM = 3;
export const PATTERN_RIM_CLEARANCE_MM = 0.5;
export const PATTERN_SOURCE_SYNTHETIC = "synthetic";
/** Extra inset so resample / fairing cannot land 1e-4 mm short of the rim gate. */
export const RIM_INSET_SLACK_MM = 0.02;

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

function smoothHeelBand(loop: PolyPoint[], uMax: number, passes: number): PolyPoint[] {
    if (loop.length < 4) return loop;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const p of loop) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
    }
    const length = Math.max(1e-3, maxX - minX);
    let cur = loop.map((p) => ({ ...p }));
    for (let pass = 0; pass < passes; pass++) {
        const next = cur.map((p) => ({ ...p }));
        for (let i = 0; i < cur.length; i++) {
            const u = (cur[i]!.x - minX) / length;
            if (u > uMax) continue;
            const a = cur[(i + cur.length - 1) % cur.length]!;
            const b = cur[i]!;
            const c = cur[(i + 1) % cur.length]!;
            next[i] = {
                x: 0.5 * b.x + 0.25 * (a.x + c.x),
                y: 0.5 * b.y + 0.25 * (a.y + c.y),
                z: b.z,
            };
        }
        cur = next;
    }
    return cur;
}

function nearestOnLoopXY(origin: PolyPoint, loop: PolyPoint[]): PolyPoint {
    let best = loop[0] ?? { x: origin.x, y: origin.y, z: 0 };
    let bestD = Infinity;
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const len2 = ex * ex + ey * ey;
        const t =
            len2 > 1e-12
                ? Math.max(0, Math.min(1, ((origin.x - a.x) * ex + (origin.y - a.y) * ey) / len2))
                : 0;
        const x = a.x + ex * t;
        const y = a.y + ey * t;
        const d = (x - origin.x) ** 2 + (y - origin.y) ** 2;
        if (d < bestD) {
            bestD = d;
            best = { x, y, z: 0 };
        }
    }
    return best;
}

function rimCentroid(rim: PolyPoint[]): { x: number; y: number } {
    let x = 0;
    let y = 0;
    for (const p of rim) {
        x += p.x;
        y += p.y;
    }
    const n = Math.max(1, rim.length);
    return { x: x / n, y: y / n };
}

/**
 * If any sample sits short of the rim gate, inset the whole pattern by the
 * deficit. A uniform Clipper offset keeps the faired shape; per-vertex snaps
 * kink the toe and drive E/F turning.
 */
export function enforceMinRimInset(
    pattern: PolyPoint[],
    rim: PolyPoint[],
    minInsetMm: number,
    opts?: { smooth?: boolean },
): PolyPoint[] {
    if (pattern.length < 3 || rim.length < 3 || minInsetMm <= 0) return pattern;
    const need = minInsetMm + RIM_INSET_SLACK_MM;
    let minIn = Infinity;
    for (const p of pattern) {
        const d = minDistToLoopXY(p.x, p.y, rim);
        const inset = pointInPoly(p.x, p.y, rim) ? d : -d;
        if (inset < minIn) minIn = inset;
    }
    if (minIn >= need - 1e-9) return pattern.map((p) => ({ x: p.x, y: p.y, z: 0 }));
    const extra = need - minIn;
    try {
        const inseted = clipperRoundInset(pattern, extra);
        if (inseted.length >= 3) {
            let after = Infinity;
            for (const p of inseted) {
                const d = minDistToLoopXY(p.x, p.y, rim);
                const inset = pointInPoly(p.x, p.y, rim) ? d : -d;
                if (inset < after) after = inset;
            }
            if (after >= minInsetMm - 1e-6) return inseted.map((p) => ({ x: p.x, y: p.y, z: 0 }));
        }
    } catch {
        /* fall through */
    }
    if (opts?.smooth) return scaleToMinInset(pattern, rim, minInsetMm);
    const c = rimCentroid(rim);
    return pattern.map((p) => {
        let q = { x: p.x, y: p.y, z: 0 };
        for (let iter = 0; iter < 16; iter++) {
            const d = minDistToLoopXY(q.x, q.y, rim);
            const inside = pointInPoly(q.x, q.y, rim);
            const inset = inside ? d : -d;
            if (inset >= need - 1e-9) return q;
            const near = nearestOnLoopXY(q, rim);
            let vx = inside ? q.x - near.x : c.x - near.x;
            let vy = inside ? q.y - near.y : c.y - near.y;
            if (Math.hypot(vx, vy) < 1e-9) {
                vx = c.x - near.x;
                vy = c.y - near.y;
            }
            const vl = Math.hypot(vx, vy) || 1;
            q = {
                x: q.x + (vx / vl) * Math.max(need - inset, 0.05),
                y: q.y + (vy / vl) * Math.max(need - inset, 0.05),
                z: 0,
            };
        }
        return q;
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
        /** Keep a fair few-control spline; do not re-interpolate or Laplacian the heel. */
        keepFair?: boolean;
    },
): HygieneReport {
    const sourceLoop = ensureCcw(loop.map((p) => ({ ...p, z: 0 })));
    const tn0 = turningNumber(sourceLoop);
    const unioned = Math.abs(tn0 - 1) < 0.05 && opts?.keepFair ? sourceLoop : clipperUnion(sourceLoop);
    const tn = turningNumber(unioned);
    if (Math.abs(tn - 1) > 0.05) {
        throw new Error(`[S1-PATTERN] turning number ${tn.toFixed(3)} is not +1 after Clipper2 union`);
    }
    if (opts?.keepFair) {
        const n = Math.max(opts.resampleN ?? 0, 160, unioned.length);
        const resampled = resamplePolyline(unioned, n);
        const minRadiusMm = masterCurveRadii(resampled).minRadiusMm;
        if (opts.requireInsideRim && opts.rimPlan?.length) {
            const clearance = opts.clearanceMm ?? PATTERN_RIM_CLEARANCE_MM;
            const cleared = enforceMinRimInset(resampled, opts.rimPlan, clearance, { smooth: true });
            assertInsideRim(cleared, opts.rimPlan, clearance);
            return {
                loop: cleared,
                turning: turningNumber(cleared),
                minRadiusMm,
                source: opts.source ?? "pattern",
            };
        }
        return {
            loop: resampled,
            turning: turningNumber(resampled),
            minRadiusMm,
            source: opts.source ?? "pattern",
        };
    }
    const smoothed = smoothClosedToMinRadius(unioned, PATTERN_MIN_RADIUS_MM, unioned.length);
    const minRadiusMm = masterCurveRadii(smoothed).minRadiusMm;
    if (minRadiusMm + 1e-6 < PATTERN_MIN_RADIUS_MM) {
        throw new Error(
            `[S1-PATTERN] min radius of curvature ${minRadiusMm.toFixed(2)} < ${PATTERN_MIN_RADIUS_MM} mm`,
        );
    }
    const n = Math.max(opts?.resampleN ?? 0, 160, smoothed.length);
    const resampled = smoothHeelBand(resampleClosedC2(fitClosedC2Spline(smoothed), n), 0.18, 8);
    if (opts?.requireInsideRim && opts.rimPlan?.length) {
        assertInsideRim(resampled, opts.rimPlan, opts.clearanceMm ?? PATTERN_RIM_CLEARANCE_MM);
    }
    const source = opts?.source ?? "pattern";
    return { loop: resampled, turning: turningNumber(resampled), minRadiusMm, source };
}
