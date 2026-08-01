// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Multi-station joint arch profile solve.
 *
 * Pure: station gaps + basis weights → (archHeightMm, apexMoveMm, archFillMm)
 * + diagnostics. No Zustand / updateCorrection / getState.
 *
 * Basis note: height-field.ts applies archHeightMm and archFillMm with the
 * IDENTICAL spatial weight (cos ≈ 1). They are therefore near-collinear; the
 * ridge term (SCAN_FIT_PROFILE_RIDGE_LAMBDA) damps trading. Amplitude for
 * clinical gates is (height + fill) before compliance.
 *
 * archEndU does NOT exist on this branch — use ARCH_FIT_U_MAX.
 * Reconciliation required once PR #118 (introduces archEndU) merges.
 */

import { CLINICAL_LIMITS } from "@/lib/geometry/clinical-constraints";
import { bump, smoothstep } from "@/lib/geometry/height-field";
import {
    SCAN_FIT_APEX_SEARCH_STEP_MM,
    SCAN_FIT_ARCH_COMPLIANCE,
    SCAN_FIT_MIN_SAMPLES_PER_STATION,
    SCAN_FIT_MIN_VALID_STATIONS,
    SCAN_FIT_PROFILE_RIDGE_LAMBDA,
    SCAN_FIT_PROFILE_STATIONS,
} from "@/lib/geometry/scan-fit-constants";
import type { Side } from "@/types";

/** Matches fit-arch-from-scan / height-field default apex. */
export const PROFILE_DEFAULT_APEX_U = 0.42;
/** Arch band — same as ARCH_FIT_U_*; archEndU absent → use ARCH_FIT_U_MAX. */
export const PROFILE_ARCH_U_MIN = 0.28;
export const PROFILE_ARCH_U_MAX = 0.58; // == ARCH_FIT_U_MAX until #118 merges

export type ProfileStation = {
    u: number;
    gapMm: number;
    sampleCount: number;
};

export type ProfileSolveResult = {
    archHeightMm: number;
    archFillMm: number;
    apexMoveMm: number;
    /** (height+fill) before compliance — amplitude gate uses this. */
    amplitudePreComplianceMm: number;
    /** After single compliance multiply on composite amplitude, then split. */
    amplitudePostComplianceMm: number;
    stationResidualsMm: number[];
    stationUs: number[];
    residualRmsMm: number;
    sampleCount: number;
    /** Normalized |⟨wH, wF⟩| / (|wH||wF|) of basis columns at solved apex. */
    basisCosine: number;
    mode: "profile" | "scalar_fallback";
    clamped: boolean;
    fallbackReason: string | null;
};

/** Unit arch-dome weight — matches height-field arch term × feather. */
export function unitArchDomeWeight(
    u: number,
    vSigned: number,
    side: Side,
    lengthMm: number,
    apexMoveMm: number,
): number {
    const medialSign = side === "left" ? -1 : 1;
    const av = Math.abs(vSigned);
    const m = -(vSigned * medialSign);
    const medialBlend = smoothstep(-0.2, 0.45, m);
    const apexCenter = PROFILE_DEFAULT_APEX_U + apexMoveMm / lengthMm;
    const arch = bump(u, apexCenter, 0.36);
    const archAcross = medialBlend * (0.45 + 0.55 * smoothstep(0.05, 0.9, av));
    const edgeFeather = smoothstep(1.0, 0.86, av);
    const featherScale = 0.35 + 0.65 * edgeFeather;
    return arch * archAcross * featherScale;
}

/**
 * Fill basis for the joint solve.
 * height-field applies fill with the same dome as height (collinear). We keep
 * the same analytic form so applied (H+F)·dome matches the fitted amplitude;
 * ridge separates the underdetermined split.
 */
export function unitArchFillWeight(
    u: number,
    vSigned: number,
    side: Side,
    lengthMm: number,
    apexMoveMm: number,
): number {
    // Identical to dome — see module note. |cos| ≈ 1 → ridge required.
    return unitArchDomeWeight(u, vSigned, side, lengthMm, apexMoveMm);
}

/** Normalized absolute cosine between two equal-length column vectors. */
export function basisCosineAbs(colA: number[], colB: number[]): number {
    const n = Math.min(colA.length, colB.length);
    let ab = 0;
    let aa = 0;
    let bb = 0;
    for (let i = 0; i < n; i++) {
        const a = colA[i] ?? 0;
        const b = colB[i] ?? 0;
        ab += a * b;
        aa += a * a;
        bb += b * b;
    }
    const den = Math.sqrt(aa * bb);
    if (den < 1e-12) return 0;
    return Math.abs(ab / den);
}

