// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { evaluateNextGate, evaluateStepComplete } from "@/lib/clinical/clinical-step-gates";
import { cn } from "@/lib/utils";
import { CLINICAL_STEPS, type ClinicalStepId, useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";

export function ClinicalStepRail() {
    const step = useClinicalWorkflowStore((s) => s.step);
    const completedSteps = useClinicalWorkflowStore((s) => s.completedSteps);
    const nextBlockReason = useClinicalWorkflowStore((s) => s.nextBlockReason);
    const scanGateStickyReason = useClinicalWorkflowStore((s) => s.scanGateStickyReason);
    const setStep = useClinicalWorkflowStore((s) => s.setStep);
    const goNext = useClinicalWorkflowStore((s) => s.goNext);
    const goBack = useClinicalWorkflowStore((s) => s.goBack);

    const atFirst = step === "scan";
    const atLast = step === "print";
    const nextGate = evaluateNextGate(step);
    const nextDisabled = !nextGate.ok;

    const stepState = (id: ClinicalStepId) => {
        if (step === id) return "current";
        if (evaluateStepComplete(id, completedSteps)) return "completed";
        if (stepIndex(id) < stepIndex(step)) return "visited";
        return "upcoming";
    };

    const bannerReason =
        scanGateStickyReason ?? (nextBlockReason || (!nextGate.ok && !atLast ? nextGate.reason : null));

    return (
        <div className="border-b border-border bg-panel px-3 py-2">
            <nav aria-label="Clinical workflow" className="flex flex-wrap items-center gap-1">
                {CLINICAL_STEPS.map((s, i) => {
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
                                state === "upcoming" &&
                                    "bg-muted text-muted-foreground hover:text-foreground",
                            )}
                        >
                            {state === "completed" ? (
                                <Check className="h-3 w-3 shrink-0" aria-hidden />
                            ) : (
                                <span className="text-[10px] opacity-80">{i + 1}.</span>
                            )}
                            {s.short}
                        </button>
                    );
                })}
            </nav>

            <div className="mt-2 flex gap-2">
                <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-8 flex-1 gap-1"
                    disabled={atFirst}
                    onClick={() => goBack()}
                >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    Back
                </Button>
                {!atLast ? (
                    <Button
                        type="button"
                        size="sm"
                        className="h-8 flex-1 gap-1"
                        disabled={nextDisabled}
                        onClick={() => goNext()}
                    >
                        Next
                        <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                ) : null}
            </div>

            {bannerReason ? (
                <p className="mt-2 text-[11px] leading-snug text-amber-300/95" role="status">
                    {bannerReason}
                </p>
            ) : null}
        </div>
    );
}

function stepIndex(step: ClinicalStepId): number {
    return CLINICAL_STEPS.findIndex((s) => s.id === step);
}
