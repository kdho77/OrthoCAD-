// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { PanelHeading } from "@/components/clinical/PanelHeading";
import { GenerateOrthoticPanel } from "@/features/clinical/GenerateOrthoticPanel";
import { PressureMapPanel } from "@/features/clinical/PressureMapPanel";
import { isOptionalScanWorkflow } from "@/features/clients/start-path";
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
    const designStartPath = useClinicalWorkflowStore((s) => s.designStartPath);
    const optionalScan = isOptionalScanWorkflow(designStartPath);

    if (optionalScan) {
        return (
            <div className="space-y-3 text-xs">
                <p className="text-[11px] text-muted-foreground" data-testid="scan-optional-notice">
                    Scan is used for measurements and alignment only.
                </p>
                <ScanImport />
                {scans.length === 0 ? (
                    <p className="text-center text-[10px] text-muted-foreground">No scans yet</p>
                ) : null}
            </div>
        );
    }

    return (
        <div className="space-y-3 text-xs">
            <PanelHeading
                title="Upload"
                info="Import STL or OBJ. Pick Left, Right, or Pair before upload. Register scans on the Scan tab only."
            />
            <ScanImport />
            <PressureMapPanel />
            <GenerateOrthoticPanel />
            {!scanGate.ok && scanGate.reason.includes("Register") ? (
                <p className="text-[10px] text-amber-300/95" role="status">
                    Register scan or remove
                </p>
            ) : !scanGate.ok ? (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-2 text-[11px] text-amber-100/90">
                    {scanGate.reason}
                </p>
            ) : null}
            {scans.length === 0 ? (
                <p className="text-center text-[10px] text-muted-foreground">No scans yet</p>
            ) : null}
        </div>
    );
}
