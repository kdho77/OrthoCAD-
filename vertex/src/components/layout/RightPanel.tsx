import { ClinicalStepFooter } from "@/components/clinical/ClinicalStepRail";
import { EditingStepHeader } from "@/components/clinical/EditingStepHeader";
import { LeftSidebar } from "@/components/layout/LeftSidebar";
import { AfoCastPanel } from "@/features/afo/AfoCastPanel";
import { AfoCorrectionsPanel } from "@/features/afo/AfoCorrectionsPanel";
import { AfoDesignPanel } from "@/features/afo/AfoDesignPanel";
import { AfoExportPanel } from "@/features/afo/AfoExportPanel";
import { AfoPrintPanel } from "@/features/afo/AfoPrintPanel";
import { AfoScanPanel } from "@/features/afo/AfoScanPanel";
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
    const productType = useClinicalWorkflowStore((s) => s.productType);
    const isAfo = productType === "afo";
    const method = useDesignStore((s) => s.design.method);

    return (
        <aside className="flex h-full w-full flex-col border-l border-border bg-panel lg:w-80 lg:shrink-0">
            <EditingStepHeader />
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto p-3">
                    {isAfo && step === "scan" ? <AfoScanPanel /> : null}
                    {isAfo && step === "cast" ? <AfoCastPanel /> : null}
                    {isAfo && step === "corrections" ? <AfoCorrectionsPanel /> : null}
                    {isAfo && step === "design" ? <AfoDesignPanel /> : null}
                    {isAfo && step === "print" ? <AfoPrintPanel /> : null}
                    {isAfo && step === "export" ? <AfoExportPanel /> : null}
                    {!isAfo && step === "scan" ? <ClinicalScanStepPanel /> : null}
                    {!isAfo && step === "setup" ? <SetupStepPanel /> : null}
                    {!isAfo && step === "base" ? (
                        <div className="space-y-3">
                            <LeftSidebar embedded sections={["pattern", "library"]} clinicalDeclutter="base" />
                            <TrimPresetsPanel />
                            {shouldShowShapeFinishOnShapeStep() ? <ShapeFinishPanel /> : null}
                        </div>
                    ) : null}
                    {!isAfo && step === "corrections" ? (
                        <div className="space-y-3">
                            <CorrectionPresetsPanel />
                            <CorrectionsPanel />
                        </div>
                    ) : null}
                    {!isAfo && step === "elements" ? <ElementsPanel /> : null}
                    {!isAfo && step === "print" ? (
                        <div className="space-y-3">
                            <ClinicalPrintStepPanel />
                            {method === "milling_3axis" ? null : <HardnessStepPanel />}
                        </div>
                    ) : null}
                    {!isAfo && step === "export" ? <ExportPanel clinicalExportStep /> : null}
                </div>
                <ClinicalStepFooter />
            </div>
        </aside>
    );
}
