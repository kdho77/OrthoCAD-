// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    bLoopOutwardNormal,
    COS_T_MIN,
    columnHeading,
    FOREFOOT_INSET_MM,
    HEADING_MAX_DEG,
    NEIGHBOUR_SPACING_RATIO,
    OUTLINE_STATION_SPACING_MM,
    TOE_SPACING_EXTENT_FRAC,
} from "./bezier-column";
import type { PolyPoint } from "./curves";
import { sampleClosedAtArc01 } from "./curves";
import type { HermiteStation } from "./loft";
import { parameterOnClosedLoop } from "./stations";

const ARCH_FAN_U0 = 0.16;
const ARCH_FAN_U1 = 0.62;

const HEEL_U_MAX = 0.22;
const FORE_U_MIN = 0.78;
const TOE_U_MIN = 0.76;
const CREASE_U_LO = 0.36;
const CREASE_U_HI = 0.39;

/** Stop inserting (R, B) pairs once either rim or pattern spacing hits this. */
export const PAIR_SPACING_MIN_MM = 0.3;

function inDenseBand(ua: number, ub: number): boolean {
    const heel = ua <= HEEL_U_MAX && ub <= HEEL_U_MAX;
    const fore = ua >= FORE_U_MIN && ub >= FORE_U_MIN;
    return heel || fore;
}

function spansCreaseU(ua: number, ub: number): boolean {
    const lo = Math.min(ua, ub);
    const hi = Math.max(ua, ub);
    return lo <= CREASE_U_HI && hi >= CREASE_U_LO;
}

/** Split only faces that already use the top-boundary edge (a, b). Never a CDT edge. */
function splitTopBoundaryEdge(indices: number[], a: number, b: number, m: number): void {
    const out: number[] = [];
    for (let t = 0; t < indices.length; t += 3) {
        const i0 = indices[t]!;
        const i1 = indices[t + 1]!;
        const i2 = indices[t + 2]!;
        const e01 = (i0 === a && i1 === b) || (i0 === b && i1 === a);
        const e12 = (i1 === a && i2 === b) || (i1 === b && i2 === a);
        const e20 = (i2 === a && i0 === b) || (i2 === b && i0 === a);
        if (e01) {
            out.push(i0, m, i2, m, i1, i2);
        } else if (e12) {
            out.push(i0, i1, m, i0, m, i2);
        } else if (e20) {
            out.push(i0, i1, m, m, i1, i2);
        } else {
            out.push(i0, i1, i2);
        }
    }
    indices.length = 0;
    for (let i = 0; i < out.length; i++) indices.push(out[i]!);
}

function midClosedParam(a: number, b: number): number {
    let sb = b;
    if (sb < a - 0.5) sb += 1;
    if (sb > a + 0.5) sb -= 1;
    return ((((a + sb) * 0.5) % 1) + 1) % 1;
}

function closestOnSegment(p: PolyPoint, a: PolyPoint, b: PolyPoint): PolyPoint {
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const ez = b.z - a.z;
    const len2 = ex * ex + ey * ey + ez * ez;
    const t =
        len2 > 1e-18
            ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey + (p.z - a.z) * ez) / len2))
            : 0.5;
    return { x: a.x + ex * t, y: a.y + ey * t, z: a.z + ez * t };
}

function planHeading(st: HermiteStation): { x: number; y: number } {
    const dx = st.outline.x - st.rim.x;
    const dy = st.outline.y - st.rim.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) {
        const nl = Math.hypot(st.n.x, st.n.y) || 1;
        return { x: st.n.x / nl, y: st.n.y / nl };
    }
    return { x: dx / len, y: dy / len };
}

export function headingDeltaDeg(a: HermiteStation, b: HermiteStation): number {
    const ha = planHeading(a);
    const hb = planHeading(b);
    const d = Math.max(-1, Math.min(1, ha.x * hb.x + ha.y * hb.y));
    return (Math.acos(d) * 180) / Math.PI;
}

