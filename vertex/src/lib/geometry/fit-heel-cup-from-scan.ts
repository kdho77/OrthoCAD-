// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Advisory heel-cup depth fit from a registered foot scan.
 *
 * Uses the shared scan-fit kernel + rigid-body residual decomposition.
 * NEVER auto-applies — caller must present suggestion + explicit Apply.
 *
 * Note: existing CLINICAL_LIMITS.heelCupDepthMm.max is 10 mm. The advisory
 * window is SCAN_FIT_HEELCUP_* (8–20). Apply goes through updateCorrection,
 * which will further clamp to clinical limits without widening them.
 */

import type * as THREE from "three";
import { CLINICAL_LIMITS } from "@/lib/geometry/clinical-constraints";
import {
    ArchFitError,
    type ArchFitReference,
    collectPlantarGapSamples,
} from "@/lib/geometry/fit-arch-from-scan";
import { heelCupDepthBowlDelta } from "@/lib/geometry/height-field";
import {
    SCAN_FIT_HEEL_COMPLIANCE,
    SCAN_FIT_HEEL_U_MAX,
    SCAN_FIT_HEEL_U_MIN,
    SCAN_FIT_HEELCUP_MAX_MM,
    SCAN_FIT_HEELCUP_MIN_MM,
    SCAN_FIT_MIN_SAMPLES,
} from "@/lib/geometry/scan-fit-constants";
import { solveWithCompliance } from "@/lib/geometry/scan-fit-kernel";
import {
    confidenceFromRms,
    decomposeRigidGap,
    type FitConfidence,
    gapsEntirelyNegative,
    registrationFlagsFromRigid,
    subtractRigidGap,
} from "@/lib/geometry/scan-fit-residual";
import type { SideCorrections } from "@/types";

export type HeelCupFitSuggestion = {
    /** Advisory depth (mm), clamped to SCAN_FIT_HEELCUP window. */
    suggestedHeelCupDepthMm: number;
    /** True when raw solve was outside the advisory window. */
    clamped: boolean;
    /** True when advisory exceeds CLINICAL_LIMITS max (Apply will further clamp). */
    exceedsClinicalMax: boolean;
    sampleCount: number;
    residualRmsMm: number;
    confidence: FitConfidence;
    /** Always false for heel — never auto-applies. */
    autoApply: false;
};

/** Unit heel-cup bowl weight (matches height-field heelCupDepthBowlDelta at 1 mm). */
export function unitHeelCupWeight(u: number, vSigned: number): number {
    return heelCupDepthBowlDelta(u, Math.abs(vSigned), 1);
}

function clampHeelAdvisory(raw: number): { value: number; clamped: boolean } {
    const rounded = Math.round(raw * 10) / 10;
    const value = Math.max(SCAN_FIT_HEELCUP_MIN_MM, Math.min(SCAN_FIT_HEELCUP_MAX_MM, rounded));
    return { value, clamped: value !== rounded };
}

/**
 * Fit an advisory heelCupDepthMm from scan vs RAW base.
 * Returns null-path via throw (ArchFitError) for insufficient coverage / bad registration.
 */
export function fitHeelCupFromScan(args: {
    scanPositions: ArrayLike<number>;
    scanVertexCount: number;
    scanToBase: THREE.Matrix4;
    reference: ArchFitReference;
}): HeelCupFitSuggestion {
    const { scanPositions, scanVertexCount, scanToBase, reference } = args;
    if (scanVertexCount < 3) {
        throw new ArchFitError("insufficient_samples", "Scan has too few vertices");
    }

    const allPlantar = collectPlantarGapSamples({
        scanPositions,
        scanVertexCount,
        scanToBase,
        reference,
    });
    if (allPlantar.length < SCAN_FIT_MIN_SAMPLES) {
        throw new ArchFitError(
            "insufficient_samples",
            `Need ≥${SCAN_FIT_MIN_SAMPLES} plantar samples (got ${allPlantar.length})`,
        );
    }
    if (gapsEntirelyNegative(allPlantar)) {
        throw new ArchFitError(
            "negative_gap_field",
            "Scan sits entirely below the base — re-run alignment or check Left/Right",
        );
    }

    const rigid = decomposeRigidGap(allPlantar);
    if (!rigid) {
        throw new ArchFitError("degenerate_weight", "Could not decompose registration residual");
    }
    const regFlags = registrationFlagsFromRigid(rigid);
    const corrected = subtractRigidGap(allPlantar, rigid);
    const correctedPlantar = corrected.map((c, i) => ({
        ...c,
        u: allPlantar[i]!.u,
        vSigned: allPlantar[i]!.vSigned,
    }));

    const band = correctedPlantar.filter((p) => p.u >= SCAN_FIT_HEEL_U_MIN && p.u <= SCAN_FIT_HEEL_U_MAX);
    if (band.length < SCAN_FIT_MIN_SAMPLES) {
        throw new ArchFitError(
            "insufficient_samples",
            `insufficient scan coverage in heel (need ≥${SCAN_FIT_MIN_SAMPLES}, got ${band.length})`,
        );
    }

    const weighted = band.map((p) => ({
        gapMm: p.gapMm,
        weight: unitHeelCupWeight(p.u, p.vSigned),
    }));

    const solved = solveWithCompliance(weighted, SCAN_FIT_HEEL_COMPLIANCE, SCAN_FIT_MIN_SAMPLES);
    if (!solved) {
        throw new ArchFitError("degenerate_weight", "Heel-cup weight vanished in the heel band");
    }

    // Absolute depth — cup depth is non-negative.
    const { value, clamped } = clampHeelAdvisory(Math.abs(solved.value));
    const confidence = confidenceFromRms(solved.residualRmsMm, regFlags, false);

    return {
        suggestedHeelCupDepthMm: value,
        clamped,
        exceedsClinicalMax: value > CLINICAL_LIMITS.heelCupDepthMm.max,
        sampleCount: solved.sampleCount,
        residualRmsMm: solved.residualRmsMm,
        confidence,
        autoApply: false,
    };
}

/** Explicit Apply patch — further clinical clamp happens in updateCorrection. */
export function heelCupFitToCorrectionPatch(suggestion: HeelCupFitSuggestion): Partial<SideCorrections> {
    return { heelCupDepthMm: suggestion.suggestedHeelCupDepthMm };
}
