// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CLINICAL_STEPS, useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";

export function ClinicalStepRail() {
    const step = useClinicalWorkflowStore((s) => s.step);
    const setStep = useClinicalWorkflowStore((s) => s.setStep);
    const goNext = useClinicalWorkflowStore((s) => s.goNext);
    const atLast = step === "print";

    return (
        <div className="space-y-2 border-b border-border pb-3">
            <nav aria-label="Clinical workflow" className="flex flex-wrap gap-1">
                {CLINICAL_STEPS.map((s, i) => (
                    <button
                        key={s.id}
                        type="button"
                        onClick={() => setStep(s.id)}
                        className={cn(
                            "rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                            step === s.id
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground hover:text-foreground",
                        )}
                    >
                        <span className="text-[10px] text-muted-foreground/80">{i + 1}.</span> {s.short}
                    </button>
                ))}
            </nav>
            {!atLast ? (
                <Button type="button" size="sm" className="h-8 w-full gap-1" onClick={() => goNext()}>
                    Next
                    <ChevronRight className="h-3.5 w-3.5" />
                </Button>
            ) : null}
        </div>
    );
}
