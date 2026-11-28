// Frozen rigid heel-lift cup-depth gates.
// Tolerances are the clinical limits from the 2026-11-24 grade brief.
// Seat rise is the full lift H at the lowest heel-seat point.
// Do not edit after the gates pull request is opened.

/** Seat rise at the lowest heel-seat point versus the full lift H. */
export const SEAT_TOL_MM = 0.3;

/** Change in (rim z − seat z) between lift H and lift 0. */
export const CUP_DEPTH_TOL_MM = 0.3;

/** Added foot-contact height at the met heads (u >= 0.75). */
export const MET_HEAD_TOL_MM = 0.1;

/** Print/belt bottom under the heel, and meshMinZ / plantarAbsMaxZ versus lift 0. */
export const BELT_TOL_MM = 0.1;

/**
 * Mesh-sample slack for the monotone taper. Station spacing is 0.15 u,
 * which is 1.2 mm of a linear taper at H = 6 and 2.4 mm at H = 12, so
 * 0.05 mm does not hide a rise toward the toe.
 */
export const MONOTONE_SLACK_MM = 0.05;

/** Centerline stations from the posterior heel up to, and not including, the taper end. */
export const STATION_U = [0.05, 0.15, 0.3, 0.45, 0.6] as const;

/** Taper end. Added height is read on centerline vertices with u in [MET_HEAD_U, MET_HEAD_U_HI]. */
export const MET_HEAD_U = 0.75;
export const MET_HEAD_U_HI = 0.78;

/**
 * Posterior heel-cup window on the composed top sheet.
 * u = 0 at the heel and 1 at the toe. v = 0 on the width centerline.
 */
export const HEEL_CUP_U_MIN = 0;
export const HEEL_CUP_U_MAX = 0.3;
export const HEEL_CUP_ABS_V_MAX = 0.5;

/** Centerline band for taper stations and the met-head sample. */
export const CENTER_ABS_V_MAX = 0.2;
export const STATION_DU = 0.02;

/** A rim vertex farther than this from the seat station is not the cup rim. */
export const RIM_DU_MAX = 0.02;

/** Vertices this close to z = 0 count as the print/belt bed face. */
export const BELT_FACE_Z_MM = 0.02;
export const BELT_FACE_MIN_COUNT = 500;
export const BELT_U_MAX = 0.2;

export const LIFT_MM = [6, 10, 12] as const;

export const BASE_SHA = "df78a4f1a6a657c4e72e15c14c797ad2f492669a";
