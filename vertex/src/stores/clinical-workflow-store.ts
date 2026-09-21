// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { create } from "zustand";
import {
    evaluateNextGate,
    evaluateScanStepGate,
    scanGateBlocksLaterSteps,
} from "@/lib/clinical/clinical-step-gates";

export type ClinicalStepId = "scan" | "shape" | "elements" | "hardness" | "print";

export const CLINICAL_STEPS: { id: ClinicalStepId; label: string; short: string }[] = [
    { id: "scan", label: "Scan", short: "Scan" },
    { id: "shape", label: "Shape", short: "Shape" },
    { id: "elements", label: "Elements", short: "Elements" },
    { id: "hardness", label: "Hardness", short: "Hardness" },
    { id: "print", label: "Print / Export", short: "Print" },
];

/** Corrections collapsible section keys (see CorrectionsPanel GROUPS + wedge/skive). */
export type CorrectionsSectionKey = "pronationSupination" | "skive" | string;

export type ElementPlacementFoot = "left" | "right" | "both";

interface ClinicalWorkflowStore {
    step: ClinicalStepId;
    /** Steps the user advanced past via successful Next (no environment auto-complete). */
    completedSteps: ClinicalStepId[];
    /** User clicked Left or Right on the clinical foot bar (scan gate). */
    footSideExplicitlyChosen: boolean;
    /** Persists scan-gate failure when user jumps ahead on the rail. */
    scanGateStickyReason: string | null;
    /** Inline reason when Next is blocked (AC8). */
    nextBlockReason: string | null;
    elementPlacementFoot: ElementPlacementFoot;
    pendingCorrectionSections: CorrectionsSectionKey[];
    setStep: (step: ClinicalStepId) => void;
    acknowledgeExplicitFootSide: (side: "left" | "right") => void;
    setElementPlacementFoot: (foot: ElementPlacementFoot) => void;
    goNext: () => void;
    goBack: () => void;
    consumePendingCorrectionSections: () => CorrectionsSectionKey[];
}

function stepIndex(step: ClinicalStepId): number {
    return CLINICAL_STEPS.findIndex((s) => s.id === step);
}

function nextStep(current: ClinicalStepId): ClinicalStepId {
    const idx = stepIndex(current);
    if (idx < 0 || idx >= CLINICAL_STEPS.length - 1) return current;
    return CLINICAL_STEPS[idx + 1].id;
}

function prevStep(current: ClinicalStepId): ClinicalStepId {
    const idx = stepIndex(current);
    if (idx <= 0) return current;
    return CLINICAL_STEPS[idx - 1].id;
}

function sectionsForStep(step: ClinicalStepId): CorrectionsSectionKey[] {
    if (step === "shape") return ["Arch", "pronationSupination"];
    return [];
}

function markCompleted(completed: ClinicalStepId[], step: ClinicalStepId): ClinicalStepId[] {
    if (step === "scan" && !evaluateScanStepGate().ok) return completed;
    if (completed.includes(step)) return completed;
    return [...completed, step];
}

function applyScanStickyReason(step: ClinicalStepId): string | null {
    if (stepIndex(step) <= stepIndex("scan")) {
        const gate = evaluateScanStepGate();
        return gate.ok ? null : gate.reason;
    }
    const gate = scanGateBlocksLaterSteps();
    return gate.ok ? null : gate.reason;
}

export const useClinicalWorkflowStore = create<ClinicalWorkflowStore>((set, get) => ({
    step: "scan",
    completedSteps: [],
    footSideExplicitlyChosen: false,
    scanGateStickyReason: null,
    nextBlockReason: null,
    elementPlacementFoot: "left",
    pendingCorrectionSections: [],
    acknowledgeExplicitFootSide: (side) =>
        set({
            footSideExplicitlyChosen: true,
            elementPlacementFoot: side,
        }),
    setStep: (step) => {
        const sticky = applyScanStickyReason(step);
        set({
            step,
            scanGateStickyReason: sticky,
            nextBlockReason: sticky,
            pendingCorrectionSections: sectionsForStep(step),
        });
    },
    setElementPlacementFoot: (foot) => set({ elementPlacementFoot: foot }),
    goNext: () => {
        const current = get().step;
        const gate = evaluateNextGate(current);
        if (!gate.ok) {
            const sticky = current === "scan" || stepIndex(current) > stepIndex("scan") ? gate.reason : null;
            set({
                nextBlockReason: gate.reason,
                scanGateStickyReason: sticky ?? get().scanGateStickyReason,
            });
            return;
        }
        const step = nextStep(current);
        const sticky = applyScanStickyReason(step);
        set((s) => ({
            step,
            nextBlockReason: sticky,
            scanGateStickyReason: sticky,
            completedSteps: markCompleted(s.completedSteps, current),
            pendingCorrectionSections: sectionsForStep(step),
        }));
    },
    goBack: () => {
        const step = prevStep(get().step);
        const sticky = applyScanStickyReason(step);
        set({
            step,
            nextBlockReason: sticky,
            scanGateStickyReason: sticky,
            pendingCorrectionSections: sectionsForStep(step),
        });
    },
    consumePendingCorrectionSections: () => {
        const pending = get().pendingCorrectionSections;
        if (pending.length > 0) set({ pendingCorrectionSections: [] });
        return pending;
    },
}));
