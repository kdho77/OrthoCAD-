// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/** Shared posting / shell-edge fillet (mm). */
export const DEFAULT_POST_FILLET_MM = 2.0;
export const POST_FILLET_MM_MIN = 0.5;
export const POST_FILLET_MM_MAX = 6.0;

/** Shared taper angle (deg) for intrinsic free-edges, posting blocks, rigid-shell edges. */
export const DEFAULT_POST_TAPER_ANGLE_DEG = 15;
export const POST_TAPER_ANGLE_DEG_MIN = 5;
export const POST_TAPER_ANGLE_DEG_MAX = 45;

export const MIN_SHELL_WALL_MM = 0.8;

export function clampPostFilletMm(mm: number): number {
    return Math.max(POST_FILLET_MM_MIN, Math.min(POST_FILLET_MM_MAX, mm));
}

export function clampPostTaperAngleDeg(deg: number): number {
    return Math.max(POST_TAPER_ANGLE_DEG_MIN, Math.min(POST_TAPER_ANGLE_DEG_MAX, deg));
}
