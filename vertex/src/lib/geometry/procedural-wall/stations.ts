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
    method?: "harmonic" | "outward-ray";
    masterMinRadiusMm?: number;
    waistMinRadiusMm?: number;
    maxSepMm?: number;
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

/** Plan-view column chords. `window` defaults to all pairs (BVH / grid). */
export function countPlanViewChordCrossings(
    plantar: PolyPoint[],
    top: PolyPoint[],
    window = Number.POSITIVE_INFINITY,
): number {
    const n = Math.min(plantar.length, top.length);
    if (n < 2) return 0;
    const segs: Array<{ i: number; minX: number; maxX: number; minY: number; maxY: number }> = [];
    for (let i = 0; i < n; i++) {
        const a = plantar[i]!;
        const b = top[i]!;
        segs.push({
            i,
            minX: Math.min(a.x, b.x),
            maxX: Math.max(a.x, b.x),
            minY: Math.min(a.y, b.y),
            maxY: Math.max(a.y, b.y),
        });
    }
    const cell = 4;
    const grid = new Map<string, number[]>();
    for (let s = 0; s < segs.length; s++) {
        const g = segs[s]!;
        const x0 = Math.floor(g.minX / cell);
        const x1 = Math.floor(g.maxX / cell);
        const y0 = Math.floor(g.minY / cell);
        const y1 = Math.floor(g.maxY / cell);
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const k = `${x},${y}`;
                let b = grid.get(k);
                if (!b) {
                    b = [];
                    grid.set(k, b);
                }
                b.push(s);
            }
        }
    }
    const seen = new Set<string>();
    let hits = 0;
    const maxK = Number.isFinite(window) ? Math.max(1, Math.floor(window)) : n;
    for (const list of grid.values()) {
        for (let a = 0; a < list.length; a++) {
            for (let b = a + 1; b < list.length; b++) {
                const i = list[a]!;
                const j = list[b]!;
                if (i === j) continue;
                const d = Math.min((j - i + n) % n, (i - j + n) % n);
                if (d === 0 || d > maxK) continue;
                const key = i < j ? `${i},${j}` : `${j},${i}`;
                if (seen.has(key)) continue;
                seen.add(key);
                const A = segs[i]!;
                const B = segs[j]!;
                if (A.maxX < B.minX || B.maxX < A.minX || A.maxY < B.minY || B.maxY < A.minY) continue;
                if (segmentsCrossXY(plantar[i]!, top[i]!, plantar[j]!, top[j]!)) hits++;
            }
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

function polylineCurvatureRadii(pts: PolyPoint[]): number[] {
    const n = pts.length;
    const out = new Array<number>(n).fill(Number.POSITIVE_INFINITY);
    for (let i = 0; i < n; i++) {
        const a = pts[(i + n - 1) % n]!;
        const b = pts[i]!;
        const c = pts[(i + 1) % n]!;
        const ab = Math.hypot(b.x - a.x, b.y - a.y);
        const bc = Math.hypot(c.x - b.x, c.y - b.y);
        const ca = Math.hypot(a.x - c.x, a.y - c.y);
        const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
        if (area2 < 1e-10 || ab < 1e-9 || bc < 1e-9) continue;
        out[i] = (ab * bc * ca) / (2 * area2);
    }
    return out;
}

export function masterCurveRadii(
    pts: PolyPoint[],
    bounds?: { minX: number; maxX: number },
): { minRadiusMm: number; waistMinRadiusMm: number } {
    const r = polylineCurvatureRadii(pts);
    let minR = Infinity;
    let waistR = Infinity;
    const minX = bounds?.minX ?? Math.min(...pts.map((p) => p.x));
    const length = Math.max(1e-3, (bounds?.maxX ?? Math.max(...pts.map((p) => p.x))) - minX);
    for (let i = 0; i < pts.length; i++) {
        const rr = r[i]!;
        if (rr < minR) minR = rr;
        const u = (pts[i]!.x - minX) / length;
        if (u >= 0.32 && u <= 0.68 && rr < waistR) waistR = rr;
    }
    return {
        minRadiusMm: Number.isFinite(minR) ? minR : 0,
        waistMinRadiusMm: Number.isFinite(waistR) ? waistR : 0,
    };
}

function smoothClosedXY(pts: PolyPoint[], passes: number): PolyPoint[] {
    let cur = pts.map((p) => ({ ...p }));
    for (let p = 0; p < passes; p++) {
        const next = cur.map((b, i) => {
            const a = cur[(i + cur.length - 1) % cur.length]!;
            const c = cur[(i + 1) % cur.length]!;
            return {
                x: b.x * 0.5 + (a.x + c.x) * 0.25,
                y: b.y * 0.5 + (a.y + c.y) * 0.25,
                z: b.z,
            };
        });
        cur = next;
    }
    return cur;
}

function nearestOnLoop(origin: PolyPoint, loop: PolyPoint[]): PolyPoint {
    let best = loop[0] ?? { x: origin.x, y: origin.y, z: origin.z };
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
            best = { x, y, z: a.z + (b.z - a.z) * t };
        }
    }
    return best;
}

