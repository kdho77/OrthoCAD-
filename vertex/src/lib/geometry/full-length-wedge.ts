// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Side, SideCorrections } from "@/types";

/**
 * Full-length wedge: a ruled posting on the real top rim.
 * Separate from the regional rearfoot / forefoot wedges (those stay in wedge.ts).
 *
 * dz = max(0, s · (y − yLow(u))) · tan(θ), with s toward the high edge.
 * Millimetres are the rise at the heel high edge (u = 0.15): θ = atan(mm / W(0.15)).
 * Omitted / non-finite amount → 3.0 mm, side lateral. Value 0 → off (byte-identical).
 *
 * HEEL_CUP_REF = "low": cup height is measured above the low-side heel surface
 * (the unposted side of the foot). The ruled dz still lifts the high rim, so the
 * high side's outside height grows by the rise while cup height above that heel
 * stays the shell's no-wedge value on both walls.
 */

export const HEEL_CUP_REF = "low" as "low" | "high" | "mean";

export const FULL_LENGTH_STATION_COUNT = 200;
export const FULL_LENGTH_HEEL_U = 0.15;
export const FULL_LENGTH_DEFAULT_RISE_MM = 3;
export const FULL_LENGTH_DEFAULT_SIDE = "lateral" as const;
export const FULL_LENGTH_SIGMA_U = 0.02;
export const FULL_LENGTH_FREEZE_U = 0.02;
export const FULL_LENGTH_DEG_MIN = 1;
export const FULL_LENGTH_DEG_MAX = 10;

const DEG = Math.PI / 180;

export interface RimXY {
    x: number;
    y: number;
}

export interface FullLengthWedgeInput {
    side?: "medial" | "lateral";
    /** Omitted or non-finite → {@link FULL_LENGTH_DEFAULT_RISE_MM}. 0 → off. */
    value?: number;
    unit?: "mm" | "deg";
}

export interface WedgeStationFrame {
    originX: number;
    lengthMm: number;
    /** +Y in this frame is medial. */
    medialPositiveY: boolean;
    /** False for an unordered point cloud (top-sheet samples). */
    ordered?: boolean;
}

export interface WedgeStations {
    n: number;
    yLow: Float64Array;
    yHigh: Float64Array;
    W: Float64Array;
    covered: Uint8Array;
    theta: number;
    highPositiveY: boolean;
    originX: number;
    lengthMm: number;
    maxRiseMm: number;
    maxRiseU: number;
}

export interface FullLengthRimFrame extends WedgeStationFrame {
    points: ReadonlyArray<RimXY>;
    /** When set, query y = vSigned * yScale (bbox half-width in this frame). */
    yScale?: number;
}

type CacheEntry = { sig: string; stations: WedgeStations | null };

const rimCache = new WeakMap<object, CacheEntry>();
const fallbackCache = new Map<string, WedgeStations | null>();
let loggedOutlineFallback = false;

export function clearFullLengthWedgeCache(): void {
    fallbackCache.clear();
    loggedOutlineFallback = false;
}

export function fullLengthWedgeActive(
    c: { fullLengthWedge?: FullLengthWedgeInput | null } | null | undefined,
): boolean {
    const w = c?.fullLengthWedge;
    if (!w) return false;
    if (w.value == null || !Number.isFinite(w.value)) return true;
    return w.value > 0;
}

export function fullLengthDegFromMm(mm: number, widthMm: number): number {
    if (!(widthMm > 1e-9) || !Number.isFinite(mm)) return 0;
    return (Math.atan(mm / widthMm) * 180) / Math.PI;
}

export function fullLengthMmFromDeg(deg: number, widthMm: number): number {
    if (!Number.isFinite(deg) || !Number.isFinite(widthMm)) return 0;
    return widthMm * Math.tan(deg * DEG);
}

/** Which heel-surface rise the cup height is referenced to. */
export function heelCupReferenceRise(riseLow: number, riseHigh: number): number {
    if (HEEL_CUP_REF === "high") return riseHigh;
    if (HEEL_CUP_REF === "mean") return 0.5 * (riseLow + riseHigh);
    return riseLow;
}

/**
 * Cup height (mm) above the reference heel surface after the ruled posting is
 * removed. With HEEL_CUP_REF "low", pass the low-side heel as the reference.
 */
export function cupHeightAboveHeelMm(
    zRim: number,
    riseAtRim: number,
    zHeel: number,
    riseAtHeel: number,
): number {
    return zRim - riseAtRim - (zHeel - riseAtHeel);
}

