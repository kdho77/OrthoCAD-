// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BIO_INTRINSIC_POST_SIGN_POSITIVE_MM_MEDIAL_HIGH } from "@/lib/geometry/biomech-signs";
import { postPerimeterFalloffFromAv } from "@/lib/geometry/post-edge-fillet";
import { SHELL_ZONE_MF_END_U, SHELL_ZONE_RF_END_U } from "@/lib/geometry/shell-thickness-zonal";
import { DEFAULT_POST_FILLET_MM } from "@/lib/geometry/track4-shared";
import type { Side, SideCorrections } from "@/types";

/** @deprecated Use {@link BIO_INTRINSIC_POST_SIGN_POSITIVE_MM_MEDIAL_HIGH}. */
export const INTRINSIC_POST_MEDIAL_HIGH_SIGN = BIO_INTRINSIC_POST_SIGN_POSITIVE_MM_MEDIAL_HIGH;

export interface IntrinsicPostParams {
    widthMm: number;
    postFilletMm?: number;
}

function smoothstep(e0: number, e1: number, x: number): number {
    if (e0 === e1) return x < e0 ? 0 : 1;
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
}

function rfIntrinsicEnvelope(u: number): number {
    const core = 1 - smoothstep(SHELL_ZONE_RF_END_U - 0.04, SHELL_ZONE_RF_END_U + 0.08, u);
    const mfBlend = 1 - smoothstep(SHELL_ZONE_RF_END_U, SHELL_ZONE_MF_END_U, u);
    return core * mfBlend;
}

function ffIntrinsicEnvelope(u: number): number {
    return smoothstep(SHELL_ZONE_MF_END_U - 0.06, SHELL_ZONE_MF_END_U + 0.1, u);
}

/**
 * Intrinsic post height (mm) on the contact surface only — DISTINCT from deg wedges
 * and extrinsic posting blocks.
 *
 * Signed prescription mm (Bio LOCKED): +mm ⇒ medial high; −mm ⇒ lateral high.
 *
 * Half-amplitude ramp: Δz = 0.5 · h(u) · s(v) · edge(av), s ∈ [-1, 1] medial-lateral.
 * |Z_med − Z_lat| = |h| at fillet-inset coronal QC (±0.3 mm). +h / −h via signed h.
 */
export function intrinsicPostDeltaAt(
    u: number,
    vSigned: number,
    side: Side,
    corrections: SideCorrections,
    params: IntrinsicPostParams,
): number {
    const rf = corrections.intrinsicPostRfMm ?? 0;
    const ff = corrections.intrinsicPostFfMm ?? 0;
    if (rf === 0 && ff === 0) return 0;

    const h = rf * rfIntrinsicEnvelope(u) + ff * ffIntrinsicEnvelope(u);
    if (h === 0) return 0;

    const medialSign = side === "left" ? -1 : 1;
    const ml = -(vSigned * medialSign) * BIO_INTRINSIC_POST_SIGN_POSITIVE_MM_MEDIAL_HIGH;
    const s = Math.max(-1, Math.min(1, ml));
    const av = Math.abs(vSigned);
    const edge = postPerimeterFalloffFromAv(
        av,
        params.widthMm,
        params.postFilletMm ?? DEFAULT_POST_FILLET_MM,
    );
    return 0.5 * h * s * edge;
}

/** Medial-lateral height at a coronal slice (u fixed) for QC gates. */
export function intrinsicPostMedialLateralDeltaMm(
    u: number,
    side: Side,
    corrections: SideCorrections,
    medialV: number,
    lateralV: number,
    params: IntrinsicPostParams,
): number {
    const zm = intrinsicPostDeltaAt(u, medialV, side, corrections, params);
    const zl = intrinsicPostDeltaAt(u, lateralV, side, corrections, params);
    return zm - zl;
}
