import { ClinicalStepFooter } from "@/components/clinical/ClinicalStepRail";
import { LeftSidebar } from "@/components/layout/LeftSidebar";
import { ActiveFootSideBar } from "@/features/clinical/ActiveFootSideBar";
import { ClinicalPrintStepPanel } from "@/features/clinical/ClinicalPrintStepPanel";
import { ClinicalScanStepPanel } from "@/features/clinical/ClinicalScanStepPanel";
import { HardnessStepPanel } from "@/features/clinical/HardnessStepPanel";
import { CorrectionsPanel } from "@/features/corrections/CorrectionsPanel";
import { ElementsPanel } from "@/features/elements/ElementsPanel";
import { ExportPanel } from "@/features/exports/ExportPanel";
import { ScanImport } from "@/features/scans/ScanImport";
import { CorrectionPresetsPanel } from "@/features/shape/CorrectionPresetsPanel";
import { TrimPresetsPanel } from "@/features/shape/TrimPresetsPanel";
import { ShapeFinishPanel } from "@/features/shape-finish/ShapeFinishPanel";
import { shouldShowShapeFinishOnShapeStep } from "@/features/shape-finish/shape-finish-mount";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";

export function RightPanel() {
    const step = useClinicalWorkflowStore((s) => s.step);
    const scanPattern = useDesignStore((s) => s.design.pattern);

    return (
        <aside className="flex h-full w-full flex-col border-l border-border bg-panel lg:w-80 lg:shrink-0">
            <div className="border-b border-border px-3 py-2">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Editing
                </div>
                <ActiveFootSideBar allowBothWhenLinked />
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto p-3">
                    {step === "scan" ? <ClinicalScanStepPanel /> : null}
                    {step === "setup" ? <LeftSidebar embedded sections={["production", "size"]} /> : null}
                    {step === "base" ? (
                        <div className="space-y-3">
                            <LeftSidebar embedded sections={["pattern", "library"]} />
                            {scanPattern === "full_contact" ? (
                                <div className="space-y-2 rounded-md border border-border bg-background/40 p-2">
                                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                        3D foot scan
                                    </div>
                                    <p className="text-[10px] text-muted-foreground">
                                        Upload a scan for Full Contact — Left, Right, or Pair.
                                    </p>
                                    <ScanImport />
                                </div>
                            ) : null}
                            <TrimPresetsPanel />
                            {shouldShowShapeFinishOnShapeStep() ? <ShapeFinishPanel /> : null}
                            <p className="text-[10px] text-muted-foreground">
                                Fine-tune outline with <span className="text-foreground">Edit trimline</span>{" "}
                                in the viewer. The bottom pattern rides with last width.
                            </p>
                        </div>
                    ) : null}
                    {step === "corrections" ? (
                        <div className="space-y-3">
                            <CorrectionPresetsPanel />
                            <CorrectionsPanel />
                        </div>
                    ) : null}
                    {step === "elements" ? <ElementsPanel /> : null}
                    {step === "print" ? (
                        <div className="space-y-3">
                            <ClinicalPrintStepPanel />
                            <HardnessStepPanel />
                        </div>
                    ) : null}
                    {step === "export" ? <ExportPanel /> : null}
                </div>
                <ClinicalStepFooter />
            </div>
        </aside>
    );
}
