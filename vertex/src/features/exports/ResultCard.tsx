// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { ChevronDown, Download } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ResultCardProps {
    filename?: string;
    sizeBytes?: number;
    estimatedTimeSec?: number;
    materialLabel?: string;
    tokensCharged?: number;
    outOfDate?: boolean;
    error?: string | null;
    errorDetails?: string;
    noTokensCharged?: boolean;
    onDownload?: () => void;
    onRetry?: () => void;
}

function fmtSize(bytes?: number): string {
    if (bytes == null) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtTime(sec?: number): string {
    if (sec == null) return "—";
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function ResultCard({
    filename,
    sizeBytes,
    estimatedTimeSec,
    materialLabel,
    tokensCharged,
    outOfDate,
    error,
    errorDetails,
    noTokensCharged,
    onDownload,
    onRetry,
}: ResultCardProps) {
    const [detailsOpen, setDetailsOpen] = useState(false);
    if (!filename && !error) return null;

    if (error) {
        return (
            <div
                className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs"
                data-testid="export-result-error"
            >
                <p className="text-destructive">{error}</p>
                {noTokensCharged ? (
                    <p className="text-[11px] text-muted-foreground">No tokens charged</p>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                    {onRetry ? (
                        <Button size="sm" variant="secondary" className="h-7" onClick={onRetry}>
                            Retry
                        </Button>
                    ) : null}
                    {errorDetails ? (
                        <button
                            type="button"
                            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                            onClick={() => setDetailsOpen((v) => !v)}
                        >
                            Details
                            <ChevronDown className={cn("h-3 w-3 transition-transform", detailsOpen && "rotate-180")} />
                        </button>
                    ) : null}
                </div>
                {detailsOpen && errorDetails ? (
                    <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-background/60 p-2 text-[10px] text-muted-foreground">
                        {errorDetails}
                    </pre>
                ) : null}
            </div>
        );
    }

    return (
        <div
            className="space-y-2 rounded-md border border-border bg-background/50 p-2 text-xs"
            data-testid="export-result-card"
        >
            {outOfDate ? (
                <p className="text-[11px] font-medium text-amber-400">Out of date · Re-export</p>
            ) : null}
            <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">File</span>
                <span className="truncate text-right font-medium">{filename}</span>
            </div>
            <div className="flex justify-between">
                <span className="text-muted-foreground">Size</span>
                <span className="tabular-nums">{fmtSize(sizeBytes)}</span>
            </div>
            <div className="flex justify-between">
                <span className="text-muted-foreground">Est. time</span>
                <span className="tabular-nums">{fmtTime(estimatedTimeSec)}</span>
            </div>
            {materialLabel ? (
                <div className="flex justify-between">
                    <span className="text-muted-foreground">Material</span>
                    <span>{materialLabel}</span>
                </div>
            ) : null}
            {tokensCharged != null ? (
                <div className="flex justify-between">
                    <span className="text-muted-foreground">Tokens</span>
                    <span className="tabular-nums">−{tokensCharged}</span>
                </div>
            ) : null}
            {onDownload ? (
                <Button size="sm" className="h-8 w-full" onClick={onDownload}>
                    <Download className="h-3.5 w-3.5" /> Download
                </Button>
            ) : null}
        </div>
    );
}
