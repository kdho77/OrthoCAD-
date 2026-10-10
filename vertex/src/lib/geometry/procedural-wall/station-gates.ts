// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type ColumnQuality, columnHeading, FILLET_R_CAP_MM, MIN_ROUND_R_MM } from "./bezier-column";
import {
    LATERAL_K_SLACK,
    makeLateralConvex,
    movedPatternHygiene,
    PATTERN_ARCH_U0,
    PATTERN_ARCH_U1,
    PATTERN_MAX_DKDS,
} from "./bottom-pattern";
import { pointInPoly } from "./cdt-band";
import {
    ensureCcw,
    nearestClosedArc01,
    type PolyPoint,
    polylineArcLengths,
    resamplePolyline,
    sampleClosedAtArc01,
    startAtLowCurvature,
} from "./curves";
import type { WallRegionDefaults } from "./defaults";
import { fairedPattern, scaleToMinInset } from "./faired-pattern";
import type { HermiteStation } from "./loft";
import { outwardNormal } from "./measure";
import { enforceMinRimInset } from "./pattern-hygiene";
import { nearestRayHitOnLoop, spreadClosedOnLoop } from "./stations";

export const PATTERN_SOURCE_FAIRED_STOCK = "faired-stock";
export const MIN_INSET_FLOOR_MM = 1;
export const LEAN_INSET_MM = 8;
export const LEAN_MAX_DEG = 45;
export const SKEW_INSET_RATIO = 0.5;
export const PRELOFT_HEADING_MAX_DEG = 15;
export const POSTLOFT_DIHEDRAL_MAX_DEG = 150;
/** High-weight targets so a clearance QP stays on the current B. */
export const CLEARANCE_TARGET_WEIGHT = 24;

export interface StockFairedInput {
    stock: PolyPoint[];
    rim: PolyPoint[];
    r1: number;
    r2: number;
    bounds?: { minX: number; maxX: number };
    medialYSign?: 1 | -1;
}

export interface ColumnInsetSkew {
    insetMm: number;
    skewMm: number;
    outward: { x: number; y: number };
}

function centroidOf(pts: PolyPoint[]): { x: number; y: number } {
    let x = 0;
    let y = 0;
    for (const p of pts) {
        x += p.x;
        y += p.y;
    }
    const n = Math.max(1, pts.length);
    return { x: x / n, y: y / n };
}

function minDistToLoop(x: number, y: number, loop: PolyPoint[]): number {
    let best = Infinity;
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const len2 = ex * ex + ey * ey;
        const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / len2)) : 0;
        best = Math.min(best, Math.hypot(x - (a.x + ex * t), y - (a.y + ey * t)));
    }
    return best;
}

function nearestOnLoop(origin: PolyPoint, loop: PolyPoint[]): PolyPoint {
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

function nearestIndex(loop: PolyPoint[], p: PolyPoint): number {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < loop.length; i++) {
        const q = loop[i]!;
        const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
        if (d < bestD) {
            bestD = d;
            best = i;
        }
    }
    return best;
}

/** Signed distance of `p` inside `rim`. Positive = inside. */
export function signedRimInsetMm(p: PolyPoint, rim: PolyPoint[]): number {
    if (rim.length < 3) return 0;
    const d = minDistToLoop(p.x, p.y, rim);
    return pointInPoly(p.x, p.y, rim) ? d : -d;
}

export function minInsetForLeanMm(r1: number, r2: number, leanRad: number): number {
    const s = Math.sin(Math.max(0, leanRad));
    return Math.max(MIN_INSET_FLOOR_MM, r1 + r2 * (1 - s));
}

export function allowedLeanRad(insetMm: number): number {
    return insetMm > LEAN_INSET_MM ? (LEAN_MAX_DEG * Math.PI) / 180 : 0;
}