function stationFromPair(
    R: PolyPoint,
    B: PolyPoint,
    cur: HermiteStation,
    nxt: HermiteStation,
    bounds: { minX: number; maxX: number },
    tB?: number,
): HermiteStation {
    const length = Math.max(1e-3, bounds.maxX - bounds.minX);
    const nx = cur.n.x + nxt.n.x;
    const ny = cur.n.y + nxt.n.y;
    const nl = Math.hypot(nx, ny) || 1;
    return {
        outline: B,
        rim: R,
        n: { x: nx / nl, y: ny / nl },
        u: Math.max(0, Math.min(1, (B.x - bounds.minX) / length)),
        tB,
    };
}

/**
 * Insert one (R, B) pair between stations i and i+1.
 * R is the TopSheet-rim midpoint (arc length), snapped onto the current
 * boundary edge so the top surface stays identical. B is the faired-pattern
 * midpoint t_B. Only the top-boundary edge is split.
 */
export function insertStationPair(
    stations: HermiteStation[],
    rimLocal: number[],
    positions: number[],
    indices: number[],
    pattern: PolyPoint[],
    bounds: { minX: number; maxX: number },
    i: number,
    rimLoop?: PolyPoint[],
): boolean {
    const n = stations.length;
    const cur = stations[i]!;
    const nxt = stations[(i + 1) % n]!;
    const prevRim = rimLocal[i]!;
    const endRim = rimLocal[(i + 1) % n]!;
    const Ra: PolyPoint = {
        x: positions[prevRim * 3]!,
        y: positions[prevRim * 3 + 1]!,
        z: positions[prevRim * 3 + 2]!,
    };
    const Rb: PolyPoint = {
        x: positions[endRim * 3]!,
        y: positions[endRim * 3 + 1]!,
        z: positions[endRim * 3 + 2]!,
    };
    const sampleRim = rimLoop && rimLoop.length >= 3 ? rimLoop : [cur.rim, nxt.rim];
    const tR = midClosedParam(
        parameterOnClosedLoop(cur.rim, sampleRim),
        parameterOnClosedLoop(nxt.rim, sampleRim),
    );
    const Rwant = sampleClosedAtArc01(sampleRim, tR);
    const R = closestOnSegment(Rwant, Ra, Rb);
    const tB0 = cur.tB ?? parameterOnClosedLoop(cur.outline, pattern);
    const tB1 = nxt.tB ?? parameterOnClosedLoop(nxt.outline, pattern);
    let span = tB1 - tB0;
    if (span < -0.5) span += 1;
    if (span > 0.5) span -= 1;
    if (Math.abs(span) < 1e-6) return false;
    const tB = midClosedParam(tB0, tB1);
    const B = { ...sampleClosedAtArc01(pattern, tB), z: 0 };
    if (
        Math.hypot(B.x - cur.outline.x, B.y - cur.outline.y) < PAIR_SPACING_MIN_MM ||
        Math.hypot(B.x - nxt.outline.x, B.y - nxt.outline.y) < PAIR_SPACING_MIN_MM
    ) {
        return false;
    }
    const mid = positions.length / 3;
    positions.push(R.x, R.y, R.z);
    splitTopBoundaryEdge(indices, prevRim, endRim, mid);
    const st = stationFromPair(R, B, cur, nxt, bounds, tB);
    stations.splice(i + 1, 0, st);
    rimLocal.splice(i + 1, 0, mid);
    return true;
}

function insertWhere(
    stations: HermiteStation[],
    rimLocal: number[],
    positions: number[],
    indices: number[],
    pattern: PolyPoint[],
    bounds: { minX: number; maxX: number },
    want: (cur: HermiteStation, nxt: HermiteStation, dsR: number, dsB: number) => number,
    rimLoop?: PolyPoint[],
): number {
    if (stations.length < 3) return 0;
    const n0 = stations.length;
    let added = 0;
    let i = 0;
    while (i < stations.length) {
        const cur = stations[i]!;
        const nxt = stations[(i + 1) % stations.length]!;
        const dsR = Math.hypot(nxt.rim.x - cur.rim.x, nxt.rim.y - cur.rim.y, nxt.rim.z - cur.rim.z);
        const dsB = Math.hypot(nxt.outline.x - cur.outline.x, nxt.outline.y - cur.outline.y);
        const nAdd = want(cur, nxt, dsR, dsB);
        if (nAdd < 1 || Math.min(dsR, dsB) < 2 * PAIR_SPACING_MIN_MM - 1e-9) {
            i++;
            continue;
        }
        if (!insertStationPair(stations, rimLocal, positions, indices, pattern, bounds, i, rimLoop)) {
            i++;
            continue;
        }
        added++;
        i += 2;
        if (stations.length > n0 * 8 + 400) break;
    }
    return added;
}

