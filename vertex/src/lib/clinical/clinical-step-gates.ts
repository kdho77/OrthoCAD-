// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { designHasBase, designNeedsDefaultStockResolution } from "@/lib/geometry/base-asset";
import { useAfoStore } from "@/stores/afo-store";
import type { ClinicalStepId } from "@/stores/clinical-workflow-store";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";
import { useScanStore } from "@/stores/scan-store";

export type StepGateResult = { ok: true } | { ok: false; reason: string };

function scanRegistrationReady(scanId: string): boolean {
    const { registrationByScanId, markersByScanId } = useScanStore.getState();
    const reg = registrationByScanId[scanId];
    const markers = markersByScanId[scanId];
    const placed = [markers?.M1, markers?.M2, markers?.M3].filter(Boolean).length;
    if (placed < 3) return false;
    if (!reg?.matrixElements || reg.incomplete || reg.error) return false;
    return true;
}

/** Clinician explicitly chose Left or Right (not silent default). */
export function isFootSideExplicitlyKnown(): boolean {
    return useClinicalWorkflowStore.getState().footSideExplicitlyChosen;
}

/** Base GLB loaded and usable for shaping. */
export function isReadyToShape(): StepGateResult {
    const { design, stockBaseLoading, stockBaseError } = useDesignStore.getState();
    if (stockBaseLoading) {
        return { ok: false, reason: "Wait for the insole base to finish loading." };
    }
    if (stockBaseError) {
        return { ok: false, reason: stockBaseError };
    }
    if (!designHasBase(design) || designNeedsDefaultStockResolution(design)) {
        return { ok: false, reason: "Stock base is not ready yet — wait for the insole to load." };
    }
    return { ok: true };
}

/** Scan step: explicit L/R + base ready; if scans exist, at least one must be registered. */
export function evaluateScanStepGate(): StepGateResult {
    if (!isFootSideExplicitlyKnown()) {
        return {
            ok: false,
            reason: "Select Left, Right, or Pair above before continuing (no silent default).",
        };
    }

    const product = useClinicalWorkflowStore.getState().productType;
    if (product === "afo") {
        if (useAfoStore.getState().castMesh) return { ok: true };
        const scans = useScanStore.getState().scans;
        if (scans.length === 0) {
            return { ok: false, reason: "Import a foot+leg scan to start the AFO case." };
        }
        const oriented = scans.some((s) => {
            const m = useScanStore.getState().markersByScanId[s.id];
            return Boolean(m?.M1 && m.M2 && m.M3);
        });
        if (!oriented) {
            return { ok: false, reason: "Place the 3-point orient (heel, medial mal, lateral mal)." };
        }
        return { ok: true };
    }

    const ready = isReadyToShape();
    if (!ready.ok) return ready;

    const scans = useScanStore.getState().scans;
    if (scans.length === 0) {
        return { ok: true };
    }

    const registered = scans.some((s) => scanRegistrationReady(s.id));
    if (!registered) {
        return {
            ok: false,
            reason: "Register a scan (3 markers, aligned) or remove scans to shape the stock base only.",
        };
    }

    return { ok: true };
}

/**
 * Whether a step may show a completed checkmark.
 * Shape / Corrections / Elements / Hardness are never auto-complete from base-load alone — only via `completedSteps`.
 */
export function evaluateStepComplete(
    step: ClinicalStepId | string,
    completedSteps: ClinicalStepId[],
): boolean {
    const id = step === "shape" ? "base" : step === "hardness" ? "print" : step;
    if (completedSteps.includes(id as ClinicalStepId)) return true;
    if (id === "scan") return evaluateScanStepGate().ok;
    return false;
}

/** Gate for leaving the current step via Next. */
export function evaluateNextGate(fromStep: ClinicalStepId): StepGateResult {
    if (fromStep === "scan") return evaluateScanStepGate();
    const product = useClinicalWorkflowStore.getState().productType;
    if (product === "afo" && fromStep === "cast") {
        const afo = useDesignStore.getState().design.afo;
        if (afo?.crest.lowConfidence && !afo.crest.override) {
            const has =
                afo.clinicalMarkers.some((m) => m.id === "tibial_tuberosity") &&
                afo.clinicalMarkers.some((m) => m.id === "distal_crest");
            if (!has) {
                return {
                    ok: false,
                    reason: "Low-confidence tibial crest — place tibial tuberosity and distal crest end.",
                };
            }
        }
    }
    if (product === "afo" && fromStep === "design") {
        const afo = useDesignStore.getState().design.afo;
        if (!afo?.trimConfirmed) {
            return { ok: false, reason: "Confirm a closed geodesic trim loop before Print." };
        }
    }
    if (product === "afo" && fromStep === "print") {
        const afo = useDesignStore.getState().design.afo;
        if (!afo?.shellReady) {
            return { ok: false, reason: "Generate the watertight shell before Export." };
        }
    }
    return scanGateBlocksLaterSteps();
}

/** Steps after Scan require the scan gate to stay satisfied (sticky failure when jumping ahead). */
export function scanGateBlocksLaterSteps(): StepGateResult {
    const gate = evaluateScanStepGate();
    return gate;
}

/**
 * Revision string for components that render {@link evaluateScanStepGate}.
 * The gate reads the stores directly; this selector is what makes the UI update.
 */
export function selectScanGateRevision(s: {
    scans: { id: string }[];
    markersByScanId: Record<string, { M1?: unknown; M2?: unknown; M3?: unknown; ARCH?: unknown } | undefined>;
    registrationByScanId: Record<
        string,
        { matrixElements: number[] | null; incomplete: boolean; error: unknown } | undefined
    >;
}): string {
    return s.scans
        .map((scan) => {
            const m = s.markersByScanId[scan.id];
            const reg = s.registrationByScanId[scan.id];
            const placed = `${m?.M1 ? 1 : 0}${m?.M2 ? 1 : 0}${m?.M3 ? 1 : 0}${m?.ARCH ? 1 : 0}`;
            const aligned = reg?.matrixElements && !reg.incomplete && !reg.error ? 1 : 0;
            return `${scan.id}:${placed}:${aligned}`;
        })
        .join("|");
}

/**
 * Banner copy for the clinical rail. Always uses the live gate so choosing
 * Left / Right / Pair (or mill-selecting a side) clears the stale "select a
 * side" message even if a jump-ahead sticky reason is still stored.
 */
export function clinicalRailBannerReason(step: ClinicalStepId): string | null {
    const live = evaluateNextGate(step);
    if (live.ok) return null;
    return live.reason;
}
