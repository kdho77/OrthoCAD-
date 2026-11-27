// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { PanelHeading } from "@/components/clinical/PanelHeading";
import { InfoPopover } from "@/components/ui/info-popover";
import { isOptionalScanWorkflow } from "@/features/clients/start-path";
import { PressureMapPanel } from "@/features/clinical/PressureMapPanel";
import { ScanImport } from "@/features/scans/ScanImport";
import { evaluateScanStepGate } from "@/lib/clinical/clinical-step-gates";
import {
    formatScanArchReadout,
    measurePlantarArch,
    resolveScanArchAssignment,
    scanArchMarkerSource,
    setScanArchMarkerSource,
} from "@/lib/clinical/measure-scan-arch";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useScanStore } from "@/stores/scan-store";

function ScanArchReadouts({ rows }: { rows: { id: string; side: string; text: string }[] }) {
    if (rows.length === 0) return null;
    return (
        <div className="space-y-1" data-testid="scan-arch-readout">
            {rows.map((row) => (
                <p key={row.id} className="text-[10px] text-muted-foreground">
                    {row.side}: {row.text}
                </p>
            ))}
        </div>
    );
}

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
    const markersByScanId = useScanStore((s) => s.markersByScanId);
    const setMarker = useScanStore((s) => s.setMarker);
    const enterPlacement = useScanStore((s) => s.enterPlacement);
    const footSideExplicitlyChosen = useClinicalWorkflowStore((s) => s.footSideExplicitlyChosen);
    const placementFoot = useClinicalWorkflowStore((s) => s.elementPlacementFoot);
    void footSideExplicitlyChosen;
    void placementFoot;
    const scanGate = evaluateScanStepGate();
    const designStartPath = useClinicalWorkflowStore((s) => s.designStartPath);
    const optionalScan = isOptionalScanWorkflow(designStartPath);

    const archReadouts = useMemo(
        () =>
            scans.map((scan) => {
                const markers = markersByScanId[scan.id];
                const placed = Boolean(markers?.M1 && markers.M2 && markers.M3);
                if (!placed || !markers?.M1 || !markers.M2 || !markers.M3) {
                    return {
                        id: scan.id,
                        side: scan.side,
                        text: "Place 1st met, 5th met, and heel center to measure the arch.",
                        apex: null as THREE.Vector3 | null,
                    };
                }
                const source = scanArchMarkerSource(scan.id);
                const manual = source === "manual_override" && markers.ARCH ? markers.ARCH : null;
                const measurement = measurePlantarArch({
                    geometry: scan.geometry,
                    side: scan.side,
                    displayScale: scan.display.displayScale,
                    landmarks: { heel: markers.M3, m1: markers.M1, m5: markers.M2 },
                    manualApex: manual,
                });
                const { record } = resolveScanArchAssignment({
                    measurement,
                    markerSource: manual ? "manual_override" : "scan_measured",
                });
                const apex =
                    !manual && measurement.apexLocal
                        ? new THREE.Vector3(
                              measurement.apexLocal.x,
                              measurement.apexLocal.y,
                              measurement.apexLocal.z,
                          )
                        : null;
                return { id: scan.id, side: scan.side, text: formatScanArchReadout(record), apex };
            }),
        [scans, markersByScanId],
    );

    useEffect(() => {
        for (const scan of scans) {
            const markers = markersByScanId[scan.id];
            if (!markers?.M1 || !markers.M2 || !markers.M3) {
                if (scanArchMarkerSource(scan.id) && !markers?.M1) setScanArchMarkerSource(scan.id, null);
                continue;
            }
            if (scanArchMarkerSource(scan.id) === "manual_override") continue;
            const readout = archReadouts.find((row) => row.id === scan.id);
            if (!readout?.apex) continue;
            const scale = scan.display.displayScale > 0 ? scan.display.displayScale : 1;
            if (markers.ARCH && markers.ARCH.distanceTo(readout.apex) * scale < 1.5) continue;
            setScanArchMarkerSource(scan.id, "scan_measured");
            try {
                setMarker(scan.id, "ARCH", readout.apex);
                const placement = useScanStore.getState().placementMode;
                if (!placement || placement.scanId === scan.id) enterPlacement(scan.id);
            } catch {
                // The readout still shows the tier if registration cannot run yet.
            }
        }
    }, [scans, markersByScanId, archReadouts, setMarker, enterPlacement]);

    if (optionalScan) {
        return (
            <div className="space-y-3 text-xs">
                <p className="text-[11px] text-muted-foreground" data-testid="scan-optional-notice">
                    Scan is used for measurements and alignment only.
                </p>
                <ScanImport />
                <ScanArchReadouts rows={archReadouts} />
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
            <ScanArchReadouts rows={archReadouts} />
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
