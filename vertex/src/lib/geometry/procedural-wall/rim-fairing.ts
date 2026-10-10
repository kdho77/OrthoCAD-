// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { PolyPoint } from "./curves";

export type RimFairing = "exact" | "fair01";

export const RIM_TURN_EXEMPT_DEG = 15;
export const RIM_FAIR_MAX_MM = 0.1;

export function rimTurningDeg(pts: PolyPoint[], i: number): number {
    const n = pts.length;
    if (n < 3) return 0;
    const prev = pts[(i + n - 1) % n]!;
    const cur = pts[i]!;
    const next = pts[(i + 1) % n]!;
    const ax = cur.x - prev.x;
    const ay = cur.y - prev.y;
    const bx = next.x - cur.x;
    const by = next.y - cur.y;
    const al = Math.hypot(ax, ay) || 1;
    const bl = Math.hypot(bx, by) || 1;
    const d = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (al * bl)));
    return (Math.acos(d) * 180) / Math.PI;
}

export function tagStaircaseRim(pts: PolyPoint[], threshDeg = RIM_TURN_EXEMPT_DEG): boolean[] {
    return pts.map((_, i) => rimTurningDeg(pts, i) > threshDeg);
}

/** Laplacian fair in XY, each vertex stays within `maxMm` of the source (z unchanged). */
export function fairRim01(pts: PolyPoint[], maxMm = RIM_FAIR_MAX_MM): PolyPoint[] {
    const n = pts.length;
    if (n < 3) return pts.map((p) => ({ ...p }));
    const src = pts.map((p) => ({ ...p }));
    let cur = src.map((p) => ({ ...p }));
    for (let pass = 0; pass < 12; pass++) {
        const next = cur.map((p, i) => {
            const a = cur[(i + n - 1) % n]!;
            const b = cur[(i + 1) % n]!;
            let x = 0.25 * a.x + 0.5 * p.x + 0.25 * b.x;
            let y = 0.25 * a.y + 0.5 * p.y + 0.25 * b.y;
            const z = src[i]!.z;
            const dx = x - src[i]!.x;
            const dy = y - src[i]!.y;
            const d = Math.hypot(dx, dy);
            if (d > maxMm) {
                const s = maxMm / d;
                x = src[i]!.x + dx * s;
                y = src[i]!.y + dy * s;
            }
            return { x, y, z };
        });
        cur = next;
    }
    return cur;
}

export function stationsOnTaggedRim(
    stations: Array<{ rim: PolyPoint }>,
    tagged: PolyPoint[],
    tolMm = 0.3,
): boolean[] {
    return stations.map((st) =>
        tagged.some((p) => Math.hypot(st.rim.x - p.x, st.rim.y - p.y, st.rim.z - p.z) <= tolMm),
    );
}
