// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

/**
 * Device-wide hardness → gyroid infill %. Same five-level table as region
 * modifiers (hardness-class-table). Extra Soft / Soft densities are the 0.7 mm
 * line-width starting points; Medium / Hard / Extra Hard keep the ladder.
 * All values pending coupon validation.
 *
 * Keep values in lockstep with hardness-to-infill-pct.json (Python reads the JSON).
 */
import { HARDNESS_CLASS_TABLE, NAMED_HARDNESS_CLASSES } from "./hardness-class-table.js";

export const HARDNESS_TO_INFILL_PCT = {
    "Extra Soft": HARDNESS_CLASS_TABLE["Extra Soft"].sparseInfillDensityPct,
    Soft: HARDNESS_CLASS_TABLE.Soft.sparseInfillDensityPct,
    Medium: HARDNESS_CLASS_TABLE.Medium.sparseInfillDensityPct,
    Hard: HARDNESS_CLASS_TABLE.Hard.sparseInfillDensityPct,
    "Extra Hard": HARDNESS_CLASS_TABLE["Extra Hard"].sparseInfillDensityPct,
} as const;

export const HARDNESS_TABLE_SOURCE_CLASSES = NAMED_HARDNESS_CLASSES;
