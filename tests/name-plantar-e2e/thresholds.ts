// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// Chirality numbers ported from #435 (cursor/name-mirror-fix-gates-1124 @ 21b9bef3,
// validation/name_mirror_fix_gates/thresholds.ts). Do not loosen them.

/** Left-to-right span of the glyph centroids in the physical reading frame. */
export const G1_MIN_ADVANCE_MM = 20;

/** J hook must clear the stem by this much on the lower left. */
export const G1_HOOK_CLEAR_MM = 1.5;
export const G1_HOOK_SLACK_MM = 0.75;

/**
 * Linear map from the font's +X/+Y glyph frame into the physical reading frame.
 * Advance must land on +reading X and the cap on +reading Y.
 */
export const G1_AXIS_MIN = 0.5;
export const G1_SKEW_MAX = 0.15;

/** Synthetic string. Not a patient name. Same as #435. */
export const SYNTHETIC_NAME = "JABBOUR";

/** Belt-contact band from the calibrated physical frame (hand_classify.py). */
export const BELT_CONTACT_Y_MM = 0.6;

/** Engrave-depth band used only when the contact band has no readable name. */
export const ENGRAVE_Y_MM = 1.6;
