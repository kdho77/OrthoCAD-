// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { smoothstep } from "@/lib/geometry/height-field";
import { postRimBandFromAv } from "@/lib/geometry/post-edge-fillet";
import {
    clampPostFilletMm,
    clampPostTaperAngleDeg,
    DEFAULT_POST_FILLET_MM,
    DEFAULT_POST_TAPER_ANGLE_DEG,
} from "@/lib/geometry/track4-shared";

const NOMINAL_SHELL_EDGE_MM = 2;
const DEFAULT_DISTAL_TAPER_DISTANCE_MM = 20;

const DEG = Math.PI / 180;

export interface ShellEdgeDistalParams {
    shellEdgeThicknessMm?: number;
    distalTaperDistanceMm?: number;
    lengthMm: number;
    widthMm: number;
    postFilletMm?: number;
    postTaperAngleDeg?: number;
}

/**
 * Track 4 #5 — Rigid-shell edge + distal (printing_shell only).
 * Rim raise from nominal edge thickness, shared fillet/taper, distal wall shorten.
 */
export function shellEdgeDistalDeltaAt(u: number, av: number, params: ShellEdgeDistalParams): number {
    const edgeMm = params.shellEdgeThicknessMm ?? NOMINAL_SHELL_EDGE_MM;
    const fillet = clampPostFilletMm(params.postFilletMm ?? DEFAULT_POST_FILLET_MM);
    const taperDeg = clampPostTaperAngleDeg(params.postTaperAngleDeg ?? DEFAULT_POST_TAPER_ANGLE_DEG);
    const distalMm = params.distalTaperDistanceMm ?? DEFAULT_DISTAL_TAPER_DISTANCE_MM;
    const lengthMm = Math.max(params.lengthMm, 1e-6);
    const widthMm = params.widthMm;

    const rimExtra = Math.max(0, edgeMm - NOMINAL_SHELL_EDGE_MM);
    const rimMask = postRimBandFromAv(av, widthMm, fillet);
    const taperScale = 1 / (1 + Math.tan(taperDeg * DEG));
    const rimRaise = rimExtra * rimMask * taperScale;

    const distalU = Math.min(0.45, distalMm / lengthMm);
    const distalStart = 1 - distalU;
    const distalEnv = smoothstep(distalStart - 0.01, 1, u);
    const distalShorten = rimExtra * distalEnv * (0.35 + 0.65 * rimMask) * taperScale;

    return rimRaise - distalShorten;
}
