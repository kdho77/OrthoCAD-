import type * as THREE from "three";
import { create } from "zustand";
import { getBaseCacheKey, getDesignBase } from "@/lib/geometry/base-asset";
import type { TrimLine } from "@/lib/geometry/mesh-edit";
import { SAMPLE_TOP_ASSET_ID } from "@/lib/geometry/procedural-wall/sample-top-id";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { buildTrimPresetCurve } from "@/lib/geometry/trim-presets";
import {
    cloneTrimline,
    getDesignTrimline,
    sampleDefaultOutline,
    type TrimlineCurve,
} from "@/lib/geometry/trimline";
import { useBaseOutlineStore } from "@/stores/base-outline-store";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { useDesignStore } from "@/stores/design-store";
import { useIssuesStore } from "@/stores/issues-store";
import type { Side, TrimPresetId } from "@/types";

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
    /** When set, committed on confirm (otherwise marks preset as custom). */
    presetOnCommit?: TrimPresetId;
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
    /** Active faired-bottom-pattern reshape session (independent of trimline). */
    bottomPatternEdit: TrimlineEditSession | null;

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
    /** Begin trimline edit with a preset draft (preview before confirm). */
    beginTrimlineEditWithDraft: (side: Side, draft: TrimlineCurve, presetOnCommit?: TrimPresetId) => void;
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
    setBottomPatternDraft: (points: THREE.Vector3[]) => void;
    setBottomPatternDragAnchor: (index: number | null, startLocal?: THREE.Vector3 | null) => void;
    setBottomPatternDragging: (dragging: boolean) => void;
    getActiveDraftBottomPattern: (side: Side) => TrimlineCurve | null;
}

/** Mesh silhouette in the same frame the base is rendered in. */
function meshOutlineForSide(side: Side): TrimlineCurve | null {
    const design = useDesignStore.getState().design;
    const base = getDesignBase(design, side);
    if (!base) return null;
    const outlines = useBaseOutlineStore.getState();
    const mirrorTag = base.mirrored ? "m" : "p";
    const wallModel = useDesignStore.getState().viewer.wallModel ?? "procedural";
    if (wallModel === "procedural") {
        const procedural = outlines.getOutline(`${SAMPLE_TOP_ASSET_ID}:${side}:${mirrorTag}`);
        if (procedural) return cloneTrimline(procedural);
    }
    const key = getBaseCacheKey(base) ?? base.assetId;
    const legacy = key ? outlines.getOutline(key) : null;
    return legacy ? cloneTrimline(legacy) : null;
}

/** Loaded base GLB boundary, or null while that mesh outline is not published yet. */
export function loadedBaseOutline(side: Side): TrimlineCurve | null {
    return meshOutlineForSide(side);
}

/**
 * Default outline for a foot.
 * A base design uses the loaded GLB boundary only. While that boundary is still
 * loading the result is null — never the parametric insole. Parametric designs
 * (no base) keep the parametric outline.
 */
export function defaultOutlineForSide(side: Side): TrimlineCurve | null {
    const mesh = meshOutlineForSide(side);
    if (mesh && mesh.points.length >= 4) return mesh;
    const design = useDesignStore.getState().design;
    if (getDesignBase(design, side)) return null;
    const layout = insoleLayoutFromDesign(design);
    return sampleDefaultOutline(layout.lengthMm, layout.widthMm);
}

/**
 * Committed trim, otherwise the GLB boundary. Base designs do not fall back to
 * the parametric outline.
 */
function committedOrMesh(side: Side): TrimlineCurve | null {
    const design = useDesignStore.getState().design;
    const committed = getDesignTrimline(design, side);
    if (committed) return committed;
    return defaultOutlineForSide(side);
}

