// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    FOREFOOT_INSET_MM,
    HEADING_MAX_DEG,
    OUTLINE_STATION_SPACING_MM,
    TOE_SPACING_EXTENT_FRAC,
} from "./bezier-column";
import type { PolyPoint } from "./curves";
import type { HermiteStation } from "./loft";
import { lerpClosedOnLoop } from "./stations";

const ARCH_FAN_U0 = 0.16;
const ARCH_FAN_U1 = 0.62;

const HEEL_U_MAX = 0.22;
const FORE_U_MIN = 0.78;

function inDenseBand(ua: number, ub: number): boolean {
    const heel = ua <= HEEL_U_MAX && ub <= HEEL_U_MAX;
    const fore = ua >= FORE_U_MIN && ub >= FORE_U_MIN;
    return heel || fore;
}

function splitEdge(indices: number[], a: number, b: number, m: number): void {
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
): void {
    const length = Math.max(1e-3, bounds.maxX - bounds.minX);
    const outSt: HermiteStation[] = [];
    const outRim: number[] = [];
    const n = stations.length;
    for (let i = 0; i < n; i++) {
        const cur = stations[i]!;
        outSt.push(cur);
        outRim.push(rimLocal[i]!);
        const nxt = stations[(i + 1) % n]!;
        if (!inDenseBand(cur.u, nxt.u)) continue;
        const dist = Math.hypot(nxt.outline.x - cur.outline.x, nxt.outline.y - cur.outline.y);
        if (dist <= OUTLINE_STATION_SPACING_MM || dist > 8) continue;
        const nAdd = Math.min(4, Math.ceil(dist / OUTLINE_STATION_SPACING_MM) - 1);
        let prevRim = rimLocal[i]!;
        const endRim = rimLocal[(i + 1) % n]!;
        for (let k = 1; k <= nAdd; k++) {
            const t = k / (nAdd + 1);
            const R = {
                x: cur.rim.x + (nxt.rim.x - cur.rim.x) * t,
                y: cur.rim.y + (nxt.rim.y - cur.rim.y) * t,
                z: cur.rim.z + (nxt.rim.z - cur.rim.z) * t,
            };
            const B = lerpClosedOnLoop(cur.outline, nxt.outline, t, outlineLoop);
            const nx = cur.n.x + (nxt.n.x - cur.n.x) * t;
            const ny = cur.n.y + (nxt.n.y - cur.n.y) * t;
            const nl = Math.hypot(nx, ny) || 1;
            const mid = positions.length / 3;
            positions.push(R.x, R.y, R.z);
            splitEdge(indices, prevRim, endRim, mid);
            prevRim = mid;
            outSt.push({
                outline: B,
                rim: R,
                n: { x: nx / nl, y: ny / nl },
                u: Math.max(0, Math.min(1, (B.x - bounds.minX) / length)),
            });
            outRim.push(mid);
        }
    }
    stations.length = 0;
    stations.push(...outSt);
    rimLocal.length = 0;
    rimLocal.push(...outRim);
}

const TOE_U_MIN = 0.76;

/**
 * Resample the toe so station spacing ≤ 0.5× the profile's plan inset.
 * After the 1 mm toe pin the extent is small; dense stations keep heading stable.
 */