/**
 * Insert stations so heel-posterior and forefoot outline spacing is ≤ 1.5 mm.
 * New rim points lie on existing TopSheet rim edges (original verts stay put).
 */
export function densifyHeelForefootStations(
    stations: HermiteStation[],
    rimLocal: number[],
    positions: number[],
    indices: number[],
    outlineLoop: PolyPoint[],
    bounds: { minX: number; maxX: number },
    rimLoop?: PolyPoint[],
): void {
    for (let pass = 0; pass < 8; pass++) {
        const added = insertWhere(
            stations,
            rimLocal,
            positions,
            indices,
            outlineLoop,
            bounds,
            (cur, nxt, dsR, dsB) => {
                if (!inDenseBand(cur.u, nxt.u)) return 0;
                const dist = Math.max(dsR, dsB);
                if (dist <= OUTLINE_STATION_SPACING_MM || dist < PAIR_SPACING_MIN_MM || dist > 8) return 0;
                return 1;
            },
            rimLoop,
        );
        if (added === 0) break;
    }
}

/**
 * Resample the toe so station spacing ≤ 0.5× the profile's plan inset (~1 mm).
 */
export function densifyToeByExtent(
    stations: HermiteStation[],
    rimLocal: number[],
    positions: number[],
    indices: number[],
    outlineLoop: PolyPoint[],
    bounds: { minX: number; maxX: number },
    rimLoop?: PolyPoint[],
): void {
    for (let pass = 0; pass < 8; pass++) {
        const added = insertWhere(
            stations,
            rimLocal,
            positions,
            indices,
            outlineLoop,
            bounds,
            (cur, nxt, dsR, dsB) => {
                if (cur.u < TOE_U_MIN && nxt.u < TOE_U_MIN) return 0;
                const dist = Math.max(dsB, dsR);
                const ext = Math.max(
                    FOREFOOT_INSET_MM,
                    Math.hypot(cur.outline.x - cur.rim.x, cur.outline.y - cur.rim.y),
                    Math.hypot(nxt.outline.x - nxt.rim.x, nxt.outline.y - nxt.rim.y),
                );
                const cap = Math.max(PAIR_SPACING_MIN_MM, TOE_SPACING_EXTENT_FRAC * ext);
                if (dist <= cap || dist > 8) return 0;
                return 1;
            },
            rimLoop,
        );
        if (added === 0) break;
    }
}

/** Split any station gap larger than 2× median; always densify u 0.36–0.39. */
export function fillLargeStationGaps(
    stations: HermiteStation[],
    rimLocal: number[],
    positions: number[],
    indices: number[],
    outlineLoop: PolyPoint[],
    bounds: { minX: number; maxX: number },
    maxMult = 2,
    rimLoop?: PolyPoint[],
): void {
    if (stations.length < 3) return;
    const n0 = stations.length;
    const spacing: number[] = [];
    for (let i = 0; i < n0; i++) {
        const a = stations[i]!;
        const b = stations[(i + 1) % n0]!;
        const dB = Math.hypot(b.outline.x - a.outline.x, b.outline.y - a.outline.y);
        const dR = Math.hypot(b.rim.x - a.rim.x, b.rim.y - a.rim.y, b.rim.z - a.rim.z);
        spacing.push(Math.max(dB, dR));
    }
    const sorted = spacing.slice().sort((x, y) => x - y);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 1.3;
    const cap = Math.max(OUTLINE_STATION_SPACING_MM, maxMult * median);
    for (let pass = 0; pass < 8; pass++) {
        const added = insertWhere(
            stations,
            rimLocal,
            positions,
            indices,
            outlineLoop,
            bounds,
            (cur, nxt, dsR, dsB) => {
                const dist = Math.max(dsB, dsR);
                const need = dist > cap || (spansCreaseU(cur.u, nxt.u) && dist > Math.max(8, 1.2 * median));
                if (!need || dist < PAIR_SPACING_MIN_MM) return 0;
                return 1;
            },
            rimLoop,
        );
        if (added === 0) break;
    }
}

