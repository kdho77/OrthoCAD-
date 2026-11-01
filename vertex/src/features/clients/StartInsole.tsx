// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// First screen of a new insole: template or scan. The scan never becomes the mesh.

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { designFromScan } from "@/lib/clinical/chart-design";
import { classifyArchHeightMm } from "@/lib/clinical/one-click-adapter";
import {
    archHeightFromDots,
    DOT_LABELS,
    DOT_ORDER,
    type DotKey,
    type FootDots,
    heelToToeAngleDeg,
} from "@/lib/clinical/scan-dots";
import { usMenFootLengthMm } from "@/lib/geometry/shoe-size";
import type { ClientRecord } from "@/stores/client-store";
import type { DesignState } from "@/types";
import {
    CHART_SHOE_WIDTHS,
    type ChartShoeWidth,
    chartGeneratedSize,
    type ShoeChart,
    shoeChartFromInput,
} from "../../../shared/client-files";
import { SCAN_RETENTION_NOTICE, type ScanSide } from "../../../shared/client-scans";
import { scanRetentionLabel } from "../../../shared/retention";
import { deleteStoredScan, downloadStoredScan, uploadStoredScan } from "./scan-actions";

const WIDTH_LABELS: Record<ChartShoeWidth, string> = {
    narrow: "Narrow",
    medium: "Medium",
    wide: "Wide",
    extra_wide: "Extra wide",
};

export function ShoeChartPanel({
    chart,
    onChange,
}: {
    chart: ShoeChart;
    onChange: (chart: ShoeChart) => void;
}) {
    const set = (patch: Partial<ShoeChart>) => onChange(shoeChartFromInput({ ...chart, ...patch }));
    return (
        <section className="rounded-xl border border-border bg-panel p-4" data-testid="shoe-chart">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Shoe size</h2>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                        type="checkbox"
                        data-testid="shoe-size-split"
                        checked={chart.shoeSizesSplit}
                        onChange={(event) => {
                            const split = event.target.checked;
                            set({
                                shoeSizesSplit: split,
                                shoeSizeLeftUs: chart.shoeSizeUs,
                                shoeSizeRightUs: chart.shoeSizeUs,
                            });
                        }}
                    />
                    Separate left and right sizes
                </label>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {chart.shoeSizesSplit ? (
                    <>
                        <SizeField
                            label="Left size"
                            testId="shoe-size-left"
                            value={chart.shoeSizeLeftUs}
                            onChange={(shoeSizeLeftUs) => set({ shoeSizeLeftUs })}
                        />
                        <SizeField
                            label="Right size"
                            testId="shoe-size-right"
                            value={chart.shoeSizeRightUs}
                            onChange={(shoeSizeRightUs) => set({ shoeSizeRightUs })}
                        />
                    </>
                ) : (
                    <SizeField
                        label="Shoe size (US men's)"
                        testId="shoe-size"
                        value={chart.shoeSizeUs}
                        onChange={(shoeSizeUs) =>
                            set({ shoeSizeUs, shoeSizeLeftUs: shoeSizeUs, shoeSizeRightUs: shoeSizeUs })
                        }
                    />
                )}
                <label className="text-xs text-muted-foreground">
                    Width
                    <select
                        data-testid="shoe-width"
                        aria-label="Width"
                        className="mt-1 block min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                        value={chart.shoeWidth}
                        onChange={(event) => set({ shoeWidth: event.target.value as ChartShoeWidth })}
                    >
                        {CHART_SHOE_WIDTHS.map((width) => (
                            <option key={width} value={width}>
                                {WIDTH_LABELS[width]}
                            </option>
                        ))}
                    </select>
                </label>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
                Generated size US men's {chartGeneratedSize(chart)}. Width {WIDTH_LABELS[chart.shoeWidth]}.
            </p>
        </section>
    );
}

function SizeField({
    label,
    testId,
    value,
    onChange,
}: {
    label: string;
    testId: string;
    value: number;
    onChange: (value: number) => void;
}) {
    return (
        <label className="text-xs text-muted-foreground">
            {label}
            <input
                data-testid={testId}
                aria-label={label}
                type="number"
                min={1}
                max={16}
                step={0.5}
                value={value}
                className="mt-1 block min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                onChange={(event) => onChange(Number(event.target.value))}
            />
        </label>
    );
}

