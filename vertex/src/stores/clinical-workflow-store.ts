// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { create } from "zustand";

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

interface ClinicalWorkflowStore {
    step: ClinicalStepId;
    /** One-shot section keys to open when entering Shape (consumed by CorrectionsPanel). */
    pendingCorrectionSections: CorrectionsSectionKey[];
    setStep: (step: ClinicalStepId) => void;
    goNext: () => void;
    consumePendingCorrectionSections: () => CorrectionsSectionKey[];
}

function nextStep(current: ClinicalStepId): ClinicalStepId {
    const idx = CLINICAL_STEPS.findIndex((s) => s.id === current);
    if (idx < 0 || idx >= CLINICAL_STEPS.length - 1) return current;
    return CLINICAL_STEPS[idx + 1].id;
}

function sectionsForStep(step: ClinicalStepId): CorrectionsSectionKey[] {
    if (step === "shape") return ["Arch", "pronationSupination"];
    return [];
}

export const useClinicalWorkflowStore = create<ClinicalWorkflowStore>((set, get) => ({
    step: "scan",
    pendingCorrectionSections: [],
    setStep: (step) =>
        set({
            step,
            pendingCorrectionSections: sectionsForStep(step),
        }),
    goNext: () => {
        const step = nextStep(get().step);
        set({
            step,
            pendingCorrectionSections: sectionsForStep(step),
        });
    },
    consumePendingCorrectionSections: () => {
        const pending = get().pendingCorrectionSections;
        if (pending.length > 0) set({ pendingCorrectionSections: [] });
        return pending;
    },
}));
