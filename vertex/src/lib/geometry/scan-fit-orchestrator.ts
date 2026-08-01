// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Unified Match-from-scan orchestration.
 *
 * Order: banded joint rigid solve → confidence gate → arch profile
 * (auto-applies if Good) → heel-cup advisory → flange advisory.
 * One rigid solve inside each fitter (identical joint formulation).
 * Heel and flange NEVER auto-apply.
 *
 * Export path stays scan-isolated. Scan mesh never baked.
 */

import type * as THREE from "three";
import {
    type ArchFitError,
    type ArchFitReference,
    type ArchFitResult,
    archFitToCorrectionPatch,
    canAutoApplyArchFit,
    collectPlantarGapSamples,
    fitArchParamsFromScan,
} from "@/lib/geometry/fit-arch-from-scan";
import {
    type FlangeFitSuggestion,
    fitFlangeFromScan,
    flangeFitToCorrectionPatch,
} from "@/lib/geometry/fit-flange-from-scan";
import {
    fitHeelCupFromScan,
    type HeelCupFitSuggestion,
    heelCupFitToCorrectionPatch,
} from "@/lib/geometry/fit-heel-cup-from-scan";
import { SCAN_FIT_CONVERGE_DELTA_MM, SCAN_FIT_MIN_SAMPLES } from "@/lib/geometry/scan-fit-constants";
import {
    type BandedGapSample,
    decomposeRigidGapBanded,
    type RigidGapResidual,
    subtractRigidGap,
} from "@/lib/geometry/scan-fit-residual";
import type { Side, SideCorrections } from "@/types";

export type MatchFromScanResult = {
    arch: ArchFitResult | null;
    heel: HeelCupFitSuggestion | null;
    flange: FlangeFitSuggestion | null;
    /** Shared joint rigid residual (from the arch path when available). */
    rigid: RigidGapResidual | null;
    conditionNumber: number;
    illConditioned: boolean;
    /** Post-fit plantar gap RMS against the corrected surface (display only). */
    postFitDeviationRmsMm: number | null;
    blockReason: string | null;
    /** True when arch was auto-applied. */
    archApplied: boolean;
    disabledReason: string | null;
};

export type MatchFromScanArgs = {
    scanPositions: ArrayLike<number>;
    scanVertexCount: number;
    scanToBase: THREE.Matrix4;
    reference: ArchFitReference;
    side: Side;
    lengthMm: number;
    /** When false, skip auto-apply decision (caller still applies). Default true. */
    allowAutoApply?: boolean;
};

/**
 * RMS of residual plantar gaps after subtracting the joint rigid plane
 * and (optionally) an arch-shaped correction already reflected in the gap
 * field via a second collect. Display-only post-fit QA.
 */
export function postFitPlantarRmsMm(gaps: readonly { gapMm: number }[]): number {
    const finite = gaps.filter((g) => Number.isFinite(g.gapMm));
    if (finite.length === 0) return 0;
    let acc = 0;
    for (const g of finite) acc += g.gapMm * g.gapMm;
    return Math.sqrt(acc / finite.length);
}

/**
 * Run the unified match pipeline. Pure — no Zustand.
 * Throws ArchFitError only when the arch path hard-fails (no plantar coverage).
 * Heel/flange thin bands degrade to null advisories without throwing.
 */
export function matchFromScan(args: MatchFromScanArgs): MatchFromScanResult {
    const allowAutoApply = args.allowAutoApply !== false;

    if (args.scanVertexCount < 3) {
        return {
            arch: null,
            heel: null,
            flange: null,
            rigid: null,
            conditionNumber: Number.POSITIVE_INFINITY,
            illConditioned: true,
            postFitDeviationRmsMm: null,
            blockReason: "Scan has too few vertices",
            archApplied: false,
            disabledReason: "Scan has too few vertices",
        };
    }

    let arch: ArchFitResult | null = null;
    let archError: string | null = null;
    try {
        arch = fitArchParamsFromScan({
            scanPositions: args.scanPositions,
            scanVertexCount: args.scanVertexCount,
            scanToBase: args.scanToBase,
            reference: args.reference,
            side: args.side,
            lengthMm: args.lengthMm,
        });
    } catch (e) {
        archError = e instanceof Error ? e.message : "Arch match failed";
    }

    let heel: HeelCupFitSuggestion | null = null;
    try {
        heel = fitHeelCupFromScan({
            scanPositions: args.scanPositions,
            scanVertexCount: args.scanVertexCount,
            scanToBase: args.scanToBase,
            reference: args.reference,
        });
    } catch {
        heel = null;
    }

    let flange: FlangeFitSuggestion | null = null;
    try {
        flange = fitFlangeFromScan({
            scanPositions: args.scanPositions,
            scanVertexCount: args.scanVertexCount,
            scanToBase: args.scanToBase,
            reference: args.reference,
            side: args.side,
        });
    } catch {
        flange = null;
    }

    // Shared rigid diagnostic: recompute once for condition number / post-fit QA
    // when arch failed, so UI still sees κ even if arch threw.
    let rigid: RigidGapResidual | null = null;
    let postFitDeviationRmsMm: number | null = null;
    try {
        const allPlantar = collectPlantarGapSamples({
            scanPositions: args.scanPositions,
            scanVertexCount: args.scanVertexCount,
            scanToBase: args.scanToBase,
            reference: args.reference,
        });
        if (allPlantar.length >= SCAN_FIT_MIN_SAMPLES) {
            const banded: BandedGapSample[] = allPlantar.map((p) => ({
                x: p.x,
                y: p.y,
                gapMm: p.gapMm,
                u: p.u,
                vSigned: p.vSigned,
            }));
            rigid = decomposeRigidGapBanded(banded, args.side);
            if (rigid) {
                const corrected = subtractRigidGap(allPlantar, rigid);
                postFitDeviationRmsMm = postFitPlantarRmsMm(corrected);
            }
        }
    } catch {
        // Diagnostic only — never throw from QA path.
    }

    const conditionNumber = arch?.conditionNumber ?? rigid?.conditionNumber ?? Number.POSITIVE_INFINITY;
    const illConditioned = arch?.illConditioned ?? rigid?.illConditioned ?? true;

    const blockReason = archError
        ? archError
        : arch?.confidence.registration.blockAutoApply
          ? "Registration residual too high to fit reliably — re-run alignment"
          : arch?.confidence.tier === "poor"
            ? "Fit residual too high to apply reliably — check alignment and scan coverage"
            : illConditioned
              ? `Ill-conditioned joint reference (κ=${conditionNumber.toFixed(1)}) — auto-apply blocked`
              : null;

    const archApplied = Boolean(allowAutoApply && arch && canAutoApplyArchFit(arch));

    // Prefer arch residual RMS as post-fit QA when arch succeeded.
    if (arch) {
        postFitDeviationRmsMm = arch.residualRmsMm;
    }

    return {
        arch,
        heel,
        flange,
        rigid: rigid ?? null,
        conditionNumber,
        illConditioned,
        postFitDeviationRmsMm,
        blockReason,
        archApplied,
        disabledReason: null,
    };
}

/** Correction patch for auto-applied arch only. */
export function matchFromScanArchPatch(result: MatchFromScanResult): Partial<SideCorrections> | null {
    if (!result.arch || !result.archApplied) return null;
    return archFitToCorrectionPatch(result.arch);
}

export type { ArchFitError };
export {
    archFitToCorrectionPatch,
    flangeFitToCorrectionPatch,
    heelCupFitToCorrectionPatch,
    SCAN_FIT_CONVERGE_DELTA_MM,
};