export function StartChoice({
    onTemplate,
    onScan,
    onBack,
}: {
    onTemplate: () => void;
    onScan: () => void;
    onBack: () => void;
}) {
    return (
        <section className="flex flex-col gap-4" data-testid="start-choice">
            <div>
                <h1 className="text-lg font-semibold">New insole</h1>
                <p className="text-sm text-muted-foreground">Choose how this design starts.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
                <button
                    type="button"
                    data-testid="start-from-scan"
                    className="min-h-28 rounded-xl border border-border bg-panel p-4 text-left hover:border-primary"
                    onClick={onScan}
                >
                    <div className="text-sm font-semibold text-primary">Start from 3D scan</div>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Upload a scan to set arch height. The insole is still the standard mesh.
                    </p>
                </button>
                <button
                    type="button"
                    data-testid="start-from-template"
                    className="min-h-28 rounded-xl border border-border bg-panel p-4 text-left hover:border-primary"
                    onClick={onTemplate}
                >
                    <div className="text-sm font-semibold text-primary">Start from 3D template</div>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Load the default mesh at this client's shoe size and width.
                    </p>
                </button>
            </div>
            <Button type="button" variant="outline" className="min-h-11 w-fit" onClick={onBack}>
                Back
            </Button>
        </section>
    );
}

interface StoredSide {
    id: string;
    fileName: string;
    uploadedAt: string;
}

export function ScanStart({
    client,
    chart,
    onChart,
    onBack,
    onCreate,
}: {
    client: ClientRecord;
    chart: ShoeChart;
    onChart: (chart: ShoeChart) => void;
    onBack: () => void;
    onCreate: (state: DesignState) => void;
}) {
    const [flexible, setFlexible] = useState(false);
    const [leftFile, setLeftFile] = useState<StoredSide | null>(null);
    const [rightFile, setRightFile] = useState<StoredSide | null>(null);
    const [leftDots, setLeftDots] = useState<Partial<FootDots>>({});
    const [rightDots, setRightDots] = useState<Partial<FootDots>>({});
    const [error, setError] = useState("");

    const feet = useMemo(() => {
        const length = usMenFootLengthMm(chartGeneratedSize(chart));
        const rows: { side: ScanSide; dots: FootDots; heightMm: number }[] = [];
        if (leftFile && completeDots(leftDots)) {
            const dots = leftDots as FootDots;
            rows.push({ side: "left", dots, heightMm: archHeightFromDots(dots, length) });
        }
        if (rightFile && completeDots(rightDots)) {
            const dots = rightDots as FootDots;
            rows.push({ side: "right", dots, heightMm: archHeightFromDots(dots, length) });
        }
        return rows;
    }, [chart, leftDots, leftFile, rightDots, rightFile]);

    const ready =
        (leftFile !== null || rightFile !== null) && feet.length === Number(!!leftFile) + Number(!!rightFile);

    const storeFile = async (side: ScanSide, file: File | undefined) => {
        if (!file) return;
        setError("");
        try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            const saved = await uploadStoredScan({
                client,
                side,
                fileName: file.name,
                contentType: file.type || "application/octet-stream",
                bytes,
            });
            const stored = { id: saved.id, fileName: saved.fileName, uploadedAt: saved.uploadedAt };
            if (side === "left") setLeftFile(stored);
            else setRightFile(stored);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Upload failed");
        }
    };

    return (
        <section className="flex flex-col gap-4" data-testid="scan-start">
            <div>
                <h1 className="text-lg font-semibold">Start from 3D scan</h1>
                <p className="text-sm text-muted-foreground" data-testid="scan-retention-notice">
                    {SCAN_RETENTION_NOTICE}
                </p>
            </div>
            <ShoeChartPanel chart={chart} onChange={onChart} />
            <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                    type="checkbox"
                    data-testid="flexible-foot"
                    checked={flexible}
                    onChange={(event) => setFlexible(event.target.checked)}
                />
                Flexible foot
            </label>
            <div className="grid gap-4 lg:grid-cols-2">
                <FootUpload
                    side="left"
                    file={leftFile}
                    dots={leftDots}
                    onDots={setLeftDots}
                    onFile={(file) => void storeFile("left", file)}
                    onDownload={() => leftFile && void downloadStoredScan(leftFile.id)}
                    onRemove={() => {
                        if (leftFile) void deleteStoredScan(leftFile.id);
                        setLeftFile(null);
                        setLeftDots({});
                    }}
                />
                <FootUpload
                    side="right"
                    file={rightFile}
                    dots={rightDots}
                    onDots={setRightDots}
                    onFile={(file) => void storeFile("right", file)}
                    onDownload={() => rightFile && void downloadStoredScan(rightFile.id)}
                    onRemove={() => {
                        if (rightFile) void deleteStoredScan(rightFile.id);
                        setRightFile(null);
                        setRightDots({});
                    }}
                />
            </div>
            {feet.map((foot) => {
                const band = classifyArchHeightMm(foot.heightMm);
                return (
                    <p key={foot.side} className="text-sm" data-testid={`arch-band-${foot.side}`}>
                        {foot.side === "left" ? "Left" : "Right"} arch {foot.heightMm.toFixed(1)} mm ·{" "}
                        {band.band}
                        {band.flagged ? " · review" : ""}
                        {flexible ? " · flexible" : ""}
                    </p>
                );
            })}
            {error ? <p className="text-sm text-red-300">{error}</p> : null}
            <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" className="min-h-11" onClick={onBack}>
                    Back
                </Button>
                <Button
                    type="button"
                    className="min-h-11"
                    data-testid="create-from-scan"
                    disabled={!ready}
                    onClick={() =>
                        onCreate(
                            designFromScan(
                                chart,
                                feet.map((foot) => ({
                                    side: foot.side,
                                    archHeightMm: foot.heightMm,
                                    flexible,
                                })),
                            ),
                        )
                    }
                >
                    Create design
                </Button>
            </div>
        </section>
    );
}

