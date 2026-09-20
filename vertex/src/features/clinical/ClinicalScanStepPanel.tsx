// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Footprints } from "lucide-react";
import { ActiveFootSideBar } from "@/features/clinical/ActiveFootSideBar";
import { evaluateScanStepGate } from "@/lib/clinical/clinical-step-gates";
import { useActiveFootSide } from "@/lib/clinical/active-foot-side";
import { useScanStore } from "@/stores/scan-store";
import { SIDE_LABELS } from "@/types";

export function ClinicalScanStepPanel() {
    const scans = useScanStore((s) => s.scans);
    const activeSide = useActiveFootSide();
    const scanGate = evaluateScanStepGate();

    return (
        <div className="space-y-3 text-xs">
            <ActiveFootSideBar />
            <p className="text-muted-foreground leading-relaxed">
                Import a foot scan from the <strong className="font-medium text-foreground">Import</strong>{" "}
                section in the left panel. Choose{" "}
                <strong className="font-medium text-foreground">Left</strong>,{" "}
                <strong className="font-medium text-foreground">Right</strong>, or{" "}
                <strong className="font-medium text-foreground">Pair</strong> before attaching files — scans
                are never silently assigned to the left foot.
            </p>
            <div className="flex items-center gap-2 rounded-md border border-border bg-background/50 px-2 py-2">
                <Footprints className="h-4 w-4 text-primary" />
                <span>
                    Active foot for placement:{" "}
                    <span className="font-medium text-foreground">{SIDE_LABELS[activeSide]}</span>
                </span>
            </div>
            {!scanGate.ok ? (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-2 text-[11px] text-amber-100/90">
                    {scanGate.reason}
                </p>
            ) : null}

            {scans.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-2 py-3 text-center text-muted-foreground">
                    No scans attached yet — you can continue to Shape when the base is ready.
                </p>
            ) : (
                <ul className="space-y-1">
                    {scans.map((s) => (
                        <li
                            key={s.id}
                            className="flex justify-between rounded border border-border px-2 py-1.5"
                        >
                            <span className="truncate">{s.name}</span>
                            <span className="shrink-0 text-muted-foreground">{SIDE_LABELS[s.side]}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
