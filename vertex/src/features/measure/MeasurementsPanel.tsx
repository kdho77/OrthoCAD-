// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import * as React from "react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
    formatMeasureMm,
    getMeasureSolidsSnapshot,
    overallPrintSize,
    pointToPoint,
    subscribeMeasureRegistry,
    triangleMeshFromGeometry,
} from "@/lib/geometry/measure";
import { insoleExportRefreshKey } from "@/lib/geometry/measure/export-key";
import { type ExportMeasureRow, loadInsoleExportRows } from "@/lib/geometry/measure/export-rows";
import type { MeasureOverall, MeasureProduct } from "@/lib/geometry/measure/types";
import { useBaseOutlineStore } from "@/stores/base-outline-store";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { useDesignStore } from "@/stores/design-store";
import { useMeasureStore } from "@/stores/measure-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";

function usePublishedSolids() {
    return useSyncExternalStore(subscribeMeasureRegistry, getMeasureSolidsSnapshot, getMeasureSolidsSnapshot);
}

/** Let a slider or outline drag settle before lofting another print mesh. */
const EXPORT_REBUILD_DEBOUNCE_MS = 200;

function overallLabel(product: MeasureProduct, overall: MeasureOverall): string {
    const length = formatMeasureMm(overall.lengthMm);
    const width = formatMeasureMm(overall.widthMm);
    const height = formatMeasureMm(overall.heightMm);
    if (product === "afo") return `${length} × ${height} × ${width} mm`;
    return `${length} × ${width} × ${height} mm`;
}

