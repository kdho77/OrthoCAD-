// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { shippedSampleTopPattern } from "@/lib/geometry/procedural-wall/shipped-pattern";
import { type ShoeWidthId, shoeWidthScaleAtU } from "@/lib/geometry/shoe-width";

/**
 * Station degree posting → millimetres, once per zone.
 *
 * This path is used only when a wedge's `degreeMode` is `"station"`.
 * Older degree inputs keep the per-u local-width angle in `wedge.ts`.
 *
 * h = W · tan(θ). W is the full medial-to-lateral chord of the bottom
 * outline, perpendicular to the long axis, for the chosen size, shoe width,
 * and side. It is never taken from a size table and never from the shell's
 * half-width factor.
 *
 * Rearfoot uses the heel station (u = 0.15). The forefoot wedge has no single
 * met-head station, so forefoot uses the widest bottom-outline chord between
 * u 0.62 and 0.75 (full high-edge height). The two zones are converted
 * separately and are never added as angles. θ is the final frontal-plane
 * post: varus raises the medial edge, valgus the lateral edge. Rearfoot
 * motion allowance is not part of θ, and θ is never taken from scan tilt.
 *
 * The geometry keeps this h unrounded. A 0° input is an exact no-op.
 */

/** Heel station. Rearfoot is at full height here. */
export const REARFOOT_POST_U = 0.15;
/**
 * Forefoot search window. The wedge is at full height across this band
 * (the fade ends at u = 0.58). The station is the widest chord inside it,
 * not a fixed u.
 */
export const FOREFOOT_STATION_U0 = 0.62;
export const FOREFOOT_STATION_U1 = 0.75;

export const REARFOOT_POST_DEG_MIN = 0;
export const REARFOOT_POST_DEG_MAX = 8;
export const FOREFOOT_POST_DEG_MIN = 0;
export const FOREFOOT_POST_DEG_MAX = 10;
/** Soft warning. Station-mode inputs above this are still allowed up to the zone max. */
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
    shoeWidth?: PostingShoeWidth | null;
}

interface OutlinePoint {
    x: number;
    y: number;
}

interface NativeBottom {
    minX: number;
    length: number;
    yMid: number;
    width: number;
    points: OutlinePoint[];
}

let nativeBottom: NativeBottom | null = null;

function nativeBottomOutline(): NativeBottom {
    if (nativeBottom) return nativeBottom;
    const points = shippedSampleTopPattern().map((p) => ({ x: p.x, y: p.y }));
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    nativeBottom = {
        minX,
        length: Math.max(1e-6, maxX - minX),
        yMid: (minY + maxY) / 2,
        width: Math.max(1e-6, maxY - minY),
        points,
    };
    return nativeBottom;
}

/** Bottom outline scaled to this size and shoe width. Y span is the full chord. */
export function sizedBottomOutline(outline: PostingOutline): OutlinePoint[] {
    const native = nativeBottomOutline();
    const sx = outline.lengthMm / native.length;
    const sy = outline.widthMm / native.width;
    const shoe = outline.shoeWidth;
    const scaleY = (u: number) => {
        if (!shoe || shoe.id === "medium") return sy;
        const ball = shoe.ballWidthMm ?? outline.widthMm;
        const heel = shoe.heelWidthMm ?? ball * HEEL_WIDTH_OF_BALL;
        return sy * shoeWidthScaleAtU(u, ball, heel, shoe.id);
    };
    return native.points.map((p) => {
        const u = (p.x - native.minX) / native.length;
        return { x: (p.x - native.minX) * sx, y: (p.y - native.yMid) * scaleY(u) };
    });
}

/** Full medial-to-lateral chord (mm) of a closed outline at normalized station `u`. */
export function outlineChordMm(points: ReadonlyArray<OutlinePoint>, u: number, lengthMm: number): number {
    if (!(lengthMm > 0) || points.length < 2) return 0;
    const x = u * lengthMm;
    const ys: number[] = [];
    const n = points.length;
    for (let i = 0; i < n; i++) {
        const a = points[i]!;
        const b = points[(i + 1) % n]!;
        const dx = b.x - a.x;
        if (Math.abs(dx) < 1e-9) {
            if (Math.abs(a.x - x) <= 1e-4) ys.push(a.y, b.y);
            continue;
        }
        const t = (x - a.x) / dx;
        if (t < -1e-6 || t > 1 + 1e-6) continue;
        ys.push(a.y + t * (b.y - a.y));
    }
    if (ys.length < 2) return 0;
    let min = Infinity;
    let max = -Infinity;
    for (const y of ys) {
        if (y < min) min = y;
        if (y > max) max = y;
    }
    return max - min;
}

/** Full bottom-outline chord at `u`. */
export function bottomOutlineChordMm(u: number, outline: PostingOutline): number {
    return outlineChordMm(sizedBottomOutline(outline), u, outline.lengthMm);
}

/**
 * Forefoot station: widest full chord on [0.62, 0.75].
 * The wedge defines a full-height plateau, not one met-head u.
 */
export function forefootPostStationU(outline: PostingOutline): number {
    const points = sizedBottomOutline(outline);
    let bestU = FOREFOOT_STATION_U0;
    let bestW = -1;
    const steps = Math.round((FOREFOOT_STATION_U1 - FOREFOOT_STATION_U0) / 0.001);
    for (let i = 0; i <= steps; i++) {
        const u = FOREFOOT_STATION_U0 + (i / steps) * (FOREFOOT_STATION_U1 - FOREFOOT_STATION_U0);
        const w = outlineChordMm(points, u, outline.lengthMm);
        if (w > bestW) {
            bestW = w;
            bestU = u;
        }
    }
    return bestU;
}

