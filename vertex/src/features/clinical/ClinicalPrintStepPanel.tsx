// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { SplitSettingsPanel } from "@/features/clinical/SplitSettingsPanel";
import { ExportPanel } from "@/features/exports/ExportPanel";
import { PrintingPanel } from "@/features/exports/PrintingPanel";
import { TextSummary } from "@/features/exports/TextSummary";
import { MillStepPanel } from "@/features/mill/MillStepPanel";
import { ShapeFinishPanel } from "@/features/shape-finish/ShapeFinishPanel";
import { shouldShowShapeFinishInPrintAdvanced } from "@/features/shape-finish/shape-finish-mount";
import { cn } from "@/lib/utils";
import { useDesignStore } from "@/stores/design-store";
import { useMillingProfileStore } from "@/stores/milling-profile-store";

export function ClinicalPrintStepPanel() {
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const method = useDesignStore((s) => s.design.method);
    const machine = useMillingProfileStore((s) => s.machine);
    const milling = method === "milling_3axis";

    if (milling) {
        return (
            <div className="space-y-3">
                <MillStepPanel />
                <button
                    type="button"
                    onClick={() => setAdvancedOpen((v) => !v)}
                    className="flex w-full items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                    aria-expanded={advancedOpen}
                >
                    <ChevronRight
                        className={cn("h-3.5 w-3.5 transition-transform", advancedOpen && "rotate-90")}
                    />
                    Advanced (manifold / STL / GLB)
                </button>
                {advancedOpen ? (
                    <div className="space-y-3 rounded-md border border-border bg-background/40 p-2">
                        <ExportPanel />
                    </div>
                ) : null}
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <div className="rounded-md border border-primary/30 bg-primary/5 px-2 py-2 text-[11px] leading-snug text-foreground">
                <p className="font-medium">Recommended path</p>
                <p className="mt-1 text-muted-foreground">
                    {machine === "cnc"
                        ? "3-axis CNC export reads the finished design (elements included) and does not change it. Walls are always straight. Choose the Idaho milling table, then export G-code."
                        : "The procedural solid is built here. Choose grinding style and hardness, then prepare G-code. Final gyroid infill is applied on the server — the 3D preview may differ from the printed part."}
                </p>
            </div>

            <SplitSettingsPanel />

            <PrintingPanel clinicalMode primaryOnly showWallPreview />
            <TextSummary />

            <button
                type="button"
                onClick={() => setAdvancedOpen((v) => !v)}
                className="flex w-full items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                aria-expanded={advancedOpen}
            >
                <ChevronRight
                    className={cn("h-3.5 w-3.5 transition-transform", advancedOpen && "rotate-90")}
                />
                Advanced (alternate G-code path, presets, manifold / STL / GLB)
            </button>

            {advancedOpen ? (
                <div className="space-y-3 rounded-md border border-border bg-background/40 p-2">
                    {shouldShowShapeFinishInPrintAdvanced() ? <ShapeFinishPanel /> : null}
                    <PrintingPanel showWallPreview={false} />
                    <ExportPanel />
                </div>
            ) : null}
        </div>
    );
}