export function filletRadiiFromDefaults(defaults: WallRegionDefaults): { r1: number; r2: number } {
    const r1In = defaults.wallFilletTopMm > 0 ? defaults.wallFilletTopMm : 0.5;
    const r2In = defaults.wallFilletBottomMm > 0 ? defaults.wallFilletBottomMm : 0.05;
    return {
        r1: Math.min(FILLET_R_CAP_MM, Math.max(MIN_ROUND_R_MM, r1In)),
        r2: Math.min(FILLET_R_CAP_MM, Math.max(0.05, r2In)),
    };
}

export function minInsetAtStationMm(insetMm: number, r1: number, r2: number): number {
    return minInsetForLeanMm(r1, r2, allowedLeanRad(insetMm));
}

export function rimOutwardAt(rim: PolyPoint[], i: number): { x: number; y: number } {
    return outwardNormal(rim, i, centroidOf(rim));
}

export function rimOutwardNear(rim: PolyPoint[], p: PolyPoint): { x: number; y: number } {
    return rimOutwardAt(rim, nearestIndex(rim, p));
}

/**
 * Column inset / skew in the rim frame. Inset is (R−B)·outward (B inside ⇒ +).
 * Skew is the tangential leftover. Column heading B→R should sit within 90° of
 * the outward rim normal.
 */
export function columnInsetSkew(
    R: PolyPoint,
    B: PolyPoint,
    outward: { x: number; y: number },
): ColumnInsetSkew {
    const dx = B.x - R.x;
    const dy = B.y - R.y;
    const ol = Math.hypot(outward.x, outward.y) || 1;
    const ox = outward.x / ol;
    const oy = outward.y / ol;
    return {
        insetMm: -(dx * ox + dy * oy),
        skewMm: Math.abs(dx * oy - dy * ox),
        outward: { x: ox, y: oy },
    };
}

/** Tangential leftover vs the harmonic pairing normal (same as columnSidewaysSkewMm). */
export function pairingSkewMm(R: PolyPoint, B: PolyPoint, n: { x: number; y: number }): number {
    const nl = Math.hypot(n.x, n.y) || 1;
    return Math.abs((R.x - B.x) * (n.y / nl) - (R.y - B.y) * (n.x / nl));
}

function nearestS01(p: PolyPoint, loop: PolyPoint[]): number {
    const { cum, total } = polylineArcLengths(loop);
    if (total < 1e-12) return 0;
    let bestS = 0;
    let bestD = Infinity;
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const len2 = ex * ex + ey * ey;
        const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2)) : 0;
        const d = (p.x - (a.x + ex * t)) ** 2 + (p.y - (a.y + ey * t)) ** 2;
        if (d < bestD) {
            bestD = d;
            const seg = cum[i + 1]! - cum[i]!;
            bestS = (cum[i]! + t * seg) / total;
        }
    }
    return ((bestS % 1) + 1) % 1;
}

