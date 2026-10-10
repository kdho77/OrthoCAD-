// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    fitClosedC2Spline,
    type PolyPoint,
    polylineArcLengths,
    resampleClosedC2,
    resamplePolyline,
    sampleClosedAtArc01,
    startAtLowCurvature,
} from "./curves";
import { outwardNormal } from "./measure";

/** ±25° applies only to per-station deviation from the region default. */
export const FLARE_DEV_CAP_DEG = 25;
/** Smooth flare along the outline: ≤5° change per 5 mm. */
export const FLARE_SMOOTH_DEG_PER_5MM = 5;
export const CROSSING_WINDOW = 20;
export const SKEW_LIMIT_MM = 2;
export const SKEW_INSET_RATIO = 0.5;

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
 * 0-skew seed: arc-length resample of a radius-smoothed P (no C2 overshoot),
 * then the nearest plan-view hit on T along ±n, capped so a far-side hit
 * cannot become a 200 mm column. Midpoints are the master-curve samples.
 */
function seedMidline(
    plantarLoop: PolyPoint[],
    topLoop: PolyPoint[],
    n: number,
): { mid: PolyPoint[]; maxSep: number } {
    const plantar = startAtLowCurvature(resamplePolyline(smoothClosedToMinRadius(plantarLoop, 12, n), n));
    const c = centroidOf(plantar);
    const normals = smoothNormals(
        plantar.map((_, i) => outwardNormal(plantar, i, c)),
        3,
    );
    const mid: PolyPoint[] = [];
    const seps: number[] = [];
    for (let i = 0; i < plantar.length; i++) {
        const p = plantar[i]!;
        const hit = nearerHit(
            nearestRayHitOnLoop(p, normals[i]!, topLoop, 1),
            nearestRayHitOnLoop(p, normals[i]!, topLoop, -1),
            25,
        );
        const t = hit?.point ?? nearestOnLoop(p, topLoop);
        const sep = Math.hypot(t.x - p.x, t.y - p.y);
        seps.push(sep);
        mid.push({ x: (p.x + t.x) * 0.5, y: (p.y + t.y) * 0.5, z: (p.z + t.z) * 0.5 });
    }
    const sorted = seps.slice().sort((a, b) => a - b);
    const typical = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] ?? 12;
    return { mid, maxSep: typical };
}

function nearerHit(a: RayHit | null, b: RayHit | null, maxT: number): RayHit | null {
    const ok = (h: RayHit | null): h is RayHit => h != null && h.t <= maxT;
    const A = ok(a) ? a : null;
    const B = ok(b) ? b : null;
    if (A && B) return A.t <= B.t ? A : B;
    return A ?? B;
}

function pairHitsFromMaster(
    origin: PolyPoint,
    n: { x: number; y: number },
    plantarLoop: PolyPoint[],
    topLoop: PolyPoint[],
    maxT: number,
): { plantar: PolyPoint; top: PolyPoint; missed: boolean; vertical: boolean } {
    const nearP = nearestOnLoop(origin, plantarLoop);
    const nearT = nearestOnLoop(origin, topLoop);
    if (Math.hypot(nearP.x - nearT.x, nearP.y - nearT.y) < 0.15) {
        return { plantar: nearP, top: nearT, missed: false, vertical: true };
    }
    const pHit = nearerHit(
        nearestRayHitOnLoop(origin, n, plantarLoop, 1),
        nearestRayHitOnLoop(origin, n, plantarLoop, -1),
        maxT,
    );
    const tHit = nearerHit(
        nearestRayHitOnLoop(origin, n, topLoop, 1),
        nearestRayHitOnLoop(origin, n, topLoop, -1),
        maxT,
    );
    const plantar = pHit?.point ?? nearP;
    const top = tHit?.point ?? nearT;
    const missed = !pHit || !tHit;
    const sep = Math.hypot(plantar.x - top.x, plantar.y - top.y);
    const vertical =
        sep < 0.15 ||
        Math.hypot(plantar.x - origin.x, plantar.y - origin.y) +
            Math.hypot(top.x - origin.x, top.y - origin.y) <
            0.3;
    return { plantar, top, missed, vertical };
}

function bboxSize(pts: PolyPoint[]): number {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    return Math.max(maxX - minX, maxY - minY);
}

