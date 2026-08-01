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

// ── Anatomically-banded rigid reference ──────────────────────────
// The rigid reference plane must NEVER be fitted through the feature
// being measured. The medial longitudinal arch is a large one-sided
// departure from planarity; including it lets the plane tilt into the
// dome and absorb clinical signal.

// Sagittal (offset + pitch) reference: heel band + lateral column.
// The lateral column (calcaneus-cuboid-5th met base) is the relatively
// rigid ground-referencing strut. The medial column is mobile and
// carries the arch, so it is signal, not reference.
export const SCAN_FIT_LATERAL_COLUMN_V_FRAC = 0.35; // lateral-most 35% of half-width

// Frontal (roll) reference: HEEL BAND ONLY.
// Rearfoot bisection is the frontal-plane reference. Including the
// forefoot would fit genuine forefoot varus/valgus as "registration
// roll" and subtract the deformity out of the gap field — deleting the
// exact signal the device exists to post.
export const SCAN_FIT_ROLL_REFERENCE_HEEL_ONLY = true;

// The medial midfoot arch band is excluded from the rigid solve.
export const SCAN_FIT_EXCLUDE_ARCH_BAND_FROM_RIGID = true;

// Robust rejection: one MAD pass before the plane solve. Scan borders
// and toe regions carry capture noise that skews a plain LS plane.
export const SCAN_FIT_MAD_REJECT_K = 2.5;

// ── Multi-station joint profile solve ────────────────────────────
export const SCAN_FIT_PROFILE_STATIONS = 5; // u stations across the arch band
export const SCAN_FIT_MIN_SAMPLES_PER_STATION = 12; // below -> station dropped, not guessed
export const SCAN_FIT_MIN_VALID_STATIONS = 3; // below -> fall back to scalar fit

// Tikhonov regularization. archHeight and archFill bases are strongly
// correlated; without damping the solver trades one against the other
// and produces clinically absurd pairs that fit the data equally well.
export const SCAN_FIT_PROFILE_RIDGE_LAMBDA = 0.05;

// Compliance is applied ONCE, to the composite solved surface height —
// never per-parameter. Applying it to both height and fill would
// double-discount. Reuse SCAN_FIT_ARCH_COMPLIANCE from #139.

/** Apex grid step (mm) for nonlinear profile search. */
export const SCAN_FIT_APEX_SEARCH_STEP_MM = 1.0;
