// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Pure scan-fit scalar kernel.
 * Takes weighted gap samples → least-squares scalar + residual diagnostics.
 * No Zustand, no updateCorrection, no getState.
 */

import {
    SCAN_FIT_CONVERGE_DELTA_MM,
    SCAN_FIT_CONVERGE_RMS_GAIN,
    SCAN_FIT_MAX_ITERATIONS,
    SCAN_FIT_MIN_SAMPLES,
} from "@/lib/geometry/scan-fit-constants";

export type WeightedGapSample = {
    gapMm: number;
    /** Unit operator weight at this sample (may be signed). */
    weight: number;
};

export type KernelSolveResult = {
    /** Solved scalar (raw, before compliance / clinical clamp). */
    value: number;
    residualRmsMm: number;
    sampleCount: number;
};

export type RefineResult = {
    value: number;
    residualRmsMm: number;
    iterations: number;
    converged: boolean;
    sampleCount: number;
};

const WEIGHT_EPS = 1e-6;
const MIN_WEIGHT_ABS = 0.05;

/**
 * Least-squares: minimize Σ (w_i · s − gap_i)² → s = Σ(w·g) / Σ(w²).
 * Returns null on insufficient samples or degenerate weight field.
 */
export function solveScalarFromWeightedGaps(
    samples: readonly WeightedGapSample[],
    minSamples: number = SCAN_FIT_MIN_SAMPLES,
): KernelSolveResult | null {
    let swg = 0;
    let sww = 0;
    let n = 0;
    for (const s of samples) {
        if (!Number.isFinite(s.gapMm) || !Number.isFinite(s.weight)) continue;
        if (Math.abs(s.weight) < MIN_WEIGHT_ABS) continue;
        swg += s.weight * s.gapMm;
        sww += s.weight * s.weight;
        n += 1;
    }
    if (n < minSamples || sww < WEIGHT_EPS) return null;

    const value = swg / sww;
    if (!Number.isFinite(value)) return null;

    let err2 = 0;
    for (const s of samples) {
        if (!Number.isFinite(s.gapMm) || !Number.isFinite(s.weight)) continue;
        if (Math.abs(s.weight) < MIN_WEIGHT_ABS) continue;
        const r = s.weight * value - s.gapMm;
        err2 += r * r;
    }
    return {
        value,
        residualRmsMm: Math.sqrt(err2 / n),
        sampleCount: n,
    };
}

function evalRms(
    gaps: readonly { gapMm: number }[],
    weightAt: (index: number, currentValue: number) => number,
    value: number,
    minSamples: number,
): { rms: number; n: number } | null {
    let err2 = 0;
    let n = 0;
    for (let i = 0; i < gaps.length; i++) {
        const w = weightAt(i, value);
        if (!Number.isFinite(w) || Math.abs(w) < MIN_WEIGHT_ABS) continue;
        const g = gaps[i]?.gapMm;
        if (g === undefined || !Number.isFinite(g)) continue;
        const r = w * value - g;
        err2 += r * r;
        n += 1;
    }
    if (n < minSamples) return null;
    return { rms: Math.sqrt(err2 / n), n };
}

/**
 * Iterative refine on a scratch scalar: fit → subtract prediction → re-solve
 * delta → repeat. Does not mutate live design.
 *
 * Linear fixed-weight cases converge in one iteration. State-dependent weights
 * (e.g. apex-shifted dome) may need more. On iteration cap, returns best-RMS
 * iterate with converged=false.
 */
export function iterativeRefineScalar(args: {
    gaps: readonly { gapMm: number }[];
    weightAt: (index: number, currentValue: number) => number;
    initialValue?: number;
    compliance?: number;
    minSamples?: number;
    /** Override iteration cap (defaults to SCAN_FIT_MAX_ITERATIONS). */
    maxIterations?: number;
}): RefineResult | null {
    const {
        gaps,
        weightAt,
        initialValue = 0,
        compliance = 1,
        minSamples = SCAN_FIT_MIN_SAMPLES,
        maxIterations = SCAN_FIT_MAX_ITERATIONS,
    } = args;

    let value = initialValue;
    let bestValue = initialValue;
    let bestRms = Infinity;
    let lastRms = Infinity;
    let converged = false;
    let iterations = 0;
    let lastCount = 0;

    for (let iter = 0; iter < maxIterations; iter++) {
        iterations = iter + 1;
        const weighted: WeightedGapSample[] = [];
        for (let i = 0; i < gaps.length; i++) {
            const w = weightAt(i, value);
            const g = gaps[i]?.gapMm;
            if (g === undefined) continue;
            const residual = g - w * value;
            weighted.push({ gapMm: residual, weight: w });
        }
        const delta = solveScalarFromWeightedGaps(weighted, minSamples);
        if (!delta) {
            if (iter === 0) return null;
            break;
        }
        const next = value + delta.value;
        const scored = evalRms(gaps, weightAt, next, minSamples);
        if (!scored) {
            if (iter === 0) return null;
            break;
        }

        const paramDelta = Math.abs(next - value);
        const rmsGain = lastRms === Infinity ? 1 : (lastRms - scored.rms) / Math.max(lastRms, 1e-9);

        value = next;
        lastRms = scored.rms;
        lastCount = scored.n;
        if (scored.rms < bestRms) {
            bestRms = scored.rms;
            bestValue = value;
        }

        // Stop on: near-zero residual, tiny parameter step, or RMS plateau
        // (small non-negative improvement). Do NOT stop when RMS worsens —
        // oscillation must run to the iteration cap and flag non-converged.
        if (
            scored.rms < SCAN_FIT_CONVERGE_DELTA_MM ||
            paramDelta < SCAN_FIT_CONVERGE_DELTA_MM ||
            (lastRms !== Infinity && rmsGain >= 0 && rmsGain < SCAN_FIT_CONVERGE_RMS_GAIN)
        ) {
            converged = true;
            break;
        }
    }

    if (!Number.isFinite(bestValue) || bestRms === Infinity) return null;

    return {
        value: bestValue * compliance,
        residualRmsMm: bestRms,
        iterations,
        converged,
        sampleCount: lastCount,
    };
}

/** One-shot solve with compliance applied to the raw scalar. */
export function solveWithCompliance(
    samples: readonly WeightedGapSample[],
    compliance: number,
    minSamples: number = SCAN_FIT_MIN_SAMPLES,
): KernelSolveResult | null {
    const raw = solveScalarFromWeightedGaps(samples, minSamples);
    if (!raw) return null;
    return {
        value: raw.value * compliance,
        residualRmsMm: raw.residualRmsMm,
        sampleCount: raw.sampleCount,
    };
}
