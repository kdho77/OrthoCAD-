// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { create } from "zustand";
import { cancelAllPreviewLofts } from "@/lib/geometry/procedural-wall/preview-loft-queue";
import type { PreviewLoftPhase } from "@/lib/geometry/procedural-wall/preview-loft-ui";
import { terminateProceduralWallWorker } from "@/lib/geometry/procedural-wall/preview-loft-worker";
import { resetSampleTopGeometryCache } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { useDesignStore } from "@/stores/design-store";
import type { Side } from "@/types";

export interface PreviewLoftStatusStore {
    phaseBySide: Record<Side, PreviewLoftPhase>;
    message: string;
    error: string | null;
    errorSide: Side | null;
    retryNonce: number;
    startedAt: number | null;
    lastElapsedMs: number;
    /** User hit Cancel — do not auto-restart loft until Retry. */
    cancelled: boolean;
    setSidePhase: (side: Side, phase: PreviewLoftPhase, message?: string) => void;
    setError: (side: Side, error: string) => void;
    clearError: () => void;
    markElapsed: (ms: number) => void;
    retry: () => void;
    reset: () => void;
}

const idlePhases = (): Record<Side, PreviewLoftPhase> => ({ left: "idle", right: "idle" });

export const usePreviewLoftStatusStore = create<PreviewLoftStatusStore>((set) => ({
    phaseBySide: idlePhases(),
    message: "",
    error: null,
    errorSide: null,
    retryNonce: 0,
    startedAt: null,
    lastElapsedMs: 0,
    cancelled: false,

    setSidePhase: (side, phase, message) =>
        set((s) => ({
            phaseBySide: { ...s.phaseBySide, [side]: phase },
            message: message ?? s.message,
            startedAt: phase === "lofting" && s.phaseBySide[side] !== "lofting" ? Date.now() : s.startedAt,
            error: phase === "ready" && s.errorSide === side ? null : s.error,
            errorSide: phase === "ready" && s.errorSide === side ? null : s.errorSide,
        })),

    setError: (side, error) =>
        set((s) => ({
            phaseBySide: { ...s.phaseBySide, [side]: "error" },
            error,
            errorSide: side,
            message: error,
        })),

    clearError: () => set({ error: null, errorSide: null }),

    markElapsed: (ms) => set({ lastElapsedMs: ms }),

    retry: () =>
        set((s) => ({
            phaseBySide: idlePhases(),
            message: "Retrying…",
            error: null,
            errorSide: null,
            retryNonce: s.retryNonce + 1,
            startedAt: null,
            lastElapsedMs: 0,
            cancelled: false,
        })),

    reset: () =>
        set({
            phaseBySide: idlePhases(),
            message: "",
            error: null,
            errorSide: null,
            startedAt: null,
            lastElapsedMs: 0,
            cancelled: false,
        }),
}));

export function retryPreviewLoft(): void {
    const err = usePreviewLoftStatusStore.getState().error ?? "";
    if (/SAMPLE_Top|GLB|fetch|HTTP|load/i.test(err)) {
        resetSampleTopGeometryCache();
    }
    usePreviewLoftStatusStore.getState().retry();
    useDesignStore.setState({
        stockBaseError: null,
        baseMeshLoadingBySide: { left: false, right: false },
    });
}

export function cancelPreviewLoft(): void {
    cancelAllPreviewLofts();
    terminateProceduralWallWorker();
    usePreviewLoftStatusStore.setState({
        phaseBySide: { left: "idle", right: "idle" },
        message: "Print solid cancelled",
        error: null,
        errorSide: null,
        startedAt: null,
        cancelled: true,
    });
    useDesignStore.setState({
        stockBaseError: null,
        baseMeshLoadingBySide: { left: false, right: false },
    });
}
