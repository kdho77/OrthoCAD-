// Frozen heel-lift cup-depth gates.
// Tolerances are the clinical limits from the grade brief.
// Do not edit after the gates pull request is opened.

/** Posterior-heel seat rise vs H, or vs heelLiftDeltaAt(u, H). */
export const SEAT_TOL_MM = 0.2;

/** |Δ(rim z − seat z)| between lift H and lift 0. */
export const CUP_DEPTH_TOL_MM = 0.2;

/** Added foot-contact height at the met heads (u = 0.75). */
export const MET_HEAD_TOL_MM = 0.1;

/** Print/belt bottom under the heel, absolute z. */
export const BELT_TOL_MM = 0.1;

/**
 * Mesh-sample slack for the monotone taper. Station spacing is 0.15 u,
 * which is 1.2 mm of taper at H = 6 and 2.4 mm at H = 12, so 0.05 mm
 * does not hide a rise toward the toe.
 */
export const MONOTONE_SLACK_MM = 0.05;

/** Foot-contact stations from the posterior heel through the met heads. */
export const STATION_U = [0.05, 0.15, 0.3, 0.45, 0.6, 0.75] as const;

export const MET_HEAD_U = 0.75;

export const LIFT_MM = [6, 12] as const;

export const BASE_SHA = "8aced4b5042bdafc2d300006fa80802bca1b94b9";