function slideAlongLoop(
    R: PolyPoint,
    B0: PolyPoint,
    nPair: { x: number; y: number },
    outward: { x: number; y: number },
    loop: PolyPoint[],
    minInset: number,
): PolyPoint {
    const s0 = nearestS01(B0, loop);
    const { total } = polylineArcLengths(loop);
    if (total < 1e-6) return B0;
    const inn = { x: -outward.x, y: -outward.y };
    const ray = nearestRayHitOnLoop(R, inn, loop, 1) ?? nearestRayHitOnLoop(R, inn, loop, -1);
    if (ray && ray.t > 0.5 && ray.t < 80) {
        const inset = columnInsetSkew(R, ray.point, outward).insetMm;
        const skew = columnInsetSkew(R, ray.point, outward).skewMm;
        const cap = SKEW_INSET_RATIO * Math.max(inset, 0);
        const ox = B0.x - R.x;
        const oy = B0.y - R.y;
        const ol = Math.hypot(ox, oy) || 1;
        const nx = ray.point.x - R.x;
        const ny = ray.point.y - R.y;
        const nl = Math.hypot(nx, ny) || 1;
        const keepDir = (ox * nx + oy * ny) / (ol * nl) >= 0.5;
        if (keepDir && inset + 1e-3 >= minInset && skew <= cap + 1e-3) {
            return { x: ray.point.x, y: ray.point.y, z: 0 };
        }
    }
    let best = B0;
    let bestSkew = pairingSkewMm(R, B0, nPair);
    const inset0 = columnInsetSkew(R, B0, outward).insetMm;
    let found =
        pairingSkewMm(R, B0, nPair) <= SKEW_INSET_RATIO * Math.max(inset0, 0) + 1e-3 &&
        inset0 >= minInset - 1e-3;
    if (found) return B0;
    for (const windowMm of [8, 16, 32, Math.min(60, total * 0.25)]) {
        const windowS = windowMm / total;
        const steps = 36;
        for (let k = -steps; k <= steps; k++) {
            if (k === 0) continue;
            const p = sampleClosedAtArc01(loop, s0 + (k / steps) * windowS);
            const inset = columnInsetSkew(R, p, outward).insetMm;
            if (inset + 1e-3 < minInset) continue;
            const skew = pairingSkewMm(R, p, nPair);
            const cap = SKEW_INSET_RATIO * Math.max(inset, 0);
            if (skew <= cap + 1e-3) {
                const d = Math.hypot(p.x - B0.x, p.y - B0.y);
                const score = d + skew;
                const bestD = Math.hypot(best.x - B0.x, best.y - B0.y) + bestSkew;
                if (!found || score < bestD) {
                    best = { x: p.x, y: p.y, z: 0 };
                    bestSkew = skew;
                    found = true;
                }
            } else if (!found && skew < bestSkew && inset >= minInset - 1e-3) {
                best = { x: p.x, y: p.y, z: 0 };
                bestSkew = skew;
            }
        }
        if (found) break;
    }
    return { x: best.x, y: best.y, z: 0 };
}

function unitInwardAtRim(rim: PolyPoint[], x: number, y: number): { x: number; y: number } {
    const n = rimOutwardNear(rim, { x, y, z: 0 });
    return { x: -n.x, y: -n.y };
}

function placeAtInset(rim: PolyPoint[], p: PolyPoint, insetMm: number): PolyPoint {
    const near = nearestOnLoop(p, rim);
    const inn = unitInwardAtRim(rim, near.x, near.y);
    return { x: near.x + inn.x * insetMm, y: near.y + inn.y * insetMm, z: 0 };
}

/**
 * Stock plantar → QP targets. Inset > 8 mm keeps the deep cut-in (lean ≤ 45°).
 * Otherwise the target inset is reduced to the vertical-wall minimum.
 */
export function stockTargetsForFairedPattern(
    stock: PolyPoint[],
    rim: PolyPoint[],
    r1: number,
    r2: number,
): PolyPoint[] {
    if (stock.length < 3 || rim.length < 3) return stock.map((p) => ({ ...p, z: 0 }));
    const verticalMin = minInsetForLeanMm(r1, r2, 0);
    const leanMin = minInsetForLeanMm(r1, r2, allowedLeanRad(LEAN_INSET_MM + 1));
    return stock.map((p) => {
        const inset = signedRimInsetMm(p, rim);
        if (inset > LEAN_INSET_MM) {
            return inset < leanMin ? placeAtInset(rim, p, leanMin) : { x: p.x, y: p.y, z: 0 };
        }
        const want = Math.max(verticalMin, Math.min(Math.max(inset, 0), LEAN_INSET_MM));
        if (Math.abs(inset - want) < 1e-4 && inset >= verticalMin - 1e-4) {
            return { x: p.x, y: p.y, z: 0 };
        }
        return placeAtInset(rim, p, want);
    });
}

