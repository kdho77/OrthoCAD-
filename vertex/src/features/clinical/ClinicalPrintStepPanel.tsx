// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { OutputSideBar } from "@/components/clinical/OutputSideBar";
import { SplitSettingsPanel } from "@/features/clinical/SplitSettingsPanel";
import { ExportPanel } from "@/features/exports/ExportPanel";
import { PrintingPanel } from "@/features/exports/PrintingPanel";
import { TextSummary } from "@/features/exports/TextSummary";
import { MillStepPanel } from "@/features/mill/MillStepPanel";
import { ShapeFinishPanel } from "@/features/shape-finish/ShapeFinishPanel";
import { shouldShowShapeFinishInPrintAdvanced } from "@/features/shape-finish/shape-finish-mount";
import { cn } from "@/lib/utils";
import { useDesignStore } from "@/stores/design-store";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";

export function ClinicalPrintStepPanel() {
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const method = useDesignStore((s) => s.design.method);
    const goNext = useClinicalWorkflowStore((s) => s.goNext);
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
                    Advanced
                </button>
                {advancedOpen ? (
                    <div className="space-y-3 rounded-md border border-border bg-background/40 p-2">
                        <ExportPanel hideOutputSide />
                    </div>
                ) : null}
                <OutputSideBar continueLabel="Continue to Export" onContinue={() => goNext()} />
            </div>
        );
    }

    return (
        <div className="space-y-3">
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
                Advanced
            </button>

            {advancedOpen ? (
                <div className="space-y-3 rounded-md border border-border bg-background/40 p-2">
                    {shouldShowShapeFinishInPrintAdvanced() ? <ShapeFinishPanel /> : null}
                    <PrintingPanel clinicalMode showWallPreview={false} />
                    <ExportPanel hideOutputSide />
                </div>
            ) : null}
            <OutputSideBar continueLabel="Continue to Export" onContinue={() => goNext()} showPair />
        </div>
    );
}
