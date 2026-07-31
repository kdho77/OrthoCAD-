// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { CheckCircle2, Eye, EyeOff, MapPin, RotateCcw, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { deviationLegendLabel } from "@/components/viewer/ScanMeshes";
import { importScanFile } from "@/lib/geometry/import";
import { analyzeManifold } from "@/lib/geometry/manifold";
import { cn } from "@/lib/utils";
import { useScanStore } from "@/stores/scan-store";

const MARKER_LABELS = {
    M1: "M1 — 1st met head (medial)",
    M2: "M2 — 5th met head (lateral)",
    M3: "M3 — heel centre",
} as const;

export function ScanImport() {
    const inputRef = useRef<HTMLInputElement>(null);
    const {
        scans,
        addScan,
        removeScan,
        setSide,
        toggleVisible,
        placementMode,
        enterPlacement,
        exitPlacement,
        resetMarkers,
        registrationByScanId,
        markersByScanId,
        deviationOverlay,
        setDeviationOverlay,
        landmarkSourceAssetId,
    } = useScanStore();
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const onFiles = async (files: FileList | null) => {
        if (!files) return;
        setError(null);
        setBusy(true);
        try {
            for (const file of Array.from(files)) {
                const { geometry, format, triangleCount } = await importScanFile(file);
                addScan({
                    id: crypto.randomUUID(),
                    name: file.name,
                    side: "left",
                    format,
                    triangleCount,
                    geometry,
                    manifold: analyzeManifold(geometry),
                });
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : "Import failed");
        } finally {
            setBusy(false);
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    return (
        <div className="space-y-2">
            <input
                ref={inputRef}
                type="file"
                accept=".stl,.obj"
                multiple
                className="hidden"
                onChange={(e) => void onFiles(e.target.files)}
            />
            <button
                type="button"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border bg-background px-2 py-4 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground disabled:opacity-50"
            >
                <Upload className="h-3.5 w-3.5" />
                {busy ? "Importing…" : "Import STL / OBJ"}
            </button>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}

            {scans.map((s) => {
                const reg = registrationByScanId[s.id];
                const markers = markersByScanId[s.id];
                const placed = [markers?.M1, markers?.M2, markers?.M3].filter(Boolean).length;
                const placing = placementMode?.scanId === s.id;
                const baseReady = Boolean(landmarkSourceAssetId);

                return (
                    <div
                        key={s.id}
                        className="space-y-1.5 rounded-md border border-border bg-background p-2 text-xs"
                    >
                        <div className="flex items-center justify-between gap-1">
                            <span className="truncate" title={s.name}>
                                {s.name}
                            </span>
                            <div className="flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => toggleVisible(s.id)}
                                    title="Toggle visibility"
                                >
                                    {s.visible ? (
                                        <Eye className="h-3.5 w-3.5" />
                                    ) : (
                                        <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                                    )}
                                </button>
                                <button type="button" onClick={() => removeScan(s.id)} title="Remove">
                                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                                </button>
                            </div>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                            <span>
                                {s.format.toUpperCase()} · {s.triangleCount.toLocaleString()} tris
                            </span>
                            <span
                                className={cn(
                                    "flex items-center gap-1",
                                    s.manifold.isWatertight ? "text-emerald-400" : "text-amber-400",
                                )}
                            >
                                {s.manifold.isWatertight ? <CheckCircle2 className="h-3 w-3" /> : null}
                                {s.manifold.isWatertight ? "watertight" : `${s.manifold.openEdges} open`}
                            </span>
                        </div>
                        <div className="flex gap-1">
                            {(["left", "right"] as const).map((side) => (
                                <button
                                    key={side}
                                    type="button"
                                    onClick={() => setSide(s.id, side)}
                                    className={cn(
                                        "flex-1 rounded px-2 py-1 text-[11px]",
                                        s.side === side
                                            ? "bg-primary text-primary-foreground"
                                            : "bg-muted text-muted-foreground",
                                    )}
                                >
                                    {side}
                                </button>
                            ))}
                        </div>

                        {/* Registration controls */}
                        <div className="flex gap-1 pt-0.5">
                            <button
                                type="button"
                                disabled={!baseReady}
                                title={baseReady ? "Place M1→M2→M3 on the scan" : "Base geometry not loaded"}
                                onClick={() => (placing ? exitPlacement() : enterPlacement(s.id))}
                                className={cn(
                                    "flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 text-[11px]",
                                    placing
                                        ? "bg-amber-500/20 text-amber-300"
                                        : "bg-muted text-muted-foreground hover:text-foreground",
                                    !baseReady && "cursor-not-allowed opacity-50",
                                )}
                            >
                                <MapPin className="h-3 w-3" />
                                {placing ? "Placing…" : "Place markers"}
                            </button>
                            <button
                                type="button"
                                onClick={() => resetMarkers(s.id)}
                                title="Reset markers"
                                className="rounded bg-muted px-2 py-1 text-muted-foreground hover:text-foreground"
                            >
                                <RotateCcw className="h-3 w-3" />
                            </button>
                        </div>

                        {placing ? (
                            <p className="text-[11px] text-amber-300">
                                Next: {MARKER_LABELS[placementMode!.next]} ({placed}/3)
                            </p>
                        ) : null}

                        {/* Readout */}
                        <div className="space-y-0.5 rounded border border-border/60 bg-muted/30 px-1.5 py-1 text-[11px] text-muted-foreground">
                            {reg?.incomplete || placed < 3 ? (
                                <p>Registration: waiting for 3 markers ({placed}/3)</p>
                            ) : reg?.error ? (
                                <p className="text-destructive">{reg.error.message}</p>
                            ) : (
                                <>
                                    <p>
                                        Residual RMS:{" "}
                                        <span className="text-foreground">
                                            {reg?.residualRmsMm != null
                                                ? `${reg.residualRmsMm.toFixed(3)} mm`
                                                : "—"}
                                        </span>
                                    </p>
                                    <p>
                                        B1/B2 separation:{" "}
                                        <span className="text-foreground">
                                            {reg?.b1b2SeparationPct != null
                                                ? `${reg.b1b2SeparationPct.toFixed(2)}%`
                                                : "—"}
                                        </span>
                                    </p>
                                    <p>
                                        Chirality:{" "}
                                        <span className="text-foreground">
                                            {reg?.identifiedSide ? `${reg.identifiedSide} foot` : "—"}
                                        </span>
                                    </p>
                                </>
                            )}
                            <label className="flex cursor-pointer items-center gap-1.5 pt-0.5">
                                <input
                                    type="checkbox"
                                    checked={deviationOverlay}
                                    onChange={(e) => setDeviationOverlay(e.target.checked)}
                                    className="h-3 w-3"
                                />
                                <span>{deviationLegendLabel()}</span>
                            </label>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