/** Default / legacy B: fairedPattern QP on the stock plantar, flat z=0. */
export function fairedPlantarFromStock(input: StockFairedInput): PolyPoint[] {
    const rim = startAtLowCurvature(ensureCcw(input.rim.map((p) => ({ ...p, z: 0 }))));
    const stock = startAtLowCurvature(ensureCcw(input.stock.map((p) => ({ ...p, z: 0 }))));
    const targets = stockTargetsForFairedPattern(stock, rim, input.r1, input.r2);
    const floorInset = minInsetForLeanMm(input.r1, input.r2, 0);
    const fit = fairedPattern({
        targets,
        controlCount: 20,
        wFit: 1,
        wFair: 0.5,
        sampleCount: Math.max(160, targets.length, rim.length),
        constraints: {
            rim,
            minInsetMm: floorInset + 0.02,
            medialYSign: input.medialYSign,
            bounds: input.bounds,
            lateralMinK: 0,
            maxIters: 10,
        },
    });
    return enforceMinRimInset(
        fit.samples.map((p) => ({ x: p.x, y: p.y, z: 0 })),
        rim,
        floorInset,
    );
}

export interface PatternClearanceResult {
    loop: PolyPoint[];
    adjusted: boolean;
    stations: number[];
    flag: string | null;
}

/**
 * B is user-owned and stays put. Re-solve the faired QP only when a sample
 * violates `inset >= max(1.0, r1+r2(1−sin lean))`. Targets = current B at
 * high weight; the inset constraint stays active.
 */
export function adjustPatternForClearance(input: {
    pattern: PolyPoint[];
    rim: PolyPoint[];
    r1: number;
    r2: number;
}): PatternClearanceResult {
    const pattern = input.pattern.map((p) => ({ x: p.x, y: p.y, z: 0 }));
    if (pattern.length < 3 || input.rim.length < 3) {
        return { loop: pattern, adjusted: false, stations: [], flag: null };
    }
    const rim = startAtLowCurvature(ensureCcw(input.rim.map((p) => ({ ...p, z: 0 }))));
    const violators: number[] = [];
    for (let i = 0; i < pattern.length; i++) {
        const inset = signedRimInsetMm(pattern[i]!, rim);
        const need = minInsetAtStationMm(inset, input.r1, input.r2);
        if (inset + 1e-3 < need) violators.push(i);
    }
    if (!violators.length) {
        return { loop: pattern, adjusted: false, stations: [], flag: null };
    }
    const floorInset = minInsetForLeanMm(input.r1, input.r2, 0);
    const fit = fairedPattern({
        targets: pattern.map((p) => ({ point: p, weight: CLEARANCE_TARGET_WEIGHT })),
        controlCount: 20,
        wFit: 1,
        wFair: 0.5,
        sampleCount: Math.max(160, pattern.length, rim.length),
        constraints: {
            rim,
            minInsetMm: floorInset + 0.02,
            maxIters: 10,
        },
    });
    const loop = enforceMinRimInset(
        fit.samples.map((p) => ({ x: p.x, y: p.y, z: 0 })),
        rim,
        floorInset,
    );
    const shown = violators.slice(0, 12).join(", ");
    const extra = violators.length > 12 ? ` (+${violators.length - 12})` : "";
    return {
        loop,
        adjusted: true,
        stations: violators,
        flag: `pattern adjusted for clearance at ${shown}${extra}`,
    };
}

export type FollowAmount = number | ((p: PolyPoint, s01: number) => number);

/**
 * Heel-widen / width-follow targets: shift B by the rim's plan displacement
 * × follow amount. Pass a function to blend the follow to 0 at the heel
 * envelope edges. Same arc-parameter s01 on both rims. These are QP targets,
 * not the finished pattern — call {@link fairMovedPattern} next.
 */
