import { create } from "zustand";

/** Drives preview-quality geometry while the user is actively editing. */
export type InteractionMode = "idle" | "slider" | "transform" | "batch";

interface PerformanceStore {
    interactionMode: InteractionMode;
    /** Incremented when a full-quality geometry build completes (for export panel sync). */
    geometryGeneration: number;

    setInteractionMode: (mode: InteractionMode) => void;
    notifyGeometryBuilt: () => void;
}

export const usePerformanceStore = create<PerformanceStore>((set) => ({
    interactionMode: "idle",
    geometryGeneration: 0,

    setInteractionMode: (interactionMode) => set({ interactionMode }),
    notifyGeometryBuilt: () => set((s) => ({ geometryGeneration: s.geometryGeneration + 1 })),
}));

/** True while sliders, gizmos, or batch AI apply are in flight — use fast preview meshes. */
export function usePreviewQuality(): boolean {
    return usePerformanceStore((s) => s.interactionMode !== "idle");
}