/** Laplacian-smooth a closed loop until min radius reaches `needR`, without shrinking past 72% span. */
export function smoothClosedToMinRadius(seed: PolyPoint[], needR: number, n = seed.length): PolyPoint[] {
    let master = resamplePolyline(seed, n);
    const seedSpan = bboxSize(master);
    let best = master;
    let bestR = masterCurveRadii(master).minRadiusMm;
    for (let pass = 0; pass < 48; pass++) {
        const { minRadiusMm } = masterCurveRadii(master);
        if (minRadiusMm >= needR) return master;
        if (minRadiusMm > bestR && bboxSize(master) > seedSpan * 0.72) {
            bestR = minRadiusMm;
            best = master;
        }
        master = resamplePolyline(smoothClosedXY(master, 2), n);
        if (bboxSize(master) < seedSpan * 0.72) return best;
    }
    return bestR >= masterCurveRadii(master).minRadiusMm ? best : master;
}

/**
 * Harmonic correspondence via the signed-distance gradient to a master
 * curve M (the cheaper accepted alternative). M is the 0-skew midline,
 * Laplacian-smoothed until min radius of curvature exceeds max |T−P|.
 * Columns are iso-psi (M arc-length) lines: from each M station, shoot
 * both ways along ∇d_M and keep the opposite-side T/P hits. Where T and
 * P cross, the column is vertical. Both loops share N strictly increasing
 * stations.
 */
