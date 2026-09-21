// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { cn } from "@/lib/utils";
import { useDesignStore } from "@/stores/design-store";
import {
    gyroidInfillPctForHardness,
    HARDNESS_NAMES,
    type HardnessName,
    migratePrintRecipe,
} from "../../../shared/print-recipe/print-recipe";

export const HARDNESS_NON_SHORE_DISCLAIMER =
    "Named hardness (Extra Soft → Extra Hard) is a relative stiffness ladder for our locked FDM gyroid profile — not Shore durometer. " +
    "Actual feel depends on filament, walls, and print settings. Preview infill may differ from server-manufactured gyroid.";

export function HardnessStepPanel() {
    const design = useDesignStore((s) => s.design);
    const setPrintHardness = useDesignStore((s) => s.setPrintHardness);
    const recipe = migratePrintRecipe(design.printRecipe);
    const active = recipe.defaultHardness;
    const pct = gyroidInfillPctForHardness(active, recipe.hardnessToInfillPct);

    return (
        <div className="space-y-3">
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-2 text-[11px] leading-snug text-amber-100/90">
                {HARDNESS_NON_SHORE_DISCLAIMER}
            </p>

            <div className="space-y-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Device hardness
                </div>
                <div className="flex flex-col gap-1">
                    {HARDNESS_NAMES.map((name) => (
                        <button
                            key={name}
                            type="button"
                            onClick={() => setPrintHardness(name as HardnessName)}
                            className={cn(
                                "flex items-center justify-between rounded-md border px-2 py-2 text-left text-xs",
                                active === name
                                    ? "border-primary bg-primary/10 text-foreground"
                                    : "border-border bg-background text-muted-foreground hover:border-primary/40",
                            )}
                        >
                            <span>{name}</span>
                            <span className="text-[10px] tabular-nums text-muted-foreground">
                                gyroid {gyroidInfillPctForHardness(name, recipe.hardnessToInfillPct)}%
                            </span>
                        </button>
                    ))}
                </div>
            </div>

            <p className="text-[11px] text-muted-foreground">
                Selected: <span className="font-medium text-foreground">{active}</span> ({pct}% gyroid infill
                target for server manufacture).
            </p>
        </div>
    );
}
