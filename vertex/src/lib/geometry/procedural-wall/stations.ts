// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    fitClosedC2Spline,
    type PolyPoint,
    polylineArcLengths,
    resampleClosedC2,
    sampleClosedAtArc01,
} from "./curves";
import { outwardNormal } from "./measure";

/** ±25° applies only to per-station deviation from the region default. */
export const FLARE_DEV_CAP_DEG = 25;
/** Smooth flare along the outline: ≤5° change per 5 mm. */
export const FLARE_SMOOTH_DEG_PER_5MM = 5;
export const CROSSING_WINDOW = 20;
export const SKEW_LIMIT_MM = 2;

export interface RayHit {
    point: PolyPoint;
    t: number;
    s01: number;
    dir: 1 | -1;
}

export interface FlareCapReport {
    /** Stations where the ±25° deviation cap changed the value. */
    cappedStations: number[];
    maxDeviationDeg: number;
    negativeClamped: number;
    /** True when a station still needed the cap after smoothing. */
    stillNeeded: boolean;
}

export interface StationPairing {
    plantar: PolyPoint[];
    top: PolyPoint[];
    normals: Array<{ x: number; y: number }>;
    s01: number[];
    sidewaysSkewMm: number[];
    maxSkewMm: number;
    chordCrossings: number;
    missedRays: number;
    monotonic: boolean;
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

function smoothNormals(ns: Array<{ x: number; y: number }>, passes = 3): Array<{ x: number; y: number }> {
    let cur = ns.map((n) => ({ ...n }));
    for (let p = 0; p < passes; p++) {
        const next = cur.map((n, i) => {
            const a = cur[(i + cur.length - 1) % cur.length]!;
            const c = cur[(i + 1) % cur.length]!;
            const x = n.x * 0.5 + (a.x + c.x) * 0.25;
            const y = n.y * 0.5 + (a.y + c.y) * 0.25;
            const len = Math.hypot(x, y) || 1;
            return { x: x / len, y: y / len };
        });
        cur = next;
    }
    return cur;
}

/** 2D ray (origin + t·dir, t>0) vs segment. */
export function raySegHit2D(
    ox: number,
    oy: number,
    dx: number,
    dy: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
): { t: number; u: number } | null {
    const ex = bx - ax;
    const ey = by - ay;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) return null;
    const rx = ax - ox;
    const ry = ay - oy;
    const t = (rx * ey - ry * ex) / den;
    const u = (rx * dy - ry * dx) / den;
    if (t > 1e-6 && u >= -1e-6 && u <= 1 + 1e-6) return { t, u };
    return null;
}

export function nearestRayHitOnLoop(
    origin: PolyPoint,
    n: { x: number; y: number },
    loop: PolyPoint[],
    sign: 1 | -1,
): RayHit | null {
    if (loop.length < 2) return null;
    const { cum, total } = polylineArcLengths(loop);
    const denom = Math.max(total, 1e-12);
    const dx = n.x * sign;
    const dy = n.y * sign;
    let best: RayHit | null = null;
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        const hit = raySegHit2D(origin.x, origin.y, dx, dy, a.x, a.y, b.x, b.y);
        if (!hit) continue;
        if (best && hit.t >= best.t) continue;
        const seg = cum[i + 1]! - cum[i]!;
        const s01 = (cum[i]! + hit.u * seg) / denom;
        const z = a.z + (b.z - a.z) * hit.u;
        best = {
            point: {
                x: origin.x + dx * hit.t,
                y: origin.y + dy * hit.t,
                z,
            },
            t: hit.t,
            s01: ((s01 % 1) + 1) % 1,
            dir: sign,
        };
    }
    return best;
}

/**
 * Unwrap closed-loop s01 so the sequence is strictly increasing, wrapping
 * at most once. Returns null when the hits fold back on themselves.
 */
export function unwrapStrictlyIncreasing(s01: number[]): { unwrapped: number[]; ok: boolean } {
    const n = s01.length;
    if (n === 0) return { unwrapped: [], ok: true };
    const out = new Array<number>(n);
    out[0] = s01[0]!;
    for (let i = 1; i < n; i++) {
        let s = s01[i]!;
        const prev = out[i - 1]!;
        while (s <= prev) s += 1;
        while (s > prev + 1) s -= 1;
        out[i] = s;
    }
    const advance = out[n - 1]! - out[0]!;
    const ok = advance > 0.45 && advance < 1.55;
    for (let i = 1; i < n; i++) {
        if (out[i]! <= out[i - 1]!) return { unwrapped: out, ok: false };
    }
    return { unwrapped: out, ok };
}

