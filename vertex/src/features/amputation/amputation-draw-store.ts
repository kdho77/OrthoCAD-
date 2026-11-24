// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { create } from "zustand";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import type { Side } from "@/types";

export interface DrawPoint {
    id: string;
    x: number;
    y: number;
    localX?: number;
    localY?: number;
}

interface PlacePoint {
    x: number;
    y: number;
    localX?: number;
    localY?: number;
}

interface AmputationDrawStore {
    side: Side | null;
    points: DrawPoint[];
    /** Fresh cut. Does not copy a saved line, a trimline, or a bottom pattern. */
    start: (side: Side) => void;
    place: (point: PlacePoint) => void;
    undo: () => void;
    cancel: () => void;
}

let pointSeq = 0;

/**
 * Trimline edit draws yellow handles. Bottom-pattern edit draws its own polyline.
 * Either one was what showed up when a Draw click landed on the sheet.
 * Leave both before the cut is placed.
 */
function releaseInsoleShapeEditors(): void {
    const mesh = useMeshEditStore.getState();
    if (mesh.editMode === "edit-trimline") mesh.cancelTrimlineEdit();
    if (useMeshEditStore.getState().editMode === "edit-bottom-pattern") {
        useMeshEditStore.getState().cancelBottomPatternEdit();
    }
    const mode = useMeshEditStore.getState().editMode;
    if (mode === "trim" || mode === "vertex") {
        useMeshEditStore.getState().clearTrimLines();
        useMeshEditStore.getState().setEditMode("transform");
    }
}

export const useAmputationDrawStore = create<AmputationDrawStore>((set) => ({
    side: null,
    points: [],

    start: (side) => {
        releaseInsoleShapeEditors();
        set({ side, points: [] });
    },

    place: (point) =>
        set((s) => {
            if (!s.side) return s;
            if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return s;
            const next: DrawPoint = {
                id: `cut-${pointSeq++}`,
                x: point.x,
                y: point.y,
                ...(Number.isFinite(point.localX) && Number.isFinite(point.localY)
                    ? { localX: point.localX, localY: point.localY }
                    : {}),
            };
            return { points: [...s.points, next] };
        }),

    undo: () => set((s) => ({ points: s.points.slice(0, -1) })),

    cancel: () => set({ side: null, points: [] }),
}));