export function densifyToeByExtent(
    stations: HermiteStation[],
    rimLocal: number[],
    positions: number[],
    indices: number[],
    outlineLoop: PolyPoint[],
    bounds: { minX: number; maxX: number },
): void {
    const length = Math.max(1e-3, bounds.maxX - bounds.minX);
    const outSt: HermiteStation[] = [];
    const outRim: number[] = [];
    const n = stations.length;
    for (let i = 0; i < n; i++) {
        const cur = stations[i]!;
        outSt.push(cur);
        outRim.push(rimLocal[i]!);
        const nxt = stations[(i + 1) % n]!;
        if (cur.u < TOE_U_MIN && nxt.u < TOE_U_MIN) continue;
        const dist = Math.hypot(nxt.outline.x - cur.outline.x, nxt.outline.y - cur.outline.y);
        const ext = Math.max(
            FOREFOOT_INSET_MM,
            Math.hypot(cur.outline.x - cur.rim.x, cur.outline.y - cur.rim.y),
            Math.hypot(nxt.outline.x - nxt.rim.x, nxt.outline.y - nxt.rim.y),
        );
        const cap = Math.max(0.35, TOE_SPACING_EXTENT_FRAC * ext);
        if (dist <= cap || dist > 8) continue;
        const nAdd = Math.min(6, Math.ceil(dist / cap) - 1);
        let prevRim = rimLocal[i]!;
        const endRim = rimLocal[(i + 1) % n]!;
        for (let k = 1; k <= nAdd; k++) {
            const t = k / (nAdd + 1);
            const R = {
                x: cur.rim.x + (nxt.rim.x - cur.rim.x) * t,
                y: cur.rim.y + (nxt.rim.y - cur.rim.y) * t,
                z: cur.rim.z + (nxt.rim.z - cur.rim.z) * t,
            };
            const B = lerpClosedOnLoop(cur.outline, nxt.outline, t, outlineLoop);
            const nx = cur.n.x + (nxt.n.x - cur.n.x) * t;
            const ny = cur.n.y + (nxt.n.y - cur.n.y) * t;
            const nl = Math.hypot(nx, ny) || 1;
            const mid = positions.length / 3;
            positions.push(R.x, R.y, R.z);
            splitEdge(indices, prevRim, endRim, mid);
            prevRim = mid;
            outSt.push({
                outline: B,
                rim: R,
                n: { x: nx / nl, y: ny / nl },
                u: Math.max(0, Math.min(1, (B.x - bounds.minX) / length)),
            });
            outRim.push(mid);
        }
    }
    stations.length = 0;
    stations.push(...outSt);
    rimLocal.length = 0;
    rimLocal.push(...outRim);
}

const CREASE_U_LO = 0.36;
const CREASE_U_HI = 0.39;

function spansCreaseU(ua: number, ub: number): boolean {
    const lo = Math.min(ua, ub);
    const hi = Math.max(ua, ub);
    return lo <= CREASE_U_HI && hi >= CREASE_U_LO;
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
    const length = Math.max(1e-3, bounds.maxX - bounds.minX);
    const outSt: HermiteStation[] = [];
    const outRim: number[] = [];
    const n = stations.length;
    for (let i = 0; i < n; i++) {
        const cur = stations[i]!;
        outSt.push(cur);
        outRim.push(rimLocal[i]!);
        const nxt = stations[(i + 1) % n]!;
        const distB = Math.hypot(nxt.outline.x - cur.outline.x, nxt.outline.y - cur.outline.y);
        const distR = Math.hypot(nxt.rim.x - cur.rim.x, nxt.rim.y - cur.rim.y, nxt.rim.z - cur.rim.z);
        const dist = Math.max(distB, distR);
        const need = dist > cap || (spansCreaseU(cur.u, nxt.u) && dist > Math.max(8, 1.2 * median));
        if (!need || dist < 1e-4) continue;
        const nAdd = Math.min(6, Math.max(1, Math.ceil(dist / cap) - 1));
        let prevRim = rimLocal[i]!;
        const endRim = rimLocal[(i + 1) % n]!;
        for (let k = 1; k <= nAdd; k++) {
            const t = k / (nAdd + 1);
            const R = {
                x: cur.rim.x + (nxt.rim.x - cur.rim.x) * t,
                y: cur.rim.y + (nxt.rim.y - cur.rim.y) * t,
                z: cur.rim.z + (nxt.rim.z - cur.rim.z) * t,
            };
            const B = lerpClosedOnLoop(cur.outline, nxt.outline, t, outlineLoop);
            const nx = cur.n.x + (nxt.n.x - cur.n.x) * t;
            const ny = cur.n.y + (nxt.n.y - cur.n.y) * t;
            const nl = Math.hypot(nx, ny) || 1;
            const mid = positions.length / 3;
            positions.push(R.x, R.y, R.z);
            splitEdge(indices, prevRim, endRim, mid);
            prevRim = mid;
            outSt.push({
                outline: B,
                rim: R,
                n: { x: nx / nl, y: ny / nl },
                u: Math.max(0, Math.min(1, (B.x - bounds.minX) / length)),
            });
            outRim.push(mid);
        }
    }
    stations.length = 0;
    stations.push(...outSt);
    rimLocal.length = 0;
    rimLocal.push(...outRim);
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
    const length = Math.max(1e-3, bounds.maxX - bounds.minX);
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
        const R = {
            x: cur.rim.x + (nxt.rim.x - cur.rim.x) * t,
            y: cur.rim.y + (nxt.rim.y - cur.rim.y) * t,
            z: cur.rim.z + (nxt.rim.z - cur.rim.z) * t,
        };
        const B = lerpClosedOnLoop(cur.outline, nxt.outline, t, outlineLoop);
        const nx = cur.n.x + (nxt.n.x - cur.n.x) * t;
        const ny = cur.n.y + (nxt.n.y - cur.n.y) * t;
        const nl = Math.hypot(nx, ny) || 1;
        const mid = positions.length / 3;
        positions.push(R.x, R.y, R.z);
        splitEdge(indices, rimLocal[seg]!, rimLocal[(seg + 1) % n]!, mid);
        outSt.push({
            outline: B,
            rim: R,
            n: { x: nx / nl, y: ny / nl },
            u: Math.max(0, Math.min(1, (B.x - bounds.minX) / length)),
        });
        outRim.push(mid);
    }
    if (outSt.length < 3) return;
    stations.length = 0;
    stations.push(...outSt);
    rimLocal.length = 0;
    rimLocal.push(...outRim);
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