export function shiftPatternByRimFollow(
    pattern: PolyPoint[],
    rimBefore: PolyPoint[],
    rimAfter: PolyPoint[],
    followFactor: FollowAmount,
): PolyPoint[] {
    const factorAt =
        typeof followFactor === "function"
            ? followFactor
            : () => (Number.isFinite(followFactor) ? followFactor : 0);
    if (pattern.length < 3 || rimBefore.length < 3 || rimAfter.length < 3) {
        return pattern.map((p) => ({ ...p }));
    }
    const before = startAtLowCurvature(ensureCcw(rimBefore.map((p) => ({ ...p, z: 0 }))));
    const after = startAtLowCurvature(ensureCcw(rimAfter.map((p) => ({ ...p, z: 0 }))));
    const { cum, total } = polylineArcLengths(pattern);
    const den = Math.max(total, 1e-9);
    return pattern.map((p, i) => {
        const s01 = (cum[i] ?? 0) / den;
        const f = factorAt(p, s01);
        if (!Number.isFinite(f) || f === 0) return { ...p };
        const sRim = nearestClosedArc01(before, p);
        const a = sampleClosedAtArc01(before, sRim);
        const b = sampleClosedAtArc01(after, sRim);
        return {
            x: p.x + (b.x - a.x) * f,
            y: p.y + (b.y - a.y) * f,
            z: p.z,
        };
    });
}

/** Whole-insole width: scale B about the same medial-lateral centre as the top. */
export function scalePatternWidth(pattern: PolyPoint[], scale: number, centerY: number): PolyPoint[] {
    if (!Number.isFinite(scale) || Math.abs(scale - 1) < 1e-12) {
        return pattern.map((p) => ({ ...p }));
    }
    return pattern.map((p) => ({
        x: p.x,
        y: centerY + (p.y - centerY) * scale,
        z: p.z,
    }));
}

/**
 * Re-fit moved B targets through the faired-pattern QP so the result is one
 * smooth curve (lateral convex, single medial S, C2). Targets are not the
 * finished pattern. Clearance QP still runs afterwards.
 */
