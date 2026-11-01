// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { collectHardnessRegions } from "@/lib/hardness/collect";
import { useDesignStore } from "@/stores/design-store";
import { CLASS_PREVIEW_COLORS, classDensityPct } from "../../../shared/print-recipe/hardness-class-table";

export function HardnessRegionList() {
    const design = useDesignStore((s) => s.design);
    const selectElement = useDesignStore((s) => s.selectElement);
    const regions = collectHardnessRegions(design);

    return (
        <div className="space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Hardness regions
            </div>
            {regions.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-2 py-2 text-[11px] text-muted-foreground">
                    No region modifiers. Device hardness fills the shell. Assign a class on a placed element,
                    or add a zone (kind &quot;zone&quot; in the print recipe).
                </p>
            ) : (
                <ul className="space-y-1">
                    {regions.map((r) => {
                        let pct = "?";
                        try {
                            pct = String(classDensityPct(r.hardnessClass, r.overrides));
                        } catch {
                            pct = "unmapped";
                        }
                        return (
                            <li key={r.regionId}>
                                <button
                                    type="button"
                                    className="flex w-full items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5 text-left text-[11px]"
                                    onClick={() => {
                                        if (r.elementId) selectElement(r.elementId);
                                    }}
                                >
                                    <span
                                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                                        style={{ background: CLASS_PREVIEW_COLORS[r.hardnessClass] }}
                                    />
                                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                                        {r.label ?? r.regionId}
                                    </span>
                                    <span className="shrink-0 text-muted-foreground">
                                        {r.kind} · {r.hardnessClass} {pct}% · p{r.priority}
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