export function pairByHarmonic(plantarLoop: PolyPoint[], topLoop: PolyPoint[], n: number): StationPairing {
    const { mid, maxSep } = seedMidline(plantarLoop, topLoop, n);
    const needR = Math.max(12, Math.min(maxSep, 20));
    const master = smoothClosedToMinRadius(mid, needR, n);
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
        const hit = pairHitsFromMaster(m, normals[i]!, plantarLoop, topLoop, Math.max(8, maxSep * 2.5));
        if (hit.vertical) {
            plantar.push({ x: m.x, y: m.y, z: hit.plantar.z });
            top.push({ x: m.x, y: m.y, z: hit.top.z });
        } else {
            plantar.push(hit.plantar);
            top.push(hit.top);
        }
        if (hit.missed) missed++;
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
 * One station per native TopSheet rim vertex. Top XY/Z are the rim verts
 * themselves. Plantar hits come from M along ∇d_M so the zip can be deleted.
 */
export function pairAtNativeTop(plantarLoop: PolyPoint[], topLoop: PolyPoint[]): StationPairing {
    const n = topLoop.length;
    if (n < 3) {
        return {
            plantar: [],
            top: [],
            normals: [],
            s01: [],
            sidewaysSkewMm: [],
            maxSkewMm: 0,
            chordCrossings: 0,
            missedRays: 0,
            monotonic: true,
            method: "harmonic",
        };
    }
    const { mid, maxSep } = seedMidline(plantarLoop, topLoop, n);
    const needR = Math.max(12, Math.min(maxSep, 20));
    const master = smoothClosedToMinRadius(mid, needR, n);
    const c = centroidOf(master);
    const masterN = smoothNormals(
        master.map((_, i) => outwardNormal(master, i, c)),
        4,
    );
    const plantar: PolyPoint[] = [];
    const top = topLoop.map((p) => ({ ...p }));
    const normals: Array<{ x: number; y: number }> = [];
    let missed = 0;
    const maxT = Math.max(8, maxSep * 2.5);
    for (let i = 0; i < n; i++) {
        const t = top[i]!;
        let bestM = 0;
        let bestD = Infinity;
        for (let k = 0; k < master.length; k++) {
            const d = (master[k]!.x - t.x) ** 2 + (master[k]!.y - t.y) ** 2;
            if (d < bestD) {
                bestD = d;
                bestM = k;
            }
        }
        const nxy = masterN[bestM]!;
        normals.push(nxy);
        const m = master[bestM]!;
        const pHit = nearerHit(
            nearestRayHitOnLoop(m, nxy, plantarLoop, 1),
            nearestRayHitOnLoop(m, nxy, plantarLoop, -1),
            maxT,
        );
        const p = pHit?.point ?? nearestOnLoop(m, plantarLoop);
        if (!pHit) missed++;
        plantar.push({ x: p.x, y: p.y, z: p.z });
    }
    const { minRadiusMm, waistMinRadiusMm } = masterCurveRadii(master);
    const sidewaysSkewMm = columnSidewaysSkewMm(plantar, top, normals);
    let maxSkewMm = 0;
    for (const d of sidewaysSkewMm) if (d > maxSkewMm) maxSkewMm = d;
    return {
        plantar,
        top,
        normals,
        s01: top.map((_, i) => i / n),
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

/** Slide B onto the pairing normal through R so |skew| ≤ 0.5 × plan inset. */
export function limitPairingSkew(pairing: StationPairing, loop: PolyPoint[]): StationPairing {
    const n = Math.min(pairing.top.length, pairing.plantar.length, pairing.normals.length);
    if (n < 3 || loop.length < 3) return pairing;
    const plantar = pairing.plantar.map((p) => ({ ...p }));
    for (let pass = 0; pass < 4; pass++) {
        let moved = 0;
        for (let i = 0; i < n; i++) {
            const R = pairing.top[i]!;
            const B = plantar[i]!;
            const nx = pairing.normals[i]!.x;
            const ny = pairing.normals[i]!.y;
            const nl = Math.hypot(nx, ny) || 1;
            const ox = nx / nl;
            const oy = ny / nl;
            const vx = B.x - R.x;
            const vy = B.y - R.y;
            const inset = Math.hypot(vx, vy);
            const skew = Math.abs(vx * oy - vy * ox);
            const cap = Math.min(SKEW_LIMIT_MM, SKEW_INSET_RATIO * Math.max(inset, 1e-6));
            if (skew <= cap + 1e-3) continue;
            const along = vx * ox + vy * oy;
            const target = { x: R.x + ox * along, y: R.y + oy * along, z: 0 };
            plantar[i] = nearestOnLoop(target, loop);
            moved++;
        }
        if (!moved) break;
    }
    const sidewaysSkewMm = columnSidewaysSkewMm(plantar, pairing.top, pairing.normals);
    let maxSkewMm = 0;
    for (const d of sidewaysSkewMm) if (d > maxSkewMm) maxSkewMm = d;
    return {
        ...pairing,
        plantar,
        sidewaysSkewMm,
        maxSkewMm,
        chordCrossings: countPlanViewChordCrossings(plantar, pairing.top),
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

/**
 * B is the pattern hit from E along the pattern's inward normal (planar pair).
 */
export function retargetPlantarFromE(E: PolyPoint[], plantarLoop: PolyPoint[]): PolyPoint[] {
    if (E.length < 3 || plantarLoop.length < 3) return E.map((p) => ({ ...p }));
    const c = centroidOf(plantarLoop);
    const out: PolyPoint[] = [];
    for (const e of E) {
        const near = nearestOnLoop(e, plantarLoop);
        const n = outwardNormal(plantarLoop, nearestIndex(plantarLoop, near), c);
        const inward = { x: -n.x, y: -n.y };
        const hit = nearerHit(
            nearestRayHitOnLoop(e, inward, plantarLoop, 1),
            nearestRayHitOnLoop(e, inward, plantarLoop, -1),
            Math.max(8, Math.hypot(near.x - e.x, near.y - e.y) * 4 + 8),
        );
        const p = hit?.point ?? near;
        out.push({ x: p.x, y: p.y, z: p.z });
    }
    return spreadClosedOnLoop(out, plantarLoop, 0.4);
}

/** Keep closed B samples strictly increasing on `loop` with a minimum arc gap. */
export function spreadClosedOnLoop(pts: PolyPoint[], loop: PolyPoint[], minMm: number): PolyPoint[] {
    const n = pts.length;
    if (n < 3 || loop.length < 3) return pts.map((p) => ({ ...p }));
    const { cum, total } = polylineArcLengths(loop);
    if (total < 1e-6) return pts.map((p) => ({ ...p }));
    const s01 = pts.map((p) => nearestS01(p, loop, cum, total));
    const outS = unwrapAllowPlateau(s01);
    const minS = minMm / total;
    for (let i = 1; i < n; i++) {
        if (outS[i]! < outS[i - 1]! + minS) outS[i] = outS[i - 1]! + minS;
    }
    const span = outS[n - 1]! - outS[0]!;
    const room = 1 - minS;
    if (span > room && span > 1e-9) {
        const t0 = outS[0]!;
        for (let i = 1; i < n; i++) outS[i] = t0 + ((outS[i]! - t0) / span) * room;
    }
    return outS.map((s) => sampleClosedAtArc01(loop, ((s % 1) + 1) % 1));
}

/** Unwrap a closed s01 circuit; equal hits stay on the same lap (no +1 jump). */
function unwrapAllowPlateau(s01: number[]): number[] {
    const n = s01.length;
    const out = new Array<number>(n);
    out[0] = s01[0]!;
    for (let i = 1; i < n; i++) {
        let s = s01[i]!;
        const prev = out[i - 1]!;
        while (s < prev - 0.5) s += 1;
        while (s > prev + 0.5) s -= 1;
        out[i] = s;
    }
    return out;
}

function nearestS01(p: PolyPoint, loop: PolyPoint[], cum: number[], total: number): number {
    let bestS = 0;
    let bestD = Infinity;
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const len2 = ex * ex + ey * ey;
        const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2)) : 0;
        const x = a.x + ex * t;
        const y = a.y + ey * t;
        const d = (x - p.x) ** 2 + (y - p.y) ** 2;
        if (d < bestD) {
            bestD = d;
            const seg = cum[i + 1]! - cum[i]!;
            bestS = (cum[i]! + t * seg) / total;
        }
    }
    return ((bestS % 1) + 1) % 1;
}

/** Interpolate along the closed loop so new stations cannot collapse to one vertex. */
export function lerpClosedOnLoop(a: PolyPoint, b: PolyPoint, t: number, loop: PolyPoint[]): PolyPoint {
    if (loop.length < 2) {
        return {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
            z: a.z + (b.z - a.z) * t,
        };
    }
    const { cum, total } = polylineArcLengths(loop);
    const sa = nearestS01(a, loop, cum, total);
    let sb = nearestS01(b, loop, cum, total);
    if (sb < sa - 0.5) sb += 1;
    if (sb > sa + 0.5) sb -= 1;
    return sampleClosedAtArc01(loop, sa + (sb - sa) * t);
}

function nearestIndex(loop: PolyPoint[], p: PolyPoint): number {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < loop.length; i++) {
        const d = (loop[i]!.x - p.x) ** 2 + (loop[i]!.y - p.y) ** 2;
        if (d < bestD) {
            bestD = d;
            best = i;
        }
    }
    return best;
}

export function offsetClosedInward(poly: PolyPoint[], distMm: number): PolyPoint[] {
    if (poly.length < 3) return poly.map((p) => ({ ...p }));
    const c = centroidOf(poly);
    return poly.map((p, i) => {
        const n = outwardNormal(poly, i, c);
        return { x: p.x - n.x * distMm, y: p.y - n.y * distMm, z: p.z };
    });
}

export const TB_SMOOTH_SIGMA_MM = 12;

/** Closed-loop arc-length fraction of `p` on `loop`. */
export function parameterOnClosedLoop(p: PolyPoint, loop: PolyPoint[]): number {
    const { cum, total } = polylineArcLengths(loop);
    if (total < 1e-12) return 0;
    return nearestS01(p, loop, cum, total);
}

/** Gaussian-smooth unwrapped s01 along the rim, σ default 12 mm. */
export function smoothClosedParameters(
    s01: number[],
    rim: PolyPoint[],
    sigmaMm = TB_SMOOTH_SIGMA_MM,
): number[] {
    const n = s01.length;
    if (n === 0) return [];
    if (n < 3 || rim.length !== n) return s01.map((s) => ((s % 1) + 1) % 1);
    const unwrapped = unwrapAllowPlateau(s01);
    const ds = rim.map((p, i) => {
        const q = rim[(i + 1) % n]!;
        return Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
    });
    const period = ds.reduce((s, d) => s + d, 0);
    if (period < 1e-9) return s01.map((s) => ((s % 1) + 1) % 1);
    const cum = [0];
    for (const d of ds) cum.push(cum[cum.length - 1]! + d);
    const sig = Math.max(8, Math.min(15, sigmaMm));
    const smoothed = unwrapped.map((_, i) => {
        let s = 0;
        let w = 0;
        for (let j = 0; j < n; j++) {
            let d = Math.abs(cum[j]! - cum[i]!);
            d = Math.min(d, period - d);
            const wt = Math.exp((-0.5 * d * d) / (sig * sig));
            s += wt * unwrapped[j]!;
            w += wt;
        }
        return w > 0 ? s / w : unwrapped[i]!;
    });
    return smoothed.map((s) => ((s % 1) + 1) % 1);
}

/** Walk the ring forward so t_B cannot jump across a pinch. */
export function stampMonotonicTB(
    stations: Array<{ outline: PolyPoint; tB?: number }>,
    loop: PolyPoint[],
): void {
    if (stations.length < 2 || loop.length < 3) return;
    const { cum, total } = polylineArcLengths(loop);
    if (total < 1e-9) return;
    let prev = stations[0]!.tB ?? nearestS01(stations[0]!.outline, loop, cum, total);
    stations[0]!.tB = ((prev % 1) + 1) % 1;
    const maxStep = Math.max(0.08, 2 / stations.length);
    for (let i = 1; i < stations.length; i++) {
        const stored = stations[i]!.tB;
        let t = stored ?? nearestS01(stations[i]!.outline, loop, cum, total);
        while (t < prev - 1e-9) t += 1;
        if (t - prev > maxStep + 1e-9 || t < prev - 1e-9) {
            t = prev + Math.min(maxStep, Math.max(1e-4, 1 / stations.length));
        }
        stations[i]!.tB = ((t % 1) + 1) % 1;
        prev = t;
    }
}

/**
 * After t_B smooth, remap B on the pattern while keeping t order.
 * Prefer a neighbour-Δt clamp to 1.5 (small moves). Fall back to equal
 * arc-length only if the clamp still crosses.
 */
export function reparameterizeBArcLength(
    stations: Array<{ outline: PolyPoint; rim: PolyPoint; tB?: number }>,
    loop: PolyPoint[],
): boolean {
    const n = stations.length;
    if (n < 3 || loop.length < 3) return false;
    const raw = stations.map((s) => s.tB ?? parameterOnClosedLoop(s.outline, loop));
    const unwrapped = unwrapAllowPlateau(raw);
    const t0 = unwrapped[0]!;
    const deltas: number[] = [];
    for (let i = 0; i < n; i++) {
        const a = unwrapped[i]!;
        const b = i + 1 < n ? unwrapped[i + 1]! : unwrapped[0]! + 1;
        deltas.push(Math.max(1e-6, b - a));
    }
    const ratio = 1.49;
    for (let pass = 0; pass < 8; pass++) {
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const a = deltas[i]!;
            const b = deltas[j]!;
            if (b > a * ratio + 1e-12 || a > b * ratio + 1e-12) {
                const s = a + b;
                const lo = s / (1 + ratio);
                const hi = s - lo;
                if (b > a) {
                    deltas[i] = lo;
                    deltas[j] = hi;
                } else {
                    deltas[i] = hi;
                    deltas[j] = lo;
                }
            }
        }
    }
    const next: number[] = [t0];
    for (let i = 0; i < n - 1; i++) next.push(next[i]! + deltas[i]!);
    if (commitTB(stations, loop, next)) return true;
    const equal: number[] = [];
    for (let i = 0; i < n; i++) equal.push(t0 + i / n);
    return commitTB(stations, loop, equal);
}

