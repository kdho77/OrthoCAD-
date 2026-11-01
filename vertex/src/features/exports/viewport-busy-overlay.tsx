// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
    type ExportJobProgress,
    exportBusyPercent,
    useExportSessionStore,
} from "@/features/exports/export-session-store";
import { cancelPreviewLoft } from "@/stores/preview-loft-status-store";
import { cn } from "@/lib/utils";

export const VIEWPORT_BUSY_STEPS = [
    { id: "building", label: "Building walls" },
    { id: "exporting", label: "Exporting" },
    { id: "slicing", label: "Slicing" },
    { id: "ready", label: "Ready" },
] as const;

function formatElapsed(ms: number): string {
    const sec = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}s`;
}

export function ViewportBusyOverlayBody({ progress, elapsedMs }: { progress: ExportJobProgress; elapsedMs: number }) {
    const activeIndex = VIEWPORT_BUSY_STEPS.findIndex((s) => s.id === progress.phase);
    const percent = exportBusyPercent(progress.phase, elapsedMs);
    const isError = progress.phase === "error";

    return (
        <>
            <div className="flex items-start gap-2">
                {!isError && progress.phase !== "ready" ? (
                    <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-cyan-400" />
                ) : null}
                <div className="min-w-0 flex-1">
                    <p className={cn("font-medium", isError && "text-red-100")}>
                        {progress.message ??
                            VIEWPORT_BUSY_STEPS.find((s) => s.id === progress.phase)?.label ??
                            "Working…"}
                    </p>
                </div>
                {!isError ? (
                    <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">
                        {percent}% · {formatElapsed(elapsedMs)}
                    </span>
                ) : null}
            </div>
            {!isError ? (
                <>
                    <div
                        className="h-1.5 overflow-hidden rounded-full bg-muted"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={percent}
                    >
                        <div
                            className="h-full rounded-full bg-cyan-400 transition-[width] duration-300"
                            style={{ width: `${percent}%` }}
                        />
                    </div>
                    <ol className="space-y-1 text-[11px]">
                        {VIEWPORT_BUSY_STEPS.map((step, idx) => {
                            const state =
                                idx < activeIndex
                                    ? "done"
                                    : idx === activeIndex
                                      ? "active"
                                      : "pending";
                            return (
                                <li key={step.id} className="flex items-center gap-2">
                                    <span
                                        className={cn(
                                            "h-1.5 w-1.5 rounded-full",
                                            state === "done" && "bg-emerald-400",
                                            state === "active" && "bg-cyan-400",
                                            state === "pending" && "bg-muted-foreground/40",
                                        )}
                                    />
                                    <span
                                        className={cn(
                                            state === "active" ? "text-foreground" : "text-muted-foreground",
                                        )}
                                    >
                                        {step.label}
                                    </span>
                                </li>
                            );
                        })}
                    </ol>
                </>
            ) : null}
            {progress.phase === "building" ? (
                <div className="flex justify-end">
                    <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded border border-border bg-background/60 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide hover:bg-background"
                        onClick={() => cancelPreviewLoft()}
                    >
                        <X className="h-3 w-3" /> Cancel
                    </button>
                </div>
            ) : null}
            {isError ? (
                <div className="flex justify-end gap-2">
                    <button
                        type="button"
                        className="rounded border border-border bg-background/60 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide hover:bg-background"
                        onClick={() => useExportSessionStore.getState().setProgress({ phase: "idle" })}
                    >
                        Dismiss
                    </button>
                </div>
            ) : null}
        </>
    );
}

/** Centered viewport card for solid build, export, slicing, and server waits. */
export function ViewportBusyOverlay() {
    const progress = useExportSessionStore((s) => s.progress);
    const startedAtMs = useExportSessionStore((s) => s.progressStartedAtMs);
    const [visible, setVisible] = useState(false);
    const [now, setNow] = useState(() => Date.now());

    const busy =
        progress.phase === "building" ||
        progress.phase === "exporting" ||
        progress.phase === "slicing" ||
        progress.phase === "error";

    useEffect(() => {
        if (!busy) {
            setVisible(false);
            return;
        }
        setVisible(true);
        const tick = window.setInterval(() => setNow(Date.now()), 250);
        return () => window.clearInterval(tick);
    }, [busy, progress.phase]);

    if (!busy || !visible) return null;

    const elapsedMs = startedAtMs ? now - startedAtMs : 0;

    return (
        <div
            className="pointer-events-auto absolute inset-x-0 top-8 z-20 flex justify-center px-3"
            role={progress.phase === "error" ? "alert" : "status"}
            aria-live="polite"
            data-testid="viewport-busy-overlay"
        >
            <div
                className={cn(
                    "flex w-[min(92vw,22rem)] flex-col gap-3 rounded-lg border px-4 py-3 text-[12px] shadow-lg backdrop-blur",
                    progress.phase === "error"
                        ? "border-red-500/50 bg-red-950/90 text-red-100"
                        : "border-border/60 bg-panel/95 text-foreground",
                )}
            >
                <ViewportBusyOverlayBody progress={progress} elapsedMs={elapsedMs} />
            </div>
        </div>
    );
}

export function useExportPrimaryBusyLabel(fallback: string): string {
    const progress = useExportSessionStore((s) => s.progress);
    const startedAtMs = useExportSessionStore((s) => s.progressStartedAtMs);
    const [now, setNow] = useState(() => Date.now());

    const busy =
        progress.phase === "building" ||
        progress.phase === "exporting" ||
        progress.phase === "slicing";

    useEffect(() => {
        if (!busy) return;
        const id = window.setInterval(() => setNow(Date.now()), 250);
        return () => window.clearInterval(id);
    }, [busy]);

    if (!busy) return fallback;
    const elapsedMs = startedAtMs ? now - startedAtMs : 0;
    return `${exportBusyPercent(progress.phase, elapsedMs)}%`;
}
