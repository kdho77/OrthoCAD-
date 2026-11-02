// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { PanelHeading } from "@/components/clinical/PanelHeading";
import { isOptionalScanWorkflow } from "@/features/clients/start-path";
import { ScanImport } from "@/features/scans/ScanImport";
import { evaluateScanStepGate } from "@/lib/clinical/clinical-step-gates";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useScanStore } from "@/stores/scan-store";

export function ClinicalScanStepPanel() {
    const scans = useScanStore((s) => s.scans);
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
            {!scanGate.ok && scanGate.reason.includes("Register") ? (
                <p className="text-[10px] text-amber-300/95" role="status">
                    Register scan or remove
                </p>
            ) : null}
            {scans.length === 0 ? (
                <p className="text-center text-[10px] text-muted-foreground">No scans yet</p>
            ) : null}
        </div>
    );
}