export function fallbackRimXY(lengthMm: number, halfWidthMmAt: (u: number) => number, samples = 64): RimXY[] {
    const pts: RimXY[] = [];
    const n = Math.max(4, samples);
    for (let i = 0; i <= n; i++) {
        const u = i / n;
        pts.push({ x: u * lengthMm, y: halfWidthMmAt(u) });
    }
    for (let i = n; i >= 0; i--) {
        const u = i / n;
        pts.push({ x: u * lengthMm, y: -halfWidthMmAt(u) });
    }
    return pts;
}

function resolveRequest(
    corr: FullLengthWedgeInput | null | undefined,
): { side: "medial" | "lateral"; unit: "mm" | "deg"; amount: number } | null {
    if (!corr) return null;
    const side = corr.side === "medial" ? "medial" : "lateral";
    if (corr.value == null || !Number.isFinite(corr.value)) {
        return { side, unit: "mm", amount: FULL_LENGTH_DEFAULT_RISE_MM };
    }
    if (!(corr.value > 0)) return null;
    return { side, unit: corr.unit === "deg" ? "deg" : "mm", amount: corr.value };
}

function clampTheta(theta: number): number {
    if (!(theta > 0) || !Number.isFinite(theta)) return 0;
    return Math.min(FULL_LENGTH_DEG_MAX * DEG, Math.max(FULL_LENGTH_DEG_MIN * DEG, theta));
}

function smoothSeries(raw: Float64Array, covered: Uint8Array): Float64Array {
    const n = raw.length;
    const du = 1 / (n - 1);
    const sigmaBins = FULL_LENGTH_SIGMA_U / du;
    const radius = Math.max(1, Math.ceil(3 * sigmaBins));
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        if (!covered[i] || u < FULL_LENGTH_FREEZE_U || u > 1 - FULL_LENGTH_FREEZE_U) {
            out[i] = raw[i]!;
            continue;
        }
        let acc = 0;
        let wsum = 0;
        for (let k = -radius; k <= radius; k++) {
            const j = i + k;
            if (j < 0 || j >= n || !covered[j]) continue;
            const w = Math.exp(-0.5 * (k / sigmaBins) ** 2);
            acc += w * raw[j]!;
            wsum += w;
        }
        out[i] = wsum > 0 ? acc / wsum : raw[i]!;
    }
    return out;
}

function sampleSeries(arr: Float64Array, u: number): number {
    const n = arr.length;
    const x = Math.max(0, Math.min(1, u)) * (n - 1);
    const i0 = Math.floor(x);
    const i1 = Math.min(n - 1, i0 + 1);
    const t = x - i0;
    return arr[i0]! * (1 - t) + arr[i1]! * t;
}

function sigOf(corr: FullLengthWedgeInput | null | undefined, frame: WedgeStationFrame): string {
    const c = corr ?? {};
    return `${c.side ?? ""}|${c.value ?? "na"}|${c.unit ?? ""}|${frame.originX}|${frame.lengthMm}|${frame.medialPositiveY ? 1 : 0}|${frame.ordered === false ? 0 : 1}`;
}

/**
 * N = 200 u-stations on the rim. yLow / W are Gaussian-smoothed (σ = 0.02 u);
 * ends u < 0.02 and u > 0.98 stay raw. Smoothed yLow is clamped so it never
 * sits inside the real rim.
 */
