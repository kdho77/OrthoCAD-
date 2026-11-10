// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { create } from "zustand";
import type { MeasureVec3 } from "@/lib/geometry/measure/types";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import { useScanStore } from "@/stores/scan-store";

export type MeasureTool = "point" | "thickness";
export type MeasurePanelTab = "view" | "measurements";

export interface StoredMeasurePoint {
    solidId: string;
    /** Export-frame millimetres. */
    export: MeasureVec3;
    /** Viewer world position captured at the click, for the on-mesh line. */
    world: MeasureVec3;
    normal: MeasureVec3;
}

interface MeasureState {
    panel: MeasurePanelTab;
    tool: MeasureTool | null;
    /** 1 mm vertex snap when true. */
    vertexSnap: boolean;
    /** Insole sacrificial leader. Off by default so the readout is the foot. */
    includeLeader: boolean;
    points: StoredMeasurePoint[];
    thickness: StoredMeasurePoint | null;
    thicknessMm: number | null;
    notice: string | null;
    setPanel: (panel: MeasurePanelTab) => void;
    arm: (tool: MeasureTool) => void;
    setVertexSnap: (on: boolean) => void;
    setIncludeLeader: (on: boolean) => void;
    addPoint: (point: StoredMeasurePoint) => void;
    setThickness: (point: StoredMeasurePoint, thicknessMm: number | null) => void;
    clear: () => void;
    setNotice: (notice: string | null) => void;
}

export const useMeasureStore = create<MeasureState>((set, get) => ({
    panel: "view",
    tool: null,
    vertexSnap: false,
    includeLeader: false,
    points: [],
    thickness: null,
    thicknessMm: null,
    notice: null,
    setPanel: (panel) => set({ panel, tool: panel === "measurements" ? get().tool : null }),
    arm: (tool) => {
        const next = get().tool === tool ? null : tool;
        if (next) {
            useScanStore.getState().exitPlacement();
            const edit = useMeshEditStore.getState();
            if (edit.editMode === "edit-trimline") edit.cancelTrimlineEdit();
            if (edit.editMode === "edit-bottom-pattern") edit.cancelBottomPatternEdit();
        }
        set({
            tool: next,
            panel: "measurements",
            points: next === "point" ? get().points : [],
            thickness: next === "thickness" ? get().thickness : null,
            thicknessMm: next === "thickness" ? get().thicknessMm : null,
            notice: null,
        });
    },
    setVertexSnap: (vertexSnap) => set({ vertexSnap }),
    setIncludeLeader: (includeLeader) => set({ includeLeader }),
    addPoint: (point) => {
        const points = get().points;
        const next = points.length >= 2 ? [point] : [...points, point];
        set({ points: next, notice: null });
    },
    setThickness: (point, thicknessMm) => set({ thickness: point, thicknessMm, notice: null }),
    clear: () => set({ points: [], thickness: null, thicknessMm: null, notice: null }),
    setNotice: (notice) => set({ notice }),
}));

export function measureToolArmed(): boolean {
    return useMeasureStore.getState().tool != null;
}
