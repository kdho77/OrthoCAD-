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
 * Model: gap ≈ a + b·(x−cx) + c·(y−cy)
 *   a = mean Z offset (mm)
 *   b = ∂z/∂x ≈ pitch (rad) for small angles
 *   c = ∂z/∂y ≈ roll  (rad)
 */

import {
    SCAN_FIT_MAX_MEAN_OFFSET_MM,
    SCAN_FIT_MAX_PITCH_DEG,
    SCAN_FIT_MAX_ROLL_DEG,
    SCAN_FIT_RMS_FAIR_MM,
    SCAN_FIT_RMS_GOOD_MM,
} from "@/lib/geometry/scan-fit-constants";

export type GapSample = {
    x: number;
    y: number;
    /** Signed plantar gap mm (scan Z − reference Z). */
    gapMm: number;
};

export type RigidGapResidual = {
    meanOffsetMm: number;
    /** Pitch about +Y, degrees (positive raises distal / +X). */
    pitchDeg: number;
    /** Roll about +X, degrees (positive raises +Y). */
    rollDeg: number;
    /** Plane coefficients: gap ≈ a + b·x + c·y (absolute, not centered). */
    a: number;
    b: number;
    c: number;
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

/**
 * Least-squares plane fit over the full plantar sample set.
 * Returns null when fewer than 3 finite samples (cannot solve).
 */
export function decomposeRigidGap(samples: readonly GapSample[]): RigidGapResidual | null {
    const pts = samples.filter(
        (s) => Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.gapMm),
    );
    if (pts.length < 3) return null;

    // Normal equations for [1, x, y] → gap
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

    // Solve 3×3 via Cramer's rule / explicit inverse of symmetric Gram matrix.
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
        a,
        b,
        c,
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
    return {
        meanOffsetExceeded,
        pitchExceeded,
        rollExceeded,
        blockAutoApply: meanOffsetExceeded || pitchExceeded || rollExceeded,
    };
}

/**
 * Map post-fit residual RMS (+ registration flags + convergence) → confidence tier.
 * Registration block forces poor. Non-convergence downgrades one tier.
 */
export function confidenceFromRms(
    residualRmsMm: number,
    registration: RegistrationFitFlags,
    nonConverged = false,
): FitConfidence {
    let tier: ConfidenceTier;
    if (registration.blockAutoApply || residualRmsMm > SCAN_FIT_RMS_FAIR_MM) {
        tier = "poor";
    } else if (residualRmsMm <= SCAN_FIT_RMS_GOOD_MM) {
        tier = "good";
    } else {
        tier = "fair";
    }
    if (nonConverged) {
        if (tier === "good") tier = "fair";
        else if (tier === "fair") tier = "poor";
    }
    return { tier, residualRmsMm, registration, nonConverged };
}

/** True when every finite gap is negative (scan below reference). */
export function gapsEntirelyNegative(samples: readonly GapSample[]): boolean {
    const finite = samples.filter((s) => Number.isFinite(s.gapMm));
    if (finite.length === 0) return false;
    return finite.every((s) => s.gapMm < 0);
}
