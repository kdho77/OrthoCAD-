// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useState } from "react";
import { afoOrientFromScanMarkers, scanIdForThreePointOrient } from "@/features/afo/afo-scan-markers";
import { ScanImport } from "@/features/scans/ScanImport";
import { evaluateScanStepGate, selectScanGateRevision } from "@/lib/clinical/clinical-step-gates";
import { buildSyntheticLegMesh } from "@/lib/geometry/afo/synthetic-leg";
import { ingestOrientedScan } from "@/stores/afo-store";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useScanStore } from "@/stores/scan-store";

export function AfoScanPanel() {
    const orientRevision = useScanStore(selectScanGateRevision);
    const footKnown = useClinicalWorkflowStore((s) => s.footSideExplicitlyChosen);
    const gate = evaluateScanStepGate();
    const [orientError, setOrientError] = useState<string | null>(null);
    const applyOrient = () => {
        const state = useScanStore.getState();
        const editing = useClinicalWorkflowStore.getState().elementPlacementFoot;
        const scanId = scanIdForThreePointOrient(state.scans, state.markersByScanId, editing);
        const scan = state.scans.find((s) => s.id === scanId);
        if (!scan) return;
        const m = state.markersByScanId[scan.id];
        if (!m?.M1 || !m.M2 || !m.M3) return;
        try {
            const result = afoOrientFromScanMarkers(
                scan.geometry,
                { M1: m.M1, M2: m.M2, M3: m.M3 },
                scan.display.displayScale,
            );
            setOrientError(null);
            ingestOrientedScan(result.mesh);
        } catch (e) {
            setOrientError(e instanceof Error ? e.message : "3-point orient failed");
        }
    };

    return (
        <div
            className="space-y-3 text-xs"
            data-orient-revision={orientRevision}
            data-foot-known={footKnown ? "yes" : "no"}
        >
            <p className="text-muted-foreground leading-relaxed">
                Import a foot+leg scan, then place the 3-point orient:{" "}
                <strong className="text-foreground">M1 heel</strong>,{" "}
                <strong className="text-foreground">M2 medial malleolus</strong>,{" "}
                <strong className="text-foreground">M3 lateral malleolus</strong>. Those malleoli are also the
                default bony-relief markers. ARCH is not required for AFO.
            </p>
            <button
                type="button"
                className="h-8 w-full rounded-md border border-border bg-background text-[12px]"
                onClick={() => ingestOrientedScan(buildSyntheticLegMesh())}
            >
                Load synthetic demo leg
            </button>
            <ScanImport />
            <button
                type="button"
                onClick={applyOrient}
                disabled={!gate.ok}
                className="h-8 w-full rounded-md bg-primary text-[12px] font-medium text-primary-foreground disabled:opacity-40"
            >
                Apply 3-point orient
            </button>
            {!gate.ok ? (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-2 text-[11px] text-amber-100/90">
                    {gate.reason}
                </p>
            ) : null}
            {orientError ? (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-2 text-[11px] text-destructive">
                    {orientError}
                </p>
            ) : null}
        </div>
    );
}
