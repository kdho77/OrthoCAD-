// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { HardnessStepPanel } from "@/features/clinical/HardnessStepPanel";
import { SplitSettingsPanel } from "@/features/clinical/SplitSettingsPanel";
import { ExportPanel } from "@/features/exports/ExportPanel";
import { PrintingPanel } from "@/features/exports/PrintingPanel";
import { MillStepPanel } from "@/features/mill/MillStepPanel";
import { ShapeFinishPanel } from "@/features/shape-finish/ShapeFinishPanel";
import { shouldShowShapeFinishInPrintAdvanced } from "@/features/shape-finish/shape-finish-mount";
import { cn } from "@/lib/utils";
import { useDesignStore } from "@/stores/design-store";

export function ClinicalPrintStepPanel() {
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const method = useDesignStore((s) => s.design.method);
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
        <div className="flex min-h-0 flex-1 flex-col">
            <PrintingPanel
                clinicalMode
                primaryOnly
                showWallPreview={false}
                materialSection={<HardnessStepPanel compact />}
                advancedSections={
                    <>
                        <SplitSettingsPanel />
                        {shouldShowShapeFinishInPrintAdvanced() ? <ShapeFinishPanel /> : null}
                    </>
                }
            />
        </div>
    );
}
