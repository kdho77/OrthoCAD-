// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Advisory medial/lateral flange fit from a registered foot scan.
 *
 * Uses the shared scan-fit kernel + anatomically-banded rigid residual.
 * NEVER auto-applies — caller must present suggestion + explicit Apply.
 * Pure: no Zustand, no updateCorrection, no getState().
 */

import type * as THREE from "three";
import { CLINICAL_LIMITS } from "@/lib/geometry/clinical-constraints";
import {
    ArchFitError,
    type ArchFitReference,
    collectPlantarGapSamples,
} from "@/lib/geometry/fit-arch-from-scan";
import { unitFlangeWeight } from "@/lib/geometry/height-field";
import {
    FLANGE_LATERAL_U_END,
    FLANGE_LATERAL_U_START,
    FLANGE_MEDIAL_U_END,
    FLANGE_MEDIAL_U_START,
    SCAN_FIT_FLANGE_COMPLIANCE,
    SCAN_FIT_FLANGE_MIN_SAMPLES,
    SCAN_FIT_MIN_SAMPLES,
} from "@/lib/geometry/scan-fit-constants";
import { solveWithCompliance } from "@/lib/geometry/scan-fit-kernel";
import {
    type BandedGapSample,
    confidenceFromRms,
    decomposeRigidGapBanded,
    type FitConfidence,
    gapsEntirelyNegative,
    registrationFlagsFromRigid,
    subtractRigidGap,
} from "@/lib/geometry/scan-fit-residual";
import type { Side, SideCorrections } from "@/types";

export type FlangeFitSuggestion = {
    suggestedMedialFlangeMm: number;
    suggestedLateralFlangeMm: number;
    /** True when either side was clamped to clinical max/min. */
    clamped: boolean;
    medialSampleCount: number;
    lateralSampleCount: number;
    residualRmsMm: number;
    confidence: FitConfidence;
    /** Always false — never auto-applies. */
    autoApply: false;
    /** True when medial edge coverage was below the sample floor. */
    medialInsufficient: boolean;
    /** True when lateral edge coverage was below the sample floor. */
    lateralInsufficient: boolean;
};

function clampFlange(raw: number): { value: number; clamped: boolean } {
    const lim = CLINICAL_LIMITS.medialFlangeMm;
    const rounded = Math.round(Math.max(0, raw) * 10) / 10;
    const value = Math.max(lim.min, Math.min(lim.max, rounded));
    return { value, clamped: value !== rounded };
}

function isMedialEdge(vSigned: number, side: Side): boolean {
    const medialSign = side === "left" ? -1 : 1;
    const m = -(vSigned * medialSign);
    return m > 0.35 && Math.abs(vSigned) >= 0.55;
}

function isLateralEdge(vSigned: number, side: Side): boolean {
    const medialSign = side === "left" ? -1 : 1;
    const m = -(vSigned * medialSign);
    return m < -0.35 && Math.abs(vSigned) >= 0.55;
}

/**
 * Fit advisory medialFlangeMm / lateralFlangeMm from scan vs RAW base.
 * Throws ArchFitError on insufficient plantar coverage / bad registration.
 * Returns zeroed sides (with insufficient flags) when an edge band is thin.
 */
