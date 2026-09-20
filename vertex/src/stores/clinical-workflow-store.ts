// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { create } from "zustand";
import { evaluateNextGate, evaluateStepComplete } from "@/lib/clinical/clinical-step-gates";

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
    /** Steps the user has successfully passed (no fake completion). */
    completedSteps: ClinicalStepId[];
    /** Inline reason when Next is blocked (AC8). */
    nextBlockReason: string | null;
    elementPlacementFoot: ElementPlacementFoot;
    pendingCorrectionSections: CorrectionsSectionKey[];
    setStep: (step: ClinicalStepId) => void;
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
    if (!evaluateStepComplete(step)) return completed;
    if (completed.includes(step)) return completed;
    return [...completed, step];
}

export const useClinicalWorkflowStore = create<ClinicalWorkflowStore>((set, get) => ({
    step: "scan",
    completedSteps: [],
    nextBlockReason: null,
    elementPlacementFoot: "left",
    pendingCorrectionSections: [],
    setStep: (step) =>
        set({
            step,
            nextBlockReason: null,
            pendingCorrectionSections: sectionsForStep(step),
        }),
    setElementPlacementFoot: (foot) => set({ elementPlacementFoot: foot }),
    goNext: () => {
        const current = get().step;
        const gate = evaluateNextGate(current);
        if (!gate.ok) {
            set({ nextBlockReason: gate.reason });
            return;
        }
        const step = nextStep(current);
        set((s) => ({
            step,
            nextBlockReason: null,
            completedSteps: markCompleted(s.completedSteps, current),
            pendingCorrectionSections: sectionsForStep(step),
        }));
    },
    goBack: () => {
        const step = prevStep(get().step);
        set({
            step,
            nextBlockReason: null,
            pendingCorrectionSections: sectionsForStep(step),
        });
    },
    consumePendingCorrectionSections: () => {
        const pending = get().pendingCorrectionSections;
        if (pending.length > 0) set({ pendingCorrectionSections: [] });
        return pending;
    },
}));
