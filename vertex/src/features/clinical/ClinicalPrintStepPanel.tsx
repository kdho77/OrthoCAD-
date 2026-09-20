// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { ExportPanel } from "@/features/exports/ExportPanel";
import { PrintingPanel } from "@/features/exports/PrintingPanel";
import { cn } from "@/lib/utils";

export function ClinicalPrintStepPanel() {
    const [advancedOpen, setAdvancedOpen] = useState(false);

    return (
        <div className="space-y-3">
            <div className="rounded-md border border-primary/30 bg-primary/5 px-2 py-2 text-[11px] leading-snug text-foreground">
                <p className="font-medium">Recommended path</p>
                <p className="mt-1 text-muted-foreground">
                    Use <strong className="font-medium text-foreground">Prepare for print</strong> below for
                    belt / server G-code. Final gyroid infill is applied during server manufacture — the 3D
                    preview may look different from the printed part.
                </p>
            </div>

            <PrintingPanel clinicalMode />

            <button
                type="button"
                onClick={() => setAdvancedOpen((v) => !v)}
                className="flex w-full items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                aria-expanded={advancedOpen}
            >
                <ChevronRight
                    className={cn("h-3.5 w-3.5 transition-transform", advancedOpen && "rotate-90")}
                />
                Advanced (manifold, triangles, STL/GLB export)
            </button>

            {advancedOpen ? (
                <div className="rounded-md border border-border bg-background/40 p-2">
                    <ExportPanel />
                </div>
            ) : null}
        </div>
    );
}