/**
 * Redistribute R and B to even outline-arc-length spacing. New rim samples
 * land on existing TopSheet rim edges (original verts stay put).
 */
export function resampleStationsEvenly(
    stations: HermiteStation[],
    rimLocal: number[],
    positions: number[],
    indices: number[],
    outlineLoop: PolyPoint[],
    bounds: { minX: number; maxX: number },
    rimLoop?: PolyPoint[],
): void {
    const n = stations.length;
    if (n < 3) return;
    const segs: number[] = [];
    let total = 0;
    for (let i = 0; i < n; i++) {
        const a = stations[i]!.outline;
        const b = stations[(i + 1) % n]!.outline;
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        segs.push(d);
        total += d;
    }
    if (total < 1e-6) return;
    const sampleRim = rimLoop && rimLoop.length >= 3 ? rimLoop : stations.map((s) => s.rim);
    const outSt: HermiteStation[] = [];
    const outRim: number[] = [];
    let seg = 0;
    let acc = 0;
    for (let k = 0; k < n; k++) {
        const target = (k / n) * total;
        while (seg < n - 1 && acc + segs[seg]! < target - 1e-9) {
            acc += segs[seg]!;
            seg++;
        }
        const span = Math.max(segs[seg]!, 1e-9);
        const t = Math.max(0, Math.min(1, (target - acc) / span));
        const cur = stations[seg]!;
        const nxt = stations[(seg + 1) % n]!;
        if (t < 1e-6) {
            outSt.push(cur);
            outRim.push(rimLocal[seg]!);
            continue;
        }
        const prevRim = rimLocal[seg]!;
        const endRim = rimLocal[(seg + 1) % n]!;
        const Ra: PolyPoint = {
            x: positions[prevRim * 3]!,
            y: positions[prevRim * 3 + 1]!,
            z: positions[prevRim * 3 + 2]!,
        };
        const Rb: PolyPoint = {
            x: positions[endRim * 3]!,
            y: positions[endRim * 3 + 1]!,
            z: positions[endRim * 3 + 2]!,
        };
        const tR = midClosedParam(
            parameterOnClosedLoop(cur.rim, sampleRim),
            parameterOnClosedLoop(nxt.rim, sampleRim),
        );
        const R = closestOnSegment(sampleClosedAtArc01(sampleRim, tR), Ra, Rb);
        const tB = midClosedParam(
            parameterOnClosedLoop(cur.outline, outlineLoop),
            parameterOnClosedLoop(nxt.outline, outlineLoop),
        );
        const B = sampleClosedAtArc01(outlineLoop, tB);
        const mid = positions.length / 3;
        positions.push(R.x, R.y, R.z);
        splitTopBoundaryEdge(indices, prevRim, endRim, mid);
        outSt.push(stationFromPair(R, B, cur, nxt, bounds));
        outRim.push(mid);
    }
    if (outSt.length < 3) return;
    stations.length = 0;
    stations.push(...outSt);
    rimLocal.length = 0;
    rimLocal.push(...outRim);
}

/**
 * Insert (R, B) pairs until heading change ≤ 3°/station or spacing hits 0.3 mm.
 * The plantar CDT is not touched — reconstruct builds it once from the final B ring.
 */
export function densifyArchFanStations(
    stations: HermiteStation[],
    rimLocal: number[],
    positions: number[],
    indices: number[],
    outlineLoop: PolyPoint[],
    bounds: { minX: number; maxX: number },
    rimLoop?: PolyPoint[],
): void {
    if (stations.length < 3) return;
    for (let pass = 0; pass < 48; pass++) {
        const added = insertWhere(
            stations,
            rimLocal,
            positions,
            indices,
            outlineLoop,
            bounds,
            (cur, nxt, dsR, dsB) => {
                const inArch =
                    (cur.u >= ARCH_FAN_U0 && cur.u <= ARCH_FAN_U1) ||
                    (nxt.u >= ARCH_FAN_U0 && nxt.u <= ARCH_FAN_U1);
                const ratio = dsB / Math.max(dsR, 1e-6);
                const head = headingDeltaDeg(cur, nxt);
                const spacing = Math.min(dsR, dsB);
                if (spacing <= PAIR_SPACING_MIN_MM + 1e-9) return 0;
                const needHead = head > HEADING_MAX_DEG + 1e-6;
                const needRatio = inArch && (ratio > 1.5 || ratio < 0.65) && spacing > PAIR_SPACING_MIN_MM;
                return needHead || needRatio ? 1 : 0;
            },
            rimLoop,
        );
        if (added === 0) break;
    }
}