export function MeasurementsPanel({ product = "insole" }: { product?: MeasureProduct }) {
    const solids = usePublishedSolids();
    const tool = useMeasureStore((s) => s.tool);
    const vertexSnap = useMeasureStore((s) => s.vertexSnap);
    const includeLeader = useMeasureStore((s) => s.includeLeader);
    const points = useMeasureStore((s) => s.points);
    const thicknessMm = useMeasureStore((s) => s.thicknessMm);
    const notice = useMeasureStore((s) => s.notice);
    const arm = useMeasureStore((s) => s.arm);
    const setVertexSnap = useMeasureStore((s) => s.setVertexSnap);
    const setIncludeLeader = useMeasureStore((s) => s.setIncludeLeader);
    const clear = useMeasureStore((s) => s.clear);

    useDesignStore((s) => s.design);
    useMeshEditStore((s) => s.trimlineEdit);
    useMeshEditStore((s) => s.bottomPatternEdit);
    useBottomPatternStore((s) => s.patterns);
    useBaseOutlineStore((s) => s.outlines);
    const exportKey = product === "insole" ? insoleExportRefreshKey() : "";
    const previewRows = solids
        .filter((solid) => solid.product === product)
        .map((solid) => {
            const mesh = triangleMeshFromGeometry(solid.geometry);
            const overall = overallPrintSize(mesh, product, false);
            return { id: solid.id, side: solid.side, overall, source: "preview" as const };
        });
    const [exportRows, setExportRows] = useState<ExportMeasureRow[] | null>(null);
    const [exportError, setExportError] = useState<string | null>(null);
    const exportRebuildArmed = React.useRef(false);
    useEffect(() => {
        if (product !== "insole") return;
        let cancel = false;
        void exportKey;
        const delay = exportRebuildArmed.current ? EXPORT_REBUILD_DEBOUNCE_MS : 0;
        exportRebuildArmed.current = true;
        const run = () => {
            if (cancel) return;
            setExportRows(null);
            setExportError(null);
            void (async () => {
                try {
                    const next = await loadInsoleExportRows(includeLeader);
                    if (!cancel) setExportRows(next);
                } catch (error) {
                    if (!cancel) {
                        setExportRows([]);
                        setExportError(error instanceof Error ? error.message : "Print size unavailable");
                    }
                }
            })();
        };
        if (delay === 0) {
            run();
            return () => {
                cancel = true;
            };
        }
        const timer = window.setTimeout(run, delay);
        return () => {
            cancel = true;
            window.clearTimeout(timer);
        };
    }, [product, exportKey, includeLeader]);
    const shownRows =
        product === "insole"
            ? (exportRows ?? []).map((row) => ({
                  id: `export-${row.side}`,
                  side: row.side,
                  overall: row.overall,
                  source: row.source,
              }))
            : previewRows;

    // rstest compiles this module with the classic JSX runtime.
    void React;
    const firstPoint = points[0];
    const secondPoint = points[1];
    const segment = firstPoint && secondPoint ? pointToPoint(firstPoint.export, secondPoint.export) : null;
    const leaderError = shownRows.find((row) => row.overall.leaderError)?.overall.leaderError ?? null;

    return (
        <div className="space-y-3" data-testid="measurements-panel">
            <p className="text-[11px] leading-snug text-muted-foreground">
                Physical print size in millimetres. Centering, fit scale, the pair shift, and display
                mirroring are removed so this matches the exported STL.
            </p>
            <div className="space-y-1" data-testid="measure-overall">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {product === "afo" ? "Footplate × height × width" : "Length × width × height"}
                </div>
                {product === "insole" && exportRows === null ? (
                    <p className="text-xs text-muted-foreground" data-testid="measure-export-pending">
                        Measuring the print mesh…
                    </p>
                ) : null}
                {exportError ? (
                    <p className="text-[11px] text-amber-200" data-testid="measure-export-error">
                        {exportError}
                    </p>
                ) : null}
                {shownRows.length === 0 && !(product === "insole" && (exportRows === null || exportError)) ? (
                    <p className="text-xs text-muted-foreground">Waiting for the print mesh.</p>
                ) : (
                    shownRows.map(({ id, side, overall, source }) => {
                        const length = formatMeasureMm(overall.lengthMm);
                        const width = formatMeasureMm(overall.widthMm);
                        const height = formatMeasureMm(overall.heightMm);
                        const shown = product === "afo" ? [length, height, width] : [length, width, height];
                        return (
                            <p
                                key={id}
                                className="font-mono text-sm text-foreground"
                                data-measure-side={side}
                                data-measure-source={source}
                                data-testid={`measure-overall-${side}`}
                            >
                                {source === "preview" ? (
                                    <span className="mr-1 text-[10px] uppercase text-amber-200">Preview</span>
                                ) : null}
                                {side === "afo" ? null : (
                                    <span className="mr-1 text-[11px] uppercase text-muted-foreground">
                                        {side}
                                    </span>
                                )}
                                <span data-testid={`measure-length-${side}`}>{shown[0]}</span>
                                <span className="text-muted-foreground"> × </span>
                                <span data-testid={`measure-mid-${side}`}>{shown[1]}</span>
                                <span className="text-muted-foreground"> × </span>
                                <span data-testid={`measure-last-${side}`}>{shown[2]}</span>
                                <span className="text-muted-foreground"> mm</span>
                                <span className="sr-only" data-testid={`measure-width-${side}`}>
                                    {width}
                                </span>
                                <span className="sr-only" data-testid={`measure-height-${side}`}>
                                    {height}
                                </span>
                            </p>
                        );
                    })
                )}
                {shownRows[0] ? (
                    <p className="sr-only" data-testid="measure-overall-text">
                        {overallLabel(product, shownRows[0].overall)}
                    </p>
                ) : null}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
                <Button
                    type="button"
                    size="sm"
                    variant={tool === "point" ? "default" : "outline"}
                    data-testid="measure-tool-point"
                    onClick={() => arm("point")}
                >
                    Point to point
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant={tool === "thickness" ? "default" : "outline"}
                    data-testid="measure-tool-thickness"
                    onClick={() => arm("thickness")}
                >
                    Thickness
                </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
                {tool === "point"
                    ? "Click two points on the solid. Orbit stays available between clicks."
                    : tool === "thickness"
                      ? "Click the outer surface. The probe runs along the inward normal."
                      : "Choose a tool, then click the solid mesh."}
            </p>
            {segment ? (
                <div className="space-y-0.5 font-mono text-xs" data-testid="measure-point-readout">
                    <div data-testid="measure-distance">{formatMeasureMm(segment.distanceMm)} mm</div>
                    <div className="text-muted-foreground">
                        |dX| {formatMeasureMm(segment.dx)} · |dY| {formatMeasureMm(segment.dy)} · |dZ|{" "}
                        {formatMeasureMm(segment.dz)}
                    </div>
                </div>
            ) : null}
            {thicknessMm != null ? (
                <div className="font-mono text-xs" data-testid="measure-thickness-readout">
                    Thickness {formatMeasureMm(thicknessMm)} mm
                </div>
            ) : null}
            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <input
                    type="checkbox"
                    data-testid="measure-vertex-snap"
                    checked={vertexSnap}
                    onChange={(event) => setVertexSnap(event.target.checked)}
                />
                Snap to vertex (1 mm)
            </label>
            {product === "insole" ? (
                <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <input
                        type="checkbox"
                        data-testid="measure-include-leader"
                        checked={includeLeader}
                        onChange={(event) => setIncludeLeader(event.target.checked)}
                    />
                    Include leader block
                </label>
            ) : null}
            <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="measure-clear"
                onClick={() => clear()}
            >
                Clear
            </Button>
            {notice ? (
                <p className="text-[11px] text-amber-200" data-testid="measure-notice">
                    {notice}
                </p>
            ) : null}
            {leaderError ? <p className="text-[11px] text-amber-200">{leaderError}</p> : null}
        </div>
    );
}
