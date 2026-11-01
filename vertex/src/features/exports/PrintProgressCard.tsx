// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { Loader2, X } from "lucide-react";
import { cancelPreviewLoft } from "@/stores/preview-loft-status-store";
import { useExportSessionStore } from "@/features/exports/export-session-store";
import { cn } from "@/lib/utils";

const STEPS = [
    { id: "building", label: "Building walls" },
    { id: "exporting", label: "Exporting" },
    { id: "slicing", label: "Slicing" },
    { id: "ready", label: "Ready" },
] as const;

export function PrintProgressCard() {
    const progress = useExportSessionStore((s) => s.progress);
    if (progress.phase === "idle") return null;

    const activeIndex = STEPS.findIndex((s) => s.id === progress.phase);

    return (
        <div
            className="space-y-2 rounded-md border border-border bg-background/60 p-2 text-xs"
            data-testid="print-progress-card"
        >
            <div className="flex items-center gap-2">
                {progress.phase !== "ready" && progress.phase !== "error" ? (
                    <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
                ) : null}
                <span>{progress.message ?? STEPS.find((s) => s.id === progress.phase)?.label}</span>
            </div>
            <ol className="space-y-1">
                {STEPS.map((step, idx) => {
                    const state =
                        progress.phase === "error"
                            ? "pending"
                            : idx < activeIndex
                              ? "done"
                              : idx === activeIndex
                                ? "active"
                                : "pending";
                    return (
                        <li key={step.id} className="flex items-center gap-2 text-[11px]">
                            <span
                                className={cn(
                                    "h-1.5 w-1.5 rounded-full",
                                    state === "done" && "bg-emerald-400",
                                    state === "active" && "bg-cyan-400",
                                    state === "pending" && "bg-muted-foreground/40",
                                )}
                            />
                            <span className={state === "active" ? "text-foreground" : "text-muted-foreground"}>
                                {step.label}
                            </span>
                        </li>
                    );
                })}
            </ol>
            {progress.phase === "building" ? (
                <div className="flex justify-end">
                    <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] uppercase tracking-wide"
                        onClick={() => cancelPreviewLoft()}
                    >
                        <X className="h-3 w-3" /> Cancel
                    </button>
                </div>
            ) : null}
        </div>
    );
}
