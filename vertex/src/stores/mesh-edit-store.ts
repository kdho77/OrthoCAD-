import type * as THREE from "three";
import { create } from "zustand";
import { getBaseCacheKey, getDesignBase } from "@/lib/geometry/base-asset";
import {
    cloneBottomPattern,
    createBottomPatternFromOutline,
    getDesignBottomPattern,
    scaleOutlineAboutCentroid,
} from "@/lib/geometry/bottom-pattern";
import { INSOLE_LENGTH_MM, INSOLE_WIDTH_MM } from "@/lib/geometry/layout";
import type { TrimLine } from "@/lib/geometry/mesh-edit";
import {
    cloneTrimline,
    getDesignTrimline,
    sampleDefaultOutline,
    type TrimlineCurve,
} from "@/lib/geometry/trimline";
import { useBaseOutlineStore } from "@/stores/base-outline-store";
import { useDesignStore } from "@/stores/design-store";
import { useIssuesStore } from "@/stores/issues-store";
import type { BottomPattern, Side } from "@/types";

export type MeshEditMode = "transform" | "trim" | "vertex" | "edit-trimline" | "edit-bottom-pattern";

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

export type BottomPatternGesture = "outline" | "translate" | "rotate";

export interface BottomPatternEditSession {
    side: Side;
    /** Live draft while editing (preview only — not committed until confirm). */
    draft: BottomPattern;
    /** Snapshot at session start for cancel/revert. */
    snapshot: BottomPattern;
    /** Which gesture is active — outline reshape vs whole-pattern transform. */
    gesture: BottomPatternGesture | null;
    dragAnchorIndex: number | null;
    dragStartLocal: THREE.Vector3 | null;
    /** Transform snapshot at gesture start (translate/rotate). */
    dragStartTransform: BottomPattern["transform"] | null;
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
    /** Active bottom-pattern edit session (independent of top trimline). */
    bottomPatternEdit: BottomPatternEditSession | null;

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
    /** Returns the live draft if an edit-trimline session is active for the side, else null. */
    getActiveDraftTrimline: (side: Side) => TrimlineCurve | null;

    beginBottomPatternEdit: (side: Side) => void;
    confirmBottomPatternEdit: () => void;
    cancelBottomPatternEdit: () => void;
    setBottomPatternDraft: (pattern: BottomPattern) => void;
    setBottomPatternGesture: (
        gesture: BottomPatternGesture | null,
        opts?: {
            anchorIndex?: number | null;
            startLocal?: THREE.Vector3 | null;
            startTransform?: BottomPattern["transform"] | null;
        },
    ) => void;
    setBottomPatternDragging: (dragging: boolean) => void;
    getActiveDraftBottomPattern: (side: Side) => BottomPattern | null;
}

function committedOrDefault(side: Side): TrimlineCurve {
    const design = useDesignStore.getState().design;
    const committed = getDesignTrimline(design, side);
    if (committed) return committed;
    // On a loaded base, start from an outline that follows the real mesh boundary
    // (published once the base GLB loads) instead of the parametric default.
    const base = getDesignBase(design, side);
    if (base) {
        const key = getBaseCacheKey(base) ?? base.assetId;
        const outline = useBaseOutlineStore.getState().getOutline(key);
        if (outline) return cloneTrimline(outline);
    }
    return sampleDefaultOutline(INSOLE_LENGTH_MM, INSOLE_WIDTH_MM);
}

/** Default bottom pattern: scaled-down top outline (partial coverage), identity transform. */
function defaultBottomPatternForSide(side: Side): BottomPattern {
    const design = useDesignStore.getState().design;
    const existing = getDesignBottomPattern(design, side);
    if (existing) return cloneBottomPattern(existing);
    const top = committedOrDefault(side);
    const smaller = scaleOutlineAboutCentroid(top, 0.65);
    return createBottomPatternFromOutline(smaller);
}

