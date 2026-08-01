// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Clinical / numerical constants for scan-driven correction fitting.
 * FIXED BY DISPATCH CONTRACT — do not derive, tune, or "optimize".
 */

// Soft-tissue compliance. The scanned plantar contour is undeformed;
// medial midfoot soft tissue deforms 2-5mm under load. Fitting 100% of
// the measured gap replaces plantar fascial tensile stress with a
// compressive stress concentration at the arch apex. This factor is the
// digital equivalent of arch fill in the plaster workflow.
// FLAGGED FOR PHYSICAL PRINT VALIDATION.
export const SCAN_FIT_ARCH_COMPLIANCE = 0.85;

// Heel fat pad expands radially and flattens 3-6mm under load. Unloaded
// contour over-cups. FLAGGED FOR PHYSICAL PRINT VALIDATION.
export const SCAN_FIT_HEEL_COMPLIANCE = 0.7;

// Heel cup depth is clinically prescribed, not contour-derived. The scan
// fit is ADVISORY ONLY and clamped to the standard clinical window.
export const SCAN_FIT_HEELCUP_MIN_MM = 8.0;
export const SCAN_FIT_HEELCUP_MAX_MM = 20.0;

// Registration rigid-body residual beyond these bounds means the fit is
// reading alignment error, not anatomy. Block auto-apply above these.
export const SCAN_FIT_MAX_MEAN_OFFSET_MM = 2.0;
export const SCAN_FIT_MAX_PITCH_DEG = 3.0;
export const SCAN_FIT_MAX_ROLL_DEG = 3.0;

// Post-fit residual RMS confidence tiers.
/** <= : auto-apply allowed */
export const SCAN_FIT_RMS_GOOD_MM = 1.5;
/** <= : apply allowed, warn in UI; > : BLOCK auto-apply, advisory display only */
export const SCAN_FIT_RMS_FAIR_MM = 3.0;

// Iterative refine.
export const SCAN_FIT_MAX_ITERATIONS = 3;
/** param change below this -> converged */
export const SCAN_FIT_CONVERGE_DELTA_MM = 0.25;
/** RMS improvement below 5% -> converged */
export const SCAN_FIT_CONVERGE_RMS_GAIN = 0.05;

// Minimum viable sample count per band. Below this the band is
// unfittable (scan hole, trim, bad capture) -> return null, do not guess.
export const SCAN_FIT_MIN_SAMPLES = 24;

/** Heel longitudinal band: posterior of arch band (arch starts at u=0.28). */
export const SCAN_FIT_HEEL_U_MIN = 0.0;
export const SCAN_FIT_HEEL_U_MAX = 0.28;
