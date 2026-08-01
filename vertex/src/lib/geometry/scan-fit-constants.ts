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
/** Alias — joint-solve heel band (restores #139/#141). */
export const SCAN_FIT_HEEL_BAND_U_MAX = SCAN_FIT_HEEL_U_MAX;

// ── Joint rigid solve (replaces PR #143 cascade) ─────────────────
// One 3-parameter weighted LS: gap ≈ a + b·x + c·y over a SINGLE
// reference set. Sequential estimation is biased when design columns
// are non-orthogonal over the sample set (they are here).
export const SCAN_FIT_JOINT_RIGID_SOLVE = true;

// Reference set = heel band ∪ PROXIMAL lateral column.
// Heel spans the midline → identifies roll (c).
// Lateral column spans x → identifies pitch (b).
// Distal lateral (5th met head) excluded — forefoot valgus must not
// enter the roll column (hard gate B).
export const SCAN_FIT_LATERAL_COLUMN_V_FRAC = 0.35; // lateral-most 35% of half-width
/** Cuboid region — NOT 5th met head. */
export const SCAN_FIT_LATERAL_COLUMN_U_MAX = 0.45;

// The medial midfoot arch band is excluded from the rigid solve.
export const SCAN_FIT_EXCLUDE_ARCH_BAND_FROM_RIGID = true;

// Identifiability guard. Column-equilibrated spectral κ of the 3×3
// normal matrix. Above this: flag ill-conditioned, downgrade confidence,
// block auto-apply. Do NOT narrow bands to chase a lower number.
export const SCAN_FIT_MAX_CONDITION_NUMBER = 1000;

// Robust rejection: one MAD pass before the plane solve. Scan borders
// and toe regions carry capture noise that skews a plain LS plane.
export const SCAN_FIT_MAD_REJECT_K = 2.5;

// ── Retired cascade flags (kept false / unused — do not re-enable) ─
/** @deprecated Joint solve replaces heel-only roll cascade. */
export const SCAN_FIT_ROLL_REFERENCE_HEEL_ONLY = false;
/** @deprecated Posterior-central roll band retired with cascade. */
export const SCAN_FIT_ROLL_U_MAX = 0.1;
/** @deprecated Posterior-central roll band retired with cascade. */
export const SCAN_FIT_ROLL_V_ABS_MAX = 0.35;
/** @deprecated Joint solve replaces roll-before-pitch cascade. */
export const SCAN_FIT_SOLVE_ROLL_BEFORE_PITCH = false;

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

// ── Flange geometry ──────────────────────────────────────────────
// Flange = vertical rise of the shell rim above the standard trimline.
// Clinically this is a frontal-plane moment-arm operator about the STJ
// axis: a medial flange increases supination moment (medially deviated
// axis, high supination resistance); a lateral flange increases
// pronation moment / lateral stability (laterally deviated axis).
// It is NOT an accommodation feature and must not be confused with
// heel cup depth, which encapsulates tissue and is near-inert for
// axis moment arm.

/** Medial flange longitudinal span: navicular through 1st met base. */
export const FLANGE_MEDIAL_U_START = 0.3;
export const FLANGE_MEDIAL_U_END = 0.65;

/** Lateral flange longitudinal span: cuboid through 5th met base. */
export const FLANGE_LATERAL_U_START = 0.25;
export const FLANGE_LATERAL_U_END = 0.6;

/** Cosine feather at both ends of each span (fraction of footprint length). */
export const FLANGE_FEATHER_U = 0.08;

/** Peak position within the span, as a fraction of span length. */
export const FLANGE_PEAK_FRAC = 0.5;

/**
 * Heel cup + flange junction. `max` = continuous medial wall (no double-add);
 * replaces the PR #143 proximal-yield smoothstep gate.
 */
export const FLANGE_HEEL_JUNCTION_MODE = "max" as const;

// ── Advisory flange fit ──────────────────────────────────────────
// Edge-band gap is the noisiest region of any scan (capture dropout,
// trim, skin fold). Flange fit is ADVISORY ONLY, never auto-applies,
// and is held to a stricter sample floor than the plantar operators.
export const SCAN_FIT_FLANGE_MIN_SAMPLES = 40;
/** Soft tissue at the foot border. FLAGGED FOR PRINT VALIDATION. */
export const SCAN_FIT_FLANGE_COMPLIANCE = 0.8;
