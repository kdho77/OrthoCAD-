import { ClinicalStepFooter } from "@/components/clinical/ClinicalStepRail";
import { EditingStepHeader } from "@/components/clinical/EditingStepHeader";
import { LeftSidebar } from "@/components/layout/LeftSidebar";
import { ClinicalPrintStepPanel } from "@/features/clinical/ClinicalPrintStepPanel";
import { ClinicalScanStepPanel } from "@/features/clinical/ClinicalScanStepPanel";
import { SetupStepPanel } from "@/features/clinical/SetupStepPanel";
import { HardnessStepPanel } from "@/features/clinical/HardnessStepPanel";
import { CorrectionsPanel } from "@/features/corrections/CorrectionsPanel";
import { ElementsPanel } from "@/features/elements/ElementsPanel";
import { ExportPanel } from "@/features/exports/ExportPanel";
import { CorrectionPresetsPanel } from "@/features/shape/CorrectionPresetsPanel";
import { TrimPresetsPanel } from "@/features/shape/TrimPresetsPanel";
import { ShapeFinishPanel } from "@/features/shape-finish/ShapeFinishPanel";
import { shouldShowShapeFinishOnShapeStep } from "@/features/shape-finish/shape-finish-mount";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";

export function RightPanel() {
    const step = useClinicalWorkflowStore((s) => s.step);
    const method = useDesignStore((s) => s.design.method);

    return (
        <aside className="flex h-full w-full flex-col border-l border-border bg-panel lg:w-80 lg:shrink-0">
            <EditingStepHeader />
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto p-3">
                    {step === "scan" ? <ClinicalScanStepPanel /> : null}
                    {step === "setup" ? <SetupStepPanel /> : null}
                    {step === "base" ? (
                        <div className="space-y-3">
                            <LeftSidebar embedded sections={["pattern", "library"]} clinicalDeclutter="base" />
                            <TrimPresetsPanel />
                            {shouldShowShapeFinishOnShapeStep() ? <ShapeFinishPanel /> : null}
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
                            {method === "milling_3axis" ? null : <HardnessStepPanel />}
                        </div>
                    ) : null}
                    {step === "export" ? <ExportPanel clinicalExportStep /> : null}
                </div>
                <ClinicalStepFooter />
            </div>
        </aside>
    );
}