function completeDots(dots: Partial<FootDots>): dots is FootDots {
    return DOT_ORDER.every((key) => dots[key] !== undefined);
}

function FootUpload({
    side,
    file,
    dots,
    onDots,
    onFile,
    onDownload,
    onRemove,
}: {
    side: ScanSide;
    file: StoredSide | null;
    dots: Partial<FootDots>;
    onDots: (dots: Partial<FootDots>) => void;
    onFile: (file: File | undefined) => void;
    onDownload: () => void;
    onRemove: () => void;
}) {
    const next = DOT_ORDER.find((key) => !dots[key]);
    const done = completeDots(dots);
    const angle = done ? heelToToeAngleDeg(dots) : 0;
    return (
        <article className="rounded-xl border border-border bg-panel p-4">
            <h2 className="text-sm font-semibold">{side === "left" ? "Left" : "Right"}</h2>
            <input
                data-testid={`scan-file-${side}`}
                aria-label={`${side} scan`}
                type="file"
                className="mt-2 block w-full text-sm"
                onChange={(event) => onFile(event.target.files?.[0])}
            />
            {file ? (
                <div className="mt-2 text-xs text-muted-foreground">
                    <p>{file.fileName}</p>
                    <p data-testid={`scan-countdown-${side}`}>{scanRetentionLabel(file.uploadedAt)}</p>
                    <div className="mt-1 flex gap-2">
                        <button type="button" className="min-h-11 underline" onClick={onDownload}>
                            Download
                        </button>
                        <button type="button" className="min-h-11 underline" onClick={onRemove}>
                            Remove
                        </button>
                    </div>
                </div>
            ) : null}
            <p className="mt-3 text-xs text-muted-foreground">
                {done
                    ? "Dots orient the scan and measure arch height."
                    : `Place ${DOT_LABELS[next ?? "firstMet"]}.`}
            </p>
            <div
                data-testid={`scan-dots-${side}`}
                className="relative mt-2 h-64 w-full max-w-xs overflow-hidden rounded-lg border border-dashed border-border bg-background"
                style={done ? { transform: `rotate(${angle}deg)` } : undefined}
                onClick={(event) => {
                    if (!file || !next) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    const x = (event.clientX - rect.left) / rect.width;
                    const y = (event.clientY - rect.top) / rect.height;
                    onDots({ ...dots, [next]: { x: clamp01(x), y: clamp01(y) } });
                }}
            >
                {(Object.keys(dots) as DotKey[]).map((key) => {
                    const dot = dots[key];
                    if (!dot) return null;
                    return (
                        <span
                            key={key}
                            data-testid={`dot-${side}-${key}`}
                            className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
                            style={{ left: `${dot.x * 100}%`, top: `${dot.y * 100}%` }}
                            title={DOT_LABELS[key]}
                        />
                    );
                })}
            </div>
        </article>
    );
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
}