export function buildWedgeStations(
    rimXY: ReadonlyArray<RimXY> | null | undefined,
    _side: Side,
    corr: FullLengthWedgeInput | null | undefined,
    frame: WedgeStationFrame,
): WedgeStations | null {
    const request = resolveRequest(corr);
    if (!request || !(frame.lengthMm > 1e-6) || !rimXY || rimXY.length < 2) return null;

    const cacheKey = rimXY as object;
    const sig = sigOf(corr, frame);
    const cached = rimCache.get(cacheKey);
    if (cached && cached.sig === sig) return cached.stations;

    const n = FULL_LENGTH_STATION_COUNT;
    const yMin = new Float64Array(n);
    const yMax = new Float64Array(n);
    yMin.fill(Number.POSITIVE_INFINITY);
    yMax.fill(Number.NEGATIVE_INFINITY);
    const hit = new Uint8Array(n);
    const lengthMm = frame.lengthMm;
    const originX = frame.originX;

    const mark = (u: number, y: number) => {
        if (u < -1e-4 || u > 1 + 1e-4 || !Number.isFinite(y)) return;
        const idx = Math.max(0, Math.min(n - 1, Math.round(u * (n - 1))));
        if (y < yMin[idx]!) yMin[idx] = y;
        if (y > yMax[idx]!) yMax[idx] = y;
        hit[idx] = 1;
    };

    for (const p of rimXY) mark((p.x - originX) / lengthMm, p.y);

    const ordered = frame.ordered !== false;
    if (ordered) {
        const last = rimXY.length - 1;
        const close = Math.hypot(rimXY[0]!.x - rimXY[last]!.x, rimXY[0]!.y - rimXY[last]!.y) <= 2;
        const edges = close ? rimXY.length : rimXY.length - 1;
        for (let e = 0; e < edges; e++) {
            const a = rimXY[e]!;
            const b = rimXY[(e + 1) % rimXY.length]!;
            const u0 = (a.x - originX) / lengthMm;
            const u1 = (b.x - originX) / lengthMm;
            if (Math.abs(u1 - u0) < 1e-12) {
                mark(u0, a.y);
                mark(u0, b.y);
                continue;
            }
            const lo = Math.max(0, Math.ceil(Math.min(u0, u1) * (n - 1) - 1e-9));
            const hi = Math.min(n - 1, Math.floor(Math.max(u0, u1) * (n - 1) + 1e-9));
            for (let i = lo; i <= hi; i++) {
                const u = i / (n - 1);
                const t = (u - u0) / (u1 - u0);
                if (t < -1e-4 || t > 1 + 1e-4) continue;
                mark(u, a.y + t * (b.y - a.y));
            }
        }
    }

    let first = -1;
    let lastHit = -1;
    for (let i = 0; i < n; i++) {
        if (!hit[i]) continue;
        if (first < 0) first = i;
        lastHit = i;
    }
    if (first < 0) {
        rimCache.set(cacheKey, { sig, stations: null });
        return null;
    }
    for (let i = first + 1; i < lastHit; i++) {
        if (hit[i]) continue;
        let p = i - 1;
        let q = i + 1;
        while (p > first && !hit[p]) p--;
        while (q < lastHit && !hit[q]) q++;
        if (!hit[p] || !hit[q] || q === p) continue;
        const t = (i - p) / (q - p);
        yMin[i] = yMin[p]! * (1 - t) + yMin[q]! * t;
        yMax[i] = yMax[p]! * (1 - t) + yMax[q]! * t;
        hit[i] = 1;
    }

    const highPositiveY = request.side === "medial" ? frame.medialPositiveY : !frame.medialPositiveY;
    const rawLow = new Float64Array(n);
    const rawW = new Float64Array(n);
    const covered = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        if (!hit[i] || !(yMax[i]! > yMin[i]! + 1e-6)) continue;
        covered[i] = 1;
        rawLow[i] = highPositiveY ? yMin[i]! : yMax[i]!;
        rawW[i] = yMax[i]! - yMin[i]!;
    }

    const yLow = smoothSeries(rawLow, covered);
    const W = smoothSeries(rawW, covered);
    const yHigh = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        if (!covered[i]) continue;
        if (highPositiveY) {
            if (yLow[i]! > rawLow[i]!) yLow[i] = rawLow[i]!;
        } else if (yLow[i]! < rawLow[i]!) yLow[i] = rawLow[i]!;
        yHigh[i] = highPositiveY ? yLow[i]! + W[i]! : yLow[i]! - W[i]!;
    }

    const wHeel = Math.max(1e-6, sampleSeries(W, FULL_LENGTH_HEEL_U));
    const theta =
        request.unit === "mm"
            ? clampTheta(Math.atan(request.amount / wHeel))
            : clampTheta(request.amount * DEG);
    const tanT = Math.tan(theta);
    let maxRiseMm = 0;
    let maxRiseU = FULL_LENGTH_HEEL_U;
    for (let i = 0; i < n; i++) {
        if (!covered[i]) continue;
        const rise = W[i]! * tanT;
        if (rise > maxRiseMm) {
            maxRiseMm = rise;
            maxRiseU = i / (n - 1);
        }
    }

    const stations: WedgeStations = {
        n,
        yLow,
        yHigh,
        W,
        covered,
        theta,
        highPositiveY,
        originX,
        lengthMm,
        maxRiseMm,
        maxRiseU,
    };
    rimCache.set(cacheKey, { sig, stations });
    return stations;
}

export function highEdgeRiseAt(stations: WedgeStations | null, u: number): number {
    if (!stations) return 0;
    const n = stations.n;
    const x = Math.max(0, Math.min(1, u)) * (n - 1);
    const i0 = Math.floor(x);
    const i1 = Math.min(n - 1, i0 + 1);
    if (!stations.covered[i0] && !stations.covered[i1]) return 0;
    return sampleSeries(stations.W, u) * Math.tan(stations.theta);
}

/** Longitudinal window that eases onto the forefoot plan-shift hold. */
export const FULL_LENGTH_TOE_FAIR_SPAN = 0.08;
/**
 * Finish the ease this far before the hold. The toe corner sits just upstream
 * of the hold; it has to already be frozen or the short wall pleats there.
 */
export const FULL_LENGTH_TOE_FAIR_LEAD = 0.04;