function headingDeltaDeg(a: HermiteStation, b: HermiteStation): number {
    const ha = planHeading(a);
    const hb = planHeading(b);
    const d = Math.max(-1, Math.min(1, ha.x * hb.x + ha.y * hb.y));
    return (Math.acos(d) * 180) / Math.PI;
}

/**
 * Densify rim stations where columns fan (pattern not parallel to the rim).
 * Density follows the pattern/rim length ratio and the 3° heading budget.
 */
export function densifyArchFanStations(
    stations: HermiteStation[],
    rimLocal: number[],
    positions: number[],
    indices: number[],
    outlineLoop: PolyPoint[],
    bounds: { minX: number; maxX: number },
): void {
    if (stations.length < 3) return;
    const length = Math.max(1e-3, bounds.maxX - bounds.minX);
    const outSt: HermiteStation[] = [];
    const outRim: number[] = [];
    const n = stations.length;
    for (let i = 0; i < n; i++) {
        const cur = stations[i]!;
        outSt.push(cur);
        outRim.push(rimLocal[i]!);
        const nxt = stations[(i + 1) % n]!;
        const inArch =
            (cur.u >= ARCH_FAN_U0 && cur.u <= ARCH_FAN_U1) || (nxt.u >= ARCH_FAN_U0 && nxt.u <= ARCH_FAN_U1);
        const dsR = Math.hypot(nxt.rim.x - cur.rim.x, nxt.rim.y - cur.rim.y);
        const dsB = Math.hypot(nxt.outline.x - cur.outline.x, nxt.outline.y - cur.outline.y);
        const ratio = dsB / Math.max(dsR, 1e-6);
        const head = headingDeltaDeg(cur, nxt);
        const needHead = head > HEADING_MAX_DEG + 1e-6;
        const needRatio = inArch && (ratio > 1.35 || ratio < 0.7) && dsR > 1.2;
        if ((!needHead && !needRatio) || dsR < 0.4) continue;
        const nFromHead = needHead ? Math.ceil(head / HEADING_MAX_DEG) - 1 : 0;
        const nFromRatio = needRatio
            ? Math.max(1, Math.round(Math.max(ratio, 1 / Math.max(ratio, 1e-6))))
            : 0;
        const nAdd = Math.min(8, Math.max(nFromHead, nFromRatio));
        if (nAdd < 1) continue;
        let prevRim = rimLocal[i]!;
        const endRim = rimLocal[(i + 1) % n]!;
        for (let k = 1; k <= nAdd; k++) {
            const t = k / (nAdd + 1);
            const R = {
                x: cur.rim.x + (nxt.rim.x - cur.rim.x) * t,
                y: cur.rim.y + (nxt.rim.y - cur.rim.y) * t,
                z: cur.rim.z + (nxt.rim.z - cur.rim.z) * t,
            };
            const B = lerpClosedOnLoop(cur.outline, nxt.outline, t, outlineLoop);
            const nx = cur.n.x + (nxt.n.x - cur.n.x) * t;
            const ny = cur.n.y + (nxt.n.y - cur.n.y) * t;
            const nl = Math.hypot(nx, ny) || 1;
            const mid = positions.length / 3;
            positions.push(R.x, R.y, R.z);
            splitEdge(indices, prevRim, endRim, mid);
            prevRim = mid;
            outSt.push({
                outline: B,
                rim: R,
                n: { x: nx / nl, y: ny / nl },
                u: Math.max(0, Math.min(1, (B.x - bounds.minX) / length)),
            });
            outRim.push(mid);
        }
    }
    stations.length = 0;
    stations.push(...outSt);
    rimLocal.length = 0;
    rimLocal.push(...outRim);
}
