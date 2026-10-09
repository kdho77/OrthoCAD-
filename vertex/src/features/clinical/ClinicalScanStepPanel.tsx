// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ScanImport } from "@/features/scans/ScanImport";
import { evaluateScanStepGate, isFootSideExplicitlyKnown } from "@/lib/clinical/clinical-step-gates";

export function ClinicalScanStepPanel() {
    const scanGate = evaluateScanStepGate();
    const sideChosen = isFootSideExplicitlyKnown();

    return (
        <div className="space-y-3 text-xs">
            <p className="text-muted-foreground leading-relaxed">
                Choose <strong className="font-medium text-foreground">Left</strong>,{" "}
                <strong className="font-medium text-foreground">Right</strong>, or{" "}
                <strong className="font-medium text-foreground">Pair</strong>, then import an STL / OBJ. Scans
                are never silently assigned to a foot.
            </p>
            <ScanImport />
            {!scanGate.ok && sideChosen ? (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-2 text-[11px] text-amber-100/90">
                    {scanGate.reason}
                </p>
            ) : null}
        </div>
    );
}
