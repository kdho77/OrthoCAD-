// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { CheckCircle2, ChevronRight, Eye, EyeOff, MapPin, Move, RotateCcw, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { deviationLegendLabel } from "@/components/viewer/ScanMeshes";
import { ScanCleanupPanel } from "@/features/scans/ScanCleanupPanel";
import { importScanFile } from "@/lib/geometry/import";
import { analyzeManifold } from "@/lib/geometry/manifold";
import {
    extractKeptGeometry,
    rankComponents,
    selectedComponentsBBox,
    weldAndLabelComponents,
} from "@/lib/geometry/scan-components";
import {
    buildScanDisplayInfo,
    buildScanDisplayInfoFromBBox,
    isNonZeroScanOffset,
} from "@/lib/geometry/scan-display";
import {
    suggestScanLandmarks,
    type SuggestedScanLandmarks,
} from "@/lib/geometry/scan-landmark-suggest";
import { cn } from "@/lib/utils";
import { type MarkerId, type ScanMarkers, useScanStore } from "@/stores/scan-store";

const MARKER_LABELS = {
    M1: "M1 — 1st met head (medial)",
    M2: "M2 — 5th met head (lateral)",
    M3: "M3 — heel centre",
} as const;

function ScanMarkersSection({
    scanId,
    sug,
    markers,
    placed,
    placing,
    baseReady,
    nextLabel,
    onConfirm,
    onDismiss,
    onTogglePlacement,
    onResetMarkers,
}: {
    scanId: string;
    sug: SuggestedScanLandmarks | null | undefined;
    markers: ScanMarkers | undefined;
    placed: number;
    placing: boolean;
    baseReady: boolean;
    nextLabel: string | null;
    onConfirm: (id: MarkerId) => void;
    onDismiss: () => void;
    onTogglePlacement: () => void;
    onResetMarkers: () => void;
}) {
    const allAccepted = placed >= 3;
    const [open, setOpen] = useState(!allAccepted);

    useEffect(() => {
        if (allAccepted) setOpen(false);
        else setOpen(true);
    }, [allAccepted]);

    useEffect(() => {
        // New suggestions (e.g. after cleanup) should prompt the user again.
        if (sug && !allAccepted) setOpen(true);
    }, [sug, scanId, allAccepted]);

    useEffect(() => {
        if (placing) setOpen(true);
    }, [placing]);

    return (
        <div className="space-y-1 rounded border border-cyan-500/30 bg-cyan-500/5 px-1.5 py-1 text-[10px]">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="flex w-full items-center gap-1 text-left"
                aria-expanded={open}
            >
                <ChevronRight
                    className={cn(
                        "h-3 w-3 shrink-0 text-muted-foreground transition-transform",
                        open && "rotate-90",
                    )}
                />
                <span className="font-medium text-cyan-200">
                    {allAccepted ? "Markers accepted" : sug ? "Suggested landmarks" : "Markers"}
                </span>
                <span className="ml-auto text-muted-foreground">{placed}/3</span>
            </button>
            {!open ? (
                <p className="pl-4 text-muted-foreground">
                    {allAccepted
                        ? "All markers placed — expand to edit"
                        : sug
                          ? "Confirm or place markers to register"
                          : "Expand to place M1 → M2 → M3"}
                </p>
            ) : (
                <div className="space-y-1">
                    {sug ? (
                        <>
                            <p className="text-muted-foreground">
                                M1/M2/M3 heuristics on the cleaned scan. Confirm each — nothing
                                auto-registers.
                            </p>
                            <div className="flex flex-wrap gap-1">
                                {(["M1", "M2", "M3"] as const).map((id) => {
                                    const already = Boolean(markers?.[id]);
                                    return (
                                        <button
                                            key={id}
                                            type="button"
                                            disabled={already}
                                            onClick={() => onConfirm(id)}
                                            className={cn(
                                                "rounded px-2 py-0.5 text-[11px]",
                                                already
                                                    ? "bg-muted text-muted-foreground"
                                                    : "bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30",
                                            )}
                                        >
                                            {already ? `${id} placed` : `Confirm ${id}`}
                                        </button>
                                    );
                                })}
                                <button
                                    type="button"
                                    onClick={onDismiss}
                                    className="rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                                >
                                    Dismiss
                                </button>
                            </div>
                        </>
                    ) : null}

                    <div className="flex gap-1 pt-0.5">
                        <button
                            type="button"
                            disabled={!baseReady}
                            title={
                                baseReady ? "Place M1→M2→M3 on the scan" : "Base geometry not loaded"
                            }
                            onClick={onTogglePlacement}
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
                            onClick={onResetMarkers}
                            title="Reset markers"
                            className="rounded bg-muted px-2 py-1 text-muted-foreground hover:text-foreground"
                        >
                            <RotateCcw className="h-3 w-3" />
                        </button>
                    </div>

                    {placing && nextLabel ? (
                        <p className="text-[11px] text-amber-300">
                            Next: {nextLabel} ({placed}/3)
                        </p>
                    ) : null}
                </div>
            )}
        </div>
    );
}

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
        manualOffsetByScanId,
        selectedScanId,
        selectScan,
        resetManualOffset,
        deviationOverlay,
        deviationBusy,
        setDeviationOverlay,
        landmarkSourceAssetId,
        setCleanupBusy,
        setSuggestedLandmarks,
        setMarker,
    } = useScanStore();
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const onFiles = async (files: FileList | null) => {
        if (!files) return;
        setError(null);
        setBusy(true);
        try {
            for (const file of Array.from(files)) {
                const { geometry: rawGeometry, format } = await importScanFile(file);

                setCleanupBusy(true);
                const labeling = weldAndLabelComponents(rawGeometry);
                const ranked = rankComponents(labeling.components);
                // Multi-component: preselect top-ranked foot only. Single: keep all.
                const keptIds =
                    ranked.length <= 1 ? ranked.map((c) => c.id) : ranked[0] ? [ranked[0].id] : [];
                const keptGeo =
                    keptIds.length > 0 ? extractKeptGeometry(rawGeometry, labeling, keptIds) : rawGeometry;
                const prior = buildScanDisplayInfo(rawGeometry);
                const bbox = selectedComponentsBBox(ranked, keptIds);
                const display = bbox
                    ? buildScanDisplayInfoFromBBox(bbox.min, bbox.max, {
                          inferredUnit: prior.inferredUnit,
                          dominantRawAxis: prior.dominantRawAxis,
                          rawLongest: prior.rawLongest,
                      })
                    : prior;

                const index = keptGeo.getIndex();
                const triangleCount = index ? index.count / 3 : keptGeo.getAttribute("position").count / 3;

                const id = crypto.randomUUID();
                const side = "left" as const;
                addScan({
                    id,
                    name: file.name,
                    side,
                    format,
                    triangleCount,
                    geometry: keptGeo,
                    rawGeometry,
                    manifold: analyzeManifold(keptGeo),
                    display,
                    components: ranked,
                    keptComponentIds: keptIds,
                    triangleComponentOf: labeling.triangleComponentOf,
                    labelingMeta: {
                        degenerateTriangleCount: labeling.degenerateTriangleCount,
                        weldTolerance: labeling.weldTolerance,
                        elapsedMs: labeling.elapsedMs,
                        originalTriangleCount: labeling.originalTriangleCount,
                    },
                });

                // Suggestions never block import.
                const sug = suggestScanLandmarks(keptGeo, side);
                if (sug) setSuggestedLandmarks(id, sug);

                if (labeling.elapsedMs <= 250) setCleanupBusy(false);
                else {
                    // Keep busy treatment visible briefly when analysis was heavy.
                    window.setTimeout(() => setCleanupBusy(false), 0);
                }
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : "Import failed");
            setCleanupBusy(false);
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
                const sug = s.suggestedLandmarks;

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
                        {(() => {
                            const d = s.display;
                            const registered =
                                Boolean(reg?.matrixElements) && !reg?.incomplete && !reg?.error;
                            return (
                                <div className="rounded border border-dashed border-border/70 bg-muted/20 px-1.5 py-1 text-[10px] leading-snug text-muted-foreground">
                                    <p className={registered ? "" : "text-amber-300"}>
                                        {registered
                                            ? "Registered (fit)"
                                            : "Provisional display — unregistered"}
                                    </p>
                                    <p>
                                        Raw bbox: {d.rawSize[0].toFixed(3)} × {d.rawSize[1].toFixed(3)} ×{" "}
                                        {d.rawSize[2].toFixed(3)} (longest {d.rawLongest.toFixed(3)},{" "}
                                        {d.dominantRawAxis.toUpperCase()}-dominant)
                                    </p>
                                    <p>
                                        Inferred units: {d.inferredUnit} → display ×{d.displayScale}
                                        {d.displayScale !== 1 ? " (units correction, not a fit)" : ""}
                                    </p>
                                    {d.priorRawInferredUnit != null &&
                                    d.priorRawInferredUnit !== d.inferredUnit ? (
                                        <p className="text-amber-300/90">
                                            Raw-bbox units were {d.priorRawInferredUnit} — corrected from
                                            selected component.
                                        </p>
                                    ) : null}
                                </div>
                            );
                        })()}

                        <ScanCleanupPanel scanId={s.id} />

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

                        <ScanMarkersSection
                            scanId={s.id}
                            sug={sug}
                            markers={markers}
                            placed={placed}
                            placing={placing}
                            baseReady={baseReady}
                            nextLabel={placing ? MARKER_LABELS[placementMode!.next] : null}
                            onConfirm={(id) => sug && setMarker(s.id, id, sug[id])}
                            onDismiss={() => setSuggestedLandmarks(s.id, null)}
                            onTogglePlacement={() => (placing ? exitPlacement() : enterPlacement(s.id))}
                            onResetMarkers={() => resetMarkers(s.id)}
                        />

                        {/* Readout */}
                        <div className="space-y-0.5 rounded border border-border/60 bg-muted/30 px-1.5 py-1 text-[11px] text-muted-foreground">
                            {reg?.incomplete || placed < 3 ? (
                                <p>Registration: waiting for 3 markers ({placed}/3)</p>
                            ) : reg?.error ? (
                                <p className="text-destructive">
                                    Alignment failed: {reg.error.message}. Check Left/Right side and marker
                                    order (M1 medial met, M2 lateral met, M3 heel).
                                </p>
                            ) : (
                                <>
                                    <p className="text-emerald-400">
                                        Aligned to insole (heel seated in cup, toes distal, ML centered)
                                    </p>
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
                            {(() => {
                                const offset = manualOffsetByScanId[s.id];
                                const moved = isNonZeroScanOffset(offset);
                                const isSelected = selectedScanId === s.id;
                                return (
                                    <div className="flex flex-col gap-1 pt-1">
                                        <div className="flex gap-1">
                                            <button
                                                type="button"
                                                onClick={() => selectScan(isSelected ? null : s.id)}
                                                className={cn(
                                                    "flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 text-[11px]",
                                                    isSelected
                                                        ? "bg-violet-500/25 text-violet-200"
                                                        : "bg-muted text-muted-foreground hover:text-foreground",
                                                )}
                                                title="Select scan to drag or nudge with arrow keys"
                                            >
                                                <Move className="h-3 w-3" />
                                                {isSelected ? "Selected" : "Move scan"}
                                            </button>
                                            <button
                                                type="button"
                                                disabled={!moved}
                                                onClick={() => resetManualOffset(s.id)}
                                                title="Reset manual position to auto-alignment"
                                                className={cn(
                                                    "rounded px-2 py-1 text-[11px]",
                                                    moved
                                                        ? "bg-muted text-muted-foreground hover:text-foreground"
                                                        : "cursor-not-allowed bg-muted/50 text-muted-foreground/50",
                                                )}
                                            >
                                                Reset
                                            </button>
                                        </div>
                                        {moved && offset ? (
                                            <p className="text-[10px] text-violet-300">
                                                Manual offset: {offset.x.toFixed(1)}, {offset.y.toFixed(1)},{" "}
                                                {offset.z.toFixed(1)} mm
                                            </p>
                                        ) : (
                                            <p className="text-[10px] text-muted-foreground/80">
                                                Click the scan to select, then drag or use arrow keys
                                            </p>
                                        )}
                                    </div>
                                );
                            })()}
                            <label className="flex cursor-pointer items-center gap-1.5 pt-0.5">
                                <input
                                    type="checkbox"
                                    checked={deviationOverlay}
                                    onChange={(e) => setDeviationOverlay(e.target.checked)}
                                    disabled={deviationBusy}
                                    className="h-3 w-3"
                                />
                                <span>{deviationBusy ? "Computing deviation…" : deviationLegendLabel()}</span>
                            </label>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
