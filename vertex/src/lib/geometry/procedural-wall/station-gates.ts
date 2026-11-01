// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { forefootWidthLongitudinalEnvelope } from "@/lib/geometry/height-field";
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
import { fairedPattern } from "./faired-pattern";
import type { HermiteStation } from "./loft";
import { outwardNormal } from "./measure";
import { enforceMinRimInset } from "./pattern-hygiene";
import {
    type ForefootSkewExempt,
    nearestRayHitOnLoop,
    segmentsCrossXY,
    spreadClosedOnLoop,
} from "./stations";

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
        skipPostScale: true,
        constraints: {
            rim,
            minInsetMm: floorInset + 0.02,
            maxIters: 10,
        },
    });
    const loop = refitMinInsetThroughQp(
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

/** Re-solve inset through the faired QP. Do not geometrically shrink — that spikes dk/ds. */
export function refitMinInsetThroughQp(
    loop: PolyPoint[],
    rim: PolyPoint[],
    minInsetMm: number,
    opts?: {
        bounds?: { minX: number; maxX: number };
        medialYSign?: 1 | -1;
        wFair?: number;
    },
): PolyPoint[] {
    let pts = loop.map((p) => ({ x: p.x, y: p.y, z: 0 }));
    if (pts.length < 3 || rim.length < 3 || minInsetMm <= 0) return pts;
    for (let attempt = 0; attempt < 5; attempt++) {
        let worst = Infinity;
        for (const p of pts) worst = Math.min(worst, signedRimInsetMm(p, rim));
        if (worst >= minInsetMm - 1e-4) break;
        const slack = minInsetMm + 0.06 + attempt * 0.05;
        const wFair = Math.max(opts?.wFair ?? 0.65, 0.55 + attempt * 0.08);
        const targets = pts.map((p) => {
            const inset = signedRimInsetMm(p, rim);
            if (inset >= slack - 1e-4) return { point: p, weight: 2.2 };
            const inn = unitInwardAtRim(rim, p.x, p.y);
            const push = slack - inset + 0.12;
            return {
                point: { x: p.x + inn.x * push, y: p.y + inn.y * push, z: 0 },
                weight: 18,
            };
        });
        const fit = fairedPattern({
            targets,
            controlCount: 20,
            wFit: 1,
            wFair,
            sampleCount: Math.max(160, pts.length, rim.length),
            skipPostScale: true,
            constraints: {
                rim,
                minInsetMm: slack,
                maxIters: 14,
                ...(opts?.bounds && opts.medialYSign
                    ? { bounds: opts.bounds, medialYSign: opts.medialYSign }
                    : {}),
            },
        });
        pts = fit.samples.map((p) => ({ x: p.x, y: p.y, z: 0 }));
    }
    let worst = Infinity;
    for (const p of pts) worst = Math.min(worst, signedRimInsetMm(p, rim));
    if (worst < minInsetMm - 1e-4) return pts;
    const polish = fairedPattern({
        targets: pts.map((p) => ({ point: p, weight: 3.2 })),
        controlCount: 20,
        wFit: 1,
        wFair: Math.max(opts?.wFair ?? 0.65, 0.95),
        sampleCount: Math.max(160, pts.length, rim.length),
        skipPostScale: true,
        constraints: {
            rim,
            minInsetMm,
            maxIters: 8,
            ...(opts?.bounds && opts.medialYSign
                ? { bounds: opts.bounds, medialYSign: opts.medialYSign }
                : {}),
        },
    });
    const smoothed = polish.samples.map((p) => ({ x: p.x, y: p.y, z: 0 }));
    let polishedWorst = Infinity;
    for (const p of smoothed) polishedWorst = Math.min(polishedWorst, signedRimInsetMm(p, rim));
    return polishedWorst >= minInsetMm - 1e-4 ? smoothed : pts;
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
            skipPostScale: true,
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
        out = refitMinInsetThroughQp(out, rim, floorInset, {
            bounds: input.bounds,
            medialYSign: sign,
            wFair: attempt.wFair,
        });
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
            best = refitMinInsetThroughQp(best, rim, floorInset, {
                bounds: input.bounds,
                medialYSign: sign,
                wFair: 0.95,
            });
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
    pts = laplacianClosedPlan(pts, 2);
    for (let i = 0; i < n; i++) {
        const snapped = nearestOnLoop(pts[i]!, loop);
        stations[i]!.outline = { x: snapped.x, y: snapped.y, z: 0 };
        stations[i]!.tB = nearestClosedArc01(loop, snapped);
    }
}

function slideSkewStations(
    stations: HermiteStation[],
    loop: PolyPoint[],
    r1: number,
    r2: number,
    opts?: ForefootSkewExempt & { minX?: number; lengthMm?: number },
): void {
    const rim = stations.map((s) => s.rim);
    const c = centroidOf(rim);
    const fore = opts?.forefootWidthMm ?? 0;
    const minX = opts?.minX ?? opts?.bounds?.minX ?? 0;
    const lengthMm = opts?.lengthMm ?? (opts?.bounds ? opts.bounds.maxX - opts.bounds.minX : 0);
    for (let i = 0; i < stations.length; i++) {
        const st = stations[i]!;
        if (fore !== 0 && lengthMm > 1e-3) {
            const u = Math.max(0, Math.min(1, (st.rim.x - minX) / lengthMm));
            if (forefootWidthLongitudinalEnvelope(u) > 1e-3) continue;
        }
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
}

function unwrapNear(s01: number[]): number[] {
    const out = new Array<number>(s01.length);
    out[0] = s01[0] ?? 0;
    for (let i = 1; i < s01.length; i++) {
        let s = s01[i] ?? 0;
        const prev = out[i - 1] ?? 0;
        while (s < prev - 0.5) s += 1;
        while (s > prev + 0.5) s -= 1;
        out[i] = s;
    }
    return out;
}

const SHORT_COLUMN_MM = 16;
/** Outline-parameter span of two local neighbours. Larger than this is a cross-foot jump. */
const LOCAL_TB_SPAN = 0.045;

function columnLen(st: HermiteStation): number {
    return Math.hypot(st.outline.x - st.rim.x, st.outline.y - st.rim.y);
}

function writeLoopOutline(st: HermiteStation, loop: PolyPoint[], s: number): void {
    const s01 = ((s % 1) + 1) % 1;
    const p = sampleClosedAtArc01(loop, s01);
    st.outline = { x: p.x, y: p.y, z: 0 };
    st.tB = s01;
    const dx = p.x - st.rim.x;
    const dy = p.y - st.rim.y;
    const hl = Math.hypot(dx, dy);
    if (hl > 1e-6) st.n = { x: dx / hl, y: dy / hl };
}

function forwardSpan(sL: number, sR: number): { sL: number; sR: number; span: number } {
    let right = sR;
    while (right <= sL) right += 1;
    return { sL, sR: right, span: right - sL };
}

/** Plan crossings of column i against non-adjacent columns in a local window. */
function columnCrossesNear(stations: HermiteStation[], i: number, window: number): number {
    const n = stations.length;
    const a0 = stations[i]!.outline;
    const a1 = stations[i]!.rim;
    let hits = 0;
    for (let k = 2; k <= window; k++) {
        const j0 = (i + k) % n;
        const j1 = (i - k + n) % n;
        if (segmentsCrossXY(a0, a1, stations[j0]!.outline, stations[j0]!.rim)) hits++;
        if (segmentsCrossXY(a0, a1, stations[j1]!.outline, stations[j1]!.rim)) hits++;
    }
    return hits;
}

const EASE_COLUMN_MM = 24;

/**
 * A dense medial rim can fold the outline parameter backwards by a few
 * millimetres and pick it up again at the next wide step. Shift that run
 * forward, as one piece, into the absorbing gap so the columns stay in
 * order. Relative spacing inside the run is unchanged, so only the kink
 * turns. The rim is not moved.
 */
function repairParameterPleats(stations: HermiteStation[], loop: PolyPoint[]): void {
    const n = stations.length;
    const rim = stations.map((s) => s.rim);
    const c = centroidOf(rim);
    const outward = rim.map((_, i) => outwardNormal(rim, i, c));

    for (let pass = 0; pass < 4; pass++) {
        const s0 = unwrapNear(stations.map((st) => st.tB ?? nearestS01(st.outline, loop)));
        const positive: number[] = [];
        for (let i = 0; i < n; i++) {
            const d = (s0[(i + 1) % n] ?? 0) - (s0[i] ?? 0);
            if (d > 1e-5 && d < 0.02) positive.push(d);
        }
        positive.sort((a, b) => a - b);
        const median = positive[Math.floor(positive.length / 2)] ?? 0.001;
        const jump = Math.max(median * 4, 0.0035);
        const retractPrefix = (at: number) => {
            if (at <= 0 || at + 1 >= n) return;
            const residual = (s0[at] ?? 0) - (s0[at + 1] ?? 0) + median * 0.35;
            if (residual <= 1e-5) return;
            let anchor = at;
            for (let t = at; t > Math.max(0, at - 40); t--) {
                anchor = t;
                const gap = (s0[t] ?? 0) - (s0[t - 1] ?? 0);
                if (gap >= residual + median * 0.2) break;
            }
            if (anchor <= 0) return;
            const gap = (s0[anchor] ?? 0) - (s0[anchor - 1] ?? 0);
            const delta = Math.min(residual, Math.max(0, gap - median * 0.2));
            if (delta <= 1e-5) return;
            const movedIdx: number[] = [];
            for (let t = anchor; t <= at; t++) movedIdx.push(t);
            const snap = movedIdx.map((idx) => ({
                outline: { ...stations[idx]!.outline },
                tB: stations[idx]!.tB,
                nvec: { ...stations[idx]!.n },
            }));
            const fits = (d: number): boolean => {
                for (const idx of movedIdx) {
                    writeLoopOutline(stations[idx]!, loop, (s0[idx] ?? 0) - d);
                    const m = columnInsetSkew(stations[idx]!.rim, stations[idx]!.outline, outward[idx]!);
                    const cap = SKEW_INSET_RATIO * Math.max(m.insetMm, 0);
                    if (
                        m.insetMm + 1e-3 < MIN_INSET_FLOOR_MM ||
                        m.skewMm > cap + 1e-3 ||
                        columnLen(stations[idx]!) > 28
                    ) {
                        return false;
                    }
                }
                return true;
            };
            let bestD = 0;
            let loD = 0;
            let hiD = delta;
            for (let step = 0; step < 6; step++) {
                const mid = (loD + hiD) * 0.5;
                if (fits(mid)) {
                    bestD = mid;
                    loD = mid;
                } else {
                    hiD = mid;
                }
            }
            if (bestD <= 1e-5) {
                for (let t = 0; t < movedIdx.length; t++) {
                    stations[movedIdx[t]!]!.outline = snap[t]!.outline;
                    stations[movedIdx[t]!]!.tB = snap[t]!.tB;
                    stations[movedIdx[t]!]!.n = snap[t]!.nvec;
                }
                return;
            }
            for (const idx of movedIdx) {
                writeLoopOutline(stations[idx]!, loop, (s0[idx] ?? 0) - bestD);
                s0[idx] = (s0[idx] ?? 0) - bestD;
            }
        };
        let fixed = 0;
        for (let i = 0; i + 1 < n; i++) {
            if ((s0[i + 1] ?? 0) >= (s0[i] ?? 0) - 1e-5) continue;
            const need = (s0[i] ?? 0) + median * 0.75 - (s0[i + 1] ?? 0);
            if (need <= 1e-5) continue;
            let k = i + 1;
            let guard = 0;
            while (guard++ < 48 && k + 1 < n) {
                const step = (s0[k + 1] ?? 0) - (s0[k] ?? 0);
                if (step < -1e-5) break;
                if (step > jump) break;
                k++;
            }
            if (k + 1 >= n) continue;
            const room = (s0[k + 1] ?? 0) - (s0[k] ?? 0) - median * 0.5;
            const appliedMax = Math.min(need, room);
            if (appliedMax <= 1e-5) continue;
            const idxs: number[] = [];
            for (let t = i + 1; t <= k; t++) idxs.push(t);
            const prior = idxs.map((idx) => {
                const m = columnInsetSkew(stations[idx]!.rim, stations[idx]!.outline, outward[idx]!);
                return { skew: m.skewMm, inset: m.insetMm };
            });
            const stillLegal = (idxPos: number): boolean => {
                const idx = idxs[idxPos]!;
                const { insetMm, skewMm } = columnInsetSkew(
                    stations[idx]!.rim,
                    stations[idx]!.outline,
                    outward[idx]!,
                );
                if (columnLen(stations[idx]!) > 28) return false;
                const was = prior[idxPos]!;
                const wasOk =
                    was.inset + 1e-3 >= MIN_INSET_FLOOR_MM &&
                    was.skew <= SKEW_INSET_RATIO * Math.max(was.inset, 0) + 1e-3;
                if (!wasOk)
                    return (
                        skewMm <= was.skew + 1e-3 && insetMm + 1e-3 >= Math.min(was.inset, MIN_INSET_FLOOR_MM)
                    );
                if (insetMm + 1e-3 < MIN_INSET_FLOOR_MM) return false;
                return skewMm <= SKEW_INSET_RATIO * Math.max(insetMm, 0) + 1e-3;
            };
            const saved = idxs.map((idx) => ({
                outline: { ...stations[idx]!.outline },
                tB: stations[idx]!.tB,
                nvec: { ...stations[idx]!.n },
            }));
            const restore = () => {
                for (let t = 0; t < idxs.length; t++) {
                    stations[idxs[t]!]!.outline = saved[t]!.outline;
                    stations[idxs[t]!]!.tB = saved[t]!.tB;
                    stations[idxs[t]!]!.n = saved[t]!.nvec;
                }
            };
            const apply = (delta: number) => {
                for (const idx of idxs) writeLoopOutline(stations[idx]!, loop, (s0[idx] ?? 0) + delta);
            };
            const crossBefore =
                columnCrossesNear(stations, i, 48) +
                columnCrossesNear(stations, i + 1, 48) +
                columnCrossesNear(stations, k, 48);
            const headBefore = headingDeg(stations[i]!, stations[i + 1]!);
            let best = 0;
            let lo = 0;
            let hi = appliedMax;
            for (let step = 0; step < 8; step++) {
                const mid = (lo + hi) * 0.5;
                apply(mid);
                const ok = idxs.every((_, pos) => stillLegal(pos));
                const head = headingDeg(stations[i]!, stations[i + 1]!);
                const cross =
                    columnCrossesNear(stations, i, 48) +
                    columnCrossesNear(stations, i + 1, 48) +
                    columnCrossesNear(stations, k, 48);
                if (ok && cross <= crossBefore && head + 1e-3 < headBefore) {
                    best = mid;
                    lo = mid;
                } else {
                    hi = mid;
                }
            }
            if (best <= 1e-5) {
                restore();
                const probe = Math.min(appliedMax, median);
                apply(probe);
                const cut = idxs.findIndex((_, t) => !stillLegal(t));
                restore();
                if (cut > 0) {
                    const k2 = idxs[cut - 1]!;
                    const anchor = idxs[cut]!;
                    const room2 = (s0[anchor] ?? 0) - (s0[k2] ?? 0) - median * 0.5;
                    const max2 = Math.min(need, room2);
                    const idxs2 = idxs.slice(0, cut);
                    if (max2 > 1e-5 && anchor === k2 + 1) {
                        const saved2 = idxs2.map((idx) => ({
                            outline: { ...stations[idx]!.outline },
                            tB: stations[idx]!.tB,
                            nvec: { ...stations[idx]!.n },
                        }));
                        const prior2 = idxs2.map((idx) => prior[idxs.indexOf(idx)]!);
                        const apply2 = (delta: number) => {
                            for (const idx of idxs2)
                                writeLoopOutline(stations[idx]!, loop, (s0[idx] ?? 0) + delta);
                        };
                        const legal2 = () =>
                            idxs2.every((idx, t) => {
                                const { insetMm, skewMm } = columnInsetSkew(
                                    stations[idx]!.rim,
                                    stations[idx]!.outline,
                                    outward[idx]!,
                                );
                                if (columnLen(stations[idx]!) > 28) return false;
                                const was = prior2[t]!;
                                const wasOk =
                                    was.inset + 1e-3 >= MIN_INSET_FLOOR_MM &&
                                    was.skew <= SKEW_INSET_RATIO * Math.max(was.inset, 0) + 1e-3;
                                if (!wasOk) {
                                    return (
                                        skewMm <= was.skew + 1e-3 &&
                                        insetMm + 1e-3 >= Math.min(was.inset, MIN_INSET_FLOOR_MM)
                                    );
                                }
                                if (insetMm + 1e-3 < MIN_INSET_FLOOR_MM) return false;
                                return skewMm <= SKEW_INSET_RATIO * Math.max(insetMm, 0) + 1e-3;
                            });
                        const cross0 =
                            columnCrossesNear(stations, i, 48) + columnCrossesNear(stations, i + 1, 48);
                        let best2 = 0;
                        let lo2 = 0;
                        let hi2 = max2;
                        for (let step = 0; step < 8; step++) {
                            const mid = (lo2 + hi2) * 0.5;
                            apply2(mid);
                            const head = headingDeg(stations[i]!, stations[i + 1]!);
                            const cross =
                                columnCrossesNear(stations, i, 48) + columnCrossesNear(stations, i + 1, 48);
                            if (legal2() && cross <= cross0 && head + 1e-3 < headBefore) {
                                best2 = mid;
                                lo2 = mid;
                            } else {
                                hi2 = mid;
                            }
                        }
                        if (best2 > 1e-5) {
                            apply2(best2);
                            for (const idx of idxs2) s0[idx] = (s0[idx] ?? 0) + best2;
                            retractPrefix(i);
                            fixed++;
                            continue;
                        }
                        for (let t = 0; t < idxs2.length; t++) {
                            stations[idxs2[t]!]!.outline = saved2[t]!.outline;
                            stations[idxs2[t]!]!.tB = saved2[t]!.tB;
                            stations[idxs2[t]!]!.n = saved2[t]!.nvec;
                        }
                    }
                }
                continue;
            }
            apply(best);
            for (const idx of idxs) s0[idx] = (s0[idx] ?? 0) + best;
            retractPrefix(i);
            fixed++;
        }
        if (!fixed) break;
    }
    const s1 = unwrapNear(stations.map((st) => st.tB ?? nearestS01(st.outline, loop)));
    const { total } = polylineArcLengths(loop);
    if (total < 1e-3) return;
    for (let i = 0; i + 1 < n; i++) {
        const behindS = (s1[i] ?? 0) - (s1[i + 1] ?? 0);
        if (behindS <= 1e-6) continue;
        const want = behindS * total + 0.22;
        const floor = 0.16;
        const gaps: number[] = [];
        const span = Math.min(i, 28);
        for (let t = i; t > i - span; t--) {
            gaps.push(
                Math.hypot(
                    stations[t]!.outline.x - stations[t - 1]!.outline.x,
                    stations[t]!.outline.y - stations[t - 1]!.outline.y,
                ),
            );
        }
        const surplus = gaps.reduce((sum, d) => sum + Math.max(0, d - floor), 0);
        const take = Math.min(want, surplus);
        if (take <= 1e-3) continue;
        const uses: number[] = [];
        let left = take;
        for (const d of gaps) {
            const use = Math.min(Math.max(0, d - floor), left);
            uses.push(use);
            left -= use;
        }
        const snap = uses.map((_, k) => {
            const idx = i - k;
            return {
                outline: { ...stations[idx]!.outline },
                tB: stations[idx]!.tB,
                nvec: { ...stations[idx]!.n },
            };
        });
        let shift = take;
        let ok = true;
        for (let k = 0; k < uses.length; k++) {
            const idx = i - k;
            writeLoopOutline(stations[idx]!, loop, (s1[idx] ?? 0) - shift / total);
            const m = columnInsetSkew(stations[idx]!.rim, stations[idx]!.outline, outward[idx]!);
            const cap = SKEW_INSET_RATIO * Math.max(m.insetMm, 0);
            if (
                m.insetMm + 1e-3 < MIN_INSET_FLOOR_MM ||
                m.skewMm > cap + 1e-3 ||
                columnLen(stations[idx]!) > 28
            ) {
                ok = false;
            }
            shift -= uses[k]!;
        }
        if (!ok) {
            for (let k = 0; k < uses.length; k++) {
                const idx = i - k;
                stations[idx]!.outline = snap[k]!.outline;
                stations[idx]!.tB = snap[k]!.tB;
                stations[idx]!.n = snap[k]!.nvec;
            }
            continue;
        }
        let acc = take;
        for (let k = 0; k < uses.length; k++) {
            s1[i - k] = (s1[i - k] ?? 0) - acc / total;
            acc -= uses[k]!;
        }
    }
}

/**
 * The skew slide can land a dense medial column on the far side of the
 * pattern (a ray along the inward normal hits the other edge inside 80 mm),
 * or fold the outline parameter back on itself where the rim is dense.
 * Pull far columns back between short neighbours, shift a folded run into
 * the gap that absorbs it, then ease any remaining heading over 15°. The
 * rim is not moved. Uniform outlines never enter: the caller gates this on
 * the Morton's rim.
 */
export function reseatDenseOutlineHeadings(stations: HermiteStation[], loop: PolyPoint[]): void {
    const n = stations.length;
    if (n < 8 || loop.length < 8) return;
    const unwrapped = () => unwrapNear(stations.map((st) => st.tB ?? nearestS01(st.outline, loop)));
    repairParameterPleats(stations, loop);

    for (let pass = 0; pass < 4; pass++) {
        const s0 = unwrapped();
        const lens = stations.map(columnLen);
        const claimed = new Array<boolean>(n).fill(false);
        let moved = 0;
        for (let i = 0; i < n; i++) {
            if (claimed[i] || lens[i]! <= SHORT_COLUMN_MM) continue;
            let left = -1;
            let right = -1;
            for (let k = 1; k <= 24; k++) {
                const j = (i - k + n) % n;
                if (lens[j]! <= SHORT_COLUMN_MM) {
                    left = j;
                    break;
                }
            }
            for (let k = 1; k <= 24; k++) {
                const j = (i + k) % n;
                if (lens[j]! <= SHORT_COLUMN_MM) {
                    right = j;
                    break;
                }
            }
            if (left < 0 || right < 0) continue;
            const span = forwardSpan(s0[left] ?? 0, s0[right] ?? 0);
            if (span.span <= 1e-5 || span.span > 0.08) continue;
            const idxs: number[] = [];
            for (let k = (left + 1) % n; k !== right; k = (k + 1) % n) {
                idxs.push(k);
                if (idxs.length > 24) break;
            }
            if (idxs.length === 0 || idxs.length > 24) continue;
            const chain = [left, ...idxs, right];
            const gaps: number[] = [];
            for (let k = 0; k < chain.length - 1; k++) {
                const a = stations[chain[k]!]!.rim;
                const b = stations[chain[k + 1]!]!.rim;
                gaps.push(Math.max(1e-4, Math.hypot(b.x - a.x, b.y - a.y)));
            }
            const gapSum = gaps.reduce((s, d) => s + d, 0) || 1;
            let acc = 0;
            for (let k = 0; k < idxs.length; k++) {
                acc += gaps[k]!;
                writeLoopOutline(stations[idxs[k]!]!, loop, span.sL + span.span * (acc / gapSum));
                claimed[idxs[k]!] = true;
                moved++;
            }
        }
        if (!moved) break;
    }

    const rim = stations.map((s) => s.rim);
    const c = centroidOf(rim);
    const outward = rim.map((_, i) => outwardNormal(rim, i, c));
    for (let pass = 0; pass < 8; pass++) {
        const s0 = unwrapped();
        let moved = 0;
        for (let i = 0; i < n; i++) {
            const prev = (i + n - 1) % n;
            const next = (i + 1) % n;
            const hL = headingDeg(stations[prev]!, stations[i]!);
            const hR = headingDeg(stations[i]!, stations[next]!);
            if (Math.max(hL, hR) <= PRELOFT_HEADING_MAX_DEG + 1e-3) continue;
            if (
                columnLen(stations[i]!) > EASE_COLUMN_MM ||
                columnLen(stations[prev]!) > EASE_COLUMN_MM ||
                columnLen(stations[next]!) > EASE_COLUMN_MM
            ) {
                continue;
            }
            const span = forwardSpan(s0[prev] ?? 0, s0[next] ?? 0);
            if (span.span <= 1e-5 || span.span > LOCAL_TB_SPAN) continue;
            const beforeCross = columnCrossesNear(stations, i, 48);
            const saved = {
                outline: { ...stations[i]!.outline },
                tB: stations[i]!.tB,
                nvec: { ...stations[i]!.n },
            };
            let bestS: number | null = null;
            let bestScore = Math.max(hL, hR);
            const steps = 20;
            for (let k = 1; k < steps; k++) {
                const s = span.sL + (span.span * k) / steps;
                writeLoopOutline(stations[i]!, loop, s);
                if (columnLen(stations[i]!) > EASE_COLUMN_MM) continue;
                const { insetMm, skewMm } = columnInsetSkew(
                    stations[i]!.rim,
                    stations[i]!.outline,
                    outward[i]!,
                );
                const cap = SKEW_INSET_RATIO * Math.max(insetMm, 0);
                if (insetMm + 1e-3 < MIN_INSET_FLOOR_MM || skewMm > cap + 1e-3) continue;
                const score = Math.max(
                    headingDeg(stations[prev]!, stations[i]!),
                    headingDeg(stations[i]!, stations[next]!),
                );
                if (score + 1e-4 < bestScore && columnCrossesNear(stations, i, 48) <= beforeCross) {
                    bestScore = score;
                    bestS = s;
                }
            }
            if (bestS == null) {
                stations[i]!.outline = saved.outline;
                stations[i]!.tB = saved.tB;
                stations[i]!.n = saved.nvec;
                continue;
            }
            writeLoopOutline(stations[i]!, loop, bestS);
            moved++;
        }
        if (!moved) break;
    }
}

export function limitStationSkew(
    stations: HermiteStation[],
    loop: PolyPoint[],
    r1: number,
    r2: number,
    opts?: ForefootSkewExempt & { minX?: number; lengthMm?: number },
): void {
    if (stations.length < 3 || loop.length < 3) return;
    slideSkewStations(stations, loop, r1, r2, opts);
    repairNeighbourHeading(stations, loop, r1, r2);
    // spreadClosedOnLoop can put skew back over 0.5 inset; slide once more.
    slideSkewStations(stations, loop, r1, r2, opts);
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

export function assertPreLoftStations(
    stations: HermiteStation[],
    r1: number,
    r2: number,
    opts?: ForefootSkewExempt & { minX?: number; lengthMm?: number },
): void {
    if (stations.length < 3) {
        throw new Error("[S1-PRELOFT] station ring < 3");
    }
    const rim = stations.map((s) => s.rim);
    const c = centroidOf(rim);
    const fore = opts?.forefootWidthMm ?? 0;
    const minX = opts?.minX ?? opts?.bounds?.minX ?? 0;
    const lengthMm = opts?.lengthMm ?? (opts?.bounds ? opts.bounds.maxX - opts.bounds.minX : 0);
    const bad: string[] = [];
    for (let i = 0; i < stations.length; i++) {
        const st = stations[i]!;
        const nxt = stations[(i + 1) % stations.length]!;
        const out = outwardNormal(rim, i, c);
        const { insetMm, skewMm } = columnInsetSkew(st.rim, st.outline, out);
        const u = lengthMm > 1e-3 ? Math.max(0, Math.min(1, (st.rim.x - minX) / lengthMm)) : 0;
        const foreEnv = fore !== 0 ? forefootWidthLongitudinalEnvelope(u) : 0;
        const need = minInsetAtStationMm(insetMm, r1, r2);
        if (foreEnv <= 1e-3 && insetMm + 1e-3 < need) {
            bad.push(`inset[${i}]=${insetMm.toFixed(3)}<${need.toFixed(3)}`);
        }
        if (foreEnv <= 1e-3) {
            const skewCap = SKEW_INSET_RATIO * Math.max(insetMm, 0);
            if (skewMm > skewCap + 1e-3) {
                bad.push(`skew[${i}]=${skewMm.toFixed(3)}>${skewCap.toFixed(3)}`);
            }
        }
        const col = columnHeading(st);
        // B→R should sit in the outward half-plane of the rim.
        const bx = st.rim.x - st.outline.x;
        const by = st.rim.y - st.outline.y;
        const bl = Math.hypot(bx, by);
        const hx = bl > 1e-8 ? bx / bl : -col.h.x;
        const hy = bl > 1e-8 ? by / bl : -col.h.y;
        if (foreEnv <= 1e-3 && hx * out.x + hy * out.y < -1e-6) {
            const deg = (Math.acos(Math.max(-1, Math.min(1, hx * out.x + hy * out.y))) * 180) / Math.PI;
            bad.push(`column-vs-outward-rim[${i}]=${deg.toFixed(1)}>90`);
        }
        const h1 = columnHeading(nxt).h;
        const d = Math.max(-1, Math.min(1, col.h.x * h1.x + col.h.y * h1.y));
        const head = (Math.acos(d) * 180) / Math.PI;
        const uNext = lengthMm > 1e-3 ? Math.max(0, Math.min(1, (nxt.rim.x - minX) / lengthMm)) : 0;
        const nextEnv = fore !== 0 ? forefootWidthLongitudinalEnvelope(uNext) : 0;
        if ((foreEnv <= 1e-3 || nextEnv <= 1e-3) && head > PRELOFT_HEADING_MAX_DEG + 1e-3) {
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
        const hits = quality.inwardHits ?? [];
        console.log("[RND-FLIPS]", JSON.stringify({ inward: quality.inwardWallFaces, hits }));
        const dump = hits
            .slice(0, 16)
            .map((h) => `i=${h.i}/j=${h.j}/Ls=${h.Ls}/wR=${h.wR}`)
            .join(",");
        bad.push(`inward-faces=${quality.inwardWallFaces}${dump ? ` [${dump}]` : ""}`);
    }
    if (bad.length) {
        throw new Error(`[S1-POSTLOFT] ${bad.join("; ")}`);
    }
}
