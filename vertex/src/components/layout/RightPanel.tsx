import { ClinicalStepRail } from "@/components/clinical/ClinicalStepRail";
import { ActiveFootSideBar } from "@/features/clinical/ActiveFootSideBar";
import { ClinicalPrintStepPanel } from "@/features/clinical/ClinicalPrintStepPanel";
import { ClinicalScanStepPanel } from "@/features/clinical/ClinicalScanStepPanel";
import { HardnessStepPanel } from "@/features/clinical/HardnessStepPanel";
import { CorrectionsPanel } from "@/features/corrections/CorrectionsPanel";
import { ElementsPanel } from "@/features/elements/ElementsPanel";
import { CorrectionPresetsPanel } from "@/features/shape/CorrectionPresetsPanel";
import { TrimPresetsPanel } from "@/features/shape/TrimPresetsPanel";
import { ShapeFinishPanel } from "@/features/shape-finish/ShapeFinishPanel";
import { shouldShowShapeFinishOnShapeStep } from "@/features/shape-finish/shape-finish-mount";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";

export function RightPanel() {
    const step = useClinicalWorkflowStore((s) => s.step);

    return (
        <aside className="flex w-80 flex-col border-l border-border bg-panel">
            <div className="flex flex-1 flex-col overflow-hidden p-3">
                <ClinicalStepRail />
                <div className="mt-3 flex-1 overflow-y-auto">
                    {step === "scan" ? <ClinicalScanStepPanel /> : null}
                    {step === "shape" ? (
                        <div className="space-y-3">
                            <ActiveFootSideBar allowBothWhenLinked />
                            <CorrectionPresetsPanel />
                            <CorrectionsPanel />
                            <TrimPresetsPanel />
                            {shouldShowShapeFinishOnShapeStep() ? <ShapeFinishPanel /> : null}
                            <p className="text-[10px] text-muted-foreground">
                                Fine-tune outline with <span className="text-foreground">Edit trimline</span> in the
                                viewer after choosing a trim preset.
                            </p>
                        </div>
                    ) : null}
                    {step === "elements" ? (
                        <div className="space-y-3">
                            <ActiveFootSideBar allowBothWhenLinked />
                            <ElementsPanel />
                        </div>
                    ) : null}
                    {step === "hardness" ? <HardnessStepPanel /> : null}
                    {step === "print" ? <ClinicalPrintStepPanel /> : null}
                </div>
            </div>
        </aside>
    );
}
