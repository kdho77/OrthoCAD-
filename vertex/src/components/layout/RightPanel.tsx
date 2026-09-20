import { ClinicalStepRail } from "@/components/clinical/ClinicalStepRail";
import { ActiveFootSideBar } from "@/features/clinical/ActiveFootSideBar";
import { ClinicalPrintStepPanel } from "@/features/clinical/ClinicalPrintStepPanel";
import { ClinicalScanStepPanel } from "@/features/clinical/ClinicalScanStepPanel";
import { HardnessStepPanel } from "@/features/clinical/HardnessStepPanel";
import { CorrectionsPanel } from "@/features/corrections/CorrectionsPanel";
import { ElementsPanel } from "@/features/elements/ElementsPanel";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";

export function RightPanel() {
    const step = useClinicalWorkflowStore((s) => s.step);

    return (
        <aside className="flex w-80 flex-col border-l border-border bg-panel">
            <div className="flex flex-1 flex-col overflow-hidden p-3">
                <ClinicalStepRail />
                <div className="mt-3 flex-1 overflow-y-auto">
                    {step === "scan" ? <ClinicalScanStepPanel /> : null}
                    {step === "shape" ? <CorrectionsPanel /> : null}
                    {step === "elements" ? (
                        <div className="space-y-3">
                            <ActiveFootSideBar />
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