function fillMissingS(s: Array<number | null>): number[] {
    const n = s.length;
    const out = new Array<number>(n);
    let last = 0;
    let lastI = -1;
    for (let i = 0; i < n; i++) {
        if (s[i] != null) {
            last = s[i]!;
            lastI = i;
            out[i] = last;
        }
    }
    if (lastI < 0) {
        for (let i = 0; i < n; i++) out[i] = i / n;
        return out;
    }
    for (let i = 0; i < n; i++) {
        if (s[i] != null) {
            out[i] = s[i]!;
            continue;
        }
        let nextI = -1;
        for (let k = 1; k <= n; k++) {
            const j = (i + k) % n;
            if (s[j] != null) {
                nextI = j;
                break;
            }
        }
        let prevI = -1;
        for (let k = 1; k <= n; k++) {
            const j = (i - k + n) % n;
            if (s[j] != null) {
                prevI = j;
                break;
            }
        }
        if (prevI < 0 || nextI < 0) {
            out[i] = i / n;
            continue;
        }
        const span = (nextI - prevI + n) % n || n;
        const step = (i - prevI + n) % n;
        const a = s[prevI]!;
        let b = s[nextI]!;
        if (b < a) b += 1;
        out[i] = (((a + ((b - a) * step) / span) % 1) + 1) % 1;
    }
    return out;
}

export function segmentsCrossXY(p0: PolyPoint, p1: PolyPoint, q0: PolyPoint, q1: PolyPoint): boolean {
    const dax = p1.x - p0.x;
    const day = p1.y - p0.y;
    const dbx = q1.x - q0.x;
    const dby = q1.y - q0.y;
    const den = dax * dby - day * dbx;
    if (Math.abs(den) < 1e-12) return false;
    const dx = q0.x - p0.x;
    const dy = q0.y - p0.y;
    const t = (dx * dby - dy * dbx) / den;
    const u = (dx * day - dy * dax) / den;
    return t > 1e-4 && t < 1 - 1e-4 && u > 1e-4 && u < 1 - 1e-4;
}

/** Plan-view column chords (plantar→top) crossing inside a ±window. */
export function countPlanViewChordCrossings(
    plantar: PolyPoint[],
    top: PolyPoint[],
    window = CROSSING_WINDOW,
): number {
    const n = Math.min(plantar.length, top.length);
    if (n < 2) return 0;
    let hits = 0;
    for (let i = 0; i < n; i++) {
        for (let k = 1; k <= window; k++) {
            const j = (i + k) % n;
            if (j === i) continue;
            if (k === 1 && n > 2 && (j === (i + 1) % n || i === (j + 1) % n)) {
                // Adjacent chords share the outline edge; only count if they
                // properly cross (not just meet at a vertex).
            }
            if (segmentsCrossXY(plantar[i]!, top[i]!, plantar[j]!, top[j]!)) hits++;
        }
    }
    return hits;
}

/** Sideways (perpendicular to plan-view n) column skew in mm. */
export function columnSidewaysSkewMm(
    plantar: PolyPoint[],
    top: PolyPoint[],
    normals: Array<{ x: number; y: number }>,
): number[] {
    const n = Math.min(plantar.length, top.length, normals.length);
    const out = new Array<number>(n);
    for (let i = 0; i < n; i++) {
        const dx = top[i]!.x - plantar[i]!.x;
        const dy = top[i]!.y - plantar[i]!.y;
        const nx = normals[i]!.x;
        const ny = normals[i]!.y;
        out[i] = Math.abs(dx * ny - dy * nx);
    }
    return out;
}

/**
 * C2 of the trimmed plantar boundary → N stations. Each column's top is the
 * nearest plan-view ray hit on the TopSheet rim along +n, falling back to −n.
 * Both loops are resampled to N; station index is strictly increasing.
 */
