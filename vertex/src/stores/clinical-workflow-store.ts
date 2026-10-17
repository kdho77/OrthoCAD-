// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { create } from "zustand";
import {
    evaluateNextGate,
    evaluateScanStepGate,
    scanGateBlocksLaterSteps,
} from "@/lib/clinical/clinical-step-gates";

export type ClinicalStepId =
    | "scan"
    | "setup"
    | "base"
    | "cast"
    | "corrections"
    | "elements"
    | "design"
    | "print"
    | "export";

export type ClinicalProductType = "insole" | "afo";

/** Map retired step ids so persisted / older calls still resolve. */
export function normalizeClinicalStep(step: string, product: ClinicalProductType = "insole"): ClinicalStepId {
    if (step === "hardness") return "print";
    if (product === "afo") {
        if (step === "shape" || step === "setup" || step === "base") return "cast";
        if (step === "elements") return "design";
        if (
            step === "scan" ||
            step === "cast" ||
            step === "corrections" ||
            step === "design" ||
            step === "print" ||
            step === "export"
        ) {
            return step;
        }
        return "scan";
    }
    if (step === "shape") return "base";
    if (step === "cast") return "setup";
    if (step === "design") return "elements";
    if (
        step === "scan" ||
        step === "setup" ||
        step === "base" ||
        step === "corrections" ||
        step === "elements" ||
        step === "print" ||
        step === "export"
    ) {
        return step;
    }
    return "scan";
}

export const CLINICAL_STEPS: { id: ClinicalStepId; label: string; short: string }[] = [
    { id: "scan", label: "Scan", short: "Scan" },
    { id: "setup", label: "Setup", short: "Setup" },
    { id: "base", label: "Base", short: "Base" },
    { id: "corrections", label: "Corrections", short: "Corrections" },
    { id: "elements", label: "Elements", short: "Elements" },
    { id: "print", label: "Print", short: "Print" },
    { id: "export", label: "Export", short: "Export" },
];

export const AFO_STEPS: { id: ClinicalStepId; label: string; short: string }[] = [
    { id: "scan", label: "Home / Scan", short: "Scan" },
    { id: "cast", label: "Cast", short: "Cast" },
    { id: "corrections", label: "Corrections", short: "Corrections" },
    { id: "design", label: "Design", short: "Design" },
    { id: "print", label: "Print", short: "Print" },
    { id: "export", label: "Export", short: "Export" },
];

export function stepsForProduct(
    product: ClinicalProductType,
): { id: ClinicalStepId; label: string; short: string }[] {
    return product === "afo" ? AFO_STEPS : CLINICAL_STEPS;
}

/** Parametric-correction section keys. Groups stay collapsed until the user opens one. */
export const CORRECTIONS_STEP_SECTIONS: CorrectionsSectionKey[] = [
    "Arch",
    "Heel",
    "Flanges",
    "Posting",
    "Posting",
    "skive",
];

/** Corrections collapsible section keys (see CorrectionsPanel GROUPS + wedge/skive). */
export type CorrectionsSectionKey = "Posting" | "skive" | string;

export type ElementPlacementFoot = "left" | "right" | "both";

export interface CorrectionPresetOrigin {
    name: string;
    mode: "merge" | "replace";
    keys: { left: string[]; right: string[] };
}

interface ClinicalWorkflowStore {
    productType: ClinicalProductType;
    setProductType: (product: ClinicalProductType) => void;
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
    /** Last applied correction preset — keys stay marked until the user edits them. */
    correctionPresetOrigin: CorrectionPresetOrigin | null;
    setStep: (step: ClinicalStepId) => void;
    acknowledgeExplicitFootSide: (side: "left" | "right") => void;
    acknowledgePairAssignment: () => void;
    setElementPlacementFoot: (foot: ElementPlacementFoot) => void;
    setCorrectionPresetOrigin: (origin: CorrectionPresetOrigin | null) => void;
    clearCorrectionPresetOriginKey: (side: "left" | "right", key: string) => void;
    goNext: () => void;
    goBack: () => void;
    consumePendingCorrectionSections: () => CorrectionsSectionKey[];
}

