// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useRef, useState } from "react";
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
import { flatPlateSpecFromAfo } from "@/lib/geometry/afo/shell-flatten";
import { applyAfoTrimCleanup } from "@/lib/geometry/afo/trim-cleanup";
import { validateTrimLoop } from "@/lib/geometry/afo/trim-loop";
import { fitSurfaceSpline } from "@/lib/geometry/afo/trim-spline";
import type { AfoDesignState, AfoTriMesh } from "@/lib/geometry/afo/types";
import { evaluateAfoWarnings } from "@/lib/geometry/afo/warnings";
import { getAfoState, patchAfoState, useAfoStore } from "@/stores/afo-store";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";

export type AfoShellFix = {
    kind: "cast" | "confirm" | "design" | "scan";
    message: string;
    label: string;
};

/** What Generate shell should offer instead of returning with no shell. */
export function afoShellFix(afo: AfoDesignState, mesh: AfoTriMesh | null): AfoShellFix | null {
    if (!mesh) {
        return {
            kind: "cast",
            message: "The cast is not ready yet. Generate shell runs after the cast mesh exists.",
            label: "Go to Cast",
        };
    }
    if (!afo.trimConfirmed || !afo.trimClosed) {
        if (afo.trimPoints.length >= 3) {
            return {
                kind: "confirm",
                message:
                    "Confirm a closed trim loop first. Generate shell runs after the trim is closed and confirmed.",
                label: "Close and confirm trim",
            };
        }
        return {
            kind: "design",
            message: "The trim loop is still open. Close it on Design, then generate the shell.",
            label: "Go to Design to fix trim",
        };
    }
    if (!flatPlateSpecFromAfo(afo, afoPrintParams(afo.print).thicknessMm)) {
        return {
            kind: "scan",
            message: "Place the plantar heel, 1st met head, and 5th met head before generating the shell.",
            label: "Go to Scan to place markers",
        };
    }
    return null;
}

