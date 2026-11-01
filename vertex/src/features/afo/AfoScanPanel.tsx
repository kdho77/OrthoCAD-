// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { ScanImport } from "@/features/scans/ScanImport";
import { evaluateScanStepGate } from "@/lib/clinical/clinical-step-gates";
import { geometryToAfoMesh } from "@/lib/geometry/afo/mesh-ops";
import { orientScanThreePoint } from "@/lib/geometry/afo/orient";
import { buildSyntheticLegMesh } from "@/lib/geometry/afo/synthetic-leg";
import { ingestOrientedScan } from "@/stores/afo-store";
import { useScanStore } from "@/stores/scan-store";

export function AfoScanPanel() {
    const gate = evaluateScanStepGate();
    const scans = useScanStore((s) => s.scans);
    const applyOrient = () => {
        const scan = scans[0];
        if (!scan) return;
        const m = useScanStore.getState().markersByScanId[scan.id];
        if (!m?.M1 || !m.M2 || !m.M3) return;
        const mesh = geometryToAfoMesh(scan.geometry);
        const result = orientScanThreePoint(mesh, m.M1, m.M2, m.M3);
        ingestOrientedScan(result.mesh);
    };

    return (
        <div className="space-y-3 text-xs">
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
        </div>
    );
}
