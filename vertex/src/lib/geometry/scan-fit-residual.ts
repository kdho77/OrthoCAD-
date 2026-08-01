// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Rigid-body residual decomposition for scan-fit gap fields.
 *
 * App footprint frame (confirmed from insole.ts / height-field.ts):
 *   +X = heel → toe (longitudinal)
 *   +Y = width axis
 *   +Z = up (insole top / thickness)
 *
 * Pitch = rotation about +Y (medial–lateral): z ≈ pitch_rad · (x − cx)
 * Roll  = rotation about +X (longitudinal):   z ≈ roll_rad  · (y − cy)
 *
 * Anatomically-banded reference (PR #140 / #141):
 *   roll         ← posterior central heel FIRST (prevents roll→offset leakage
 *                  via the asymmetric lateral-column sagittal band)
 *   offset+pitch ← heel band + lateral column on the de-rolled field
 */

import {
    SCAN_FIT_EXCLUDE_ARCH_BAND_FROM_RIGID,
    SCAN_FIT_HEEL_U_MAX,
    SCAN_FIT_HEEL_U_MIN,
    SCAN_FIT_LATERAL_COLUMN_V_FRAC,
    SCAN_FIT_MAD_REJECT_K,
    SCAN_FIT_MAX_MEAN_OFFSET_MM,
    SCAN_FIT_MAX_PITCH_DEG,
    SCAN_FIT_MAX_ROLL_DEG,
    SCAN_FIT_MIN_SAMPLES,
    SCAN_FIT_RMS_FAIR_MM,
    SCAN_FIT_RMS_GOOD_MM,
    SCAN_FIT_ROLL_REFERENCE_HEEL_ONLY,
    SCAN_FIT_ROLL_U_MAX,
    SCAN_FIT_ROLL_V_ABS_MAX,
    SCAN_FIT_SOLVE_ROLL_BEFORE_PITCH,
} from "@/lib/geometry/scan-fit-constants";
import type { Side } from "@/types";

/** Arch band u-range — imported loosely to avoid circular dep with fit-arch. */
export const RIGID_ARCH_BAND_U_MIN = 0.28;
export const RIGID_ARCH_BAND_U_MAX = 0.58;

export type GapSample = {
    x: number;
    y: number;
    /** Signed plantar gap mm (scan Z − reference Z). */
    gapMm: number;
};

export type BandedGapSample = GapSample & {
    u: number;
    vSigned: number;
};

export type RigidGapResidual = {
    meanOffsetMm: number;
    /** Pitch about +Y, degrees (positive raises distal / +X). */
    pitchDeg: number;
    /** Roll about +X from heel reference, degrees (positive raises +Y). */
    rollDeg: number;
    /** Forefoot roll (display / FF–RF readout), degrees. */
    forefootRollDeg: number;
    /** Heel roll (same as rollDeg when heel-only reference). */
    heelRollDeg: number;
    /** Forefoot − heel roll (frontal-plane FF/RF relationship), degrees. */
    forefootToRearfootDeg: number;
    /** Plane coefficients: gap ≈ a + b·x + c·y (absolute). */
    a: number;
    b: number;
    c: number;
    /** True when lateral-column pitch band was thin — fell back to fuller set. */
    pitchFallbackUsed: boolean;
    /** True when heel band was insufficient for roll — auto-apply must block. */
    rollUnsolvable: boolean;
    warnings: string[];
};

export type ConfidenceTier = "good" | "fair" | "poor";

export type RegistrationFitFlags = {
    meanOffsetExceeded: boolean;
    pitchExceeded: boolean;
    rollExceeded: boolean;
    /** True when any rigid residual bound is exceeded — block auto-apply. */
    blockAutoApply: boolean;
};

export type FitConfidence = {
    tier: ConfidenceTier;
    residualRmsMm: number;
    registration: RegistrationFitFlags;
    /** Downgraded one tier due to non-convergence of iterative refine. */
    nonConverged: boolean;
};

function medianSorted(sorted: number[]): number {
    if (sorted.length === 0) return 0;
    const m = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[m]! : 0.5 * (sorted[m - 1]! + sorted[m]!);
}

/** One MAD pass — reject outliers beyond k·MAD from median gap. */
export function madRejectSamples<T extends GapSample>(
    samples: readonly T[],
    k: number = SCAN_FIT_MAD_REJECT_K,
): T[] {
    if (samples.length < 3) return [...samples];
    const gaps = samples.map((s) => s.gapMm).sort((a, b) => a - b);
    const med = medianSorted(gaps);
    const absDev = gaps.map((g) => Math.abs(g - med)).sort((a, b) => a - b);
    const mad = medianSorted(absDev);
    if (mad < 1e-9) return [...samples];
    const thresh = k * mad * 1.4826; // consistency with σ for normal
    return samples.filter((s) => Math.abs(s.gapMm - med) <= thresh);
}

/** Lateral-most fraction of |vSigned| on the lateral side for this foot. */
export function isLateralColumnSample(vSigned: number, side: Side): boolean {
    const medialSign = side === "left" ? -1 : 1;
    // Lateral = opposite of medial: m_lat = +(vSigned * medialSign) when medial is -v*medialSign
    // medial coordinate m = -(vSigned * medialSign); lateral when m is negative / low.
    const m = -(vSigned * medialSign);
    // Lateral column: lateral-most SCAN_FIT_LATERAL_COLUMN_V_FRAC of half-width
    // → m < -(1 - LATERAL_COLUMN_V_FRAC) approximately, using |v| on lateral side.
    const av = Math.abs(vSigned);
    const onLateralSide = m < -0.05;
    return onLateralSide && av >= 1 - SCAN_FIT_LATERAL_COLUMN_V_FRAC;
}

export function isHeelBandSample(u: number): boolean {
    return u >= SCAN_FIT_HEEL_U_MIN && u <= SCAN_FIT_HEEL_U_MAX;
}

export function isArchBandSample(u: number): boolean {
    return u >= RIGID_ARCH_BAND_U_MIN && u <= RIGID_ARCH_BAND_U_MAX;
}

/**
 * Sagittal reference set: heel ∪ lateral column, excluding medial arch band.
 * Under roll-first, strong medial heel samples are also dropped — the arch
 * dome bleeds into the heel u-range and biases offset when pitch is present.
 */
export function selectSagittalReferenceBand(
    samples: readonly BandedGapSample[],
    side: Side,
): BandedGapSample[] {
    const medialSign = side === "left" ? -1 : 1;
    return samples.filter((s) => {
        if (SCAN_FIT_EXCLUDE_ARCH_BAND_FROM_RIGID && isArchBandSample(s.u)) {
            // Keep arch-band samples only if they are on the lateral column.
            return isLateralColumnSample(s.vSigned, side);
        }
        if (isHeelBandSample(s.u)) {
            if (SCAN_FIT_SOLVE_ROLL_BEFORE_PITCH) {
                const m = -(s.vSigned * medialSign);
                // Drop strong medial heel (arch-bleed); keep center + lateral.
                return m < 0.25;
            }
            return true;
        }
        return isLateralColumnSample(s.vSigned, side);
    });
}

/** Roll reference: posterior central heel bisection (when flag true). */
export function selectRollReferenceBand(samples: readonly BandedGapSample[]): BandedGapSample[] {
    if (SCAN_FIT_ROLL_REFERENCE_HEEL_ONLY) {
        return samples.filter(
            (s) =>
                s.u >= SCAN_FIT_HEEL_U_MIN &&
                s.u <= SCAN_FIT_ROLL_U_MAX &&
                Math.abs(s.vSigned) <= SCAN_FIT_ROLL_V_ABS_MAX,
        );
    }
    return [...samples];
}

/** Forefoot band for FF roll readout (u > arch max). */
export function selectForefootBand(samples: readonly BandedGapSample[]): BandedGapSample[] {
    return samples.filter((s) => s.u > RIGID_ARCH_BAND_U_MAX);
}

/**
 * Least-squares plane fit gap ≈ a + b·x + c·y.
 * Returns null when fewer than 3 finite samples.
 */
export function decomposeRigidGap(samples: readonly GapSample[]): RigidGapResidual | null {
    const pts = samples.filter(
        (s) => Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.gapMm),
    );
    if (pts.length < 3) return null;

    let s0 = 0;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    let sg = 0;
    let sgx = 0;
    let sgy = 0;
    for (const p of pts) {
        s0 += 1;
        sx += p.x;
        sy += p.y;
        sxx += p.x * p.x;
        syy += p.y * p.y;
        sxy += p.x * p.y;
        sg += p.gapMm;
        sgx += p.gapMm * p.x;
        sgy += p.gapMm * p.y;
    }

    const det = s0 * (sxx * syy - sxy * sxy) - sx * (sx * syy - sxy * sy) + sy * (sx * sxy - sxx * sy);
    if (Math.abs(det) < 1e-12) return null;

    const a =
        (sg * (sxx * syy - sxy * sxy) - sx * (sgx * syy - sxy * sgy) + sy * (sgx * sxy - sxx * sgy)) / det;
    const b = (s0 * (sgx * syy - sxy * sgy) - sg * (sx * syy - sxy * sy) + sy * (sx * sgy - sgx * sy)) / det;
    const c = (s0 * (sxx * sgy - sgx * sxy) - sx * (sx * sgy - sgx * sy) + sg * (sx * sxy - sxx * sy)) / det;

    const pitchDeg = (Math.atan(b) * 180) / Math.PI;
    const rollDeg = (Math.atan(c) * 180) / Math.PI;

    return {
        meanOffsetMm: a + b * (sx / s0) + c * (sy / s0),
        pitchDeg,
        rollDeg,
        forefootRollDeg: rollDeg,
        heelRollDeg: rollDeg,
        forefootToRearfootDeg: 0,
        a,
        b,
        c,
        pitchFallbackUsed: false,
        rollUnsolvable: false,
        warnings: [],
    };
}