function commitTB(
    stations: Array<{ outline: PolyPoint; rim: PolyPoint; tB?: number }>,
    loop: PolyPoint[],
    next: number[],
): boolean {
    const pts = next.map((t) => {
        const p = sampleClosedAtArc01(loop, ((t % 1) + 1) % 1);
        return { x: p.x, y: p.y, z: 0 };
    });
    const crossings = countPlanViewChordCrossings(
        pts,
        stations.map((s) => s.rim),
    );
    if (crossings !== 0) return false;
    for (let i = 0; i < stations.length; i++) {
        stations[i]!.outline = pts[i]!;
        stations[i]!.tB = ((next[i]! % 1) + 1) % 1;
    }
    return true;
}

export function applyStoredTB(stations: Array<{ outline: PolyPoint; tB?: number }>, loop: PolyPoint[]): void {
    for (const s of stations) {
        if (s.tB === undefined) continue;
        const p = sampleClosedAtArc01(loop, s.tB);
        s.outline = { x: p.x, y: p.y, z: 0 };
    }
}

export function resampleBySmoothedParameter(
    pts: PolyPoint[],
    loop: PolyPoint[],
    rim: PolyPoint[],
    sigmaMm = TB_SMOOTH_SIGMA_MM,
): PolyPoint[] {
    if (pts.length < 3 || loop.length < 3) return pts.map((p) => ({ ...p }));
    const s01 = pts.map((p) => parameterOnClosedLoop(p, loop));
    const sm = smoothClosedParameters(s01, rim, sigmaMm);
    return sm.map((s) => sampleClosedAtArc01(loop, s));
}

