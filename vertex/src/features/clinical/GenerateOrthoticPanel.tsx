// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { Loader2, Sparkles, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import { heuristicParse } from "@/features/ai-prescription/heuristic";
import { parsePrescription } from "@/features/ai-prescription/parse-service";
import {
    generateOrthoticFromScanAndRx,
    type GenerateOrthoticSuccess,
} from "@/lib/clinical/generateOrthoticFromScanAndRx";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";
import { useScanStore } from "@/stores/scan-store";
import type { PrescriptionParseResult } from "@/types";

function applyGeneratedDesign(result: GenerateOrthoticSuccess) {
    const store = useDesignStore.getState();
    store.checkpoint("before-generate-orthotic");
    store.loadDesign(result.design);
    useDesignStore.setState({ viewer: { ...useDesignStore.getState().viewer, wallStyle: "round" } });
    useClinicalWorkflowStore.getState().setStep("corrections");
}

export function GenerateOrthoticPanel() {
    const scans = useScanStore((s) => s.scans);
    const markersByScanId = useScanStore((s) => s.markersByScanId);
    const manualOffsetByScanId = useScanStore((s) => s.manualOffsetByScanId);
    const landmarkSourceAssetId = useScanStore((s) => s.landmarkSourceAssetId);
    const rawBaseBySourceId = useScanStore((s) => s.rawBaseBySourceId);
    const design = useDesignStore((s) => s.design);
    const canUndo = useDesignStore((s) => s.canUndo());
    const undo = useDesignStore((s) => s.undo);

    const [rxText, setRxText] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastResult, setLastResult] = useState<GenerateOrthoticSuccess | null>(null);

    const bundles = useMemo(
        () =>
            scans.map((scan) => ({
                side: scan.side,
                geometry: scan.geometry,
                display: scan.display,
                markers: markersByScanId[scan.id] ?? {
                    M1: null,
                    M2: null,
                    M3: null,
                    ARCH: null,
                },
                suggestedLandmarks: scan.suggestedLandmarks,
                manualOffset: manualOffsetByScanId[scan.id] ?? null,
                keepSetApproved: scan.keepSetApproved,
            })),
        [scans, markersByScanId, manualOffsetByScanId],
    );

    const onGenerate = async () => {
        setError(null);
        setLastResult(null);
        const sourceId = landmarkSourceAssetId;
        const rawBase = sourceId ? rawBaseBySourceId[sourceId] : undefined;
        if (!sourceId || !rawBase) {
            setError("Wait for the clinical base (SAMPLE_Top) to finish loading.");
            return;
        }
        if (bundles.length === 0) {
            setError("Import a foot scan first.");
            return;
        }

        setBusy(true);
        try {
            let prescription: PrescriptionParseResult | null = null;
            if (rxText.trim()) {
                const parsed = await parsePrescription({ text: rxText });
                if (parsed.ok && parsed.result) prescription = parsed.result;
                else if (!parsed.ok) prescription = heuristicParse(rxText);
            }

            const outcome = generateOrthoticFromScanAndRx({
                baselineDesign: design,
                scans: bundles,
                rawBaseGeometry: rawBase,
                sourceAssetId: sourceId,
                prescription,
            });

            if (!outcome.ok) {
                setError(outcome.reason);
                return;
            }
            applyGeneratedDesign(outcome);
            setLastResult(outcome);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Generation failed");
        } finally {
            setBusy(false);
        }
    };

    const layout = insoleLayoutFromDesign(design);

    return (
        <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-2">
            <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <p className="text-[11px] font-semibold text-foreground">Generate Orthotic</p>
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
                One step: auto-measure the scan, fit the default SAMPLE_Top shell, and merge your Rx.
                Explicit Rx beats scan fit. Review warnings before manufacturing.
            </p>
            <label className="block text-[10px] font-medium text-muted-foreground" htmlFor="rx-text">
                Prescription (optional — defaults apply when empty)
            </label>
            <textarea
                id="rx-text"
                rows={3}
                value={rxText}
                onChange={(e) => setRxText(e.target.value)}
                placeholder="e.g. Left: 4° rearfoot varus, medial skive 4 mm…"
                className="w-full resize-y rounded border border-border bg-background px-2 py-1.5 text-[11px] text-foreground"
            />
            <button
                type="button"
                disabled={busy || bundles.length === 0}
                onClick={() => void onGenerate()}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-[11px] font-semibold text-primary-foreground disabled:opacity-50"
            >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Generate Orthotic
            </button>
            {canUndo ? (
                <button
                    type="button"
                    onClick={() => undo()}
                    className="flex w-full items-center justify-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
                >
                    <Undo2 className="h-3 w-3" />
                    Restore previous design
                </button>
            ) : null}
            {error ? (
                <p className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[10px] text-destructive">
                    {error}
                </p>
            ) : null}
            {lastResult ? (
                <div className="space-y-1 rounded border border-border bg-background/60 p-2 text-[10px]">
                    <p className="font-medium text-foreground">Applied</p>
                    <ul className="list-inside list-disc text-muted-foreground">
                        {lastResult.perFoot.map((f) => (
                            <li key={f.side}>
                                {f.side}: {f.sizeLabel ?? "size unchanged"} · arch {f.archSource ?? "—"} · RMS{" "}
                                {f.registrationRmsMm?.toFixed(1) ?? "—"} mm
                            </li>
                        ))}
                        <li>Template layout {layout.lengthMm.toFixed(0)} × {layout.widthMm.toFixed(0)} mm</li>
                    </ul>
                    {lastResult.warnings.length > 0 ? (
                        <div>
                            <p className="font-medium text-amber-200/90">Warnings</p>
                            <ul className="list-inside list-disc text-amber-100/80">
                                {lastResult.warnings.slice(0, 6).map((w) => (
                                    <li key={w}>{w}</li>
                                ))}
                            </ul>
                        </div>
                    ) : null}
                    {lastResult.elementSuggestions.length > 0 ? (
                        <p className="text-muted-foreground">
                            Suggested elements ({lastResult.elementSuggestions.length}) — confirm in Elements.
                        </p>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