function distToSeg3(p: PolyPoint, a: PolyPoint, b: PolyPoint): number {
    const hit = closestOnSegment(p, a, b);
    return Math.hypot(p.x - hit.x, p.y - hit.y, p.z - hit.z);
}

/**
 * Every source TopSheet rim vertex must remain a station so rows 0→1 stay a
 * true quad strip. Extra stations already sit on straight source rim edges.
 */
export function ensureSourceRimStations(
    stations: HermiteStation[],
    rimLocal: number[],
    positions: number[],
    indices: number[],
    pattern: PolyPoint[],
    bounds: { minX: number; maxX: number },
    sourceRim: number[],
): number {
    if (stations.length < 3 || sourceRim.length < 3) return 0;
    const have = new Set(rimLocal);
    let added = 0;
    for (const src of sourceRim) {
        if (have.has(src)) continue;
        const R: PolyPoint = {
            x: positions[src * 3]!,
            y: positions[src * 3 + 1]!,
            z: positions[src * 3 + 2]!,
        };
        let bestI = 0;
        let bestD = Infinity;
        for (let i = 0; i < stations.length; i++) {
            const a = stations[i]!.rim;
            const b = stations[(i + 1) % stations.length]!.rim;
            const d = distToSeg3(R, a, b);
            if (d < bestD) {
                bestD = d;
                bestI = i;
            }
        }
        const cur = stations[bestI]!;
        const nxt = stations[(bestI + 1) % stations.length]!;
        const tB = midClosedParam(
            cur.tB ?? parameterOnClosedLoop(cur.outline, pattern),
            nxt.tB ?? parameterOnClosedLoop(nxt.outline, pattern),
        );
        let tUse = tB;
        let B = { ...sampleClosedAtArc01(pattern, tUse), z: 0 };
        const tooClose = (p: PolyPoint): boolean =>
            Math.hypot(p.x - cur.outline.x, p.y - cur.outline.y) < PAIR_SPACING_MIN_MM ||
            Math.hypot(p.x - nxt.outline.x, p.y - nxt.outline.y) < PAIR_SPACING_MIN_MM;
        for (let k = 1; k <= 8 && tooClose(B); k++) {
            tUse = midClosedParam(tUse, nxt.tB ?? parameterOnClosedLoop(nxt.outline, pattern));
            B = { ...sampleClosedAtArc01(pattern, tUse), z: 0 };
        }
        const st = stationFromPair(R, B, cur, nxt, bounds, tUse);
        st.sourceRim = true;
        splitTopBoundaryEdge(indices, rimLocal[bestI]!, rimLocal[(bestI + 1) % rimLocal.length]!, src);
        stations.splice(bestI + 1, 0, st);
        rimLocal.splice(bestI + 1, 0, src);
        have.add(src);
        added++;
    }
    if (added) {
        console.log(
            "[S1-RIM-STATIONS]",
            JSON.stringify({ added, n: stations.length, source: sourceRim.length }),
        );
    }
    return added;
}

export function markSourceRimStations(
    stations: HermiteStation[],
    rimLocal: number[],
    sourceRim: number[],
): void {
    const have = new Set(sourceRim);
    for (let i = 0; i < stations.length; i++) {
        stations[i]!.sourceRim = have.has(rimLocal[i]!);
    }
}

function wrapParamDelta(a: number, b: number): number {
    let span = b - a;
    if (span < -0.5) span += 1;
    if (span > 0.5) span -= 1;
    return span;
}

/**
 * Even k-splits of each source rim edge. k = max(0, round(L / target) − 1)
 * so extras never cluster. B is the interpolated harmonic t_B on the pattern.
 */