/**
 * Fit roll-only (gap ≈ a0 + c·y) on a band — used for heel vs forefoot readout.
 */
export function fitRollOnBand(
    samples: readonly GapSample[],
): { a0: number; c: number; rollDeg: number } | null {
    const pts = samples.filter((s) => Number.isFinite(s.y) && Number.isFinite(s.gapMm));
    if (pts.length < 3) return null;
    let s0 = 0;
    let sy = 0;
    let syy = 0;
    let sg = 0;
    let sgy = 0;
    for (const p of pts) {
        s0 += 1;
        sy += p.y;
        syy += p.y * p.y;
        sg += p.gapMm;
        sgy += p.gapMm * p.y;
    }
    const det = s0 * syy - sy * sy;
    if (Math.abs(det) < 1e-12) return null;
    const a0 = (sg * syy - sy * sgy) / det;
    const c = (s0 * sgy - sy * sg) / det;
    return { a0, c, rollDeg: (Math.atan(c) * 180) / Math.PI };
}

/**
 * Fit gap ≈ a + b·x (offset + pitch only — no roll).
 */
export function fitOffsetPitch(samples: readonly GapSample[]): {
    a: number;
    b: number;
    pitchDeg: number;
    meanOffsetMm: number;
} | null {
    const pts = samples.filter((s) => Number.isFinite(s.x) && Number.isFinite(s.gapMm));
    if (pts.length < 3) return null;
    let s0 = 0;
    let sx = 0;
    let sxx = 0;
    let sg = 0;
    let sgx = 0;
    for (const p of pts) {
        s0 += 1;
        sx += p.x;
        sxx += p.x * p.x;
        sg += p.gapMm;
        sgx += p.gapMm * p.x;
    }
    const det = s0 * sxx - sx * sx;
    if (Math.abs(det) < 1e-12) return null;
    const a = (sg * sxx - sx * sgx) / det;
    const b = (s0 * sgx - sx * sg) / det;
    return {
        a,
        b,
        pitchDeg: (Math.atan(b) * 180) / Math.PI,
        meanOffsetMm: a + b * (sx / s0),
    };
}

