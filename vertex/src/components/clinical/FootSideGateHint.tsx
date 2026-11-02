// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { evaluateScanStepGate, isFootSideExplicitlyKnown } from "@/lib/clinical/clinical-step-gates";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";

/** Short inline gate copy at the foot-side control (replaces rail banners). */
export function FootSideGateHint() {
    const footSideExplicitlyChosen = useClinicalWorkflowStore((s) => s.footSideExplicitlyChosen);
    void footSideExplicitlyChosen;
    if (isFootSideExplicitlyKnown()) return null;
    const gate = evaluateScanStepGate();
    if (gate.ok) return null;
    const short = gate.reason.includes("Left, Right, or Pair")
        ? "Pick Left, Right, or Pair"
        : gate.reason.length > 48
          ? `${gate.reason.slice(0, 45)}…`
          : gate.reason;
    return (
        <p className="text-[10px] text-amber-300/95" role="status">
            {short}
        </p>
    );
}