export function fairMovedPattern(input: {
    pattern: PolyPoint[];
    rim: PolyPoint[];
    r1: number;
    r2: number;
    bounds?: { minX: number; maxX: number };
    medialYSign?: 1 | -1;
    /** `width` tracks the scaled silhouette more tightly so pairing stays. */
    mode?: "heel" | "width";
}): PolyPoint[] {
    const rim = startAtLowCurvature(ensureCcw(input.rim.map((p) => ({ ...p, z: 0 }))));
    const moved = startAtLowCurvature(ensureCcw(input.pattern.map((p) => ({ ...p, z: 0 }))));
    if (moved.length < 3 || rim.length < 3) return moved;
    const floorInset = minInsetForLeanMm(input.r1, input.r2, 0);
    const sign = input.medialYSign ?? 1;
    const yMid = moved.reduce((s, p) => s + p.y, 0) / moved.length;
    const length = input.bounds ? Math.max(1e-3, input.bounds.maxX - input.bounds.minX) : 1;
    const dense = resamplePolyline(moved, 36);
    let heel = moved[0]!;
    let toe = moved[0]!;
    const arch: PolyPoint[] = [];
    for (const p of moved) {
        if (p.x < heel.x) heel = p;
        if (p.x > toe.x) toe = p;
        if (!input.bounds) continue;
        const u = Math.max(0, Math.min(1, (p.x - input.bounds.minX) / length));
        if ((p.y - yMid) * sign > 0 && u >= PATTERN_ARCH_U0 && u <= PATTERN_ARCH_U1) arch.push(p);
    }
    const sOf = (p: PolyPoint) => nearestClosedArc01(moved, p);
    const widthMode = input.mode === "width";
    const targets = widthMode
        ? [
              ...resamplePolyline(moved, 64).map((p) => ({ point: p, weight: 1.6, s01: sOf(p) })),
              { point: heel, weight: 8, s01: sOf(heel) },
              { point: toe, weight: 16, s01: sOf(toe) },
          ]
        : [
              ...dense.map((p) => ({ point: p, weight: 1.2, s01: sOf(p) })),
              { point: heel, weight: 8, s01: sOf(heel) },
              { point: toe, weight: 20, s01: sOf(toe) },
              ...arch
                  .filter((_, i) => i % Math.max(1, Math.floor(arch.length / 8)) === 0)
                  .slice(0, 8)
                  .map((p) => ({ point: p, weight: 6, s01: sOf(p) })),
          ];
    const attempts: Array<{ ctrl: number; wFair: number; medial: boolean; lat: number }> = widthMode
        ? [
              { ctrl: 20, wFair: 0.45, medial: true, lat: 36 },
              { ctrl: 18, wFair: 0.55, medial: true, lat: 48 },
              { ctrl: 16, wFair: 0.7, medial: true, lat: 56 },
          ]
        : [
              { ctrl: 16, wFair: 0.55, medial: true, lat: 36 },
              { ctrl: 14, wFair: 0.7, medial: true, lat: 48 },
              { ctrl: 12, wFair: 0.9, medial: true, lat: 56 },
              { ctrl: 10, wFair: 1.1, medial: true, lat: 64 },
          ];
    let best = moved;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const attempt of attempts) {
        const fit = fairedPattern({
            targets,
            controlCount: attempt.ctrl,
            wFit: 1,
            wFair: attempt.wFair,
            sampleCount: Math.max(160, moved.length, rim.length),
            constraints: {
                rim,
                minInsetMm: floorInset + 0.02,
                lateralMinK: 0,
                maxIters: 10,
                ...(attempt.medial && input.bounds ? { medialYSign: sign, bounds: input.bounds } : {}),
            },
        });
        let out = makeLateralConvex(
            fit.samples.map((p) => ({ x: p.x, y: p.y, z: 0 })),
            sign,
            attempt.lat,
            yMid,
        );
        out = scaleToMinInset(out, rim, floorInset);
        if (!input.bounds) {
            best = out;
            continue;
        }
        const hygiene = movedPatternHygiene(out, input.bounds, sign);
        const score =
            (hygiene.report.inflections > 2 ? 10 + hygiene.report.inflections : 0) +
            (hygiene.report.lateralMinK < LATERAL_K_SLACK ? 5 : 0) +
            (hygiene.report.maxAbsDkDs > PATTERN_MAX_DKDS ? 3 : 0);
        if (score < bestScore) {
            bestScore = score;
            best = out;
        }
        if (score === 0) return out;
    }
    if (input.bounds) {
        const hygiene = movedPatternHygiene(best, input.bounds, sign);
        if (hygiene.report.maxAbsDkDs > PATTERN_MAX_DKDS) {
            best = laplacianClosedPlan(best, 6);
            best = scaleToMinInset(best, rim, floorInset);
        }
    }
    return best;
}

function laplacianClosedPlan(loop: PolyPoint[], passes: number): PolyPoint[] {
    let cur = loop.map((p) => ({ ...p, z: 0 }));
    const n = cur.length;
    if (n < 3) return cur;
    for (let pass = 0; pass < passes; pass++) {
        const next = cur.map((p, i) => {
            const prev = cur[(i + n - 1) % n]!;
            const nxt = cur[(i + 1) % n]!;
            return {
                x: p.x + 0.5 * (0.5 * (prev.x + nxt.x) - p.x),
                y: p.y + 0.5 * (0.5 * (prev.y + nxt.y) - p.y),
                z: 0,
            };
        });
        cur = next;
    }
    return cur;
}

/** Even out moved-B station samples on the faired loop so outlineRing dk/ds stays ≤ 0.02. */
export function smoothMovedStationOutline(stations: HermiteStation[], loop: PolyPoint[]): void {
    if (stations.length < 3 || loop.length < 3) return;
    const n = stations.length;
    let pts = stations.map((s) => ({ ...s.outline, z: 0 }));
    pts = laplacianClosedPlan(pts, 5);
    for (let i = 0; i < n; i++) {
        const snapped = nearestOnLoop(pts[i]!, loop);
        stations[i]!.outline = { x: snapped.x, y: snapped.y, z: 0 };
        stations[i]!.tB = nearestClosedArc01(loop, snapped);
    }
}