export function evenSplitSourceEdges(
    stations: HermiteStation[],
    rimLocal: number[],
    positions: number[],
    indices: number[],
    pattern: PolyPoint[],
    bounds: { minX: number; maxX: number },
    rimLoop?: PolyPoint[],
    targetMm?: number,
): number {
    if (stations.length < 3) return 0;
    let added = 0;
    for (let pass = 0; pass < 4; pass++) {
        const n0 = stations.length;
        const edgeLen: number[] = [];
        const bLen: number[] = [];
        for (let i = 0; i < n0; i++) {
            const a = stations[i]!.rim;
            const b = stations[(i + 1) % n0]!.rim;
            edgeLen.push(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
            const ba = stations[i]!.outline;
            const bb = stations[(i + 1) % n0]!.outline;
            bLen.push(Math.hypot(bb.x - ba.x, bb.y - ba.y));
        }
        const sorted = edgeLen.slice().sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)] ?? OUTLINE_STATION_SPACING_MM;
        const minE = sorted[0] ?? median;
        let target = targetMm ?? Math.max(0.6, Math.min(1.5, median));
        if (minE > PAIR_SPACING_MIN_MM && minE * NEIGHBOUR_SPACING_RATIO < target) {
            target = Math.max(0.6, minE * NEIGHBOUR_SPACING_RATIO);
        }
        const ks: number[] = [];
        for (let i = 0; i < n0; i++) {
            const L = Math.max(edgeLen[i]!, bLen[i]!);
            const prevL = Math.max(edgeLen[(i + n0 - 1) % n0]!, bLen[(i + n0 - 1) % n0]!);
            const nextL = Math.max(edgeLen[(i + 1) % n0]!, bLen[(i + 1) % n0]!);
            const neigh = Math.max(PAIR_SPACING_MIN_MM, Math.min(prevL, nextL));
            const ratioCap = neigh * NEIGHBOUR_SPACING_RATIO;
            let k = Math.max(0, Math.round(L / Math.max(target, 1e-6)) - 1);
            if (L > ratioCap + 1e-9) {
                k = Math.max(k, Math.ceil(L / ratioCap - 1e-9) - 1);
            }
            const kB = Math.max(0, Math.floor(bLen[i]! / PAIR_SPACING_MIN_MM) - 1);
            ks.push(Math.min(k, kB));
        }
        let passAdded = 0;
        for (let i = n0 - 1; i >= 0; i--) {
            const k = ks[i]!;
            if (k < 1) continue;
            passAdded += insertEvenK(stations, rimLocal, positions, indices, pattern, bounds, i, k, rimLoop);
        }
        added += passAdded;
        if (passAdded === 0) break;
    }
    if (added) {
        console.log("[S1-EVEN-SPLIT]", JSON.stringify({ added, n: stations.length }));
    }
    return added;
}

function insertEvenK(
    stations: HermiteStation[],
    rimLocal: number[],
    positions: number[],
    indices: number[],
    pattern: PolyPoint[],
    bounds: { minX: number; maxX: number },
    i: number,
    k: number,
    _rimLoop?: PolyPoint[],
): number {
    const n = stations.length;
    const cur = stations[i]!;
    const nxt = stations[(i + 1) % n]!;
    const prevRim = rimLocal[i]!;
    const endRim = rimLocal[(i + 1) % n]!;
    const Ra: PolyPoint = {
        x: positions[prevRim * 3]!,
        y: positions[prevRim * 3 + 1]!,
        z: positions[prevRim * 3 + 2]!,
    };
    const Rb: PolyPoint = {
        x: positions[endRim * 3]!,
        y: positions[endRim * 3 + 1]!,
        z: positions[endRim * 3 + 2]!,
    };
    const tB0 = cur.tB ?? parameterOnClosedLoop(cur.outline, pattern);
    const tB1 = nxt.tB ?? parameterOnClosedLoop(nxt.outline, pattern);
    const span = wrapParamDelta(tB0, tB1);
    if (Math.abs(span) < 1e-6) return 0;
    let inserted = 0;
    let edgeStart = prevRim;
    let insertAt = i;
    for (let j = 1; j <= k; j++) {
        const t = j / (k + 1);
        const R: PolyPoint = {
            x: Ra.x + (Rb.x - Ra.x) * t,
            y: Ra.y + (Rb.y - Ra.y) * t,
            z: Ra.z + (Rb.z - Ra.z) * t,
        };
        const tB = (((tB0 + span * t) % 1) + 1) % 1;
        const B = { ...sampleClosedAtArc01(pattern, tB), z: 0 };
        const left = stations[insertAt]!;
        const right = stations[(insertAt + 1) % stations.length]!;
        if (
            Math.hypot(B.x - left.outline.x, B.y - left.outline.y) < PAIR_SPACING_MIN_MM ||
            Math.hypot(B.x - right.outline.x, B.y - right.outline.y) < PAIR_SPACING_MIN_MM
        ) {
            continue;
        }
        const mid = positions.length / 3;
        positions.push(R.x, R.y, R.z);
        splitTopBoundaryEdge(indices, edgeStart, endRim, mid);
        const st = stationFromPair(R, B, left, right, bounds, tB);
        stations.splice(insertAt + 1, 0, st);
        rimLocal.splice(insertAt + 1, 0, mid);
        insertAt++;
        edgeStart = mid;
        inserted++;
    }
    return inserted;
}

