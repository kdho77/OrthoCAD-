// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { PanelHeading } from "@/components/clinical/PanelHeading";
import { InfoPopover } from "@/components/ui/info-popover";
import { PressureMapPanel } from "@/features/clinical/PressureMapPanel";
import { isOptionalScanWorkflow } from "@/features/clients/start-path";
import { ScanImport } from "@/features/scans/ScanImport";
import { evaluateScanStepGate } from "@/lib/clinical/clinical-step-gates";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useScanStore } from "@/stores/scan-store";

function scanGateShortMessage(reason: string): string {
    if (reason.includes("Register")) return "Register scan or remove";
    if (reason.includes("Left, Right, or Pair")) return "Pick foot side first";
    if (/loading/i.test(reason)) return "Base still loading";
    if (/not ready/i.test(reason)) return "Base not ready yet";
    const words = reason.split(/\s+/).filter(Boolean);
    return words.slice(0, 6).join(" ");
}

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
            <PressureMapPanel scanStepCompact />
            {!scanGate.ok ? (
                <p className="flex items-center gap-1 text-[10px] text-amber-300/95" role="status">
                    <span>{scanGateShortMessage(scanGate.reason)}</span>
                    <InfoPopover label="Scan step requirement">{scanGate.reason}</InfoPopover>
                </p>
            ) : null}
            {scans.length === 0 ? (
                <p className="text-center text-[10px] text-muted-foreground">No scans yet</p>
            ) : null}
        </div>
    );
}
