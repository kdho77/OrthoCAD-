// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { designHasBase, designNeedsDefaultStockResolution } from "@/lib/geometry/base-asset";
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
        return { ok: false, reason: "Stock base is not ready yet — check the left panel." };
    }
    return { ok: true };
}

/** Scan step: explicit L/R + base ready; if scans exist, at least one must be registered. */
export function evaluateScanStepGate(): StepGateResult {
    if (!isFootSideExplicitlyKnown()) {
        return {
            ok: false,
            reason: "Select Left or Right foot above before continuing (no silent default).",
        };
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
 * Shape / Elements / Hardness are never auto-complete from base-load alone — only via `completedSteps`.
 */
export function evaluateStepComplete(step: ClinicalStepId, completedSteps: ClinicalStepId[]): boolean {
    if (completedSteps.includes(step)) return true;
    if (step === "scan") return evaluateScanStepGate().ok;
    return false;
}

/** Gate for leaving the current step via Next. */
export function evaluateNextGate(fromStep: ClinicalStepId): StepGateResult {
    if (fromStep === "scan") return evaluateScanStepGate();
    return { ok: true };
}

/** Steps after Scan require the scan gate to stay satisfied (sticky failure when jumping ahead). */
export function scanGateBlocksLaterSteps(): StepGateResult {
    const gate = evaluateScanStepGate();
    return gate;
}