/**
 * Ridge LS: min ||W p − g||² + λ ||p||² for p = [H, F].
 * W is n×2, g is n.
 *
 * When columns are collinear (as in height-field), Tikhonov shrinks the
 * identifiable sum H+F. We restore amplitude by rescaling to the unconstrained
 * scalar LS on the shared column, preserving the ridge H:F ratio. That keeps
 * null-space damping without under-supporting the arch.
 */
export function solveRidgeHF(
    colH: number[],
    colF: number[],
    gaps: number[],
    lambda: number = SCAN_FIT_PROFILE_RIDGE_LAMBDA,
): { height: number; fill: number } | null {
    const n = gaps.length;
    if (n < 1 || colH.length !== n || colF.length !== n) return null;

    let g00 = lambda;
    let g01 = 0;
    let g11 = lambda;
    let rhs0 = 0;
    let rhs1 = 0;
    let swg = 0;
    let sww = 0;
    for (let i = 0; i < n; i++) {
        const h = colH[i] ?? 0;
        const f = colF[i] ?? 0;
        const g = gaps[i] ?? 0;
        g00 += h * h;
        g01 += h * f;
        g11 += f * f;
        rhs0 += h * g;
        rhs1 += f * g;
        // Shared-column amplitude proxy (mean of the two nearly-identical bases).
        const w = 0.5 * (h + f);
        swg += w * g;
        sww += w * w;
    }
    const det = g00 * g11 - g01 * g01;
    if (Math.abs(det) < 1e-12) return null;
    let height = (rhs0 * g11 - rhs1 * g01) / det;
    let fill = (g00 * rhs1 - g01 * rhs0) / det;
    if (!Number.isFinite(height) || !Number.isFinite(fill)) return null;

    // Restore identifiable amplitude when ridge shrunk H+F.
    if (sww > 1e-12) {
        const A = swg / sww;
        const sum = height + fill;
        if (Math.abs(sum) > 1e-9) {
            const scale = A / sum;
            height *= scale;
            fill *= scale;
        } else if (Math.abs(A) > 1e-9) {
            height = A * 0.5;
            fill = A * 0.5;
        }
    }

    return { height, fill };
}

function clampParams(
    height: number,
    fill: number,
    apex: number,
): { archHeightMm: number; archFillMm: number; apexMoveMm: number; clamped: boolean } {
    const hLim = CLINICAL_LIMITS.archHeightMm;
    const fLim = CLINICAL_LIMITS.archFillMm;
    const aLim = CLINICAL_LIMITS.apexMoveMm;
    const hr = Math.round(height * 10) / 10;
    const fr = Math.round(fill * 10) / 10;
    const ar = Math.round(apex * 10) / 10;
    const archHeightMm = Math.max(hLim.min, Math.min(hLim.max, hr));
    const archFillMm = Math.max(fLim.min, Math.min(fLim.max, fr));
    const apexMoveMm = Math.max(aLim.min, Math.min(aLim.max, ar));
    const clamped = archHeightMm !== hr || archFillMm !== fr || apexMoveMm !== ar;
    return { archHeightMm, archFillMm, apexMoveMm, clamped };
}

/** Build equal-spaced station u centers across the arch band. */
export function profileStationUs(
    count: number = SCAN_FIT_PROFILE_STATIONS,
    uMin = PROFILE_ARCH_U_MIN,
    uMax = PROFILE_ARCH_U_MAX,
): number[] {
    if (count <= 1) return [(uMin + uMax) / 2];
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
        out.push(uMin + ((uMax - uMin) * i) / (count - 1));
    }
    return out;
}

/**
 * Aggregate medial arch samples into per-station mean gaps.
 * Drops stations below SCAN_FIT_MIN_SAMPLES_PER_STATION.
 */
export function buildProfileStations(
    samples: readonly { u: number; vSigned: number; gapMm: number }[],
    side: Side,
    stationUs: number[] = profileStationUs(),
): ProfileStation[] {
    const medialSign = side === "left" ? -1 : 1;
    const halfWidth = stationUs.length > 1 ? (stationUs[1]! - stationUs[0]!) / 2 : 0.04;
    const out: ProfileStation[] = [];
    for (const u0 of stationUs) {
        let sum = 0;
        let n = 0;
        for (const s of samples) {
            if (Math.abs(s.u - u0) > halfWidth + 1e-9) continue;
            const m = -(s.vSigned * medialSign);
            if (m < 0.2) continue;
            if (!Number.isFinite(s.gapMm)) continue;
            sum += s.gapMm;
            n += 1;
        }
        if (n < SCAN_FIT_MIN_SAMPLES_PER_STATION) continue;
        out.push({ u: u0, gapMm: sum / n, sampleCount: n });
    }
    return out;
}

