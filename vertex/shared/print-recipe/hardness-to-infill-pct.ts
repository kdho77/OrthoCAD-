// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Locked clinical hardness → gyroid infill % (Biomechanics 2026-09-20).
 *
 * Keep values in lockstep with hardness-to-infill-pct.json (Python reads the JSON).
 * This is a .ts module so the Vercel Node ESM function can import it without
 * `with { type: "json" }` (ERR_IMPORT_ATTRIBUTE_MISSING).
 */
export const HARDNESS_TO_INFILL_PCT = {
    "Extra Soft": 14,
    Soft: 20,
    Medium: 26,
    Hard: 32,
    "Extra Hard": 38,
} as const;
