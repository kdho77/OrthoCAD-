// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Side, SideCorrections } from "@/types";
import { effectiveOutlineHalfWidth, type TrimlineCurve } from "@/lib/geometry/trimline";

/**
 * Medial/Lateral wedge system (Phase 3A).
 *
 * These are surface modifications applied only to the plantar (top/foot-contact)
 * surface of the insole. The bottom surface remains the flat z=0 plane.
 *
 * Per-zone (rearfoot/forefoot) the user may specify either a medial or lateral
 * wedge (mutually exclusive). Input may be absolute millimeters or an angle
 * (degrees). Degrees are resolved against the *current* local width at each
 * station u (trimline-aware) so the physical ramp angle stays constant when the
 * footbed outline changes.
 *
 * The effect tapers linearly from the raised edge (full raise) to zero on the
 * opposite edge, modulated by a smooth zone factor so the wedge fades in the
 * midfoot.
 */

export interface WedgeParams {
    lengthMm: number;
    widthMm: number;
    trimline?: TrimlineCurve | null;
}

// Zone fade boundaries (tunable; keep in sync with documentation / tests)
const REARFOOT_WEDGE_START_FADE = 0.3;
const REARFOOT_WEDGE_END_FADE = 0.45;
const FOREFOOT_WEDGE_START_FADE = 0.55;
const FOREFOOT_WEDGE_END_FADE = 0.7;

/** Local smoothstep (duplicated from height-field.ts for module independence / no circular import). */
function smoothstep(e0: number, e1: number, x: number): number {
    if (e0 === e1) return x < e0 ? 0 : 1;
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
}

export function getRearfootFactor(u: number): number {
    return 1 - smoothstep(REARFOOT_WEDGE_START_FADE, REARFOOT_WEDGE_END_FADE, u);
}

export function getForefootFactor(u: number): number {
    return smoothstep(FOREFOOT_WEDGE_START_FADE, FOREFOOT_WEDGE_END_FADE, u);
}

/**
 * Computes the additive height contribution (mm, positive = raise) of the
 * medial/lateral wedge system at a normalized footprint coordinate.
 *
 * This is the public entry point. It sums rearfoot + forefoot contributions
 * (they may overlap slightly in the midfoot fade region).
 */
export function wedgeDeltaAt(
    u: number,
    vSigned: number,
    side: Side,
    corrections: SideCorrections,
    params: WedgeParams
): number {
    let d = 0;

    if (corrections.rearfootWedge) {
        d += zoneWedgeDelta(u, vSigned, side, corrections.rearfootWedge, "rearfoot", params);
    }
    if (corrections.forefootWedge) {
        d += zoneWedgeDelta(u, vSigned, side, corrections.forefootWedge, "forefoot", params);
    }

    return d;
}

function zoneWedgeDelta(
    u: number,
    vSigned: number,
    side: Side,
    wedge: NonNullable<SideCorrections["rearfootWedge"]>,
    zone: "rearfoot" | "forefoot",
    params: WedgeParams
): number {
    const zoneFactor = zone === "rearfoot" ? getRearfootFactor(u) : getForefootFactor(u);
    if (zoneFactor <= 0) return 0;

    // Current effective full width at station u (respects active trimline)
    const halfWidthFactor = effectiveOutlineHalfWidth(
        u,
        params.lengthMm,
        params.widthMm,
        params.trimline
    );
    const localFullWidth = 2 * halfWidthFactor * (params.widthMm / 2);

    // Edge case: zero or negative width (extreme trimline) -> no raise for degrees; mm still applies absolute but taper will be narrow
    if (localFullWidth <= 0) {
        if (wedge.unit === "deg") return 0;
        // For mm we still allow the value (steep ramp on remaining sliver)
    }

    // Resolve the physical raise height at the raised edge.
    // mm: absolute lift on the chosen edge.
    // deg: angle -> height using current local width (constant angle behavior).
    let maxRaise: number;
    if (wedge.unit === "mm") {
        maxRaise = Math.max(0, wedge.value);
    } else {
        // Clamp radians to sensible range to avoid NaN/Inf on extreme input (UI should prevent)
        const deg = Math.max(0, Math.min(wedge.value, 45)); // clinical soft cap inside logic
        const radians = (deg * Math.PI) / 180;
        maxRaise = localFullWidth * Math.tan(radians);
    }

    // Cross position in the *current* outline space at this u.
    // m = +1 at medial edge, -1 at lateral edge (consistent with heightAt medialBlend).
    // vSigned outside [-1,1] is clamped for safety (defensive).
    const medialSign = side === "left" ? -1 : 1;
    const m = -(Math.max(-1, Math.min(1, vSigned)) * medialSign);
    const crossMedialToLateral = Math.max(0, Math.min(1, (1 - m) / 2));

    const isMedial = wedge.side === "medial";
    // taper = 1.0 at the raised edge, 0.0 at the opposite edge
    const taper = isMedial ? (1 - crossMedialToLateral) : crossMedialToLateral;

    return maxRaise * taper * zoneFactor;
}