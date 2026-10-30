// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { caseSummaryParts, formatCaseSummaryLine } from "@/lib/clinical/case-summary";
import { useDesignStore } from "@/stores/design-store";

/** QC / order-ticket snapshot of size, width, method, and pattern. */
export function CaseOrderSummary() {
    const design = useDesignStore((s) => s.design);
    const parts = caseSummaryParts(design);

    return (
        <div className="rounded-md border border-border bg-background/50 p-2 text-xs">
            <p className="mb-1.5 font-medium text-muted-foreground">Order summary</p>
            <p className="font-medium text-foreground">{formatCaseSummaryLine(design)}</p>
            <dl className="mt-2 space-y-1 text-[11px]">
                {parts.map((p) => (
                    <div key={p.id} className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">{p.title}</dt>
                        <dd className="text-foreground">{p.label}</dd>
                    </div>
                ))}
            </dl>
        </div>
    );
}
