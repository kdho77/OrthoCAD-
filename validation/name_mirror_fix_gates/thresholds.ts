// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// Frozen on BASE 8aced4b5042bdafc2d300006fa80802bca1b94b9.
// Do not retune these to a worker.

/** BASE commit these numbers were measured against. */
export const BASE_SHA = "8aced4b5042bdafc2d300006fa80802bca1b94b9";

/** Synthetic string. Not a patient name. */
export const SYNTHETIC_NAME = "JABBOUR";

/** Bottom engrave depth on BASE (`BOTTOM_ENGRAVE.default`). */
export const G2_DEPTH_MM = 0.6;

/** Arch anchor on BASE (`BOTTOM_ANCHOR_U`). */
export const G2_PLACEMENT_U = 0.32;

export const G2_CAP_MM = 12;

export const G2_ROTATION_DEG = 0;

export const G2_NUDGE_MM = 0;

/**
 * Block centre of the beltPrint string on the frozen sole, both feet.
 * Filled from the identity run on BASE. Tolerance is absolute millimetres.
 */
/** Placement pivot on the frozen sole. An X mirror about this point does not move it. */
export const G2_CENTER_X_MM = 86.8;
export const G2_CENTER_Y_MM = 0;
export const G2_CENTER_TOL_MM = 0.05;

/** Mapped advance of JABBOUR at 12 mm bold on the frozen sole. Measured on BASE. */
export const G2_MAPPED_WIDTH_MM = 82.9933;
export const G2_WIDTH_TOL_MM = 0.05;

/** Left-to-right span of the glyph centroids in the physical camera. */
export const G1_MIN_ADVANCE_MM = 20;

/** J hook must clear the stem by this much on the lower left. */
export const G1_HOOK_CLEAR_MM = 1.5;
export const G1_HOOK_SLACK_MM = 0.75;

/**
 * Linear map from the font's +X/+Y glyph frame into the physical camera.
 * Advance must land on +screen X and the cap on +screen Y. Off-axis terms
 * stay small so a 90° pose is not accepted as "upright".
 */
export const G1_AXIS_MIN = 0.5;
export const G1_SKEW_MAX = 0.15;

/** Vertices outside the text region. Matches BASE `TEXT_OUTSIDE_IDENT_MM`. */
export const G3_OUTSIDE_IDENT_MM = 1e-4;

/** Pad around the glyph AABB. Matches BASE `TEXT_REGION_PAD_MM`. */
export const G3_REGION_PAD_MM = 1;

/** S1-PRELOFT skew cap is 0.5 × the column inset. */
export const SKEW_INSET_RATIO_BASE = 0.5;