/**
 * Anatomically-banded rigid decomposition.
 *
 * When SCAN_FIT_SOLVE_ROLL_BEFORE_PITCH:
 *   1. Fit heel roll (c·y) on posterior central heel of the raw field
 *   2. Subtract c·y only (a0 stays with the offset solve)
 *   3. Fit offset+pitch (a+b·x) on heel ∪ lateral column of the de-rolled field
 *
 * This prevents registration roll from leaking into the global offset via the
 * lateral-column band (entirely on one side of the midline).
 * Forefoot roll is readout-only and is NOT written into the subtraction plane.
 */
export function decomposeRigidGapBanded(
    samples: readonly BandedGapSample[],
    side: Side,
): RigidGapResidual | null {
    const warnings: string[] = [];
    let pitchFallbackUsed = false;
    let rollUnsolvable = false;

    let heelRollDeg = 0;
    let c = 0;
    let aRoll = 0;
    let working: readonly BandedGapSample[] = samples;

    if (SCAN_FIT_SOLVE_ROLL_BEFORE_PITCH) {
        // Pre-cleanse pitch on the heel band only (no lateral column) so the
        // roll fit sees a level heel. This does NOT open the roll→offset path
        // because the lateral column is excluded from the prelim.
        const heelForPrelim = madRejectSamples(samples.filter((s) => isHeelBandSample(s.u)));
        const prelim = heelForPrelim.length >= SCAN_FIT_MIN_SAMPLES ? fitOffsetPitch(heelForPrelim) : null;
        const rollSource = prelim
            ? samples.map((s) => ({
                  ...s,
                  gapMm: s.gapMm - (prelim.a + prelim.b * s.x),
              }))
            : samples;

        const heelRaw = selectRollReferenceBand(rollSource);
        const heel = madRejectSamples(heelRaw);
        if (heel.length >= SCAN_FIT_MIN_SAMPLES) {
            const heelRoll = fitRollOnBand(heel);
            if (heelRoll) {
                heelRollDeg = heelRoll.rollDeg;
                c = heelRoll.c;
                // Discard a0 — offset belongs to the subsequent sagittal solve.
            } else {
                rollUnsolvable = true;
                warnings.push("Heel band insufficient for roll — auto-apply blocked");
            }
        } else {
            rollUnsolvable = true;
            warnings.push("Heel band insufficient for roll — auto-apply blocked");
        }
        // Subtract c·y from the ORIGINAL field, then solve final offset+pitch
        // on heel ∪ lateral column of the de-rolled field.
        working = samples.map((s) => ({
            ...s,
            gapMm: s.gapMm - c * s.y,
        }));
    }

    const sagittalRaw = selectSagittalReferenceBand(working, side);
    let sagittal = madRejectSamples(sagittalRaw);
    if (sagittal.length < SCAN_FIT_MIN_SAMPLES) {
        const expanded = working.filter(
            (s) =>
                isHeelBandSample(s.u) ||
                isLateralColumnSample(s.vSigned, side) ||
                (!isArchBandSample(s.u) && Math.abs(s.vSigned) > 0.3),
        );
        sagittal = madRejectSamples(expanded.length >= 3 ? expanded : [...working]);
        pitchFallbackUsed = true;
        warnings.push(
            "Lateral/heel sagittal band thin — pitch solved on expanded set (confidence downgraded)",
        );
    }

    const sag = fitOffsetPitch(sagittal);
    if (!sag) return null;

    if (!SCAN_FIT_SOLVE_ROLL_BEFORE_PITCH) {
        // Legacy order: offset+pitch first, then heel roll on residual.
        const afterSag = samples.map((s) => ({
            ...s,
            gapMm: s.gapMm - (sag.a + sag.b * s.x),
        }));
        const heelRaw = selectRollReferenceBand(afterSag);
        const heel = madRejectSamples(heelRaw);
        if (heel.length >= SCAN_FIT_MIN_SAMPLES) {
            const heelRoll = fitRollOnBand(heel);
            if (heelRoll) {
                heelRollDeg = heelRoll.rollDeg;
                c = heelRoll.c;
                aRoll = heelRoll.a0;
            } else {
                rollUnsolvable = true;
                warnings.push("Heel band insufficient for roll — auto-apply blocked");
            }
        } else {
            rollUnsolvable = true;
            warnings.push("Heel band insufficient for roll — auto-apply blocked");
        }
        working = afterSag;
    }

    // FF roll readout on original field after removing offset+pitch only.
    const afterPitchOnly = samples.map((s) => ({
        ...s,
        gapMm: s.gapMm - (sag.a + sag.b * s.x),
    }));
    const ffRaw = selectForefootBand(afterPitchOnly);
    const ff = madRejectSamples(ffRaw);
    let forefootRollDeg = heelRollDeg;
    if (ff.length >= 8) {
        const ffRoll = fitRollOnBand(ff);
        if (ffRoll) forefootRollDeg = ffRoll.rollDeg;
    }

    const a = sag.a + aRoll;
    const b = sag.b;

    return {
        meanOffsetMm: sag.meanOffsetMm,
        pitchDeg: sag.pitchDeg,
        rollDeg: heelRollDeg,
        forefootRollDeg,
        heelRollDeg,
        forefootToRearfootDeg: forefootRollDeg - heelRollDeg,
        a,
        b,
        c,
        pitchFallbackUsed,
        rollUnsolvable,
        warnings,
    };
}