export function limitStationSkew(
    stations: HermiteStation[],
    loop: PolyPoint[],
    r1: number,
    r2: number,
): void {
    if (stations.length < 3 || loop.length < 3) return;
    const rim = stations.map((s) => s.rim);
    const c = centroidOf(rim);
    for (let i = 0; i < stations.length; i++) {
        const st = stations[i]!;
        const out = outwardNormal(rim, i, c);
        const { insetMm, skewMm } = columnInsetSkew(st.rim, st.outline, out);
        const cap = SKEW_INSET_RATIO * Math.max(insetMm, 0);
        if (skewMm <= cap + 1e-3 && insetMm >= MIN_INSET_FLOOR_MM - 1e-3) continue;
        const need = Math.max(MIN_INSET_FLOOR_MM, minInsetAtStationMm(insetMm, r1, r2));
        st.outline = slideAlongLoop(st.rim, st.outline, out, out, loop, need);
        const dx = st.outline.x - st.rim.x;
        const dy = st.outline.y - st.rim.y;
        const hl = Math.hypot(dx, dy);
        if (hl > 1e-6) st.n = { x: dx / hl, y: dy / hl };
        st.tB = nearestS01(st.outline, loop);
    }
    repairNeighbourHeading(stations, loop, r1, r2);
}

function headingDeg(a: HermiteStation, b: HermiteStation): number {
    const h0 = columnHeading(a).h;
    const h1 = columnHeading(b).h;
    return (Math.acos(Math.max(-1, Math.min(1, h0.x * h1.x + h0.y * h1.y))) * 180) / Math.PI;
}

function pullHeading(st: HermiteStation, ref: HermiteStation, loop: PolyPoint[]): boolean {
    const h0 = columnHeading(ref).h;
    const h1 = columnHeading(st).h;
    const ang = Math.acos(Math.max(-1, Math.min(1, h0.x * h1.x + h0.y * h1.y)));
    const maxRad = (PRELOFT_HEADING_MAX_DEG * Math.PI) / 180;
    if (ang <= maxRad + 1e-9) return false;
    const t = maxRad / Math.max(ang, 1e-9);
    const hx = h0.x + (h1.x - h0.x) * t;
    const hy = h0.y + (h1.y - h0.y) * t;
    const hl = Math.hypot(hx, hy) || 1;
    const len = Math.max(0.8, Math.hypot(st.outline.x - st.rim.x, st.outline.y - st.rim.y));
    const target = { x: st.rim.x + (hx / hl) * len, y: st.rim.y + (hy / hl) * len, z: 0 };
    const snapped = nearestOnLoop(target, loop);
    st.outline = { x: snapped.x, y: snapped.y, z: 0 };
    const dx = st.outline.x - st.rim.x;
    const dy = st.outline.y - st.rim.y;
    const nl = Math.hypot(dx, dy);
    if (nl > 1e-6) st.n = { x: dx / nl, y: dy / nl };
    st.tB = nearestS01(st.outline, loop);
    return true;
}

