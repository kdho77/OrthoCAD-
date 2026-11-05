// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { PanelHeading } from "@/components/clinical/PanelHeading";
import { ActiveFootSideBar } from "@/features/clinical/ActiveFootSideBar";
import { evaluateScanStepGate, isFootSideExplicitlyKnown } from "@/lib/clinical/clinical-step-gates";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";

function editingInfoCopy(step: "base" | "corrections" | "elements"): string {
    const gate = evaluateScanStepGate();
    const needSide = !isFootSideExplicitlyKnown() && gate.reason.includes("Left, Right, or Pair");

    if (step === "base") {
        return needSide
            ? "Pick Left, Right, or Pair before continuing. Choose which foot you edit for trim and library saves."
            : "Choose Left, Right, or Pair for trim and library saves on this base.";
    }
    if (step === "corrections") {
        return needSide
            ? "Pick Left, Right, or Pair first. Corrections apply to the active foot or linked pair."
            : "Corrections apply to the active foot or linked pair.";
    }
    return needSide
        ? "Pick Left, Right, or Pair first. Elements place on the active foot or both when linked."
        : "Elements place on the active foot or both when linked.";
}

export function EditingStepHeader() {
    const step = useClinicalWorkflowStore((s) => s.step);
    if (step !== "base" && step !== "corrections" && step !== "elements") return null;

    return (
        <div className="border-b border-border px-3 py-2">
            <PanelHeading title="Editing" info={editingInfoCopy(step)} className="mb-1" />
            <ActiveFootSideBar allowBothWhenLinked />
        </div>
    );
}
