// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { ScanImport } from "@/features/scans/ScanImport";
import { FootSideGateHint } from "@/components/clinical/FootSideGateHint";
import { PanelHeading } from "@/components/clinical/PanelHeading";
import { evaluateScanStepGate } from "@/lib/clinical/clinical-step-gates";
import { useScanStore } from "@/stores/scan-store";

export function ClinicalScanStepPanel() {
    const scans = useScanStore((s) => s.scans);
    const scanGate = evaluateScanStepGate();

    return (
        <div className="space-y-3 text-xs">
            <PanelHeading title="Upload" info="Import STL or OBJ. Pick Left, Right, or Pair before upload." />
            <ScanImport />
            <FootSideGateHint />
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