/**
 * 0-skew seed: C2 of P, then the TopSheet hit along P's plan normal (+n then −n).
 * Midpoints of those pairs are the master-curve samples.
 */
function seedMidline(plantarLoop: PolyPoint[], topLoop: PolyPoint[], n: number): PolyPoint[] {
    const seed = pairByOutwardRay(plantarLoop, topLoop, n);
    const mid: PolyPoint[] = [];
    for (let i = 0; i < seed.plantar.length; i++) {
        const p = seed.plantar[i]!;
        const t = seed.top[i]!;
        mid.push({ x: (p.x + t.x) * 0.5, y: (p.y + t.y) * 0.5, z: (p.z + t.z) * 0.5 });
    }
    return mid;
}

function hitLoopFromMaster(
    origin: PolyPoint,
    n: { x: number; y: number },
    loop: PolyPoint[],
): { point: PolyPoint; missed: boolean } {
    const pos = nearestRayHitOnLoop(origin, n, loop, 1);
    const neg = nearestRayHitOnLoop(origin, n, loop, -1);
    if (pos && neg) return { point: pos.t <= neg.t ? pos.point : neg.point, missed: false };
    if (pos) return { point: pos.point, missed: false };
    if (neg) return { point: neg.point, missed: false };
    return { point: nearestOnLoop(origin, loop), missed: true };
}

/**
 * Harmonic correspondence via the signed-distance gradient to a C2 master
 * curve M (the cheaper accepted alternative). M is the 0-skew midline,
 * smoothed until min radius of curvature exceeds max |T−P|. Columns are
 * iso-psi (M arc-length) lines: from each M station, shoot both ways along
 * ∇d_M. Where T and P cross, the column is vertical. Both loops share N
 * strictly increasing stations.
 */
