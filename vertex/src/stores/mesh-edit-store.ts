import { create } from "zustand";
import * as THREE from "three";
import { INSOLE_LENGTH_MM, INSOLE_WIDTH_MM } from "@/lib/geometry/layout";
import type { TrimLine } from "@/lib/geometry/mesh-edit";
import {
    cloneTrimline,
    getDesignTrimline,
    sampleDefaultOutline,
    type TrimlineCurve,
} from "@/lib/geometry/trimline";
import { useDesignStore } from "@/stores/design-store";
import type { Side } from "@/types";

export type MeshEditMode = "transform" | "trim" | "vertex" | "edit-trimline";

export type MeshEditTarget =
    | { type: "element"; id: string }
    | { type: "insole"; side: Side }
    | { type: "scan"; id: string };

export interface TrimlineEditSession {
    side: Side;
    /** Live draft curve while editing (preview). */
    draft: TrimlineCurve;
    /** Snapshot taken at session start for cancel/revert. */
    snapshot: TrimlineCurve;
    /** Control point index where the current drag started. */
    dragAnchorIndex: number | null;
    /** Local footprint point where drag started (for delta computation). */
    dragStartLocal: THREE.Vector3 | null;
    isDragging: boolean;
}

export interface MeshEditStore {
    editMode: MeshEditMode;
    target: MeshEditTarget | null;
    /** Active trim polyline being drawn (cut tool). */
    activeTrimPoints: THREE.Vector3[];
    trimLines: TrimLine[];
    /** Active trimline reshape session (draft vs committed). */
    trimlineEdit: TrimlineEditSession | null;

    vertexOverrides: Map<number, THREE.Vector3>;
    selectedVertex: number | null;

    setEditMode: (mode: MeshEditMode) => void;
    setTarget: (target: MeshEditTarget | null) => void;
    addTrimPoint: (point: THREE.Vector3) => void;
    finishTrimLine: () => void;
    clearTrimLines: () => void;
    setVertexOverride: (index: number, position: THREE.Vector3) => void;
    setSelectedVertex: (index: number | null) => void;
    resetEdits: () => void;

    /** Enter interactive trimline editing for a foot side. */
    beginTrimlineEdit: (side: Side) => void;
    /** Commit draft trimline to design store and exit edit mode. */
    confirmTrimlineEdit: () => void;
    /** Revert draft to session snapshot and exit edit mode. */
    cancelTrimlineEdit: () => void;
    /** Update draft points during drag (preview). */
    setTrimlineDraft: (points: THREE.Vector3[]) => void;
    setTrimlineDragAnchor: (index: number | null, startLocal?: THREE.Vector3 | null) => void;
    setTrimlineDragging: (dragging: boolean) => void;
    getTrimlineForSide: (side: Side) => TrimlineCurve;
    getCommittedTrimline: (side: Side) => TrimlineCurve | null;
}

function committedOrDefault(side: Side): TrimlineCurve {
    const design = useDesignStore.getState().design;
    return getDesignTrimline(design, side) ?? sampleDefaultOutline(INSOLE_LENGTH_MM, INSOLE_WIDTH_MM);
}

export const useMeshEditStore = create<MeshEditStore>((set, get) => ({
    editMode: "transform",
    target: null,
    activeTrimPoints: [],
    trimLines: [],
    trimlineEdit: null,
    vertexOverrides: new Map(),
    selectedVertex: null,

    setEditMode: (editMode) =>
        set({
            editMode,
            activeTrimPoints: editMode === "trim" ? get().activeTrimPoints : [],
            selectedVertex: editMode === "vertex" ? get().selectedVertex : null,
            trimlineEdit: editMode === "edit-trimline" ? get().trimlineEdit : null,
        }),

    setTarget: (target) =>
        set({
            target,
            activeTrimPoints: [],
            trimLines: [],
            vertexOverrides: new Map(),
            selectedVertex: null,
        }),

    addTrimPoint: (point) =>
        set((s) => ({ activeTrimPoints: [...s.activeTrimPoints, point.clone()] })),

    finishTrimLine: () =>
        set((s) => {
            if (s.activeTrimPoints.length < 2) return s;
            const line: TrimLine = {
                id: crypto.randomUUID(),
                points: s.activeTrimPoints.map((p) => p.clone()),
            };
            return { trimLines: [...s.trimLines, line], activeTrimPoints: [] };
        }),

    clearTrimLines: () => set({ trimLines: [], activeTrimPoints: [] }),

    setVertexOverride: (index, position) =>
        set((s) => {
            const vertexOverrides = new Map(s.vertexOverrides);
            vertexOverrides.set(index, position.clone());
            return { vertexOverrides };
        }),

    setSelectedVertex: (selectedVertex) => set({ selectedVertex }),

    resetEdits: () =>
        set({
            activeTrimPoints: [],
            trimLines: [],
            trimlineEdit: null,
            vertexOverrides: new Map(),
            selectedVertex: null,
            editMode: "transform",
        }),

    beginTrimlineEdit: (side) => {
        const base = committedOrDefault(side);
        const snapshot = cloneTrimline(base);
        const draft = cloneTrimline(base);
        set({
            editMode: "edit-trimline",
            target: { type: "insole", side },
            trimlineEdit: {
                side,
                draft,
                snapshot,
                dragAnchorIndex: null,
                dragStartLocal: null,
                isDragging: false,
            },
        });
    },

    confirmTrimlineEdit: () => {
        const session = get().trimlineEdit;
        if (!session) return;
        useDesignStore.getState().setSideTrimline(session.side, session.draft);
        set({ trimlineEdit: null, editMode: "transform" });
    },

    cancelTrimlineEdit: () => {
        set({ trimlineEdit: null, editMode: "transform" });
    },

    setTrimlineDraft: (points) =>
        set((s) => {
            if (!s.trimlineEdit) return s;
            return {
                trimlineEdit: {
                    ...s.trimlineEdit,
                    draft: { points: points.map((p) => p.clone()) },
                },
            };
        }),

    setTrimlineDragAnchor: (index, startLocal = null) =>
        set((s) => {
            if (!s.trimlineEdit) return s;
            return {
                trimlineEdit: {
                    ...s.trimlineEdit,
                    dragAnchorIndex: index,
                    dragStartLocal: startLocal ? startLocal.clone() : null,
                },
            };
        }),

    setTrimlineDragging: (isDragging) =>
        set((s) => {
            if (!s.trimlineEdit) return s;
            return { trimlineEdit: { ...s.trimlineEdit, isDragging } };
        }),

    getTrimlineForSide: (side) => committedOrDefault(side),

    getCommittedTrimline: (side) => getDesignTrimline(useDesignStore.getState().design, side),
}));
