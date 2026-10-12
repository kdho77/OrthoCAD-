// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Sole-UV frame derived from a closed BottomOutline (XY only).
 * No wall-topology dependency: half-width comes from the outline's own
 * medial/lateral extent at each longitudinal station.
 */

import type { PolyPoint } from "./curves";
import type { BottomOutline } from "./types";

export interface SoleUvFrame {
    minX: number;
    maxX: number;
    lengthMm: number;
    /** Half-width (mm) at `stations` samples along X. */
    halfWidth: Float64Array;
    stations: number;
}

/** Canonical zone fixtures in sole-UV (u along length, vSigned across width). */
export const ZONE_FIXTURES = {
    F1: { id: "F1", label: "heel pad", u: 0.12, vSigned: 0 },
    F2: { id: "F2", label: "medial arch", u: 0.4, vSigned: 0.55 },
    F2b: { id: "F2b", label: "lateral midfoot", u: 0.4, vSigned: -0.55 },
    F3: { id: "F3", label: "forefoot / mets", u: 0.75, vSigned: 0 },
} as const;

export type ZoneFixtureId = keyof typeof ZONE_FIXTURES;

export function soleUvFrameFromPolyline(poly: PolyPoint[], stations = 64): SoleUvFrame {
    let minX = Infinity;
    let maxX = -Infinity;
    for (const p of poly) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
    }
    const lengthMm = Math.max(1e-3, maxX - minX);
    const pos = new Float64Array(stations).fill(0);
    const neg = new Float64Array(stations).fill(0);
    const posN = new Uint16Array(stations);
    const negN = new Uint16Array(stations);
    for (const p of poly) {
        const s = Math.max(0, Math.min(stations - 1, Math.round(((p.x - minX) / lengthMm) * (stations - 1))));
        if (p.y >= 0) {
            pos[s] = Math.max(pos[s]!, p.y);
            posN[s]!++;
        } else {
            neg[s] = Math.max(neg[s]!, -p.y);
            negN[s]!++;
        }
    }
    const fill = (arr: Float64Array, counts: Uint16Array) => {
        let last = 1;
        for (let i = 0; i < stations; i++) {
            if (counts[i]) last = arr[i]!;
            else arr[i] = last;
        }
        last = arr[stations - 1] || last;
        for (let i = stations - 1; i >= 0; i--) {
            if (counts[i]) last = arr[i]!;
            else arr[i] = Math.max(arr[i]!, last);
        }
    };
    fill(pos, posN);
    fill(neg, negN);
    const halfWidth = new Float64Array(stations);
    for (let i = 0; i < stations; i++) halfWidth[i] = Math.max(pos[i]!, neg[i]!, 1e-3);
    return { minX, maxX, lengthMm, halfWidth, stations };
}

export function soleUvFrameFromOutline(outline: BottomOutline, stations = 64): SoleUvFrame {
    // Frame comes from the BottomOutline spline controls (XY only). No wall topology.
    return soleUvFrameFromPolyline(outline.spline.controls, stations);
}

export function xyFromSoleUv(frame: SoleUvFrame, u: number, vSigned: number): { x: number; y: number } {
    const uu = Math.max(0, Math.min(1, u));
    const x = frame.minX + uu * frame.lengthMm;
    const s = uu * (frame.stations - 1);
    const i0 = Math.max(0, Math.min(frame.stations - 2, Math.floor(s)));
    const f = s - i0;
    const hw = frame.halfWidth[i0]! * (1 - f) + frame.halfWidth[i0 + 1]! * f;
    return { x, y: vSigned * hw };
}

export function uvFromSoleXy(frame: SoleUvFrame, x: number, y: number): { u: number; vSigned: number } {
    const u = Math.max(0, Math.min(1, (x - frame.minX) / frame.lengthMm));
    const s = u * (frame.stations - 1);
    const i0 = Math.max(0, Math.min(frame.stations - 2, Math.floor(s)));
    const f = s - i0;
    const hw = frame.halfWidth[i0]! * (1 - f) + frame.halfWidth[i0 + 1]! * f;
    return { u, vSigned: Math.max(-1, Math.min(1, y / Math.max(hw, 1e-6))) };
}

export interface ZoneFixtureMap {
    id: ZoneFixtureId;
    uv: { u: number; vSigned: number };
    xy: { x: number; y: number };
}

export function mapZoneFixtures(frame: SoleUvFrame): ZoneFixtureMap[] {
    return (Object.keys(ZONE_FIXTURES) as ZoneFixtureId[]).map((id) => {
        const uv = ZONE_FIXTURES[id];
        return { id, uv: { u: uv.u, vSigned: uv.vSigned }, xy: xyFromSoleUv(frame, uv.u, uv.vSigned) };
    });
}

/** True when F1/F2/F2b/F3 map to the same XY (and invert back to the same UV). */
export function zoneFixturesMapIdentically(
    a: SoleUvFrame,
    b: SoleUvFrame,
    xyTolMm = 0.15,
    uvTol = 0.01,
): boolean {
    const ma = mapZoneFixtures(a);
    const mb = mapZoneFixtures(b);
    for (let i = 0; i < ma.length; i++) {
        const pa = ma[i]!;
        const pb = mb[i]!;
        if (Math.hypot(pa.xy.x - pb.xy.x, pa.xy.y - pb.xy.y) > xyTolMm) return false;
        const ua = uvFromSoleXy(a, pa.xy.x, pa.xy.y);
        const ub = uvFromSoleXy(b, pb.xy.x, pb.xy.y);
        if (Math.abs(ua.u - ub.u) > uvTol || Math.abs(ua.vSigned - ub.vSigned) > uvTol) return false;
    }
    return true;
}
