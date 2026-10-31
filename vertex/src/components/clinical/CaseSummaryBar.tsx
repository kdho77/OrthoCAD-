// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { caseSummaryParts } from "@/lib/clinical/case-summary";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";

export function CaseSummaryBar() {
    const design = useDesignStore((s) => s.design);
    const setStep = useClinicalWorkflowStore((s) => s.setStep);
    const parts = caseSummaryParts(design);

    return (
        <div className="flex flex-wrap items-center gap-1 border-b border-border bg-background px-3 py-1 text-[11px]">
            {parts.map((p, i) => (
                <span key={p.id} className="flex items-center gap-1">
                    {i > 0 ? <span className="text-muted-foreground">·</span> : null}
                    <button
                        type="button"
                        onClick={() => setStep(p.step)}
                        className="text-foreground underline-offset-2 hover:underline"
                    >
                        {p.label}
                    </button>
                </span>
            ))}
        </div>
    );
}