/** Close the loop and confirm it when the current pins already validate. */
export function closeAndConfirmAfoTrim(): { ok: true } | { ok: false; reasons: string[] } {
    const working = useAfoStore.getState().correctedMesh ?? useAfoStore.getState().castMesh;
    const afo = getAfoState();
    if (!working) return { ok: false, reasons: ["No working mesh."] };
    const hits = afo.trimPoints.map((point) => point.point);
    if (hits.length < 3) return { ok: false, reasons: ["Need at least 3 trim points."] };
    const fit = fitSurfaceSpline(working, hits, { closed: true });
    if (!fit.ok) return { ok: false, reasons: fit.reasons.length ? fit.reasons : ["Trim could not close."] };
    const full = validateTrimLoop(
        working,
        afo.trimPoints.map((point) => point.vertexIndex),
        true,
        { skipGeodesic: true, points: hits },
    );
    if (!full.ok) return { ok: false, reasons: full.reasons };
    useAfoStore.getState().setLastError(null);
    patchAfoState({ trimClosed: true, trimConfirmed: true, trimCurve: fit.curve }, "afo-trim-confirm");
    return { ok: true };
}

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
    const liveFix = afoShellFix(afo, working);
    const [override, setOverride] = useState<AfoShellFix | null>(null);
    const [attempt, setAttempt] = useState(0);
    const [generating, setGenerating] = useState(false);
    const [plateMode, setPlateMode] = useState(false);
    const generatingRef = useRef(false);
    const fix = liveFix == null ? null : (override ?? liveFix);

    const generate = async () => {
        if (generatingRef.current) return;
        const mesh = afoPrintShellInput(
            useAfoStore.getState().correctedMesh,
            useAfoStore.getState().castMesh,
        );
        const live = getAfoState();
        const block = afoShellFix(live, mesh);
        if (block || !mesh) {
            setAttempt((n) => n + 1);
            setError(null);
            return;
        }
        const params = afoPrintParams(live.print ?? defaultAfoPrint());
        const flatPlate = flatPlateSpecFromAfo(live, params.thicknessMm);
        if (!flatPlate) {
            setAttempt((n) => n + 1);
            setError(null);
            return;
        }
        const startedFingerprint = currentAfoShellFingerprint();
        const startedToken = beginShellGeneration();
        generatingRef.current = true;
        setGenerating(true);
        setError(null);
        setAttempt(0);
        setProgress({ pct: 0, stage: "shell" });
        try {
            const pinPoints = live.trimPoints.map((p) => p.point);
            const polygon =
                trimPolygonForShell(live.trimCurve ?? [], true) ??
                (pinPoints.length >= 3
                    ? trimPolygonForShell(fitSurfaceSpline(mesh, pinPoints, { closed: true }).curve, true)
                    : null);
            const shell = await runAfoShell(
                mesh,
                live.trimPoints.map((p) => p.vertexIndex),
                {
                    thicknessMm: params.thicknessMm,
                    edgeMm: params.edgeMm,
                    flareMm: params.flareMm,
                    trimPolygon: polygon ?? undefined,
                    heelSeed: live.scanWorkflow.derived?.heelCupCenter ?? flatPlate.heel,
                    ...(plateMode ? { flatPlate } : { contactCut: flatPlate }),
                    onProgress: (pct, stage) => setProgress({ pct, stage }),
                },
            );
            commitShellIfCurrent({ startedFingerprint, startedToken, shell });
        } catch (e) {
            // Rejection throws before setShell, so the previous shell stays.
            setError(e instanceof Error ? e.message : "Shell failed");
        } finally {
            generatingRef.current = false;
            setGenerating(false);
            setProgress(null);
        }
    };

    const runFix = async (action: AfoShellFix) => {
        if (action.kind === "confirm") {
            const result = closeAndConfirmAfoTrim();
            if (!result.ok) {
                setOverride({
                    kind: "design",
                    message: result.reasons.join(" ") || "The trim loop needs a fix on Design.",
                    label: "Go to Design to fix trim",
                });
                setAttempt((n) => n + 1);
                return;
            }
            setOverride(null);
            await generate();
            return;
        }
        const step = action.kind === "scan" ? "scan" : action.kind === "cast" ? "cast" : "design";
        useClinicalWorkflowStore.getState().setStep(step);
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
                disabled={!working || afo.trimPoints.length < 2}
                className="h-8 w-full rounded-md border border-border bg-background disabled:opacity-40"
                onClick={() => {
                    applyAfoTrimCleanup();
                }}
            >
                Clean up
            </button>
            <label className="flex items-center gap-2 text-[11px] text-muted-foreground" htmlFor="afo-plate-mode">
                <input
                    id="afo-plate-mode"
                    data-testid="afo-plate-mode"
                    type="checkbox"
                    checked={plateMode}
                    onChange={(e) => setPlateMode(e.target.checked)}
                />
                Plate mode (built-down sole, off by default)
            </label>
            <button
                type="button"
                data-testid="afo-generate-shell"
                aria-busy={generating}
                aria-describedby={fix ? "afo-shell-fix" : undefined}
                disabled={generating}
                onClick={() => void generate()}
                className="h-8 w-full rounded-md bg-primary text-[12px] font-medium text-primary-foreground disabled:opacity-60"
            >
                {generating ? "Generating shell…" : "Generate shell"}
            </button>
            {generating ? (
                <div role="status" aria-live="polite" data-testid="afo-shell-progress" className="space-y-1">
                    <div
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round((progress?.pct ?? 0) * 100)}
                        className="h-1.5 w-full overflow-hidden rounded bg-muted"
                    >
                        <div
                            className="h-full bg-primary"
                            style={{ width: `${Math.round((progress?.pct ?? 0) * 100)}%` }}
                        />
                    </div>
                    <p className="font-medium text-foreground">
                        Generating shell
                        {progress ? ` · ${progress.stage} · ${Math.round(progress.pct * 100)}%` : "…"}
                    </p>
                </div>
            ) : null}
            {fix && !generating ? (
                <div
                    id="afo-shell-fix"
                    role="status"
                    data-testid="afo-shell-fix"
                    className="space-y-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-2"
                >
                    <p className="text-[11px] text-amber-100">{fix.message}</p>
                    {attempt > 0 ? (
                        <p className="text-[11px] font-medium text-amber-50">
                            Use the button below to continue.
                        </p>
                    ) : null}
                    <button
                        type="button"
                        data-testid="afo-shell-fix-action"
                        onClick={() => void runFix(fix)}
                        className="h-8 w-full rounded-md bg-primary text-[12px] font-medium text-primary-foreground"
                    >
                        {fix.label}
                    </button>
                </div>
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