function extremumIndex(loop: PolyPoint[], pick: "minX" | "maxX"): number {
    let best = 0;
    for (let i = 1; i < loop.length; i++) {
        const p = loop[i]!;
        const b = loop[best]!;
        if (pick === "minX" ? p.x < b.x : p.x > b.x) best = i;
    }
    return best;
}

function medialUIndex(
    loop: PolyPoint[],
    bounds: { minX: number; maxX: number },
    sign: 1 | -1,
    targetU: number,
): number {
    const length = Math.max(1e-3, bounds.maxX - bounds.minX);
    const yMid = loop.reduce((s, p) => s + p.y, 0) / Math.max(1, loop.length);
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < loop.length; i++) {
        const p = loop[i]!;
        if ((p.y - yMid) * sign <= 0) continue;
        const u = (p.x - bounds.minX) / length;
        const d = Math.abs(u - targetU);
        if (d < bestD) {
            bestD = d;
            best = i;
        }
    }
    return best;
}

function featureS01Circuit(
    loop: PolyPoint[],
    bounds: { minX: number; maxX: number },
    sign: 1 | -1,
    archU0: number,
    archU1: number,
): number[] {
    const { cum, total } = polylineArcLengths(loop);
    if (total < 1e-12) return [0, 0.25, 0.5, 0.75];
    const sOf = (i: number) => cum[i]! / total;
    const heel = sOf(extremumIndex(loop, "minX"));
    const toe = sOf(extremumIndex(loop, "maxX"));
    const arch0 = sOf(medialUIndex(loop, bounds, sign, archU0));
    const arch1 = sOf(medialUIndex(loop, bounds, sign, archU1));
    const raw = [heel, toe, arch1, arch0];
    const unwrapped = unwrapAllowPlateau(raw.map((s) => (((s - heel) % 1) + 1) % 1));
    unwrapped.sort((a, b) => a - b);
    return unwrapped.map((s) => (((s + heel) % 1) + 1) % 1);
}