/** Presets cut the loaded GLB, not a previously saved trim and not the parametric shape. */
function presetSourceOutline(side: Side): TrimlineCurve | null {
    const mesh = meshOutlineForSide(side);
    if (mesh && mesh.points.length >= 4) return mesh;
    const design = useDesignStore.getState().design;
    if (getDesignBase(design, side)) return null;
    return committedOrMesh(side);
}

/** Landmark trim of this foot's own outline. Does not reuse the other foot's Y. */
export function curveForTrimPreset(
    side: Side,
    preset: Exclude<TrimPresetId, "custom">,
): TrimlineCurve | null {
    const base = presetSourceOutline(side);
    if (!base) return null;
    const design = useDesignStore.getState().design;
    const layout = insoleLayoutFromDesign(design);
    return buildTrimPresetCurve(preset, {
        lengthMm: layout.lengthMm,
        widthMm: layout.widthMm,
        baseCurve: base,
        footSide: side,
    });
}

/**
 * Trimline that should clip the mesh and the export right now.
 * A linked Sulcus / Met-head / Full preview is rebuilt per foot so the right
 * foot is not a copy of the left foot's polyline.
 */
export function resolveActiveTrimline(
    side: Side,
    design = useDesignStore.getState().design,
    session = useMeshEditStore.getState().trimlineEdit,
): TrimlineCurve | null {
    if (session?.side === side) return cloneTrimline(session.draft);
    const committed = getDesignTrimline(design, side);
    const preset = session?.presetOnCommit;
    if (
        session &&
        session.side !== side &&
        design.corrections.linked &&
        (preset === "full" || preset === "sulcus" || preset === "met_head")
    ) {
        return curveForTrimPreset(side, preset);
    }
    return committed;
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
        const base = committedOrMesh(side);
        if (!base || base.points.length < 4) return;
        get().beginTrimlineEditWithDraft(side, base);
    },

    beginTrimlineEditWithDraft: (side, draft, presetOnCommit) => {
        if (!draft || draft.points.length < 4) return;
        useDesignStore.getState().checkpoint("trimline-edit-begin");
        const snapshotSource = committedOrMesh(side) ?? draft;
        const snapshot = cloneTrimline(snapshotSource);
        set({
            editMode: "edit-trimline",
            target: { type: "insole", side },
            bottomPatternEdit: null,
            trimlineEdit: {
                side,
                draft: cloneTrimline(draft),
                snapshot,
                presetOnCommit,
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
        const store = useDesignStore.getState();
        const presetId = session.presetOnCommit ?? "custom";
        store.setSideTrimline(session.side, session.draft);
        store.setTrimPresetId(session.side, presetId);
        const effective = { [session.side]: session.draft } as Partial<Record<Side, TrimlineCurve>>;
        if (store.design.corrections.linked) {
            const other: Side = session.side === "left" ? "right" : "left";
            // Named presets are rebuilt on the other foot's own outline. Copying the
            // active polyline would put the left foot's Y on the right foot.
            const otherCurve =
                presetId === "full" || presetId === "sulcus" || presetId === "met_head"
                    ? curveForTrimPreset(other, presetId)
                    : session.draft;
            if (otherCurve && otherCurve.points.length >= 4) {
                store.setSideTrimline(other, otherCurve);
                store.setTrimPresetId(other, presetId);
                effective[other] = otherCurve;
            }
        }
        // Phase 3A: after committing a new footprint, surface any now-orphaned elements or correction regions.
        const design = useDesignStore.getState().design;
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

    getTrimlineForSide: (side) => committedOrMesh(side) ?? { points: [] },

    getCommittedTrimline: (side) => getDesignTrimline(useDesignStore.getState().design, side),

    getActiveDraftTrimline: (side) => {
        const session = get().trimlineEdit;
        if (session && session.side === side) return cloneTrimline(session.draft);
        return null;
    },

    beginBottomPatternEdit: (side) => {
        const stored = useBottomPatternStore.getState().getPattern(side);
        const base = stored ?? committedOrMesh(side);
        if (!base || base.points.length < 4) return;
        useDesignStore.getState().checkpoint("bottom-pattern-edit-begin");
        set({
            editMode: "edit-bottom-pattern",
            target: { type: "insole", side },
            trimlineEdit: null,
            bottomPatternEdit: {
                side,
                draft: cloneTrimline(base),
                snapshot: cloneTrimline(base),
                dragAnchorIndex: null,
                dragStartLocal: null,
                isDragging: false,
            },
        });
    },

    confirmBottomPatternEdit: () => {
        const session = get().bottomPatternEdit;
        if (!session) return;
        useDesignStore.getState().checkpoint("bottom-pattern-edit-confirm");
        useBottomPatternStore.getState().setPattern(session.side, session.draft);
        if (useDesignStore.getState().design.corrections.linked) {
            const other: Side = session.side === "left" ? "right" : "left";
            useBottomPatternStore.getState().setPattern(other, session.draft);
        }
        set({ bottomPatternEdit: null, editMode: "transform" });
    },

    cancelBottomPatternEdit: () => {
        set({ bottomPatternEdit: null, editMode: "transform" });
    },

    setBottomPatternDraft: (points) =>
        set((s) => {
            if (!s.bottomPatternEdit) return s;
            return {
                bottomPatternEdit: {
                    ...s.bottomPatternEdit,
                    draft: { points: points.map((p) => p.clone()) },
                },
            };
        }),

    setBottomPatternDragAnchor: (index, startLocal = null) =>
        set((s) => {
            if (!s.bottomPatternEdit) return s;
            return {
                bottomPatternEdit: {
                    ...s.bottomPatternEdit,
                    dragAnchorIndex: index,
                    dragStartLocal: startLocal ? startLocal.clone() : null,
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
        if (session && session.side === side) return cloneTrimline(session.draft);
        return null;
    },
}));

const OUTLINE_DIRTY_EPS = 1e-4;

/** True when the live draft differs from the session snapshot. */
export function outlineSessionDirty(session: TrimlineEditSession | null): boolean {
    if (!session) return false;
    const draft = session.draft.points;
    const snapshot = session.snapshot.points;
    if (draft.length !== snapshot.length) return true;
    for (let i = 0; i < draft.length; i++) {
        const p = draft[i];
        const q = snapshot[i];
        if (!p || !q) return true;
        if (
            Math.abs(p.x - q.x) > OUTLINE_DIRTY_EPS ||
            Math.abs(p.y - q.y) > OUTLINE_DIRTY_EPS ||
            Math.abs(p.z - q.z) > OUTLINE_DIRTY_EPS
        ) {
            return true;
        }
    }
    return false;
}

/** Active trimline or bottom-pattern session, or null when another tool is active. */
export function activeOutlineSession(): TrimlineEditSession | null {
    const state = useMeshEditStore.getState();
    if (state.editMode === "edit-trimline") return state.trimlineEdit;
    if (state.editMode === "edit-bottom-pattern") return state.bottomPatternEdit;
    return null;
}

/**
 * Leave trimline / bottom-pattern edit.
 * Prompts only when `promptIfDirty` is set and the draft differs from the snapshot.
 * Returns false when the user keeps the session.
 */
export function leaveOutlineEdit(options?: { promptIfDirty?: boolean }): boolean {
    const state = useMeshEditStore.getState();
    const session = activeOutlineSession();
    if (!session) return true;
    if (options?.promptIfDirty && outlineSessionDirty(session)) {
        const tool = state.editMode === "edit-trimline" ? "trimline" : "bottom pattern";
        const confirmed =
            typeof window !== "undefined" && typeof window.confirm === "function"
                ? window.confirm(`Discard unsaved ${tool} changes?`)
                : false;
        if (!confirmed) return false;
    }
    if (state.editMode === "edit-trimline") state.cancelTrimlineEdit();
    else state.cancelBottomPatternEdit();
    return true;
}
