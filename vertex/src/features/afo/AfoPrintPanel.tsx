// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { SliderField } from "@/components/ui/slider-field";
import { runAfoShell } from "@/lib/geometry/afo/afo-engine";
import {
    AFO_EDGE_MM,
    AFO_EDGE_RANGE,
    AFO_FLARE_MM,
    AFO_FLARE_RANGE,
    AFO_THICKNESS_MM,
    AFO_THICKNESS_RANGE,
    defaultAfoPrint,
} from "@/lib/geometry/afo/defaults";
import { getAfoState, patchAfoState, useAfoStore } from "@/stores/afo-store";
import { useDesignStore } from "@/stores/design-store";

export function AfoPrintPanel() {
    const afo = useDesignStore((s) => s.design.afo) ?? getAfoState();
    const print = afo.print ?? defaultAfoPrint();
    const correctedMesh = useAfoStore((s) => s.correctedMesh);
    const castMesh = useAfoStore((s) => s.castMesh);
    const working = correctedMesh ?? castMesh;
    const progress = useAfoStore((s) => s.workerProgress);
    const lastError = useAfoStore((s) => s.lastError);
    const setShell = useAfoStore((s) => s.setShellMesh);
    const setHideCast = useAfoStore((s) => s.setHideCast);
    const setProgress = useAfoStore((s) => s.setWorkerProgress);
    const setError = useAfoStore((s) => s.setLastError);

    const generate = async () => {
        if (!working || !afo.trimConfirmed) {
            setError("Confirm a closed trim loop first.");
            return;
        }
        setError(null);
        setProgress({ pct: 0, stage: "shell" });
        try {
            const shell = await runAfoShell(
                working,
                afo.trimPoints.map((p) => p.vertexIndex),
                {
                    thicknessMm: print.thicknessMm,
                    edgeMm: print.edgeMm,
                    flareMm: print.flareMm,
                    onProgress: (pct, stage) => setProgress({ pct, stage }),
                },
            );
            setShell(shell);
            setHideCast(print.hideCast);
            patchAfoState({ shellReady: true, print: { ...print, hideCast: true } }, "afo-shell");
            setProgress(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Shell failed");
            setProgress(null);
        }
    };

    return (
        <div className="space-y-3 text-xs">
            <SliderField
                label="Thickness"
                value={print.thicknessMm}
                min={AFO_THICKNESS_RANGE[0]}
                max={AFO_THICKNESS_RANGE[1]}
                unit="mm"
                defaultValue={AFO_THICKNESS_MM}
                onChange={(v) => patchAfoState({ print: { ...print, thicknessMm: v } }, "afo-print")}
            />
            <SliderField
                label="Edge"
                value={print.edgeMm}
                min={AFO_EDGE_RANGE[0]}
                max={AFO_EDGE_RANGE[1]}
                unit="mm"
                defaultValue={AFO_EDGE_MM}
                onChange={(v) => patchAfoState({ print: { ...print, edgeMm: v } }, "afo-print")}
            />
            <SliderField
                label="Flare"
                value={print.flareMm}
                min={AFO_FLARE_RANGE[0]}
                max={AFO_FLARE_RANGE[1]}
                unit="mm"
                defaultValue={AFO_FLARE_MM}
                onChange={(v) => patchAfoState({ print: { ...print, flareMm: v } }, "afo-print")}
            />
            <label className="flex items-center gap-2">
                <input
                    type="checkbox"
                    checked={print.hideCast}
                    onChange={(e) => {
                        patchAfoState({ print: { ...print, hideCast: e.target.checked } }, "afo-print");
                        setHideCast(e.target.checked);
                    }}
                />
                Hide cast
            </label>
            <button
                type="button"
                onClick={() => void generate()}
                className="h-8 w-full rounded-md bg-primary text-[12px] font-medium text-primary-foreground"
            >
                Generate shell
            </button>
            {progress ? (
                <p className="text-muted-foreground">
                    {progress.stage} · {Math.round(progress.pct * 100)}%
                </p>
            ) : null}
            {lastError ? <p className="text-amber-200">{lastError}</p> : null}
            {afo.shellReady ? <p className="text-emerald-300">Watertight shell ready. Cast hidden.</p> : null}
        </div>
    );
}