export function fitFlangeFromScan(args: {
    scanPositions: ArrayLike<number>;
    scanVertexCount: number;
    scanToBase: THREE.Matrix4;
    reference: ArchFitReference;
    side: Side;
}): FlangeFitSuggestion {
    const { scanPositions, scanVertexCount, scanToBase, reference, side } = args;
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

    const banded: BandedGapSample[] = allPlantar.map((p) => ({
        x: p.x,
        y: p.y,
        gapMm: p.gapMm,
        u: p.u,
        vSigned: p.vSigned,
    }));

    const rigid = decomposeRigidGapBanded(banded, side);
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

    const medialBand = correctedPlantar.filter(
        (p) => p.u >= FLANGE_MEDIAL_U_START && p.u <= FLANGE_MEDIAL_U_END && isMedialEdge(p.vSigned, side),
    );
    const lateralBand = correctedPlantar.filter(
        (p) => p.u >= FLANGE_LATERAL_U_START && p.u <= FLANGE_LATERAL_U_END && isLateralEdge(p.vSigned, side),
    );

    const medialInsufficient = medialBand.length < SCAN_FIT_FLANGE_MIN_SAMPLES;
    const lateralInsufficient = lateralBand.length < SCAN_FIT_FLANGE_MIN_SAMPLES;

    if (medialInsufficient && lateralInsufficient) {
        throw new ArchFitError(
            "insufficient_samples",
            `insufficient edge coverage for flange (need ≥${SCAN_FIT_FLANGE_MIN_SAMPLES} per side; medial ${medialBand.length}, lateral ${lateralBand.length})`,
        );
    }

    let medialValue = 0;
    let lateralValue = 0;
    let clamped = false;
    let medialN = 0;
    let lateralN = 0;
    let rmsAcc = 0;
    let rmsN = 0;

    if (!medialInsufficient) {
        const weighted = medialBand.map((p) => ({
            gapMm: p.gapMm,
            weight: unitFlangeWeight(p.u, p.vSigned, side, "medial"),
        }));
        const solved = solveWithCompliance(weighted, SCAN_FIT_FLANGE_COMPLIANCE, SCAN_FIT_FLANGE_MIN_SAMPLES);
        if (solved) {
            const c = clampFlange(solved.value);
            medialValue = c.value;
            clamped = clamped || c.clamped;
            medialN = solved.sampleCount;
            rmsAcc += solved.residualRmsMm * solved.residualRmsMm * solved.sampleCount;
            rmsN += solved.sampleCount;
        } else {
            throw new ArchFitError("degenerate_weight", "Medial flange weight vanished in the edge band");
        }
    }

    if (!lateralInsufficient) {
        const weighted = lateralBand.map((p) => ({
            gapMm: p.gapMm,
            weight: unitFlangeWeight(p.u, p.vSigned, side, "lateral"),
        }));
        const solved = solveWithCompliance(weighted, SCAN_FIT_FLANGE_COMPLIANCE, SCAN_FIT_FLANGE_MIN_SAMPLES);
        if (solved) {
            const c = clampFlange(solved.value);
            lateralValue = c.value;
            clamped = clamped || c.clamped;
            lateralN = solved.sampleCount;
            rmsAcc += solved.residualRmsMm * solved.residualRmsMm * solved.sampleCount;
            rmsN += solved.sampleCount;
        } else {
            throw new ArchFitError("degenerate_weight", "Lateral flange weight vanished in the edge band");
        }
    }

    const residualRmsMm = rmsN > 0 ? Math.sqrt(rmsAcc / rmsN) : 0;
    const confidence = confidenceFromRms(residualRmsMm, regFlags, false, rigid.pitchFallbackUsed);

    return {
        suggestedMedialFlangeMm: medialValue,
        suggestedLateralFlangeMm: lateralValue,
        clamped,
        medialSampleCount: medialN,
        lateralSampleCount: lateralN,
        residualRmsMm,
        confidence,
        autoApply: false,
        medialInsufficient,
        lateralInsufficient,
    };
}

/** Explicit Apply patch — clinical clamp happens again in updateCorrection. */
export function flangeFitToCorrectionPatch(suggestion: FlangeFitSuggestion): Partial<SideCorrections> {
    const patch: Partial<SideCorrections> = {};
    if (!suggestion.medialInsufficient) {
        patch.medialFlangeMm = suggestion.suggestedMedialFlangeMm;
    }
    if (!suggestion.lateralInsufficient) {
        patch.lateralFlangeMm = suggestion.suggestedLateralFlangeMm;
    }
    return patch;
}
