// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { SliderField } from "@/components/ui/slider-field";
import { runAfoShell } from "@/lib/geometry/afo/afo-engine";
import {
    AFO_EDGE_MM,
    AFO_EDGE_RANGE,
    AFO_FLARE_MM,
    AFO_FLARE_RANGE,
    AFO_PRINT_MATERIAL_IDS,
    AFO_THICKNESS_MM,
    AFO_THICKNESS_RANGE,
    afoPrintParams,
    defaultAfoPrint,
} from "@/lib/geometry/afo/defaults";
import { trimPolygonForShell } from "@/lib/geometry/afo/shell";
import {
    beginShellGeneration,
    commitShellIfCurrent,
    currentAfoShellFingerprint,
    useAfoShellCurrent,
} from "@/lib/geometry/afo/shell-fingerprint";
import { fitSurfaceSpline } from "@/lib/geometry/afo/trim-spline";
import type { AfoTriMesh } from "@/lib/geometry/afo/types";
import { evaluateAfoWarnings } from "@/lib/geometry/afo/warnings";
import { getAfoState, patchAfoState, useAfoStore } from "@/stores/afo-store";
import { useDesignStore } from "@/stores/design-store";

/**
 * The shell is built on the mesh the trim was drawn on. Re-running cast and
 * corrections here drops the malleolus override that `refreshAfoWorkingMesh`
 * already baked into `correctedMesh`.
 */
export function afoPrintShellInput(
    correctedMesh: AfoTriMesh | null,
    castMesh: AfoTriMesh | null,
): AfoTriMesh | null {
    return correctedMesh ?? castMesh;
}

export function AfoPrintPanel() {
    const afo = useDesignStore((s) => s.design.afo) ?? getAfoState();
    const print = afoPrintParams(afo.print ?? defaultAfoPrint());
    const correctedMesh = useAfoStore((s) => s.correctedMesh);
    const castMesh = useAfoStore((s) => s.castMesh);
    const working = afoPrintShellInput(correctedMesh, castMesh);
    const progress = useAfoStore((s) => s.workerProgress);
    const lastError = useAfoStore((s) => s.lastError);
    const setProgress = useAfoStore((s) => s.setWorkerProgress);
    const shellCurrent = useAfoShellCurrent();
    const setError = useAfoStore((s) => s.setLastError);
    const warnings = evaluateAfoWarnings(afo, working);

    const generate = async () => {
        if (!working || !afo.trimConfirmed) {
            setError("Confirm a closed trim loop first.");
            return;
        }
        const startedFingerprint = currentAfoShellFingerprint();
        const startedToken = beginShellGeneration();
        setError(null);
        setProgress({ pct: 0, stage: "shell" });
        try {
            const pinPoints = afo.trimPoints.map((p) => p.point);
            const polygon =
                trimPolygonForShell(afo.trimCurve ?? [], true) ??
                (pinPoints.length >= 3
                    ? trimPolygonForShell(fitSurfaceSpline(working, pinPoints, { closed: true }).curve, true)
                    : null);
            const shell = await runAfoShell(
                working,
                afo.trimPoints.map((p) => p.vertexIndex),
                {
                    thicknessMm: print.thicknessMm,
                    edgeMm: print.edgeMm,
                    flareMm: print.flareMm,
                    trimPolygon: polygon ?? undefined,
                    heelSeed: afo.scanWorkflow.derived?.heelCupCenter ?? undefined,
                    onProgress: (pct, stage) => setProgress({ pct, stage }),
                },
            );
            commitShellIfCurrent({ startedFingerprint, startedToken, shell });
        } catch (e) {
            setError(e instanceof Error ? e.message : "Shell failed");
        } finally {
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
                label="Edge thickness"
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
            <label className="block text-[10px] text-muted-foreground" htmlFor="afo-print-material">
                Material
                <select
                    id="afo-print-material"
                    data-testid="afo-print-material"
                    className="mt-1 h-7 w-full rounded border border-border bg-background px-2 text-foreground"
                    value={print.material}
                    onChange={(e) =>
                        patchAfoState(
                            { print: afoPrintParams({ ...print, material: e.target.value }) },
                            "afo-print",
                        )
                    }
                >
                    {AFO_PRINT_MATERIAL_IDS.map((id) => (
                        <option key={id} value={id}>
                            {id}
                        </option>
                    ))}
                </select>
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
            {warnings.map((w) => (
                <p key={w.id} className="text-[11px] text-amber-200/90">
                    Warn: {w.message}
                </p>
            ))}
            {shellCurrent ? <p className="text-emerald-300">Watertight shell ready. Cast hidden.</p> : null}
        </div>
    );
}