/**
 * Arc-length-proportional B mapping between matched features: heel apex,
 * medial-arch S ends, toe apex. Used when the pattern is not a parallel
 * offset of the rim (the arch fan).
 */
export function mapLoopByMatchedFeatures(
    src: PolyPoint[],
    dst: PolyPoint[],
    bounds: { minX: number; maxX: number },
    sign: 1 | -1,
    archU0 = 0.16,
    archU1 = 0.62,
): PolyPoint[] {
    if (src.length < 3 || dst.length < 3) return src.map((p) => ({ ...p }));
    const srcF = featureS01Circuit(src, bounds, sign, archU0, archU1);
    const dstF = featureS01Circuit(dst, bounds, sign, archU0, archU1);
    const nF = Math.min(srcF.length, dstF.length);
    if (nF < 2) return src.map((p) => ({ x: p.x, y: p.y, z: 0 }));
    const srcFu = unwrapAllowPlateau(srcF.slice(0, nF));
    srcFu.push(srcFu[0]! + 1);
    const dstFu = unwrapAllowPlateau(dstF.slice(0, nF));
    dstFu.push(dstFu[0]! + 1);
    return src.map((p) => {
        let s = parameterOnClosedLoop(p, src);
        while (s < srcFu[0]! - 0.5) s += 1;
        while (s > srcFu[0]! + 0.5) s -= 1;
        if (s < srcFu[0]!) s += 1;
        let seg = 0;
        while (seg < nF - 1 && srcFu[seg + 1]! < s) seg++;
        const a = srcFu[seg]!;
        const b = srcFu[seg + 1]!;
        const span = Math.max(b - a, 1e-9);
        const t = Math.max(0, Math.min(1, (s - a) / span));
        return sampleClosedAtArc01(dst, dstFu[seg]! + (dstFu[seg + 1]! - dstFu[seg]!) * t);
    });
}