function repairNeighbourHeading(stations: HermiteStation[], loop: PolyPoint[], r1: number, r2: number): void {
    void r1;
    void r2;
    for (let pass = 0; pass < 8; pass++) {
        let moved = 0;
        for (let i = 0; i < stations.length; i++) {
            const a = stations[i]!;
            const b = stations[(i + 1) % stations.length]!;
            if (headingDeg(a, b) <= PRELOFT_HEADING_MAX_DEG + 1e-3) continue;
            if (pullHeading(b, a, loop)) moved++;
            if (headingDeg(a, b) > PRELOFT_HEADING_MAX_DEG + 1e-3 && pullHeading(a, b, loop)) moved++;
        }
        if (!moved) break;
    }
    const spread = spreadClosedOnLoop(
        stations.map((s) => s.outline),
        loop,
        0.4,
    );
    for (let i = 0; i < stations.length; i++) {
        const p = spread[i]!;
        stations[i]!.outline = { x: p.x, y: p.y, z: 0 };
        const dx = p.x - stations[i]!.rim.x;
        const dy = p.y - stations[i]!.rim.y;
        const hl = Math.hypot(dx, dy);
        if (hl > 1e-6) stations[i]!.n = { x: dx / hl, y: dy / hl };
        stations[i]!.tB = nearestS01(p, loop);
    }
}

export function assertPreLoftStations(stations: HermiteStation[], r1: number, r2: number): void {
    if (stations.length < 3) {
        throw new Error("[S1-PRELOFT] station ring < 3");
    }
    const rim = stations.map((s) => s.rim);
    const c = centroidOf(rim);
    const bad: string[] = [];
    for (let i = 0; i < stations.length; i++) {
        const st = stations[i]!;
        const nxt = stations[(i + 1) % stations.length]!;
        const out = outwardNormal(rim, i, c);
        const { insetMm, skewMm } = columnInsetSkew(st.rim, st.outline, out);
        const need = minInsetAtStationMm(insetMm, r1, r2);
        if (insetMm + 1e-3 < need) {
            bad.push(`inset[${i}]=${insetMm.toFixed(3)}<${need.toFixed(3)}`);
        }
        const skewCap = SKEW_INSET_RATIO * Math.max(insetMm, 0);
        if (skewMm > skewCap + 1e-3) {
            bad.push(`skew[${i}]=${skewMm.toFixed(3)}>${skewCap.toFixed(3)}`);
        }
        const col = columnHeading(st);
        // B→R should sit in the outward half-plane of the rim.
        const bx = st.rim.x - st.outline.x;
        const by = st.rim.y - st.outline.y;
        const bl = Math.hypot(bx, by);
        const hx = bl > 1e-8 ? bx / bl : -col.h.x;
        const hy = bl > 1e-8 ? by / bl : -col.h.y;
        if (hx * out.x + hy * out.y < -1e-6) {
            const deg = (Math.acos(Math.max(-1, Math.min(1, hx * out.x + hy * out.y))) * 180) / Math.PI;
            bad.push(`column-vs-outward-rim[${i}]=${deg.toFixed(1)}>90`);
        }
        const h1 = columnHeading(nxt).h;
        const d = Math.max(-1, Math.min(1, col.h.x * h1.x + col.h.y * h1.y));
        const head = (Math.acos(d) * 180) / Math.PI;
        if (head > PRELOFT_HEADING_MAX_DEG + 1e-3) {
            bad.push(`heading[${i}-${(i + 1) % stations.length}]=${head.toFixed(2)}>15`);
        }
    }
    if (bad.length) {
        throw new Error(`[S1-PRELOFT] ${bad.length} station(s): ${bad.slice(0, 24).join("; ")}`);
    }
}

export function assertPostLoftGates(quality: ColumnQuality): void {
    const bad: string[] = [];
    if ((quality.maxSignedFoldDeg ?? 0) > POSTLOFT_DIHEDRAL_MAX_DEG + 1e-6) {
        bad.push(`signed-dihedral ${quality.maxSignedFoldDeg.toFixed(2)}>${POSTLOFT_DIHEDRAL_MAX_DEG}`);
    }
    if ((quality.columnCrossings ?? 0) !== 0) {
        bad.push(`crossings=${quality.columnCrossings}`);
    }
    if ((quality.inwardWallFaces ?? 0) !== 0) {
        bad.push(`inward-faces=${quality.inwardWallFaces}`);
    }
    if (bad.length) {
        throw new Error(`[S1-POSTLOFT] ${bad.join("; ")}`);
    }
}