export function postingStationU(zone: PostingZone, outline: PostingOutline): number {
    return zone === "rearfoot" ? REARFOOT_POST_U : forefootPostStationU(outline);
}

/** Clamp a station-mode degree entry. 0 stays 0. Non-finite becomes 0. */
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
 * Full medial-to-lateral chord (mm) at the zone station.
 */
export function codeOutlineWidthMm(zone: PostingZone, outline: PostingOutline): number {
    return bottomOutlineChordMm(postingStationU(zone, outline), outline);
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

const riseCache = new Map<string, number>();

/** One conversion for a zone: clamp θ, measure W at that zone's station, h = W·tanθ. */
export function postingMmAtStation(zone: PostingZone, deg: number, outline: PostingOutline): number {
    const clamped = clampPostingDegrees(zone, deg);
    if (clamped === 0) return 0;
    const shoe = outline.shoeWidth;
    const key = [
        zone,
        clamped,
        outline.lengthMm,
        outline.widthMm,
        shoe?.id ?? "",
        shoe?.ballWidthMm ?? "",
        shoe?.heelWidthMm ?? "",
    ].join("|");
    const hit = riseCache.get(key);
    if (hit !== undefined) return hit;
    const rise = postingRiseMm(clamped, codeOutlineWidthMm(zone, outline));
    riseCache.set(key, rise);
    return rise;
}

/** Varus raises medial. Valgus raises lateral. */
export function postingEdgeForAngle(kind: "varus" | "valgus"): "medial" | "lateral" {
    return kind === "varus" ? "medial" : "lateral";
}

/** Display only. Geometry uses {@link postingRiseMm} unrounded. */
export function formatPostingDegreesMm(deg: number, mm: number, place?: string): string {
    const value = `${deg.toFixed(1)}°`;
    const mmText = `${mm.toFixed(1)} mm`;
    return place ? `${value} at ${place} = ${mmText}` : `${value} = ${mmText}`;
}

/** What the regional degrees toggle writes. Station mode is the new UI path. */
export function wedgeFromUiEntry(
    edge: "medial" | "lateral",
    value: number,
    unit: "mm" | "deg",
    stationDegrees = false,
): { side: "medial" | "lateral"; value: number; unit: "mm" | "deg"; degreeMode?: "station" } | undefined {
    if (value <= 0) return undefined;
    if (unit === "deg" && stationDegrees) return { side: edge, value, unit, degreeMode: "station" };
    return { side: edge, value, unit };
}

function stationDegrees(
    zone: PostingZone | "full",
    wedge: { value?: number; unit?: "mm" | "deg"; degreeMode?: "local" | "station" } | null | undefined,
): number | undefined {
    if (!wedge || wedge.unit !== "deg" || !(wedge.value != null && wedge.value > 0)) return undefined;
    if (zone !== "full" && wedge.degreeMode !== "station") return undefined;
    const deg = zone === "full" ? wedge.value : clampPostingDegrees(zone, wedge.value);
    return deg > 0 ? deg : undefined;
}

export function postingEquivalenceLabel(
    zone: PostingZone | "full",
    wedge: { value?: number; unit?: "mm" | "deg"; degreeMode?: "local" | "station" } | null | undefined,
    outline: PostingOutline,
): string | undefined {
    const deg = stationDegrees(zone, wedge);
    if (deg === undefined) return undefined;
    const postingZone: PostingZone = zone === "forefoot" ? "forefoot" : "rearfoot";
    const u = zone === "full" ? REARFOOT_POST_U : postingStationU(postingZone, outline);
    const place = zone === "forefoot" ? "met-head width" : undefined;
    return formatPostingDegreesMm(deg, postingRiseMm(deg, bottomOutlineChordMm(u, outline)), place);
}

/**
 * Millimetres the max-rise warning reads for one foot.
 * Legacy degree entries (no station flag) contribute 0 here; their angle warning is separate.
 */
export function stationPostingRiseMm(
    corrections: {
        rearfootWedge?: { value?: number; unit?: "mm" | "deg"; degreeMode?: "local" | "station" } | null;
        forefootWedge?: { value?: number; unit?: "mm" | "deg"; degreeMode?: "local" | "station" } | null;
    },
    outline: PostingOutline,
): number {
    return Math.max(
        convertedPostingMm("rearfoot", corrections.rearfootWedge, outline) ?? 0,
        convertedPostingMm("forefoot", corrections.forefootWedge, outline) ?? 0,
    );
}

/** Unrounded millimetres for a station-mode degree entry, or null otherwise. */
export function convertedPostingMm(
    zone: PostingZone | "full",
    wedge: { value?: number; unit?: "mm" | "deg"; degreeMode?: "local" | "station" } | null | undefined,
    outline: PostingOutline,
): number | null {
    const deg = stationDegrees(zone, wedge);
    if (deg === undefined) return null;
    const postingZone: PostingZone = zone === "forefoot" ? "forefoot" : "rearfoot";
    const u = zone === "full" ? REARFOOT_POST_U : postingStationU(postingZone, outline);
    return postingRiseMm(deg, bottomOutlineChordMm(u, outline));
}
