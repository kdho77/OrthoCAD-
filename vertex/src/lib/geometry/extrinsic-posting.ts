// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { smoothstep } from "@/lib/geometry/height-field";
import { postPerimeterFalloffFromAv } from "@/lib/geometry/post-edge-fillet";
import { SHELL_ZONE_MF_END_U, SHELL_ZONE_RF_END_U } from "@/lib/geometry/shell-thickness-zonal";
import {
    clampPostFilletMm,
    clampPostTaperAngleDeg,
    DEFAULT_POST_FILLET_MM,
    DEFAULT_POST_TAPER_ANGLE_DEG,
} from "@/lib/geometry/track4-shared";
import type { PostingPolarity, Side, SideCorrections } from "@/types";

const DEG = Math.PI / 180;
const GRIND_ANGLE_CAP_DEG = 8;

export interface ExtrinsicPostingParams {
    postFilletMm?: number;
    postTaperAngleDeg?: number;
    widthMm: number;
}

function polaritySign(polarity?: PostingPolarity): number {
    return polarity === "supination" ? -1 : 1;
}

function rfZoneFactor(u: number): number {
    return 1 - smoothstep(SHELL_ZONE_RF_END_U - 0.02, SHELL_ZONE_RF_END_U + 0.06, u);
}

function ffZoneFactor(u: number): number {
    return smoothstep(SHELL_ZONE_MF_END_U - 0.04, SHELL_ZONE_MF_END_U + 0.12, u);
}

/**
 * Bottom-surface extrinsic posting wedge (mm, negative = grow material downward).
 * Contact/top contour unchanged — applied only on plantar bottom verts.
 */
export function extrinsicPostingBottomDeltaAt(
    u: number,
    vSigned: number,
    side: Side,
    corrections: SideCorrections,
    params: ExtrinsicPostingParams,
): number {
    const rfH = corrections.extrinsicPostingRfMm ?? 0;
    const ffH = corrections.extrinsicPostingFfMm ?? 0;
    if (rfH === 0 && ffH === 0) return 0;

    const fillet = clampPostFilletMm(params.postFilletMm ?? DEFAULT_POST_FILLET_MM);
    const taperDeg = Math.min(
        GRIND_ANGLE_CAP_DEG,
        clampPostTaperAngleDeg(params.postTaperAngleDeg ?? DEFAULT_POST_TAPER_ANGLE_DEG),
    );
    const pol = polaritySign(corrections.extrinsicPostingPolarity);

    const medialSign = side === "left" ? -1 : 1;
    const ml = -(vSigned * medialSign) * pol;
    const av = Math.abs(vSigned);
    const edgeTaper = postPerimeterFalloffFromAv(av, params.widthMm, fillet);
    const angleTaper = 1 / (1 + Math.tan(taperDeg * DEG));

    const h = rfH * rfZoneFactor(u) + ffH * ffZoneFactor(u);
    if (h <= 0) return 0;

    const highSide = smoothstep(0, 0.85, ml);
    const magnitude = h * highSide * edgeTaper * angleTaper;
    return -magnitude;
}
