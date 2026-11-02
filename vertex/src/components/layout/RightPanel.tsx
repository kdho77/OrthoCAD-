import { ClinicalStepFooter } from "@/components/clinical/ClinicalStepRail";
import { FootSideGateHint } from "@/components/clinical/FootSideGateHint";
import { PanelHeading } from "@/components/clinical/PanelHeading";
import { LeftSidebar } from "@/components/layout/LeftSidebar";
import { ActiveFootSideBar } from "@/features/clinical/ActiveFootSideBar";
import { ClinicalPrintStepPanel } from "@/features/clinical/ClinicalPrintStepPanel";
import { ClinicalScanStepPanel } from "@/features/clinical/ClinicalScanStepPanel";
import { SetupStepPanel } from "@/features/clinical/SetupStepPanel";
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
import type { ClinicalStepId } from "@/stores/clinical-workflow-store";

const EDITING_PICKER_STEPS: ClinicalStepId[] = ["base", "corrections", "elements"];

export function RightPanel() {
    const step = useClinicalWorkflowStore((s) => s.step);
    const scanPattern = useDesignStore((s) => s.design.pattern);
    const method = useDesignStore((s) => s.design.method);
    const showEditingPicker = EDITING_PICKER_STEPS.includes(step);

    return (
        <aside className="flex h-full w-full flex-col border-l border-border bg-panel lg:w-80 lg:shrink-0">
            {showEditingPicker ? (
                <div className="border-b border-border px-3 py-2">
                    <PanelHeading
                        title="Editing"
                        info="Choose Left, Right, or linked Pair for corrections and elements."
                        className="mb-1"
                    />
                    <ActiveFootSideBar allowBothWhenLinked />
                    <FootSideGateHint />
                </div>
            ) : null}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto p-3">
                    {step === "scan" ? <ClinicalScanStepPanel /> : null}
                    {step === "setup" ? <SetupStepPanel /> : null}
                    {step === "base" ? (
                        <div className="space-y-3">
                            <LeftSidebar embedded sections={["pattern", "library"]} clinicalDeclutter="base" />
                            {scanPattern === "full_contact" ? (
                                <div className="space-y-2 rounded-md border border-border bg-background/40 p-2">
                                    <PanelHeading title="Scan upload" info="Full Contact uses a registered foot scan on this base." />
                                    <ScanImport />
                                </div>
                            ) : null}
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
