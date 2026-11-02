// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { AlertCircle, Check, CircleDot } from "lucide-react";
import { isOptionalScanWorkflow } from "@/features/clients/start-path";
import { evaluateNextGate, evaluateStepComplete } from "@/lib/clinical/clinical-step-gates";
import { cn } from "@/lib/utils";
import {
    CLINICAL_STEPS,
    type ClinicalStepId,
    clinicalStepShort,
    useClinicalWorkflowStore,
} from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";

export function ClinicalStepRail() {
    const step = useClinicalWorkflowStore((s) => s.step);
    const designStartPath = useClinicalWorkflowStore((s) => s.designStartPath);
    const completedSteps = useClinicalWorkflowStore((s) => s.completedSteps);
    const nextBlockReason = useClinicalWorkflowStore((s) => s.nextBlockReason);
    const scanGateStickyReason = useClinicalWorkflowStore((s) => s.scanGateStickyReason);
    const footSideExplicitlyChosen = useClinicalWorkflowStore((s) => s.footSideExplicitlyChosen);
    void footSideExplicitlyChosen;
    const setStep = useClinicalWorkflowStore((s) => s.setStep);
    const method = useDesignStore((s) => s.design.method);

    const stepState = (id: ClinicalStepId) => {
        if (step === id) return "current";
        if (evaluateStepComplete(id, completedSteps)) return "completed";
        if (stepIndex(id) < stepIndex(step)) return "visited";
        if (stepIndex(id) > stepIndex(step) && !evaluateNextGate(step).ok && id !== "scan") {
            return "attention";
        }
        return "upcoming";
    };

    void scanGateStickyReason;
    void nextBlockReason;

    const optionalScanRail = isOptionalScanWorkflow(designStartPath);

    return (
        <div className="border-b border-border bg-panel px-3 py-2">
            <nav aria-label="Clinical workflow" className="flex flex-wrap items-center gap-1">
                {CLINICAL_STEPS.map((s, i) => {
                    const state = stepState(s.id);
                    const scanOptional = s.id === "scan" && optionalScanRail;
                    return (
                        <button
                            key={s.id}
                            type="button"
                            onClick={() => setStep(s.id)}
                            className={cn(
                                "flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                                scanOptional &&
                                    state !== "current" &&
                                    "border border-dashed border-border/80 bg-muted/30 text-muted-foreground/90",
                                state === "current" && "bg-primary text-primary-foreground",
                                state === "completed" &&
                                    !scanOptional &&
                                    "border border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
                                state === "visited" &&
                                    "border border-border bg-background text-muted-foreground hover:text-foreground",
                                state === "attention" &&
                                    "border border-amber-500/50 bg-amber-500/10 text-amber-100",
                                state === "upcoming" &&
                                    !scanOptional &&
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
                            {scanOptional ? (
                                <span className="rounded bg-muted px-1 py-0.5 text-[9px] font-normal uppercase tracking-wide text-muted-foreground">
                                    Optional
                                </span>
                            ) : null}
                        </button>
                    );
                })}
            </nav>
        </div>
    );
}

function stepIndex(step: ClinicalStepId): number {
    return CLINICAL_STEPS.findIndex((s) => s.id === step);
}

export function ClinicalStepFooter() {
    const step = useClinicalWorkflowStore((s) => s.step);
    const nextBlockReason = useClinicalWorkflowStore((s) => s.nextBlockReason);
    const footSideExplicitlyChosen = useClinicalWorkflowStore((s) => s.footSideExplicitlyChosen);
    void nextBlockReason;
    void footSideExplicitlyChosen;
    const goNext = useClinicalWorkflowStore((s) => s.goNext);
    const goBack = useClinicalWorkflowStore((s) => s.goBack);
    const atFirst = step === "scan";
    const atLast = step === "export";

    return (
        <div className="sticky bottom-0 z-10 border-t border-border bg-panel px-3 py-2">
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
        </div>
    );
}
