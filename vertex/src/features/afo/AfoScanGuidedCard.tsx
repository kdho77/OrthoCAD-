// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { ChevronUp, GripVertical, HelpCircle, SkipForward, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
    AFO_LANDMARK_STEPS,
    AFO_PLANTAR_STEPS,
    afoStageSnapshot,
    undoAfoMarker,
} from "@/features/afo/afo-scan-markers";
import {
    AFO_MARKER_CLICK_HINT,
    AFO_MARKER_FULL_NAME,
    AFO_MARKER_HELP,
    AFO_MARKER_PILL,
    activeAfoTarget,
    afoGuidedProgress,
    afoPlacementComplete,
    skipAfoLandmark,
    undoLastAfoMarker,
    type AfoMarkerKey,
} from "@/features/afo/afo-scan-ui";
import { isOptionalLandmark, skippedLandmarkIds } from "@/lib/geometry/afo/landmark-frame";
import { defaultAfoScanWorkflow } from "@/lib/geometry/afo/defaults";
import { cn } from "@/lib/utils";
import { useAfoStore } from "@/stores/afo-store";
import { useDesignStore } from "@/stores/design-store";

export function AfoScanGuidedCard() {
    const workflow = useDesignStore((s) => s.design.afo?.scanWorkflow) ?? defaultAfoScanWorkflow();
    const placement = useAfoStore((s) => s.scanPlacement);
    const paused = placement?.paused ?? false;
    const [collapsed, setCollapsed] = useState(false);
    const [helpOpen, setHelpOpen] = useState(false);
    const [drag, setDrag] = useState({ x: 0, y: 0 });
    const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

    const targetId = activeAfoTarget(workflow, placement?.redo ?? null);
    const progress = afoGuidedProgress(workflow);
    const complete = afoPlacementComplete(workflow);

    const targetStep = useMemo(() => {
        if (!targetId) return null;
        return (
            AFO_PLANTAR_STEPS.find((s) => s.id === targetId) ??
            AFO_LANDMARK_STEPS.find((s) => s.id === targetId) ??
            null
        );
    }, [targetId]);

    const optional = targetStep && "optional" in targetStep ? targetStep.optional : false;
    const markerKey = targetId as AfoMarkerKey | null;

    useEffect(() => {
        if (complete) return;
        const onKey = (event: KeyboardEvent) => {
            if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
            event.preventDefault();
            if (event.shiftKey) {
                const redoId = useAfoStore.getState().scanLastUndoId;
                if (redoId) {
                    useAfoStore.getState().setScanPlacement({ redo: redoId, paused: false });
                    useAfoStore.getState().setScanLastUndoId(null);
                }
                return;
            }
            undoLastAfoMarker();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [complete]);

    const onSkip = () => {
        if (!targetId || !isOptionalLandmark(targetId)) return;
        const message = skipAfoLandmark(targetId);
        useAfoStore.getState().setScanLandmarkError(message);
        useAfoStore.getState().setScanAutoFrameSuppressed(false);
    };

    const onUndoTarget = () => {
        if (!targetId) return;
        undoAfoMarker(targetId);
        useAfoStore.getState().setScanLastUndoId(targetId);
    };

    const onPointerDownDrag = (event: React.PointerEvent) => {
        dragRef.current = {
            startX: event.clientX,
            startY: event.clientY,
            originX: drag.x,
            originY: drag.y,
        };
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    };

    const onPointerMoveDrag = (event: React.PointerEvent) => {
        if (!dragRef.current) return;
        setDrag({
            x: dragRef.current.originX + event.clientX - dragRef.current.startX,
            y: dragRef.current.originY + event.clientY - dragRef.current.startY,
        });
    };

    const onPointerUpDrag = () => {
        dragRef.current = null;
    };

    if (complete || !placement) return null;

    if (collapsed) {
        return (
            <button
                type="button"
                data-testid="afo-guided-card-collapsed"
                className="pointer-events-auto absolute left-1/2 top-[4.5rem] z-20 -translate-x-1/2 rounded-full border border-white/10 bg-[rgba(15,23,42,0.9)] px-4 py-1.5 text-[11px] font-medium text-white shadow-lg backdrop-blur"
                style={{ transform: `translate(calc(-50% + ${drag.x}px), ${drag.y}px)` }}
                onClick={() => setCollapsed(false)}
            >
                {progress.headline}
                {paused ? " · Paused" : ""}
            </button>
        );
    }

    return (
        <div
            data-testid="afo-guided-card"
            className="pointer-events-auto absolute left-1/2 top-[4.5rem] z-20 w-[360px] max-w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-lg border border-white/10 bg-[rgba(15,23,42,0.9)] p-3 text-white shadow-xl backdrop-blur"
            style={{ transform: `translate(calc(-50% + ${drag.x}px), ${drag.y}px)` }}
        >
            <div className="mb-2 flex items-center gap-2">
                <button
                    type="button"
                    aria-label="Drag card"
                    className="cursor-grab text-white/50 active:cursor-grabbing"
                    onPointerDown={onPointerDownDrag}
                    onPointerMove={onPointerMoveDrag}
                    onPointerUp={onPointerUpDrag}
                    onPointerCancel={onPointerUpDrag}
                >
                    <GripVertical className="h-4 w-4" />
                </button>
                <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-white/70" data-testid="afo-guided-headline">
                        {progress.headline}
                    </p>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
                        <div
                            className="h-full rounded-full bg-cyan-400 transition-all duration-300"
                            style={{ width: `${Math.round(progress.progress * 100)}%` }}
                        />
                    </div>
                </div>
                <button
                    type="button"
                    className="rounded p-1 text-white/70 hover:bg-white/10"
                    aria-label="Collapse"
                    onClick={() => setCollapsed(true)}
                >
                    <ChevronUp className="h-4 w-4" />
                </button>
            </div>

            {markerKey && targetStep ? (
                <>
                    <div className="flex items-start gap-2">
                        <p className="text-sm font-semibold leading-snug" data-testid="afo-guided-marker-name">
                            {AFO_MARKER_FULL_NAME[markerKey]}
                        </p>
                        {optional ? (
                            <span className="shrink-0 rounded bg-violet-500/30 px-1.5 py-0.5 text-[10px] font-medium text-violet-200">
                                Optional
                            </span>
                        ) : null}
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-white/80">
                        {AFO_MARKER_CLICK_HINT[markerKey]}
                    </p>
                    {paused ? (
                        <p className="mt-2 text-[11px] text-amber-200">
                            Placement paused · press P to resume · orbit freely
                        </p>
                    ) : null}
                    {helpOpen ? (
                        <p className="mt-2 rounded border border-white/10 bg-black/20 px-2 py-1.5 text-[11px] leading-relaxed text-white/75">
                            {AFO_MARKER_HELP[markerKey]}
                        </p>
                    ) : null}
                </>
            ) : (
                <p className="text-[11px] text-white/80">
                    {afoStageSnapshot(workflow).nextLabel ?? "All markers placed"}
                </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
                {optional ? (
                    <button
                        type="button"
                        data-testid="afo-guided-skip"
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-white/15 px-2 text-[11px] hover:bg-white/10"
                        onClick={onSkip}
                    >
                        <SkipForward className="h-3 w-3" />
                        Skip
                    </button>
                ) : null}
                <button
                    type="button"
                    data-testid="afo-guided-undo"
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-white/15 px-2 text-[11px] hover:bg-white/10"
                    onClick={onUndoTarget}
                >
                    <Undo2 className="h-3 w-3" />
                    Undo
                </button>
                <button
                    type="button"
                    data-testid="afo-guided-help"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/15 text-[11px] hover:bg-white/10"
                    aria-label="More detail"
                    onClick={() => setHelpOpen((v) => !v)}
                >
                    <HelpCircle className="h-3.5 w-3.5" />
                </button>
                {markerKey ? (
                    <span className="ml-auto text-[10px] text-white/50">{AFO_MARKER_PILL[markerKey]}</span>
                ) : null}
            </div>
        </div>
    );
}

export function afoChecklistRowState(
    workflow: ReturnType<typeof defaultAfoScanWorkflow>,
    stepId: string,
    point: unknown,
    optional: boolean,
): "waiting" | "done" | "skipped" {
    const skipped = skippedLandmarkIds(workflow);
    if (point) return "done";
    if (optional && skipped.includes(stepId as never)) return "skipped";
    return "waiting";
}

export function AfoChecklistCheck({ state }: { state: "waiting" | "done" | "skipped" }) {
    return (
        <span
            className={cn(
                "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px]",
                state === "done" && "border-emerald-400 bg-emerald-500/20 text-emerald-200",
                state === "skipped" && "border-violet-400/50 text-violet-200",
                state === "waiting" && "border-white/20 text-transparent",
            )}
            aria-hidden
        >
            {state === "done" ? "✓" : state === "skipped" ? "–" : ""}
        </span>
    );
}
