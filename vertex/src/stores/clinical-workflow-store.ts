// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { create } from "zustand";
import {
    evaluateNextGate,
    evaluateScanStepGate,
    scanGateBlocksLaterSteps,
} from "@/lib/clinical/clinical-step-gates";
import type { ProductionMethod } from "@/types";

export type ClinicalStepId = "scan" | "setup" | "base" | "corrections" | "elements" | "print" | "export";

/** Map retired step ids so persisted / older calls still resolve. */
export function normalizeClinicalStep(step: string): ClinicalStepId {
    if (step === "shape") return "base";
    if (step === "hardness") return "print";
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

/** Print step is labeled Mill when production type is Milling — 3 Axis. */
export function clinicalStepShort(id: ClinicalStepId, method?: ProductionMethod): string {
    if (id === "print" && method === "milling_3axis") return "Mill";
    return CLINICAL_STEPS.find((s) => s.id === id)?.short ?? id;
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
    /** Bumped when Print / Export asks Elements to open the text editor. */
    textFocusNonce: number;
    pendingCorrectionSections: CorrectionsSectionKey[];
    /** Last applied correction preset — keys stay marked until the user edits them. */
    correctionPresetOrigin: CorrectionPresetOrigin | null;
    setStep: (step: ClinicalStepId) => void;
    acknowledgeExplicitFootSide: (side: "left" | "right") => void;
    acknowledgePairAssignment: () => void;
    setElementPlacementFoot: (foot: ElementPlacementFoot) => void;
    openTextEditor: () => void;
    setCorrectionPresetOrigin: (origin: CorrectionPresetOrigin | null) => void;
    clearCorrectionPresetOriginKey: (side: "left" | "right", key: string) => void;
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

function sectionsForStep(_step: ClinicalStepId): CorrectionsSectionKey[] {
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
    elementPlacementFoot: "both",
    textFocusNonce: 0,
    pendingCorrectionSections: [],
    correctionPresetOrigin: null,
    acknowledgeExplicitFootSide: (side) => {
        set({
            footSideExplicitlyChosen: true,
            elementPlacementFoot: side,
        });
        const gate = evaluateScanStepGate();
        set({
            scanGateStickyReason: gate.ok ? null : gate.reason,
            nextBlockReason: gate.ok ? null : gate.reason,
        });
    },
    acknowledgePairAssignment: () => {
        set({
            footSideExplicitlyChosen: true,
            elementPlacementFoot: "both",
        });
        const gate = evaluateScanStepGate();
        set({
            scanGateStickyReason: gate.ok ? null : gate.reason,
            nextBlockReason: gate.ok ? null : gate.reason,
        });
    },
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
        const next = normalizeClinicalStep(step);
        const sticky = applyScanStickyReason(next);
        set({
            step: next,
            scanGateStickyReason: sticky,
            nextBlockReason: sticky,
            pendingCorrectionSections: sectionsForStep(next),
        });
    },
    setElementPlacementFoot: (foot) => set({ elementPlacementFoot: foot }),
    openTextEditor: () =>
        set((s) => ({
            step: "elements",
            textFocusNonce: s.textFocusNonce + 1,
        })),
    goNext: () => {
        const current = get().step;
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