export function pairByHarmonic(plantarLoop: PolyPoint[], topLoop: PolyPoint[], n: number): StationPairing {
    const midSeed = seedMidline(plantarLoop, topLoop, n);
    let master = resampleClosedC2(fitClosedC2Spline(midSeed), n);
    let maxSep = 0;
    for (let i = 0; i < n; i++) {
        const p = nearestOnLoop(master[i]!, plantarLoop);
        const t = nearestOnLoop(master[i]!, topLoop);
        maxSep = Math.max(maxSep, Math.hypot(p.x - t.x, p.y - t.y));
    }
    const needR = Math.max(12, maxSep);
    for (let pass = 0; pass < 24; pass++) {
        const { minRadiusMm } = masterCurveRadii(master);
        if (minRadiusMm >= needR) break;
        master = resampleClosedC2(fitClosedC2Spline(smoothClosedXY(master, 2)), n);
    }
    const c = centroidOf(master);
    const normals = smoothNormals(
        master.map((_, i) => outwardNormal(master, i, c)),
        4,
    );
    const plantar: PolyPoint[] = [];
    const top: PolyPoint[] = [];
    let missed = 0;
    for (let i = 0; i < n; i++) {
        const m = master[i]!;
        const nxy = normals[i]!;
        const pHit = hitLoopFromMaster(m, nxy, plantarLoop);
        const tHit = hitLoopFromMaster(m, nxy, topLoop);
        const cross =
            Math.hypot(pHit.point.x - tHit.point.x, pHit.point.y - tHit.point.y) < 0.15 ||
            Math.hypot(pHit.point.x - m.x, pHit.point.y - m.y) +
                Math.hypot(tHit.point.x - m.x, tHit.point.y - m.y) <
                0.3;
        if (cross) {
            plantar.push({ x: m.x, y: m.y, z: pHit.point.z });
            top.push({ x: m.x, y: m.y, z: tHit.point.z });
        } else {
            plantar.push(pHit.point);
            top.push(tHit.point);
        }
        if (pHit.missed || tHit.missed) missed++;
    }
    const { minRadiusMm, waistMinRadiusMm } = masterCurveRadii(master);
    const sidewaysSkewMm = columnSidewaysSkewMm(plantar, top, normals);
    let maxSkewMm = 0;
    for (const d of sidewaysSkewMm) if (d > maxSkewMm) maxSkewMm = d;
    const s01 = plantar.map((_, i) => i / n);
    return {
        plantar,
        top,
        normals,
        s01,
        sidewaysSkewMm,
        maxSkewMm,
        chordCrossings: countPlanViewChordCrossings(plantar, top),
        missedRays: missed,
        monotonic: true,
        method: "harmonic",
        masterMinRadiusMm: minRadiusMm,
        waistMinRadiusMm,
        maxSepMm: maxSep,
    };
}

/**
 * C2 of the trimmed plantar boundary → N stations. Each column's top is the
 * nearest plan-view ray hit on the TopSheet rim along +n, falling back to −n.
 * Both loops are resampled to N; station index is strictly increasing.
 */
export function pairByOutwardRay(plantarLoop: PolyPoint[], topLoop: PolyPoint[], n: number): StationPairing {
    const plantar = resampleClosedC2(fitClosedC2Spline(plantarLoop), n);
    const c = centroidOf(plantar);
    const rawN = plantar.map((_, i) => outwardNormal(plantar, i, c));
    const normals = smoothNormals(rawN);
    let missed = 0;
    const sUsed: number[] = [];
    const top: PolyPoint[] = [];
    for (let i = 0; i < plantar.length; i++) {
        const pos = nearestRayHitOnLoop(plantar[i]!, normals[i]!, topLoop, 1);
        const neg = nearestRayHitOnLoop(plantar[i]!, normals[i]!, topLoop, -1);
        const prev = i === 0 ? 0 : sUsed[i - 1]!;
        const expected = i === 0 ? 0 : prev + 1 / plantar.length;
        const unwrapS = (s: number): number => {
            let u = s;
            while (i > 0 && u <= prev) u += 1;
            while (i > 0 && u > prev + 1) u -= 1;
            return u;
        };
        const scored = [pos, neg]
            .filter((h): h is RayHit => h != null)
            .map((h) => {
                const u = i === 0 ? ((h.s01 % 1) + 1) % 1 : unwrapS(h.s01);
                return { h, u, err: Math.abs(u - expected) + (h.dir === 1 ? 0 : 0.02) };
            });
        scored.sort((a, b) => a.err - b.err);
        const pick = scored.find((c) => i === 0 || c.u > prev) ?? scored[0];
        if (!pick) {
            missed++;
            const s = expected;
            sUsed.push(s);
            top.push(sampleClosedAtArc01(topLoop, ((s % 1) + 1) % 1));
            continue;
        }
        sUsed.push(pick.u);
        top.push(pick.h.point);
    }
    const s01 = sUsed.map((s) => ((s % 1) + 1) % 1);
    let ok = true;
    for (let i = 1; i < sUsed.length; i++) {
        if (sUsed[i]! <= sUsed[i - 1]!) ok = false;
    }
    if (sUsed.length) {
        const advance = sUsed[sUsed.length - 1]! - sUsed[0]!;
        if (advance < 0.45 || advance > 1.55) ok = false;
    }
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
        method: "outward-ray",
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