/** Predicted rigid gap at (x, y). */
export function rigidGapAt(r: RigidGapResidual, x: number, y: number): number {
    return r.a + r.b * x + r.c * y;
}

/** Subtract rigid plane from samples (pure; returns new array). */
export function subtractRigidGap(samples: readonly GapSample[], rigid: RigidGapResidual): GapSample[] {
    return samples.map((s) => ({
        x: s.x,
        y: s.y,
        gapMm: s.gapMm - rigidGapAt(rigid, s.x, s.y),
    }));
}

export function registrationFlagsFromRigid(rigid: RigidGapResidual): RegistrationFitFlags {
    const meanOffsetExceeded = Math.abs(rigid.meanOffsetMm) > SCAN_FIT_MAX_MEAN_OFFSET_MM;
    const pitchExceeded = Math.abs(rigid.pitchDeg) > SCAN_FIT_MAX_PITCH_DEG;
    const rollExceeded = Math.abs(rigid.rollDeg) > SCAN_FIT_MAX_ROLL_DEG;
    const blockAutoApply = meanOffsetExceeded || pitchExceeded || rollExceeded || rigid.rollUnsolvable;
    return {
        meanOffsetExceeded,
        pitchExceeded,
        rollExceeded,
        blockAutoApply,
    };
}

/**
 * Map post-fit residual RMS (+ registration flags + convergence) → confidence tier.
 * Registration block forces poor. Non-convergence / pitch fallback downgrades one tier.
 */
export function confidenceFromRms(
    residualRmsMm: number,
    registration: RegistrationFitFlags,
    nonConverged = false,
    extraDowngrade = false,
): FitConfidence {
    let tier: ConfidenceTier;
    if (registration.blockAutoApply || residualRmsMm > SCAN_FIT_RMS_FAIR_MM) {
        tier = "poor";
    } else if (residualRmsMm <= SCAN_FIT_RMS_GOOD_MM) {
        tier = "good";
    } else {
        tier = "fair";
    }
    const downgrade = () => {
        if (tier === "good") tier = "fair";
        else if (tier === "fair") tier = "poor";
    };
    if (nonConverged) downgrade();
    if (extraDowngrade) downgrade();
    return { tier, residualRmsMm, registration, nonConverged };
}

/** True when every finite gap is negative (scan below reference). */
export function gapsEntirelyNegative(samples: readonly GapSample[]): boolean {
    const finite = samples.filter((s) => Number.isFinite(s.gapMm));
    if (finite.length === 0) return false;
    return finite.every((s) => s.gapMm < 0);
}
