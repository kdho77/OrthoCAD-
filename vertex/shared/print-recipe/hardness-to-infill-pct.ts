// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Device-wide hardness → gyroid infill %. Same five-level table as region
 * modifiers (hardness-class-table). Extra Soft / Soft stay 16 / 22% at 0.7 mm;
 * Medium stays 26% at 1.0 mm; Hard / Extra Hard are 26 / 30% at 1.2 mm.
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
