// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { AlertCircle, Check, CircleDot } from "lucide-react";
import { useSaveDesign } from "@/features/designs/SaveControl";
import {
    clinicalRailBannerReason,
    evaluateNextGate,
    evaluateStepComplete,
    selectScanGateRevision,
} from "@/lib/clinical/clinical-step-gates";
import { cn } from "@/lib/utils";
import { useAppNavStore } from "@/stores/app-nav-store";
import {
    type ClinicalStepId,
    clinicalStepShort,
    stepsForProduct,
    useClinicalWorkflowStore,
} from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";
import { useScanStore } from "@/stores/scan-store";

export function ClinicalStepRail() {
    const productType = useClinicalWorkflowStore((s) => s.productType);
    const steps = stepsForProduct(productType);
    const step = useClinicalWorkflowStore((s) => s.step);
    const completedSteps = useClinicalWorkflowStore((s) => s.completedSteps);
    const nextBlockReason = useClinicalWorkflowStore((s) => s.nextBlockReason);
    const scanGateStickyReason = useClinicalWorkflowStore((s) => s.scanGateStickyReason);
    const footSideExplicitlyChosen = useClinicalWorkflowStore((s) => s.footSideExplicitlyChosen);
    void footSideExplicitlyChosen;
    const setStep = useClinicalWorkflowStore((s) => s.setStep);
    const method = useDesignStore((s) => s.design.method);
    const scanGateRevision = useScanStore(selectScanGateRevision);
    const stockGate = useDesignStore((s) => `${s.stockBaseLoading ? 1 : 0}:${s.stockBaseError ?? ""}`);

    const stepState = (id: ClinicalStepId) => {
        if (step === id) return "current";
        if (evaluateStepComplete(id, completedSteps)) return "completed";
        if (stepIndexOf(id, steps) < stepIndexOf(step, steps)) return "visited";
        if (
            stepIndexOf(id, steps) > stepIndexOf(step, steps) &&
            !evaluateNextGate(step).ok &&
            id !== "scan"
        ) {
            return "attention";
        }
        return "upcoming";
    };

    const bannerReason = clinicalRailBannerReason(step);
    void scanGateStickyReason;
    void nextBlockReason;

    return (
        <div
            className="border-b border-border bg-panel px-3 py-2"
            data-scan-gate={scanGateRevision}
            data-stock-gate={stockGate}
        >
            <nav aria-label="Clinical workflow" className="flex flex-wrap items-center gap-1">
                {steps.map((s, i) => {
                    const state = stepState(s.id);
                    return (
                        <button
                            key={s.id}
                            type="button"
                            onClick={() => setStep(s.id)}
                            className={cn(
                                "flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                                state === "current" && "bg-primary text-primary-foreground",
                                state === "completed" &&
                                    "border border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
                                state === "visited" &&
                                    "border border-border bg-background text-muted-foreground hover:text-foreground",
                                state === "attention" &&
                                    "border border-amber-500/50 bg-amber-500/10 text-amber-100",
                                state === "upcoming" &&
                                    "bg-muted text-muted-foreground hover:text-foreground",
                            )}
                        >
                            {state === "completed" ? (
                                <Check className="h-3 w-3 shrink-0" aria-hidden />
                            ) : state === "current" ? (
                                <CircleDot className="h-3 w-3 shrink-0" aria-hidden />
                            ) : state === "attention" ? (
                                <AlertCircle className="h-3 w-3 shrink-0" aria-hidden />
                            ) : (
                                <span className="text-[10px] opacity-80">{i + 1}.</span>
                            )}
                            {clinicalStepShort(s.id, method)}
                        </button>
                    );
                })}
            </nav>

            {bannerReason && typeof bannerReason === "string" ? (
                <p className="mt-2 text-[11px] leading-snug text-amber-300/95" role="status">
                    {bannerReason}
                </p>
            ) : null}
        </div>
    );
}

function stepIndexOf(step: ClinicalStepId, steps: { id: ClinicalStepId }[]): number {
    return steps.findIndex((s) => s.id === step);
}

export function ClinicalStepFooter() {
    const step = useClinicalWorkflowStore((s) => s.step);
    const nextBlockReason = useClinicalWorkflowStore((s) => s.nextBlockReason);
    const footSideExplicitlyChosen = useClinicalWorkflowStore((s) => s.footSideExplicitlyChosen);
    void nextBlockReason;
    void footSideExplicitlyChosen;
    const goNext = useClinicalWorkflowStore((s) => s.goNext);
    const goBack = useClinicalWorkflowStore((s) => s.goBack);
    const productType = useClinicalWorkflowStore((s) => s.productType);
    const scanGateRevision = useScanStore(selectScanGateRevision);
    const stockGate = useDesignStore((s) => `${s.stockBaseLoading ? 1 : 0}:${s.stockBaseError ?? ""}`);
    const steps = stepsForProduct(productType);
    const atFirst = step === steps[0]?.id;
    const atLast = step === steps[steps.length - 1]?.id;
    const gate = evaluateNextGate(step);
    const isAfoPrint = productType === "afo" && step === "print";

    if (isAfoPrint) {
        return <AfoPrintFooter />;
    }

    return (
        <div
            className="sticky bottom-0 z-10 border-t border-border bg-panel px-3 py-2"
            data-scan-gate={scanGateRevision}
            data-stock-gate={stockGate}
        >
            <div className="flex gap-2">
                <button
                    type="button"
                    disabled={atFirst}
                    onClick={() => goBack()}
                    className="h-8 flex-1 rounded-md border border-border bg-background text-[12px] font-medium text-foreground disabled:opacity-40"
                >
                    Back
                </button>
                {!atLast ? (
                    <button
                        type="button"
                        onClick={() => goNext()}
                        className="h-8 flex-1 rounded-md bg-primary text-[12px] font-medium text-primary-foreground"
                    >
                        Next
                    </button>
                ) : null}
            </div>
            {!gate.ok ? (
                <p className="mt-1.5 text-[11px] leading-snug text-amber-300/95" role="status">
                    {gate.reason} Next jumps to what’s missing.
                </p>
            ) : null}
        </div>
    );
}

function AfoPrintFooter() {
    const { saved, onSave, dialog } = useSaveDesign();
    const setNav = useAppNavStore((s) => s.setNav);

    return (
        <div className="sticky bottom-0 z-10 border-t border-border bg-panel px-3 py-2">
            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={onSave}
                    className="h-8 flex-1 rounded-md bg-primary text-[12px] font-medium text-primary-foreground"
                >
                    {saved ? "Saved" : "Save"}
                </button>
                <button
                    type="button"
                    onClick={() => setNav("Clients")}
                    className="h-8 flex-1 rounded-md border border-border bg-background text-[12px] font-medium text-foreground"
                >
                    Return to patient file
                </button>
            </div>
            {dialog}
        </div>
    );
}