export function pairByOutwardRay(plantarLoop: PolyPoint[], topLoop: PolyPoint[], n: number): StationPairing {
    const plantar =
        n > 0 && plantarLoop.length === n
            ? plantarLoop.map((p) => ({ ...p }))
            : resampleClosedC2(fitClosedC2Spline(plantarLoop), n);
    const c = centroidOf(plantar);
    const rawN = plantar.map((_, i) => outwardNormal(plantar, i, c));
    const normals = smoothNormals(rawN);
    const rawS: Array<number | null> = [];
    let missed = 0;
    for (let i = 0; i < plantar.length; i++) {
        const pos = nearestRayHitOnLoop(plantar[i]!, normals[i]!, topLoop, 1);
        const neg = pos ? null : nearestRayHitOnLoop(plantar[i]!, normals[i]!, topLoop, -1);
        const hit = pos ?? neg;
        if (!hit) {
            rawS.push(null);
            missed++;
        } else {
            rawS.push(hit.s01);
        }
    }
    const filled = fillMissingS(rawS);
    const { unwrapped, ok } = unwrapStrictlyIncreasing(filled);
    const s01 = unwrapped.map((s) => ((s % 1) + 1) % 1);
    const top = s01.map((s) => sampleClosedAtArc01(topLoop, s));
    const sidewaysSkewMm = columnSidewaysSkewMm(plantar, top, normals);
    let maxSkewMm = 0;
    for (const d of sidewaysSkewMm) if (d > maxSkewMm) maxSkewMm = d;
    return {
        plantar,
        top,
        normals,
        s01,
        sidewaysSkewMm,
        maxSkewMm,
        chordCrossings: countPlanViewChordCrossings(plantar, top),
        missedRays: missed,
        monotonic: ok,
    };
}

function outlineStepMm(outline: PolyPoint[], i: number): number {
    const a = outline[i]!;
    const b = outline[(i + 1) % outline.length]!;
    return Math.max(1e-3, Math.hypot(b.x - a.x, b.y - a.y));
}

/**
 * Smooth flare along the outline (≤5° / 5 mm). The ±25° cap applies only to
 * per-station deviation from the region default and to negative-flare artefacts.
 * Region defaults (e.g. lateral midfoot 41°) are never overwritten by the cap.
 */
export function smoothAndCapFlare(
    outline: PolyPoint[],
    regionDefault: number[],
    desired?: number[],
): { flare: number[]; report: FlareCapReport } {
    const n = Math.min(outline.length, regionDefault.length);
    const src = desired && desired.length >= n ? desired : regionDefault;
    const flare = new Array<number>(n);
    for (let i = 0; i < n; i++) flare[i] = src[i]!;

    const maxPerMm = FLARE_SMOOTH_DEG_PER_5MM / 5;
    for (let pass = 0; pass < 8; pass++) {
        let moved = false;
        for (let i = 0; i < n; i++) {
            const ds = outlineStepMm(outline, i);
            const lim = maxPerMm * ds;
            const j = (i + 1) % n;
            const d = flare[j]! - flare[i]!;
            if (Math.abs(d) <= lim) continue;
            const adj = (Math.abs(d) - lim) * 0.5 * Math.sign(d);
            flare[i]! += adj;
            flare[j]! -= adj;
            moved = true;
        }
        if (!moved) break;
    }

    const cappedStations: number[] = [];
    let maxDeviationDeg = 0;
    let negativeClamped = 0;
    for (let i = 0; i < n; i++) {
        if (flare[i]! < 0) {
            flare[i] = 0;
            negativeClamped++;
        }
        const dev = flare[i]! - regionDefault[i]!;
        if (Math.abs(dev) > maxDeviationDeg) maxDeviationDeg = Math.abs(dev);
        if (Math.abs(dev) > FLARE_DEV_CAP_DEG + 1e-6) {
            flare[i] = regionDefault[i]! + Math.sign(dev) * FLARE_DEV_CAP_DEG;
            cappedStations.push(i);
        }
    }
    return {
        flare,
        report: {
            cappedStations,
            maxDeviationDeg,
            negativeClamped,
            stillNeeded: cappedStations.length > 0,
        },
    };
}

export function offsetClosedInward(poly: PolyPoint[], distMm: number): PolyPoint[] {
    if (poly.length < 3) return poly.map((p) => ({ ...p }));
    const c = centroidOf(poly);
    return poly.map((p, i) => {
        const n = outwardNormal(poly, i, c);
        return { x: p.x - n.x * distMm, y: p.y - n.y * distMm, z: p.z };
    });
}
