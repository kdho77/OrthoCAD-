// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { designHasBase, designNeedsDefaultStockResolution } from "@/lib/geometry/base-asset";
import type { ClinicalStepId } from "@/stores/clinical-workflow-store";
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

/** Scan step: active foot chosen + base ready; if scans exist, at least one must be registered. */
export function evaluateScanStepGate(): StepGateResult {
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

export function evaluateStepComplete(step: ClinicalStepId): boolean {
    switch (step) {
        case "scan":
            return evaluateScanStepGate().ok;
        case "shape":
        case "elements":
        case "hardness":
            return isReadyToShape().ok;
        case "print":
            return false;
        default:
            return false;
    }
}

/** Gate for leaving the current step via Next. */
export function evaluateNextGate(fromStep: ClinicalStepId): StepGateResult {
    if (fromStep === "scan") return evaluateScanStepGate();
    return { ok: true };
}
