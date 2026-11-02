// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { Loader2, Sparkles, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
    type GenerateOrthoticSuccess,
    generateOrthoticFromScanAndRx,
    type RequiredShoeSize,
} from "@/lib/clinical/generateOrthoticFromScanAndRx";
import { footLengthMmOptions, ukShoeSizeOptions, usShoeSizeOptions } from "@/lib/geometry/shoe-size";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";
import { useScanStore } from "@/stores/scan-store";
import type { Side } from "@/types";

function applyGeneratedDesign(result: GenerateOrthoticSuccess) {
    const store = useDesignStore.getState();
    store.checkpoint("before-generate-orthotic");
    store.loadDesign(result.design);
    useDesignStore.setState({ viewer: { ...useDesignStore.getState().viewer, wallStyle: "round" } });
    useClinicalWorkflowStore.getState().setStep("corrections");
}

export function GenerateOrthoticPanel() {
    const scans = useScanStore((s) => s.scans);
    const design = useDesignStore((s) => s.design);
    const canUndo = useDesignStore((s) => s.canUndo());
    const undo = useDesignStore((s) => s.undo);

    const [rxText, setRxText] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastResult, setLastResult] = useState<GenerateOrthoticSuccess | null>(null);
    const [sizeSystem, setSizeSystem] = useState<RequiredShoeSize["system"]>("us");
    const [sizeValue, setSizeValue] = useState("");
    const [flexible, setFlexible] = useState<Record<Side, boolean>>({ left: false, right: false });

    const bundles = useMemo(
        () =>
            scans.map((scan) => ({
                side: scan.side,
                geometry: scan.geometry,
                display: scan.display,
                keepSetApproved: scan.keepSetApproved,
            })),
        [scans],
    );

    const sides = useMemo(() => [...new Set(bundles.map((b) => b.side))], [bundles]);

    const shoeSize: RequiredShoeSize | null = useMemo(() => {
        if (sizeValue.trim() === "") return null;
        const value = Number(sizeValue);
        if (!Number.isFinite(value)) return null;
        return { system: sizeSystem, value };
    }, [sizeSystem, sizeValue]);

    const sizeOptions = useMemo(() => {
        if (sizeSystem === "uk")
            return ukShoeSizeOptions().map((o) => ({ value: String(o.ukSize), label: o.label }));
        if (sizeSystem === "mm") {
            return footLengthMmOptions().map((o) => ({ value: String(o.footLengthMm), label: o.label }));
        }
        return usShoeSizeOptions().map((o) => ({ value: String(o.menSize), label: o.label }));
    }, [sizeSystem]);

    const onGenerate = async () => {
        setError(null);
        setLastResult(null);
        if (bundles.length === 0) {
            setError("Import a foot scan first.");
            return;
        }
        if (!shoeSize) {
            setError("Shoe size is required. It is not taken from the scan.");
            return;
        }

        setBusy(true);
        try {
            const outcome = generateOrthoticFromScanAndRx({
                baselineDesign: design,
                scans: bundles,
                shoeSize,
                flexibleBySide: flexible,
                prescriptionText: rxText,
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

    return (
        <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-2">
            <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <p className="text-[11px] font-semibold text-foreground">Generate Orthotic</p>
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
                Shoe size scales the default SAMPLE_Top. The scan sets the Arch height slider (Low −3.5 mm,
                Standard 0, High +3 mm). Flexible sets the Apex shift slider to +4 mm. An explicit Rx value
                replaces that slider. It is not added. Review warnings before manufacturing.
            </p>
            <label className="block text-[10px] font-medium text-muted-foreground" htmlFor="shoe-size-system">
                Shoe size (required)
            </label>
            <div className="flex gap-1">
                <select
                    id="shoe-size-system"
                    value={sizeSystem}
                    onChange={(e) => {
                        setSizeSystem(e.target.value as RequiredShoeSize["system"]);
                        setSizeValue("");
                    }}
                    className="rounded border border-border bg-background px-1.5 py-1 text-[11px]"
                >
                    <option value="us">US</option>
                    <option value="uk">UK</option>
                    <option value="mm">mm</option>
                </select>
                <select
                    id="shoe-size-value"
                    aria-label="Shoe size"
                    value={sizeValue}
                    onChange={(e) => setSizeValue(e.target.value)}
                    className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-1 text-[11px]"
                >
                    <option value="">Select size</option>
                    {sizeOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                            {o.label}
                        </option>
                    ))}
                </select>
            </div>
            {sides.map((side) => (
                <label key={side} className="flex items-center gap-2 text-[11px] text-foreground">
                    <input
                        type="checkbox"
                        checked={flexible[side]}
                        onChange={(e) => setFlexible((prev) => ({ ...prev, [side]: e.target.checked }))}
                    />
                    Flexible foot ({side}) — set apex shift to +4 mm
                </label>
            ))}
            <label className="block text-[10px] font-medium text-muted-foreground" htmlFor="rx-text">
                Prescription (optional)
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
                disabled={busy || bundles.length === 0 || !shoeSize}
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
                                {f.side}: {f.sizeLabel} · measured {f.archHeightMeasuredMm.toFixed(1)} mm{" "}
                                {f.archBand}
                                {f.archReviewBelow18 ? " (review)" : ""} · Arch height {f.archHeightMm} mm ·
                                Apex shift {f.apexMoveMm} mm
                            </li>
                        ))}
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
                    {lastResult.pathology ? (
                        <p className="text-amber-100/90">{lastResult.pathology.reason}</p>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
