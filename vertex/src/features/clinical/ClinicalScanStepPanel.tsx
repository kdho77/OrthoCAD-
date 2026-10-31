// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { ScanImport } from "@/features/scans/ScanImport";
import { evaluateScanStepGate } from "@/lib/clinical/clinical-step-gates";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useScanStore } from "@/stores/scan-store";

export function ClinicalScanStepPanel() {
    const scans = useScanStore((s) => s.scans);
    const footSideExplicitlyChosen = useClinicalWorkflowStore((s) => s.footSideExplicitlyChosen);
    const placementFoot = useClinicalWorkflowStore((s) => s.elementPlacementFoot);
    void footSideExplicitlyChosen;
    void placementFoot;
    const scanGate = evaluateScanStepGate();

    return (
        <div className="space-y-3 text-xs">
            <p className="text-muted-foreground leading-relaxed">
                Import a foot scan below. Assign <strong className="font-medium text-foreground">Left</strong>
                , <strong className="font-medium text-foreground">Right</strong>, or{" "}
                <strong className="font-medium text-foreground">Pair</strong> once — scans are never silently
                assigned to the left foot. Use <span className="text-foreground">Editing</span> above to
                choose which foot you are working on.
            </p>
            <ScanImport />
            {!scanGate.ok ? (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-2 text-[11px] text-amber-100/90">
                    {scanGate.reason}
                </p>
            ) : null}

            {scans.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-2 py-3 text-center text-muted-foreground">
                    No scans attached yet — you can continue to Setup when the base is ready.
                </p>
            ) : null}
        </div>
    );
}
