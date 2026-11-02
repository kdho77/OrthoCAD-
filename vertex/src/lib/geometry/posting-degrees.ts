// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { type ShoeWidthId, shoeWidthScaleAtU } from "@/lib/geometry/shoe-width";
import { effectiveOutlineHalfWidth, type TrimlineCurve } from "@/lib/geometry/trimline";

/**
 * Degree posting → millimetres, once per zone.
 *
 * h = W · tan(θ). W is the bottom-planform width at the zone's full-height
 * station, measured on the code outline (perpendicular to the long axis) for
 * the chosen size, shoe width, and side. It is never taken from a size table.
 *
 * Rearfoot uses the heel station. Forefoot uses the met-head line. The two
 * zones are converted separately and are never added as angles. θ is the final
 * frontal-plane post: varus raises the medial edge, valgus the lateral edge.
 * Rearfoot motion allowance is not part of θ.
 *
 * The geometry keeps this h unrounded. A 0° input is an exact no-op.
 */

/** Heel station shared with the full-length wedge (u = 0.15). */
export const REARFOOT_POST_U = 0.15;
/** Met-head line (~75% of insole length). */
export const FOREFOOT_POST_U = 0.75;

export const REARFOOT_POST_DEG_MIN = 0;
export const REARFOOT_POST_DEG_MAX = 8;
export const FOREFOOT_POST_DEG_MIN = 0;
export const FOREFOOT_POST_DEG_MAX = 10;
/** Soft warning. Inputs above this are still allowed up to the zone max. */
export const REGIONAL_POSTING_WARN_DEG = 6;

/**
 * Heel width passed to the shoe-width scale, as a fraction of ball width.
 * Same ratio as `printSolidOptions`.
 */
const HEEL_WIDTH_OF_BALL = 0.62;

const DEG = Math.PI / 180;

export type PostingZone = "rearfoot" | "forefoot";

export interface PostingShoeWidth {
    id: ShoeWidthId;
    ballWidthMm?: number;
    heelWidthMm?: number;
}

export interface PostingOutline {
    lengthMm: number;
    widthMm: number;
    trimline?: TrimlineCurve | null;
    shoeWidth?: PostingShoeWidth | null;
}

export function postingStationU(zone: PostingZone): number {
    return zone === "rearfoot" ? REARFOOT_POST_U : FOREFOOT_POST_U;
}

/** Clamp a degree entry. 0 stays 0. Non-finite becomes 0. */
export function clampPostingDegrees(zone: PostingZone, deg: number): number {
    if (!Number.isFinite(deg)) return 0;
    const max = zone === "rearfoot" ? REARFOOT_POST_DEG_MAX : FOREFOOT_POST_DEG_MAX;
    if (deg <= 0) return 0;
    return deg > max ? max : deg;
}

export function postingDegAboveWarn(deg: number): boolean {
    return deg > REGIONAL_POSTING_WARN_DEG;
}

/**
 * Full width (mm) of the code outline at normalized station `u`.
 * Long axis is +x; the width is the medial-to-lateral span, perpendicular to it.
 */
export function codeOutlineWidthMm(u: number, outline: PostingOutline): number {
    const half = effectiveOutlineHalfWidth(u, outline.lengthMm, outline.widthMm, outline.trimline ?? null);
    const unscaled = half * outline.widthMm;
    const shoe = outline.shoeWidth;
    if (!shoe || shoe.id === "medium") return unscaled;
    const ball = shoe.ballWidthMm ?? outline.widthMm;
    const heel = shoe.heelWidthMm ?? ball * HEEL_WIDTH_OF_BALL;
    return unscaled * shoeWidthScaleAtU(u, ball, heel, shoe.id);
}

/**
 * Rise from the hinge edge to the high edge. No rounding.
 * 0° returns exact 0, independent of width.
 */
export function postingRiseMm(deg: number, widthMm: number): number {
    if (deg === 0 || widthMm === 0) return 0;
    if (!Number.isFinite(deg) || !Number.isFinite(widthMm)) return 0;
    return widthMm * Math.tan(deg * DEG);
}

/** One conversion for a zone: clamp θ, measure W at that zone's station, h = W·tanθ. */
export function postingMmAtStation(zone: PostingZone, deg: number, outline: PostingOutline): number {
    const clamped = clampPostingDegrees(zone, deg);
    if (clamped === 0) return 0;
    return postingRiseMm(clamped, codeOutlineWidthMm(postingStationU(zone), outline));
}

/** Varus raises medial. Valgus raises lateral. */
export function postingEdgeForAngle(kind: "varus" | "valgus"): "medial" | "lateral" {
    return kind === "varus" ? "medial" : "lateral";
}

/** Display only. Geometry uses {@link postingRiseMm} unrounded. */
export function formatPostingDegreesMm(deg: number, mm: number): string {
    return `${deg.toFixed(1)}° = ${mm.toFixed(1)} mm`;
}

export function postingEquivalenceLabel(
    zone: PostingZone | "full",
    wedge: { value?: number; unit?: "mm" | "deg" } | null | undefined,
    outline: PostingOutline,
): string | undefined {
    if (!wedge || wedge.unit !== "deg" || !(wedge.value != null && wedge.value > 0)) return undefined;
    const deg = zone === "full" ? wedge.value : clampPostingDegrees(zone, wedge.value);
    if (!(deg > 0)) return undefined;
    const u = zone === "forefoot" ? FOREFOOT_POST_U : REARFOOT_POST_U;
    return formatPostingDegreesMm(deg, postingRiseMm(deg, codeOutlineWidthMm(u, outline)));
}

/** Unrounded millimetres for a degree entry, or null when the entry is not degrees. */
export function convertedPostingMm(
    zone: PostingZone | "full",
    wedge: { value?: number; unit?: "mm" | "deg" } | null | undefined,
    outline: PostingOutline,
): number | null {
    if (!wedge || wedge.unit !== "deg" || !(wedge.value != null && wedge.value > 0)) return null;
    const deg = zone === "full" ? wedge.value : clampPostingDegrees(zone, wedge.value);
    if (!(deg > 0)) return null;
    const u = zone === "forefoot" ? FOREFOOT_POST_U : REARFOOT_POST_U;
    return postingRiseMm(deg, codeOutlineWidthMm(u, outline));
}