/**
 * Ease u onto a held station. Identity before the window, the hold value from
 * the lead point onward, C1 at both ends.
 */
export function fullLengthToeSampleU(u: number, holdU: number): number {
    const span = FULL_LENGTH_TOE_FAIR_SPAN;
    const u1 = holdU - FULL_LENGTH_TOE_FAIR_LEAD;
    const u0 = u1 - span;
    if (!(span > 0) || u <= u0) return u;
    if (u >= u1) return holdU;
    const t = (u - u0) / (u1 - u0);
    const h00 = (2 * t - 3) * t * t + 1;
    const h10 = (t - 2) * t * t + t;
    const h01 = (-2 * t + 3) * t * t;
    return h00 * u0 + h10 * (u1 - u0) + h01 * holdU;
}

export function fullLengthWedgeDeltaAt(
    x: number,
    y: number,
    stations: WedgeStations | null,
    toeHoldU?: number,
): number {
    if (!stations || !(stations.lengthMm > 1e-9)) return 0;
    let u = (x - stations.originX) / stations.lengthMm;
    if (u < -1e-4 || u > 1 + 1e-4) return 0;
    // Ease the ruled station onto the hold ahead of the toe corner. A live
    // yLow through that corner tilts the rim against the held plan shift.
    if (toeHoldU != null) u = fullLengthToeSampleU(u, toeHoldU);
    const n = stations.n;
    const fx = Math.max(0, Math.min(1, u)) * (n - 1);
    const i0 = Math.floor(fx);
    const i1 = Math.min(n - 1, i0 + 1);
    if (!stations.covered[i0] || !stations.covered[i1]) return 0;
    const yLow = sampleSeries(stations.yLow, u);
    const s = stations.highPositiveY ? 1 : -1;
    return Math.max(0, s * (y - yLow)) * Math.tan(stations.theta);
}

export interface FullLengthFieldQuery {
    side: Side;
    lengthMm: number;
    widthMm: number;
    corrections: SideCorrections;
    fullLengthRim?: FullLengthRimFrame | null;
    /**
     * Ease the ruled stations onto this u ahead of the toe corner.
     * Set only with a forefoot plan shift that holds the same station.
     * Absent → the toe follows the live rim, and width-free exports stay put.
     */
    fullLengthToeHoldU?: number;
}

/** Additive full-length dz (mm). 0 when the wedge is off — callers must skip it for byte identity. */
export function fullLengthDeltaFromField(
    u: number,
    vSigned: number,
    field: FullLengthFieldQuery,
    halfWidthMmAt?: (u: number) => number,
): number {
    if (!fullLengthWedgeActive(field.corrections)) return 0;
    const corr = field.corrections.fullLengthWedge;
    const rim = field.fullLengthRim;
    const lengthMm = rim?.lengthMm ?? field.lengthMm;
    const originX = rim?.originX ?? 0;
    const medialPositiveY = rim?.medialPositiveY ?? field.side === "left";
    const frame: WedgeStationFrame = {
        originX,
        lengthMm,
        medialPositiveY,
        ordered: rim?.ordered,
    };

    let points = rim?.points;
    let stations: WedgeStations | null = null;
    if (points && points.length >= 4) {
        stations = buildWedgeStations(points, field.side, corr, frame);
    } else if (halfWidthMmAt) {
        const key = [
            field.side,
            corr?.side ?? "",
            corr?.value ?? "na",
            corr?.unit ?? "",
            lengthMm.toFixed(3),
            field.widthMm.toFixed(3),
            medialPositiveY ? 1 : 0,
            halfWidthMmAt(0.15).toFixed(3),
            halfWidthMmAt(0.5).toFixed(3),
            halfWidthMmAt(0.9).toFixed(3),
        ].join("|");
        const hit = fallbackCache.get(key);
        if (hit !== undefined) {
            stations = hit;
        } else {
            if (!loggedOutlineFallback) {
                loggedOutlineFallback = true;
                console.warn("[full-length-wedge] no real rim; using effectiveOutlineHalfWidth fallback");
            }
            points = fallbackRimXY(lengthMm, halfWidthMmAt);
            stations = buildWedgeStations(points, field.side, corr, { ...frame, ordered: true });
            fallbackCache.set(key, stations);
            if (fallbackCache.size > 24) {
                const oldest = fallbackCache.keys().next().value;
                if (oldest !== undefined) fallbackCache.delete(oldest);
            }
        }
    }
    if (!stations) return 0;
    const y = rim?.yScale != null ? vSigned * rim.yScale : vSigned * (halfWidthMmAt ? halfWidthMmAt(u) : 0);
    const x = originX + u * lengthMm;
    return fullLengthWedgeDeltaAt(x, y, stations, field.fullLengthToeHoldU);
}