/**
 * Slide B on the pattern toward square-to-B when |dot(h, nB)| < 0.3.
 * R stays on the source rim; B stays on the pattern between its neighbors.
 */
export function squarePairingsToB(stations: HermiteStation[], pattern: PolyPoint[]): number {
    if (stations.length < 3 || pattern.length < 3) return 0;
    let moved = 0;
    for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < stations.length; i++) {
            const st = stations[i]!;
            const nB = bLoopOutwardNormal(stations, i);
            const h = columnHeading(st).h;
            let n = { ...nB };
            if (h.x * n.x + h.y * n.y < 0) n = { x: -n.x, y: -n.y };
            const cosT = Math.max(0, Math.min(1, h.x * n.x + h.y * n.y));
            if (cosT >= COS_T_MIN - 1e-9) continue;
            const prev = stations[(i + stations.length - 1) % stations.length]!;
            const next = stations[(i + 1) % stations.length]!;
            const tPrev = prev.tB ?? parameterOnClosedLoop(prev.outline, pattern);
            const tNext = next.tB ?? parameterOnClosedLoop(next.outline, pattern);
            let t1 = tNext;
            if (t1 < tPrev - 0.5) t1 += 1;
            if (t1 > tPrev + 0.5) t1 -= 1;
            const span = t1 - tPrev;
            if (Math.abs(span) < 1e-6) continue;
            let bestT = st.tB ?? parameterOnClosedLoop(st.outline, pattern);
            let bestCos = cosT;
            const steps = 20;
            for (let k = 1; k < steps; k++) {
                const raw = tPrev + (span * k) / steps;
                const tUse = ((raw % 1) + 1) % 1;
                const B = sampleClosedAtArc01(pattern, tUse);
                if (
                    Math.hypot(B.x - prev.outline.x, B.y - prev.outline.y) < PAIR_SPACING_MIN_MM ||
                    Math.hypot(B.x - next.outline.x, B.y - next.outline.y) < PAIR_SPACING_MIN_MM
                ) {
                    continue;
                }
                const dx = B.x - st.rim.x;
                const dy = B.y - st.rim.y;
                const len = Math.hypot(dx, dy);
                if (len < 1e-4) continue;
                const hx = dx / len;
                const hy = dy / len;
                let nn = { ...nB };
                if (hx * nn.x + hy * nn.y < 0) nn = { x: -nn.x, y: -nn.y };
                const c = Math.max(0, Math.min(1, hx * nn.x + hy * nn.y));
                if (c > bestCos + 1e-9) {
                    bestCos = c;
                    bestT = tUse;
                }
                if (c >= COS_T_MIN - 1e-9) break;
            }
            if (bestCos <= cosT + 1e-9) continue;
            st.tB = ((bestT % 1) + 1) % 1;
            const B = sampleClosedAtArc01(pattern, st.tB);
            st.outline = { x: B.x, y: B.y, z: 0 };
            moved++;
        }
    }
    if (moved) console.log("[S1-SQUARE-B]", JSON.stringify({ moved, n: stations.length }));
    return moved;
}