export const useMeshEditStore = create<MeshEditStore>((set, get) => ({
    editMode: "transform",
    target: null,
    activeTrimPoints: [],
    trimLines: [],
    trimlineEdit: null,
    bottomPatternEdit: null,
    vertexOverrides: new Map(),
    selectedVertex: null,

    setEditMode: (editMode) =>
        set({
            editMode,
            activeTrimPoints: editMode === "trim" ? get().activeTrimPoints : [],
            selectedVertex: editMode === "vertex" ? get().selectedVertex : null,
            trimlineEdit: editMode === "edit-trimline" ? get().trimlineEdit : null,
            bottomPatternEdit: editMode === "edit-bottom-pattern" ? get().bottomPatternEdit : null,
        }),

    setTarget: (target) =>
        set({
            target,
            activeTrimPoints: [],
            trimLines: [],
            vertexOverrides: new Map(),
            selectedVertex: null,
        }),

    addTrimPoint: (point) => set((s) => ({ activeTrimPoints: [...s.activeTrimPoints, point.clone()] })),

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
            bottomPatternEdit: null,
            vertexOverrides: new Map(),
            selectedVertex: null,
            editMode: "transform",
        }),

    beginTrimlineEdit: (side) => {
        // Phase 3A: checkpoint before entering a long-running edit session so that
        // cancel (or later undo) reliably restores the pre-edit design state.
        useDesignStore.getState().checkpoint("trimline-edit-begin");
        const base = committedOrDefault(side);
        const snapshot = cloneTrimline(base);
        const draft = cloneTrimline(base);
        set({
            editMode: "edit-trimline",
            target: { type: "insole", side },
            bottomPatternEdit: null,
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
        // Checkpoint the post-trim state as its own history entry (the begin checkpoint
        // captured the pre-trim state, so undo after confirm steps back across the whole edit).
        useDesignStore.getState().checkpoint("trimline-edit-confirm");
        useDesignStore.getState().setSideTrimline(session.side, session.draft);
        // Phase 3A: after committing a new footprint, surface any now-orphaned elements or correction regions.
        const design = useDesignStore.getState().design;
        const effective = { [session.side]: session.draft } as Partial<Record<Side, TrimlineCurve>>;
        useIssuesStore.getState().recompute(design, effective);
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

    getActiveDraftTrimline: (side) => {
        const session = get().trimlineEdit;
        if (session && session.side === side) return cloneTrimline(session.draft);
        return null;
    },

    beginBottomPatternEdit: (side) => {
        useDesignStore.getState().checkpoint("bottom-pattern-edit-begin");
        const base = defaultBottomPatternForSide(side);
        const snapshot = cloneBottomPattern(base);
        const draft = cloneBottomPattern(base);
        set({
            editMode: "edit-bottom-pattern",
            target: { type: "insole", side },
            trimlineEdit: null,
            bottomPatternEdit: {
                side,
                draft,
                snapshot,
                gesture: null,
                dragAnchorIndex: null,
                dragStartLocal: null,
                dragStartTransform: null,
                isDragging: false,
            },
        });
    },

    confirmBottomPatternEdit: () => {
        const session = get().bottomPatternEdit;
        if (!session) return;
        useDesignStore.getState().checkpoint("bottom-pattern-edit-confirm");
        useDesignStore.getState().setSideBottomPattern(session.side, session.draft);
        set({ bottomPatternEdit: null, editMode: "transform" });
    },

    cancelBottomPatternEdit: () => {
        set({ bottomPatternEdit: null, editMode: "transform" });
    },

    setBottomPatternDraft: (pattern) =>
        set((s) => {
            if (!s.bottomPatternEdit) return s;
            return {
                bottomPatternEdit: {
                    ...s.bottomPatternEdit,
                    draft: cloneBottomPattern(pattern),
                },
            };
        }),

    setBottomPatternGesture: (gesture, opts = {}) =>
        set((s) => {
            if (!s.bottomPatternEdit) return s;
            const startLocal = opts.startLocal ?? null;
            return {
                bottomPatternEdit: {
                    ...s.bottomPatternEdit,
                    gesture,
                    dragAnchorIndex: opts.anchorIndex ?? null,
                    dragStartLocal: startLocal ? startLocal.clone() : null,
                    dragStartTransform: opts.startTransform ? { ...opts.startTransform } : null,
                },
            };
        }),

    setBottomPatternDragging: (isDragging) =>
        set((s) => {
            if (!s.bottomPatternEdit) return s;
            return { bottomPatternEdit: { ...s.bottomPatternEdit, isDragging } };
        }),

    getActiveDraftBottomPattern: (side) => {
        const session = get().bottomPatternEdit;
        if (session && session.side === side) return cloneBottomPattern(session.draft);
        return null;
    },
}));
