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
 * Joint rigid solve (replaces PR #143 cascade):
 *   One 3-parameter weighted LS gap ≈ a + b·x + c·y over
 *   heel band ∪ proximal lateral column. Identifiability via
 *   column-equilibrated spectral condition number of the 3×3 normal matrix.
 */

import {
    SCAN_FIT_EXCLUDE_ARCH_BAND_FROM_RIGID,
    SCAN_FIT_HEEL_U_MAX,
    SCAN_FIT_HEEL_U_MIN,
    SCAN_FIT_JOINT_RIGID_SOLVE,
    SCAN_FIT_LATERAL_COLUMN_U_MAX,
    SCAN_FIT_LATERAL_COLUMN_V_FRAC,
    SCAN_FIT_MAD_REJECT_K,
    SCAN_FIT_MAX_CONDITION_NUMBER,
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
    /** Column-equilibrated spectral κ of the joint normal matrix. */
    conditionNumber: number;
    /** True when conditionNumber > SCAN_FIT_MAX_CONDITION_NUMBER. */
    illConditioned: boolean;
    heelSampleCount: number;
    lateralSampleCount: number;
    jointSampleCount: number;
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
    // Floor prevents the zero-MAD early-exit from disabling rejection when the
    // majority of gaps are exact zeros (common on synthetics / clean heel).
    const thresh = Math.max(k * mad * 1.4826, 1e-6);
    return samples.filter((s) => Math.abs(s.gapMm - med) <= thresh);
}

/** Lateral-most fraction of |vSigned| on the lateral side for this foot. */
export function isLateralColumnSample(vSigned: number, side: Side): boolean {
    const medialSign = side === "left" ? -1 : 1;
    const m = -(vSigned * medialSign);
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
 * True where the medial arch dome *basis* is active enough to contaminate
 * a rigid reference plane.
 *
 * Mirrors height-field / unitArchWeight support:
 *   bump(u, 0.42, 0.36) × smoothstep(-0.2, 0.45, m) × …
 * That support extends into the heel u-range; excluding by nominal arch-band
 * u alone leaves contaminated medial-heel samples in the joint set.
 */
export function isMedialArchFeatureSample(u: number, vSigned: number, side: Side): boolean {
    const medialSign = side === "left" ? -1 : 1;
    const m = -(vSigned * medialSign);
    // smoothstep(-0.2, 0.45, m) — same knees as height-field medialBlend
    const t = Math.max(0, Math.min(1, (m + 0.2) / 0.65));
    const medialBlend = t * t * (3 - 2 * t);
    if (medialBlend < 1e-3) return false;
    // bump(u, 0.42, 0.36)
    const du = Math.abs(u - 0.42) / 0.36;
    if (du >= 1) return false;
    const arch = 0.5 * (1 + Math.cos(Math.PI * du));
    // Threshold: below this the dome is numerically negligible vs scan noise.
    return arch * medialBlend > 0.02;
}

/** Proximal lateral column (cuboid) — u ≤ SCAN_FIT_LATERAL_COLUMN_U_MAX. */
export function isProximalLateralColumnSample(u: number, vSigned: number, side: Side): boolean {
    return u <= SCAN_FIT_LATERAL_COLUMN_U_MAX && isLateralColumnSample(vSigned, side);
}

/**
 * Joint rigid reference set: heel band ∪ proximal lateral column,
 * minus medial arch feature support (basis-overlap into heel included).
 */
export function selectJointRigidReferenceBand(
    samples: readonly BandedGapSample[],
    side: Side,
): BandedGapSample[] {
    return samples.filter((s) => {
        if (isMedialArchFeatureSample(s.u, s.vSigned, side)) return false;
        if (isHeelBandSample(s.u)) return true;
        if (isProximalLateralColumnSample(s.u, s.vSigned, side)) return true;
        return false;
    });
}

/**
 * Sagittal reference set (legacy cascade path only).
 * Under joint solve this is unused — prefer selectJointRigidReferenceBand.
 */
export function selectSagittalReferenceBand(
    samples: readonly BandedGapSample[],
    side: Side,
): BandedGapSample[] {
    return samples.filter((s) => {
        if (SCAN_FIT_EXCLUDE_ARCH_BAND_FROM_RIGID && isArchBandSample(s.u)) {
            return isLateralColumnSample(s.vSigned, side);
        }
        if (isHeelBandSample(s.u)) return true;
        return isLateralColumnSample(s.vSigned, side);
    });
}

/** Roll reference (legacy cascade path only). */
export function selectRollReferenceBand(samples: readonly BandedGapSample[]): BandedGapSample[] {
    if (SCAN_FIT_ROLL_REFERENCE_HEEL_ONLY) {
        return samples.filter(
            (s) =>
                s.u >= SCAN_FIT_HEEL_U_MIN &&
                s.u <= SCAN_FIT_ROLL_U_MAX &&
                Math.abs(s.vSigned) <= SCAN_FIT_ROLL_V_ABS_MAX,
        );
    }
    return samples.filter((s) => isHeelBandSample(s.u));
}

/** Forefoot band for FF roll readout (u > arch max). */
export function selectForefootBand(samples: readonly BandedGapSample[]): BandedGapSample[] {
    return samples.filter((s) => s.u > RIGID_ARCH_BAND_U_MAX);
}

/**
 * Accumulate normal-equation sums for gap ≈ a + b·x + c·y.
 */
export function accumulatePlaneNormalSums(samples: readonly GapSample[]): {
    s0: number;
    sx: number;
    sy: number;
    sxx: number;
    syy: number;
    sxy: number;
    sg: number;
    sgx: number;
    sgy: number;
} | null {
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
    return { s0, sx, sy, sxx, syy, sxy, sg, sgx, sgy };
}

/**
 * Column-equilibrated spectral condition number of the 3×3 normal matrix
 * N = [[s0,sx,sy],[sx,sxx,sxy],[sy,sxy,syy]].
 *
 * Equilibration removes the mm-scale mismatch between the constant column and
 * x/y (hundreds of mm) so κ reports geometric identifiability, not unit choice.
 * Hand-rolled — no matrix library.
 */
export function planeNormalConditionNumber(sums: {
    s0: number;
    sx: number;
    sy: number;
    sxx: number;
    syy: number;
    sxy: number;
}): number {
    const { s0, sx, sy, sxx, syy, sxy } = sums;
    const d0 = Math.sqrt(Math.max(s0, 1e-18));
    const d1 = Math.sqrt(Math.max(sxx, 1e-18));
    const d2 = Math.sqrt(Math.max(syy, 1e-18));
    // Scaled matrix Ŝ = D^{-1/2} N D^{-1/2} (column equilibration)
    const M = [
        [1, sx / (d0 * d1), sy / (d0 * d2)],
        [sx / (d1 * d0), 1, sxy / (d1 * d2)],
        [sy / (d2 * d0), sxy / (d2 * d1), 1],
    ];
    // Jacobi eigenvalue iteration on SPD 3×3
    for (let iter = 0; iter < 24; iter++) {
        for (const [p, q] of [
            [0, 1],
            [0, 2],
            [1, 2],
        ] as const) {
            const apq = M[p]![q]!;
            if (Math.abs(apq) < 1e-15) continue;
            const app = M[p]![p]!;
            const aqq = M[q]![q]!;
            const tau = (aqq - app) / (2 * apq);
            const t = (tau >= 0 ? 1 : -1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
            const c = 1 / Math.sqrt(1 + t * t);
            const s = t * c;
            for (let k = 0; k < 3; k++) {
                const mik = M[k]![p]!;
                const miq = M[k]![q]!;
                M[k]![p] = c * mik - s * miq;
                M[k]![q] = s * mik + c * miq;
            }
            for (let k = 0; k < 3; k++) {
                const mpi = M[p]![k]!;
                const mqi = M[q]![k]!;
                M[p]![k] = c * mpi - s * mqi;
                M[q]![k] = s * mpi + c * mqi;
            }
            M[p]![q] = 0;
            M[q]![p] = 0;
        }
    }
    const ev = [Math.abs(M[0]![0]!), Math.abs(M[1]![1]!), Math.abs(M[2]![2]!)].sort((a, b) => a - b);
    return ev[2]! / Math.max(ev[0]!, 1e-18);
}

function emptyRigid(warnings: string[]): RigidGapResidual {
    return {
        meanOffsetMm: 0,
        pitchDeg: 0,
        rollDeg: 0,
        forefootRollDeg: 0,
        heelRollDeg: 0,
        forefootToRearfootDeg: 0,
        a: 0,
        b: 0,
        c: 0,
        pitchFallbackUsed: false,
        rollUnsolvable: true,
        conditionNumber: Number.POSITIVE_INFINITY,
        illConditioned: true,
        heelSampleCount: 0,
        lateralSampleCount: 0,
        jointSampleCount: 0,
        warnings,
    };
}

/**
 * Least-squares plane fit gap ≈ a + b·x + c·y.
 * Returns null when fewer than 3 finite samples.
 */
export function decomposeRigidGap(samples: readonly GapSample[]): RigidGapResidual | null {
    const sums = accumulatePlaneNormalSums(samples);
    if (!sums) return null;

    const { s0, sx, sy, sxx, syy, sxy, sg, sgx, sgy } = sums;
    const det = s0 * (sxx * syy - sxy * sxy) - sx * (sx * syy - sxy * sy) + sy * (sx * sxy - sxx * sy);
    if (Math.abs(det) < 1e-12) return null;

    const a =
        (sg * (sxx * syy - sxy * sxy) - sx * (sgx * syy - sxy * sgy) + sy * (sgx * sxy - sxx * sgy)) / det;
    const b = (s0 * (sgx * syy - sxy * sgy) - sg * (sx * syy - sxy * sy) + sy * (sx * sgy - sgx * sy)) / det;
    const c = (s0 * (sxx * sgy - sgx * sxy) - sx * (sx * sgy - sgx * sy) + sg * (sx * sxy - sxx * sy)) / det;

    const pitchDeg = (Math.atan(b) * 180) / Math.PI;
    const rollDeg = (Math.atan(c) * 180) / Math.PI;
    const conditionNumber = planeNormalConditionNumber(sums);

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
        conditionNumber,
        illConditioned: conditionNumber > SCAN_FIT_MAX_CONDITION_NUMBER,
        heelSampleCount: 0,
        lateralSampleCount: 0,
        jointSampleCount: s0,
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
 * Anatomically-banded rigid decomposition — joint 3-parameter solve.
 *
 * Reference = heel ∪ proximal lateral column (one MAD pre-pass, uniform weights).
 * Forefoot roll is readout-only and is NOT written into the subtraction plane.
 */
export function decomposeRigidGapBanded(
    samples: readonly BandedGapSample[],
    side: Side,
): RigidGapResidual | null {
    if (!SCAN_FIT_JOINT_RIGID_SOLVE && SCAN_FIT_SOLVE_ROLL_BEFORE_PITCH) {
        // Cascade path intentionally disabled; fall through to joint.
    }

    const warnings: string[] = [];

    // Count raw band coverage before MAD (degrade reasons use pre-MAD counts).
    const heelCoverage = samples.filter(
        (s) => isHeelBandSample(s.u) && !isMedialArchFeatureSample(s.u, s.vSigned, side),
    );
    const lateralCoverage = samples.filter((s) => isProximalLateralColumnSample(s.u, s.vSigned, side));
    const heelSampleCount = heelCoverage.length;
    const lateralSampleCount = lateralCoverage.length;

    if (heelSampleCount < SCAN_FIT_MIN_SAMPLES) {
        warnings.push(
            `Heel band insufficient (need ≥${SCAN_FIT_MIN_SAMPLES}, got ${heelSampleCount}) — auto-apply blocked`,
        );
        return {
            ...emptyRigid(warnings),
            heelSampleCount,
            lateralSampleCount,
        };
    }
    if (lateralSampleCount < SCAN_FIT_MIN_SAMPLES) {
        warnings.push(
            `Proximal lateral column insufficient (need ≥${SCAN_FIT_MIN_SAMPLES}, got ${lateralSampleCount}) — auto-apply blocked`,
        );
        return {
            ...emptyRigid(warnings),
            heelSampleCount,
            lateralSampleCount,
            rollUnsolvable: true,
        };
    }

    // Single MAD pre-pass on the joint reference set only (not the arch feature).
    const jointRaw = selectJointRigidReferenceBand(samples, side);
    const joint = madRejectSamples(jointRaw);
    if (joint.length < SCAN_FIT_MIN_SAMPLES) {
        warnings.push(
            `Joint reference set insufficient after MAD (need ≥${SCAN_FIT_MIN_SAMPLES}, got ${joint.length})`,
        );
        return {
            ...emptyRigid(warnings),
            heelSampleCount,
            lateralSampleCount,
            jointSampleCount: joint.length,
        };
    }

    const plane = decomposeRigidGap(joint);
    if (!plane) {
        warnings.push("Joint plane solve degenerate");
        return {
            ...emptyRigid(warnings),
            heelSampleCount,
            lateralSampleCount,
            jointSampleCount: joint.length,
        };
    }

    const illConditioned = plane.conditionNumber > SCAN_FIT_MAX_CONDITION_NUMBER;
    if (illConditioned) {
        warnings.push(
            `Ill-conditioned joint reference (κ=${plane.conditionNumber.toFixed(1)} > ${SCAN_FIT_MAX_CONDITION_NUMBER})`,
        );
    }

    // FF−RF readout: heel roll from the joint plane (heel∪proximal lateral).
    // Forefoot roll measured after removing offset+pitch only so genuine FF
    // valgus distal of arch max is preserved (hard gate B).
    const afterPitchOnly = samples.map((s) => ({
        ...s,
        gapMm: s.gapMm - (plane.a + plane.b * s.x),
    }));
    const ffForGate = madRejectSamples(selectForefootBand(afterPitchOnly));
    const heelRollDeg = plane.rollDeg;
    let forefootRollDeg = heelRollDeg;
    if (ffForGate.length >= 8) {
        const ffRoll = fitRollOnBand(ffForGate);
        if (ffRoll) forefootRollDeg = ffRoll.rollDeg;
    }

    return {
        meanOffsetMm: plane.meanOffsetMm,
        pitchDeg: plane.pitchDeg,
        rollDeg: heelRollDeg,
        forefootRollDeg,
        heelRollDeg,
        forefootToRearfootDeg: forefootRollDeg - heelRollDeg,
        a: plane.a,
        b: plane.b,
        c: plane.c,
        pitchFallbackUsed: false,
        rollUnsolvable: false,
        conditionNumber: plane.conditionNumber,
        illConditioned,
        heelSampleCount,
        lateralSampleCount,
        jointSampleCount: joint.length,
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
    const blockAutoApply =
        meanOffsetExceeded || pitchExceeded || rollExceeded || rigid.rollUnsolvable || rigid.illConditioned;
    return {
        meanOffsetExceeded,
        pitchExceeded,
        rollExceeded,
        blockAutoApply,
    };
}

/**
 * Map post-fit residual RMS (+ registration flags + convergence) → confidence tier.
 * Registration block forces poor. Non-convergence / pitch fallback / ill-conditioned
 * downgrades one tier (ill-conditioned also blocks via registrationFlags).
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
