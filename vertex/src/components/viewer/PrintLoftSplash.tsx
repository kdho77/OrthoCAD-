// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { Loader2, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { isCoarsePointerDevice } from "@/lib/geometry/procedural-wall/preview-loft-queue";
import {
    INITIAL_LOAD_LABEL,
    PRINT_LOFT_HINT,
    previewLoftProgressLabel,
    printLoftProgress01,
    printLoftSteps,
    type ViewerLoftOverlayState,
} from "@/lib/geometry/procedural-wall/preview-loft-ui";
import { cn } from "@/lib/utils";
import {
    cancelPreviewLoft,
    retryPreviewLoft,
    usePreviewLoftStatusStore,
} from "@/stores/preview-loft-status-store";

function formatElapsed(ms: number): string {
    const sec = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}s`;
}

export function PrintLoftSplash({ overlay }: { overlay: ViewerLoftOverlayState }) {
    const phaseBySide = usePreviewLoftStatusStore((s) => s.phaseBySide);
    const loftError = usePreviewLoftStatusStore((s) => s.error);
    const startedAt = usePreviewLoftStatusStore((s) => s.startedAt);
    const lastElapsedMs = usePreviewLoftStatusStore((s) => s.lastElapsedMs);
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (overlay.kind !== "progress") return;
        const id = window.setInterval(() => setNow(Date.now()), 250);
        return () => window.clearInterval(id);
    }, [overlay.kind]);

    if (!overlay.showBanner) return null;

    const elapsedMs = startedAt ? now - startedAt : lastElapsedMs;
    const workingFeet = (["left", "right"] as const).filter((side) => {
        const phase = phaseBySide[side];
        return phase === "lofting" || phase === "queued" || phase === "fetching";
    }).length;
    const progress = printLoftProgress01(elapsedMs, Math.max(1, workingFeet));
    const steps = printLoftSteps(phaseBySide);
    const label = previewLoftProgressLabel(phaseBySide, isCoarsePointerDevice());
    const initialLoad = overlay.kind === "progress" && overlay.mode === "initial";

    return (
        <div
            className={
                overlay.blockViewport
                    ? "absolute inset-0 z-10 flex items-center justify-center bg-[hsl(222_28%_7%/0.72)]"
                    : "pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2"
            }
            role={overlay.kind === "error" ? "alert" : "status"}
            aria-live="polite"
            data-testid={initialLoad ? "initial-load-splash" : "print-loft-splash"}
        >
            <div
                className={
                    overlay.kind === "error"
                        ? "flex w-[min(92vw,22rem)] flex-col gap-3 rounded-lg border border-red-500/50 bg-red-950/90 px-4 py-3 text-[12px] text-red-100 shadow-lg backdrop-blur"
                        : "flex w-[min(92vw,22rem)] flex-col gap-3 rounded-lg border border-border/60 bg-panel/95 px-4 py-3 text-[12px] text-foreground shadow-lg backdrop-blur"
                }
            >
                {overlay.kind === "error" ? (
                    <>
                        <span className="break-words font-medium">
                            {loftError ?? "Failed to load the base."}
                        </span>
                        <div className="flex items-center justify-end gap-2">
                            <button
                                type="button"
                                className="inline-flex items-center justify-center gap-1 rounded bg-red-900/70 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide hover:bg-red-800/80"
                                onClick={() => cancelPreviewLoft()}
                            >
                                <X className="h-3 w-3" />
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="inline-flex items-center justify-center gap-1 rounded bg-red-900/70 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide hover:bg-red-800/80"
                                onClick={() => retryPreviewLoft()}
                            >
                                <RotateCcw className="h-3 w-3" />
                                Retry
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="flex items-start gap-2">
                            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-cyan-400" />
                            <div className="min-w-0 flex-1">
                                <p className="font-medium">{initialLoad ? INITIAL_LOAD_LABEL : label}</p>
                                {initialLoad ? null : (
                                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                                        {PRINT_LOFT_HINT}
                                    </p>
                                )}
                            </div>
                            {initialLoad ? null : (
                                <span className="tabular-nums text-[11px] text-muted-foreground">
                                    {formatElapsed(elapsedMs)}
                                </span>
                            )}
                        </div>
                        {initialLoad ? null : (
                            <>
                                <div
                                    className="h-1.5 overflow-hidden rounded-full bg-muted"
                                    role="progressbar"
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-valuenow={Math.round(progress * 100)}
                                >
                                    <div
                                        className="h-full rounded-full bg-cyan-400 transition-[width] duration-300"
                                        style={{ width: `${Math.round(progress * 100)}%` }}
                                    />
                                </div>
                                <ol className="space-y-1 text-[11px]">
                                    {steps.map((step) => (
                                        <li key={step.id} className="flex items-center gap-2">
                                            <span
                                                className={cn(
                                                    "h-1.5 w-1.5 rounded-full",
                                                    step.state === "done" && "bg-emerald-400",
                                                    step.state === "active" && "bg-cyan-400",
                                                    step.state === "pending" && "bg-muted-foreground/40",
                                                )}
                                            />
                                            <span
                                                className={cn(
                                                    step.state === "active" && "text-foreground",
                                                    step.state !== "active" && "text-muted-foreground",
                                                )}
                                            >
                                                {step.label}
                                            </span>
                                        </li>
                                    ))}
                                </ol>
                                <div className="flex justify-end">
                                    <button
                                        type="button"
                                        className="inline-flex items-center justify-center gap-1 rounded border border-border bg-background/60 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide hover:bg-background"
                                        onClick={() => cancelPreviewLoft()}
                                    >
                                        <X className="h-3 w-3" />
                                        Cancel
                                    </button>
                                </div>
                            </>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
