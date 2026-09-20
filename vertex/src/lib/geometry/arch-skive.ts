// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { bump } from "@/lib/geometry/height-field";
import type { ArchSkiveSide, Side } from "@/types";

/**
 * Midfoot arch skive — DISTINCT from Kirby heel skive (heel-skive.ts).
 *
 * Clinical intent: localized intrinsic raise under the arch band for posting
 * relief / intrinsic correction at the midfoot. Uses its own longitudinal u-mask
 * over the arch ellipse; never shares heel SKIVE_U_REF / heelSkiveMask.
 */

export const ARCH_SKIVE_U_CENTER = 0.42;
export const ARCH_SKIVE_U_RADIUS = 0.22;
export const ARCH_SKIVE_DEPTH_MAX_MM = 6;
export const ARCH_SKIVE_GATE_TOL_MM = 0.3;

function smoothstep(e0: number, e1: number, x: number): number {
    if (e0 === e1) return x < e0 ? 0 : 1;
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
}

/** Longitudinal midfoot mask (0 outside arch ellipse). */
export function archSkiveUMask(u: number): number {
    return bump(u, ARCH_SKIVE_U_CENTER, ARCH_SKIVE_U_RADIUS);
}

/**
 * Lateral emphasis for medial / lateral / central arch skive.
 * Returns 0..1 weight at normalized |vSigned|.
 */
export function archSkiveAcrossMask(vSigned: number, side: Side, archSide: ArchSkiveSide): number {
    const av = Math.abs(vSigned);
    if (archSide === "central") {
        return smoothstep(1.0, 0.35, av);
    }
    const medialSign = side === "left" ? -1 : 1;
    const m = -(vSigned * medialSign);
    if (archSide === "medial") {
        return smoothstep(-0.15, 0.55, m) * smoothstep(1.0, 0.5, av);
    }
    return smoothstep(-0.15, 0.55, -m) * smoothstep(1.0, 0.5, av);
}

export function archSkiveCombinedMask(
    u: number,
    vSigned: number,
    side: Side,
    archSide: ArchSkiveSide,
): number {
    return archSkiveUMask(u) * archSkiveAcrossMask(vSigned, side, archSide);
}

export function clampArchSkiveDepthMm(mm: number): number {
    return Math.max(0, Math.min(ARCH_SKIVE_DEPTH_MAX_MM, mm));
}

export interface ApplyArchSkiveMeshParams {
    side: Side;
    archSkiveMm: number;
    archSkiveSide: ArchSkiveSide;
    lengthAxis: 0 | 1 | 2;
    widthAxis: 0 | 1 | 2;
    thickAxis: 0 | 1 | 2;
    lenMin: number;
    lenSize: number;
    topVertexCount: number;
    widthSign: number;
}

/**
 * Top-mesh-only raise in the arch skive band (plane tilt from medial→lateral).
 * Excluded from field-F / bottom-shell sync (applied post-sync like heel skive).
 */
export function applyArchSkiveToTopMesh(positions: Float32Array, params: ApplyArchSkiveMeshParams): number {
    const depth = clampArchSkiveDepthMm(params.archSkiveMm);
    if (depth <= 0) return 0;

    const { side, archSkiveSide, lengthAxis, widthAxis, thickAxis, lenMin, lenSize, topVertexCount } = params;

    let maxRaise = 0;
    let raised = 0;

    for (let i = 0; i < topVertexCount; i++) {
        const u = (positions[i * 3 + lengthAxis]! - lenMin) / (lenSize || 1);
        const y = positions[i * 3 + widthAxis]!;
        const vSigned = y * params.widthSign;
        const mask = archSkiveCombinedMask(u, vSigned, side, archSkiveSide);
        if (mask <= 1e-6) continue;

        const z = positions[i * 3 + thickAxis]!;
        const raise = depth * mask;
        const zNew = z + raise;
        if (zNew > z + 1e-9) {
            positions[i * 3 + thickAxis] = zNew;
            raised++;
            if (raise > maxRaise) maxRaise = raise;
        }
    }

    return maxRaise;
}

/**
 * Expected raise at one-third of arch width from the targeted edge (gate metric).
 */
export function archSkiveDepthAtThirdWidth(
    depthMm: number,
    archSide: ArchSkiveSide,
    u: number = ARCH_SKIVE_U_CENTER,
): number {
    const d = clampArchSkiveDepthMm(depthMm);
    if (d <= 0) return 0;
    const uMask = archSkiveUMask(u);
    if (uMask <= 1e-6) return 0;
    // At 1/3 from medial/lateral edge the across-mask is ≈0.78 for medial/lateral targets.
    const across =
        archSide === "central"
            ? archSkiveAcrossMask(0, "right", "central")
            : archSide === "medial"
              ? archSkiveAcrossMask(-1 / 3, "right", "medial")
              : archSkiveAcrossMask(1 / 3, "right", "lateral");
    return d * uMask * across;
}