/** Mean dome/fill weight of samples belonging to a station at a given apex. */
function meanStationWeight(
    samples: readonly { u: number; vSigned: number; gapMm: number }[],
    side: Side,
    u0: number,
    halfWidth: number,
    lengthMm: number,
    apexMoveMm: number,
    kind: "dome" | "fill",
): number {
    const medialSign = side === "left" ? -1 : 1;
    let sum = 0;
    let n = 0;
    for (const s of samples) {
        if (Math.abs(s.u - u0) > halfWidth + 1e-9) continue;
        const m = -(s.vSigned * medialSign);
        if (m < 0.2) continue;
        const w =
            kind === "dome"
                ? unitArchDomeWeight(s.u, s.vSigned, side, lengthMm, apexMoveMm)
                : unitArchFillWeight(s.u, s.vSigned, side, lengthMm, apexMoveMm);
        sum += w;
        n += 1;
    }
    return n > 0 ? sum / n : 0;
}

/**
 * Joint profile solve over stations. Falls back to null when too few stations
 * (caller falls back to scalar path).
 *
 * Pass the same medial arch samples used to build stations so basis columns
 * are sample-averaged weights (not a single vProbe) — required for amplitude
 * recovery when stations pool a range of vSigned.
 *
 * Compliance applied ONCE to composite amplitude (H+F), then split proportionally.
 */
export function solveArchProfile(args: {
    stations: ProfileStation[];
    samples: readonly { u: number; vSigned: number; gapMm: number }[];
    side: Side;
    lengthMm: number;
    applyCompliance?: boolean;
}): ProfileSolveResult | null {
    const { stations, samples, side, lengthMm, applyCompliance = true } = args;
    if (stations.length < SCAN_FIT_MIN_VALID_STATIONS) return null;

    const stationUs = profileStationUs();
    const halfWidth = stationUs.length > 1 ? (stationUs[1]! - stationUs[0]!) / 2 : 0.04;

    const apexMin = CLINICAL_LIMITS.apexMoveMm.min;
    const apexMax = CLINICAL_LIMITS.apexMoveMm.max;
    let best: {
        height: number;
        fill: number;
        apex: number;
        rms: number;
        residuals: number[];
        cosine: number;
    } | null = null;

    for (let apex = apexMin; apex <= apexMax + 1e-9; apex += SCAN_FIT_APEX_SEARCH_STEP_MM) {
        const colH: number[] = [];
        const colF: number[] = [];
        const gaps: number[] = [];
        for (const st of stations) {
            colH.push(meanStationWeight(samples, side, st.u, halfWidth, lengthMm, apex, "dome"));
            colF.push(meanStationWeight(samples, side, st.u, halfWidth, lengthMm, apex, "fill"));
            gaps.push(st.gapMm);
        }
        const cos = basisCosineAbs(colH, colF);
        const solved = solveRidgeHF(colH, colF, gaps);
        if (!solved) continue;
        const height = Math.max(0, solved.height);
        const fill = Math.max(0, solved.fill);
        const residuals: number[] = [];
        let err2 = 0;
        for (let i = 0; i < stations.length; i++) {
            const pred = height * colH[i]! + fill * colF[i]!;
            const r = pred - gaps[i]!;
            residuals.push(r);
            err2 += r * r;
        }
        const rms = Math.sqrt(err2 / stations.length);
        if (!best || rms < best.rms) {
            best = { height, fill, apex, rms, residuals, cosine: cos };
        }
    }
    if (!best) return null;

    const amplitudePre = best.height + best.fill;
    const amplitudePost = applyCompliance ? amplitudePre * SCAN_FIT_ARCH_COMPLIANCE : amplitudePre;
    let heightOut = 0;
    let fillOut = 0;
    if (amplitudePre > 1e-9) {
        heightOut = amplitudePost * (best.height / amplitudePre);
        fillOut = amplitudePost * (best.fill / amplitudePre);
    }

    const clamped = clampParams(heightOut, fillOut, best.apex);
    const totalSamples = stations.reduce((s, st) => s + st.sampleCount, 0);

    return {
        archHeightMm: clamped.archHeightMm,
        archFillMm: clamped.archFillMm,
        apexMoveMm: clamped.apexMoveMm,
        amplitudePreComplianceMm: amplitudePre,
        // Pre-clamp composite (compliance applied once). Clamped H+F may differ by rounding.
        amplitudePostComplianceMm: amplitudePost,
        stationResidualsMm: best.residuals.map((r) => Math.round(r * 100) / 100),
        stationUs: stations.map((s) => s.u),
        residualRmsMm: best.rms,
        sampleCount: totalSamples,
        basisCosine: best.cosine,
        mode: "profile",
        clamped: clamped.clamped,
        fallbackReason: null,
    };
}
