// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { Download, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResultCard } from "@/features/exports/ResultCard";
import { cn } from "@/lib/utils";

export interface ExportTileProps {
    title: string;
    purpose: string;
    badge?: string;
    costLabel: string;
    buttonLabel: string;
    busy?: boolean;
    disabled?: boolean;
    locked?: boolean;
    outOfDate?: boolean;
    result?: {
        filename?: string;
        sizeBytes?: number;
        tokensCharged?: number;
        onDownload?: () => void;
    };
    error?: { message: string; details?: string; noTokens?: boolean; onRetry?: () => void };
    onAction: () => void;
    testId?: string;
}

export function ExportTile({
    title,
    purpose,
    badge,
    costLabel,
    buttonLabel,
    busy,
    disabled,
    locked,
    outOfDate,
    result,
    error,
    onAction,
    testId,
}: ExportTileProps) {
    return (
        <div
            className={cn("flex flex-col gap-2 rounded-md border border-border bg-background/40 p-2")}
            data-testid={testId}
        >
            <div className="flex items-start justify-between gap-2">
                <div>
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{title}</span>
                        {badge ? (
                            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">
                                {badge}
                            </span>
                        ) : null}
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{purpose}</p>
                </div>
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{costLabel}</span>
            </div>
            {busy ? (
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Working…
                </p>
            ) : null}
            <Button className="h-8 w-full" disabled={disabled || busy} onClick={onAction}>
                {locked ? <Lock className="h-3.5 w-3.5" /> : busy ? null : <Download className="h-3.5 w-3.5" />}
                {buttonLabel}
            </Button>
            {error ? (
                <ResultCard
                    error={error.message}
                    errorDetails={error.details}
                    noTokensCharged={error.noTokens}
                    onRetry={error.onRetry}
                />
            ) : result?.filename ? (
                <ResultCard
                    filename={result.filename}
                    sizeBytes={result.sizeBytes}
                    tokensCharged={result.tokensCharged}
                    outOfDate={outOfDate}
                    onDownload={result.onDownload}
                />
            ) : null}
        </div>
    );
}