function activeSteps(product: ClinicalProductType) {
    return stepsForProduct(product);
}

function stepIndex(step: ClinicalStepId, product: ClinicalProductType): number {
    return activeSteps(product).findIndex((s) => s.id === step);
}

function nextStep(current: ClinicalStepId, product: ClinicalProductType): ClinicalStepId {
    const steps = activeSteps(product);
    const idx = stepIndex(current, product);
    if (idx < 0 || idx >= steps.length - 1) return current;
    return steps[idx + 1]!.id;
}

function prevStep(current: ClinicalStepId, product: ClinicalProductType): ClinicalStepId {
    const steps = activeSteps(product);
    const idx = stepIndex(current, product);
    if (idx <= 0) return current;
    return steps[idx - 1]!.id;
}

function sectionsForStep(_step: ClinicalStepId): CorrectionsSectionKey[] {
    return [];
}

function markCompleted(completed: ClinicalStepId[], step: ClinicalStepId): ClinicalStepId[] {
    if (step === "scan" && !evaluateScanStepGate().ok) return completed;
    if (completed.includes(step)) return completed;
    return [...completed, step];
}

function applyScanStickyReason(step: ClinicalStepId, product: ClinicalProductType): string | null {
    if (stepIndex(step, product) <= stepIndex("scan", product)) {
        const gate = evaluateScanStepGate();
        return gate.ok ? null : gate.reason;
    }
    const gate = scanGateBlocksLaterSteps();
    return gate.ok ? null : gate.reason;
}

export const useClinicalWorkflowStore = create<ClinicalWorkflowStore>((set, get) => ({
    productType: "insole",
    setProductType: (product) =>
        set({
            productType: product,
            step: "scan",
            completedSteps: [],
            nextBlockReason: null,
            scanGateStickyReason: null,
        }),
    step: "scan",
    completedSteps: [],
    footSideExplicitlyChosen: false,
    scanGateStickyReason: null,
    nextBlockReason: null,
    elementPlacementFoot: "left",
    pendingCorrectionSections: [],
    correctionPresetOrigin: null,
    acknowledgeExplicitFootSide: (side) =>
        set({
            footSideExplicitlyChosen: true,
            elementPlacementFoot: side,
        }),
    acknowledgePairAssignment: () =>
        set({
            footSideExplicitlyChosen: true,
            elementPlacementFoot: "both",
        }),
    setCorrectionPresetOrigin: (origin) => set({ correctionPresetOrigin: origin }),
    clearCorrectionPresetOriginKey: (side, key) =>
        set((s) => {
            const origin = s.correctionPresetOrigin;
            if (!origin) return s;
            const nextKeys = origin.keys[side].filter((k) => k !== key);
            if (nextKeys.length === origin.keys[side].length) return s;
            return {
                correctionPresetOrigin: {
                    ...origin,
                    keys: { ...origin.keys, [side]: nextKeys },
                },
            };
        }),
    setStep: (step) => {
        const product = get().productType;
        const next = normalizeClinicalStep(step, product);
        const sticky = applyScanStickyReason(next, product);
        set({
            step: next,
            scanGateStickyReason: sticky,
            nextBlockReason: sticky,
            pendingCorrectionSections: sectionsForStep(next),
        });
    },
    setElementPlacementFoot: (foot) => set({ elementPlacementFoot: foot }),
    goNext: () => {
        const current = get().step;
        const product = get().productType;
        const gate = evaluateNextGate(current);
        if (!gate.ok) {
            set({
                step: "scan",
                nextBlockReason: gate.reason,
                scanGateStickyReason: gate.reason,
                pendingCorrectionSections: sectionsForStep("scan"),
            });
            return;
        }
        const step = nextStep(current, product);
        const sticky = applyScanStickyReason(step, product);
        set((s) => ({
            step,
            nextBlockReason: sticky,
            scanGateStickyReason: sticky,
            completedSteps: markCompleted(s.completedSteps, current),
            pendingCorrectionSections: sectionsForStep(step),
        }));
    },
    goBack: () => {
        const product = get().productType;
        const step = prevStep(get().step, product);
        const sticky = applyScanStickyReason(step, product);
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
