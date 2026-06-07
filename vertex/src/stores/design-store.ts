import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
    constrainSideCorrections,
    type ConstraintViolation,
} from "@/lib/geometry/clinical-constraints";
import { serializeTrimlineCurve, type TrimlineCurve } from "@/lib/geometry/trimline";
import { buildEffectiveTrimlines } from "@/stores/issues-store";
import { useIssuesStore } from "@/stores/issues-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import { usePerformanceStore } from "@/stores/performance-store";
import type {
    Corrections,
    DesignBase,
    DesignState,
    ElementKind,
    PlacedElement,
    PrescriptionParseResult,
    ProductionMethod,
    ScanPattern,
    Side,
    SideCorrections,
    Unit,
    WedgeCorrection,
} from "@/types";

function defaultSideCorrections(): SideCorrections {
    return {
        forefootPostingDeg: 0,
        rearfootPostingDeg: 0,
        medialSkiveMm: 0,
        lateralSkiveMm: 0,
        archFillMm: 0,
        archHeightMm: 0,
        heelCupDepthMm: 0,
        heelCupHeightMm: 0,
        apexMoveMm: 0,
        medialFlangeMm: 0,
        lateralFlangeMm: 0,
        // rearfootWedge and forefootWedge intentionally omitted (undefined = no wedge)
        // as per wedge system design for default/neutral state.
    };
}

/**
 * Store-level enforcement of mutual exclusion for wedges.
 * Per refined design: only one wedge type (medial or lateral) per zone.
 * Since the data model uses a single optional WedgeCorrection object per zone (rearfootWedge / forefootWedge),
 * "both" is not possible via normal setters. This defensive normalizer ensures that if a patch
 * somehow sets conflicting state (e.g. from bad external data), we prefer the patch's value or clear.
 * Called from updateCorrection.
 */
function enforceWedgeMutualExclusion(corrections: Corrections): Corrections {
    const newCorrections = { ...corrections };
    // For each side, if both wedge fields were somehow present in a way that conflicts (not typical),
    // but since they are different zones, no conflict between rear and fore.
    // The exclusion is per-zone (one side choice). Nothing to "clear" here beyond what the object model provides.
    // This function is a hook for future if we change model; currently structural.
    // For safety, ensure undefined for absent.
    if (!newCorrections.left.rearfootWedge) delete (newCorrections.left as any).rearfootWedge;
    if (!newCorrections.left.forefootWedge) delete (newCorrections.left as any).forefootWedge;
    if (!newCorrections.right.rearfootWedge) delete (newCorrections.right as any).rearfootWedge;
    if (!newCorrections.right.forefootWedge) delete (newCorrections.right as any).forefootWedge;
    return newCorrections;
}

export function defaultDesign(): DesignState {
    return {
        pattern: "full_contact",
        method: "printing_solid",
        thicknessMm: 3,
        corrections: {
            unit: "mm",
            linked: true,
            left: defaultSideCorrections(),
            right: defaultSideCorrections(),
        },
        elements: [],
    };
}

/** Named camera viewpoints. Orthographic-style views drive trimline planar constraint. */
export type CameraView = "iso" | "front" | "back" | "left" | "right" | "top" | "bottom";

export interface ViewerSettings {
    transparent: boolean;
    heightmap: boolean;
    showLeft: boolean;
    showRight: boolean;
    /** Active named camera view (for UI + planar editing constraint). */
    view: CameraView;
}

export type TransformMode = "translate" | "rotate" | "scale";

export interface DesignStore {
    design: DesignState;
    viewer: ViewerSettings;
    selectedElementId: string | null;
    transformMode: TransformMode;

    /** Undo stack (most recent first). Session-only, not persisted to localStorage. */
    history: DesignState[];
    /** Redo stack. Cleared on new mutations. */
    future: DesignState[];

    setPattern: (pattern: ScanPattern) => void;
    setMethod: (method: ProductionMethod) => void;
    setThickness: (mm: number) => void;
    setUnit: (unit: Unit) => void;
    setLinked: (linked: boolean) => void;

    /** Patch corrections for a side. When linked, mirrors to the other side. */
    updateCorrection: (side: Side, patch: Partial<SideCorrections>) => void;

    /** Live production constraint violations for the current design (derived). */
    getActiveViolations: () => ConstraintViolation[];

    addElement: (kind: ElementKind, side: Side) => void;
    addCustomElement: (customElementId: string, customName: string, side: Side) => void;
    updateElement: (id: string, patch: Partial<PlacedElement>) => void;
    removeElement: (id: string) => void;
    selectElement: (id: string | null) => void;
    setTransformMode: (mode: TransformMode) => void;
    setCustomPrefab: (customPrefabId: string, customPrefabName: string) => void;

    /** Set the base template the design starts from (Base + Modifier model). */
    setBase: (base: DesignBase) => void;
    /** Remove the base template and revert to full parametric generation. */
    clearBase: () => void;

    /** Atomically apply an AI-parsed prescription to the design. */
    applyPrescription: (result: PrescriptionParseResult) => void;

    /** Replace the entire design (used when opening a saved design). */
    loadDesign: (design: DesignState) => void;

    /** Persist a confirmed trimline curve for one foot side. */
    setSideTrimline: (side: Side, curve: TrimlineCurve | null) => void;
    /** Remove custom trimline for one side (revert to parametric outline). */
    clearSideTrimline: (side: Side) => void;

    setViewer: (patch: Partial<ViewerSettings>) => void;
    reset: () => void;

    /** Push a snapshot of the current design onto the undo stack (clears future). */
    checkpoint: (label?: string) => void;
    undo: () => void;
    redo: () => void;
    canUndo: () => boolean;
    canRedo: () => boolean;
    /** Clear history (call after explicit server Save or when starting a brand new clinical case). */
    clearHistory: () => void;

    /** Set or clear rearfoot wedge (mutual exclusion per zone is by using a single WedgeCorrection object or undefined). */
    setRearfootWedge: (side: Side, wedge: WedgeCorrection | undefined) => void;
    /** Set or clear forefoot wedge (mutual exclusion per zone is by using a single WedgeCorrection object or undefined). */
    setForefootWedge: (side: Side, wedge: WedgeCorrection | undefined) => void;
}

export const useDesignStore = create<DesignStore>()(
    persist(
        (set, get) => ({
            design: defaultDesign(),
            viewer: { transparent: false, heightmap: false, showLeft: true, showRight: true, view: "iso" },
            selectedElementId: null,
            transformMode: "translate",
            history: [],
            future: [],

            setPattern: (pattern) =>
                set((s) => ({
                    design: {
                        ...s.design,
                        pattern,
                        ...(pattern === "custom"
                            ? {}
                            : { customPrefabId: undefined, customPrefabName: undefined, base: undefined }),
                    },
                })),
            setMethod: (method) => set((s) => ({ design: { ...s.design, method } })),
            setThickness: (thicknessMm) =>
                set((s) => {
                    const left = s.design.corrections.left;
                    const right = s.design.corrections.right;
                    const linked = s.design.corrections.linked;
                    // Use constrain on a representative side for thickness decision, then re-apply full.
                    const rep = constrainSideCorrections(left, thicknessMm);
                    const safeThickness = rep.thicknessMm;
                    // Re-clamp both sides against the (possibly reduced) thickness.
                    const r1 = constrainSideCorrections(left, safeThickness);
                    const r2 = constrainSideCorrections(right, safeThickness);
                    const nextLeft = r1.constrained;
                    const nextRight = linked ? r1.constrained : r2.constrained;
                    return {
                        design: {
                            ...s.design,
                            thicknessMm: safeThickness,
                            corrections: {
                                ...s.design.corrections,
                                left: nextLeft,
                                right: nextRight,
                            },
                        },
                    };
                }),

            setUnit: (unit) =>
                set((s) => ({
                    design: { ...s.design, corrections: { ...s.design.corrections, unit } },
                })),
            setLinked: (linked) =>
                set((s) => ({
                    design: { ...s.design, corrections: { ...s.design.corrections, linked } },
                })),

            updateCorrection: (side, patch) =>
                set((s) => {
                    let corrections: Corrections = { ...s.design.corrections };
                    corrections[side] = { ...corrections[side], ...patch };
                    if (corrections.linked) {
                        const other: Side = side === "left" ? "right" : "left";
                        corrections[other] = { ...corrections[other], ...patch };
                    }
                    // Enforce mutual exclusion for wedges at store level: a zone can have at most one wedge object.
                    // Structural (single field per zone), but defensively clear the other if a bad patch tries both (shouldn't happen via UI).
                    // Here we just ensure only one is set per zone in the patch; the model prevents "both medial and lateral" simultaneously.
                    corrections = enforceWedgeMutualExclusion(corrections);

                    // Apply clinical constraints (clamps + combined wall/arch guards).
                    // Note: wedge objects (if present in patch) are clamped inside constrainSideCorrections
                    // (value clamped per unit; mutual exclusion is structural: one WedgeCorrection per zone).
                    const { constrained: safeLeft, thicknessMm: t1 } = constrainSideCorrections(
                        corrections.left,
                        s.design.thicknessMm,
                    );
                    const { constrained: safeRight } = constrainSideCorrections(corrections.right, t1);
                    const finalLeft = safeLeft;
                    const finalRight = corrections.linked ? safeLeft : safeRight;
                    return {
                        design: {
                            ...s.design,
                            thicknessMm: t1,
                            corrections: {
                                ...corrections,
                                left: finalLeft,
                                right: finalRight,
                            },
                        },
                    };
                }),

            /** Set or clear the rearfoot wedge for a side (enforces one choice per zone via the single object). */
            setRearfootWedge: (side, wedge) =>
                set((s) => {
                    const patch = { rearfootWedge: wedge } as Partial<SideCorrections>;
                    const corrections: Corrections = { ...s.design.corrections };
                    corrections[side] = { ...corrections[side], ...patch };
                    if (corrections.linked) {
                        const other: Side = side === "left" ? "right" : "left";
                        corrections[other] = { ...corrections[other], ...patch };
                    }
                    const { constrained: safeLeft, thicknessMm: t1 } = constrainSideCorrections(
                        corrections.left,
                        s.design.thicknessMm,
                    );
                    const { constrained: safeRight } = constrainSideCorrections(corrections.right, t1);
                    const finalLeft = safeLeft;
                    const finalRight = corrections.linked ? safeLeft : safeRight;
                    return {
                        design: {
                            ...s.design,
                            thicknessMm: t1,
                            corrections: {
                                ...corrections,
                                left: finalLeft,
                                right: finalRight,
                            },
                        },
                    };
                }),

            /** Set or clear the forefoot wedge for a side (enforces one choice per zone via the single object). */
            setForefootWedge: (side, wedge) =>
                set((s) => {
                    const patch = { forefootWedge: wedge } as Partial<SideCorrections>;
                    const corrections: Corrections = { ...s.design.corrections };
                    corrections[side] = { ...corrections[side], ...patch };
                    if (corrections.linked) {
                        const other: Side = side === "left" ? "right" : "left";
                        corrections[other] = { ...corrections[other], ...patch };
                    }
                    const { constrained: safeLeft, thicknessMm: t1 } = constrainSideCorrections(
                        corrections.left,
                        s.design.thicknessMm,
                    );
                    const { constrained: safeRight } = constrainSideCorrections(corrections.right, t1);
                    const finalLeft = safeLeft;
                    const finalRight = corrections.linked ? safeLeft : safeRight;
                    return {
                        design: {
                            ...s.design,
                            thicknessMm: t1,
                            corrections: {
                                ...corrections,
                                left: finalLeft,
                                right: finalRight,
                            },
                        },
                    };
                }),

            addElement: (kind, side) => {
                get().checkpoint("add-element");
                set((s) => {
                    const el: PlacedElement = {
                        id: crypto.randomUUID(),
                        kind,
                        side,
                        position: { x: 0, y: 0 },
                        rotationDeg: 0,
                        scale: { x: 1, y: 1 },
                        heightMm: 4,
                    };
                    const next = { ...s.design, elements: [...s.design.elements, el] };
                    const eff = buildEffectiveTrimlines(next);
                    useIssuesStore.getState().recompute(next, eff);
                    return { design: next, selectedElementId: el.id };
                });
            },

            addCustomElement: (customElementId, customName, side) => {
                get().checkpoint("add-custom-element");
                set((s) => {
                    const el: PlacedElement = {
                        id: crypto.randomUUID(),
                        kind: "custom",
                        customElementId,
                        customName,
                        side,
                        position: { x: 0, y: 0 },
                        rotationDeg: 0,
                        scale: { x: 1, y: 1 },
                        heightMm: 4,
                    };
                    const next = { ...s.design, elements: [...s.design.elements, el] };
                    const eff = buildEffectiveTrimlines(next);
                    useIssuesStore.getState().recompute(next, eff);
                    return { design: next, selectedElementId: el.id };
                });
            },

            setCustomPrefab: (customPrefabId, customPrefabName) =>
                set((s) => ({
                    design: {
                        ...s.design,
                        pattern: "custom",
                        customPrefabId,
                        customPrefabName,
                        // Keep the canonical base in sync so modifiers apply to it.
                        base: { assetId: customPrefabId, name: customPrefabName, source: "custom" },
                    },
                })),

            setBase: (base) => {
                const snap = get().design;
                set((s) => ({
                    design: {
                        ...s.design,
                        pattern: "custom",
                        base,
                        customPrefabId: base.assetId,
                        customPrefabName: base.name,
                    },
                }));
                // Only checkpoint if something actually changed (base switch is a big clinical action).
                if (snap.base?.assetId !== base.assetId) get().checkpoint("set-base");
            },

            clearBase: () => {
                const hadBase = !!get().design.base;
                set((s) => ({
                    design: {
                        ...s.design,
                        pattern: s.design.pattern === "custom" ? "full_contact" : s.design.pattern,
                        base: undefined,
                        customPrefabId: undefined,
                        customPrefabName: undefined,
                    },
                }));
                if (hadBase) get().checkpoint("clear-base");
            },

            updateElement: (id, patch) =>
                set((s) => {
                    const nextElements = s.design.elements.map((e) => (e.id === id ? { ...e, ...patch } : e));
                    const next = { ...s.design, elements: nextElements };
                    // Recompute orphans when an element moves/scales (common source of "outside trimline").
                    const eff = buildEffectiveTrimlines(next);
                    useIssuesStore.getState().recompute(next, eff);
                    return { design: next };
                }),

            removeElement: (id) => {
                get().checkpoint("remove-element");
                set((s) => {
                    const nextElements = s.design.elements.filter((e) => e.id !== id);
                    const next = { ...s.design, elements: nextElements };
                    const eff = buildEffectiveTrimlines(next);
                    useIssuesStore.getState().recompute(next, eff);
                    return {
                        design: next,
                        selectedElementId: s.selectedElementId === id ? null : s.selectedElementId,
                    };
                });
            },

            selectElement: (selectedElementId) => set({ selectedElementId }),
            setTransformMode: (transformMode) => set({ transformMode }),

            applyPrescription: (result) => {
                usePerformanceStore.getState().setInteracting(true, "ai");
                set((s) => {
                    const baseThickness = result.thicknessMm ?? s.design.thicknessMm;
                    const baseLeft = { ...s.design.corrections.left, ...(result.corrections.left ?? {}) };
                    const baseRight = { ...s.design.corrections.right, ...(result.corrections.right ?? {}) };
                    // Clamp AI output immediately — parsed prescriptions can be aggressive.
                    const r1 = constrainSideCorrections(baseLeft, baseThickness);
                    const r2 = constrainSideCorrections(baseRight, r1.thicknessMm);
                    const corrections: Corrections = {
                        ...s.design.corrections,
                        unit: result.unit ?? s.design.corrections.unit,
                        left: r1.constrained,
                        right: s.design.corrections.linked ? r1.constrained : r2.constrained,
                    };
                    const elements: PlacedElement[] = result.elements.map((e) => ({
                        id: crypto.randomUUID(),
                        kind: e.kind,
                        side: e.side,
                        position: { x: 0, y: 0 },
                        rotationDeg: 0,
                        scale: { x: 1, y: 1 },
                        heightMm: 4,
                    }));
                    return {
                        design: {
                            ...s.design,
                            pattern: result.pattern ?? s.design.pattern,
                            method: result.method ?? s.design.method,
                            thicknessMm: r1.thicknessMm,
                            corrections,
                            elements: [...s.design.elements, ...elements],
                        },
                    };
                });
                requestAnimationFrame(() => usePerformanceStore.getState().setInteracting(false));
            },

            loadDesign: (incoming) => {
                usePerformanceStore.getState().clearAllPreviews();
                useMeshEditStore.getState().cancelTrimlineEdit();
                useIssuesStore.getState().clear();
                get().clearHistory(); // Loaded design becomes the new undo root.
                // Sanitize on load so persisted or imported designs are always valid.
                const r = constrainSideCorrections(incoming.corrections.left, incoming.thicknessMm);
                const r2 = constrainSideCorrections(incoming.corrections.right, r.thicknessMm);
                const safeDesign: DesignState = {
                    ...incoming,
                    thicknessMm: r.thicknessMm,
                    corrections: {
                        ...incoming.corrections,
                        left: r.constrained,
                        right: incoming.corrections.linked ? r.constrained : r2.constrained,
                    },
                };
                const eff = buildEffectiveTrimlines(safeDesign);
                useIssuesStore.getState().recompute(safeDesign, eff);
                set({ design: safeDesign, selectedElementId: null });
            },

            setSideTrimline: (side, curve) => {
                get().checkpoint("set-trimline");
                set((s) => {
                    const trimlines = { ...s.design.trimlines };
                    if (curve && curve.points.length >= 4) {
                        trimlines[side] = serializeTrimlineCurve(curve);
                    } else {
                        delete trimlines[side];
                    }
                    return {
                        design: {
                            ...s.design,
                            trimlines: Object.keys(trimlines).length > 0 ? trimlines : undefined,
                        },
                    };
                });
            },

            clearSideTrimline: (side) => {
                if (!get().design.trimlines?.[side]) return;
                get().checkpoint("clear-trimline");
                set((s) => {
                    if (!s.design.trimlines?.[side]) return s;
                    const trimlines = { ...s.design.trimlines };
                    delete trimlines[side];
                    return {
                        design: {
                            ...s.design,
                            trimlines: Object.keys(trimlines).length > 0 ? trimlines : undefined,
                        },
                    };
                });
            },

            setViewer: (patch) => set((s) => ({ viewer: { ...s.viewer, ...patch } })),
            reset: () => {
                usePerformanceStore.getState().clearAllPreviews();
                useMeshEditStore.getState().cancelTrimlineEdit();
                useIssuesStore.getState().clear();
                get().clearHistory();
                const d = defaultDesign();
                set({ design: d, selectedElementId: null });
                // No orphans on a fresh default.
            },

            getActiveViolations: () => {
                const d = useDesignStore.getState().design;
                const r1 = constrainSideCorrections(d.corrections.left, d.thicknessMm);
                const r2 = constrainSideCorrections(d.corrections.right, r1.thicknessMm);
                // Dedup combined messages for UI brevity.
                const seen = new Set<string>();
                const all = [...r1.violations, ...r2.violations].filter((vi) => {
                    const key = `${vi.field}:${vi.message}`;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
                return all;
            },

            checkpoint: (label?: string) => {
                const current = get().design;
                const snap: DesignState = JSON.parse(JSON.stringify(current));
                // Phase 5: bump a simple design version for audit/versioned history.
                (snap as any).designVersion = ((snap as any).designVersion ?? 0) + 1;
                set((s) => ({
                    history: [snap, ...s.history].slice(0, 40),
                    future: [],
                }));
                // Also record in the client audit trail (pairs with server audit_logs in Phase 5).
                try {
                    // Lazy to avoid circular import at module top level.
                    import("@/stores/audit-store").then(({ useAuditStore }) => {
                        useAuditStore.getState().record("design_saved", `checkpoint${label ? ":" + label : ""} v${(snap as any).designVersion}`);
                    });
                } catch {}
            },

            undo: () => {
                const s = get();
                if (s.history.length === 0) return;
                const [prev, ...rest] = s.history;
                const currentSnap: DesignState = JSON.parse(JSON.stringify(s.design));
                // Restore previous and push current onto future for redo.
                usePerformanceStore.getState().clearAllPreviews();
                useMeshEditStore.getState().cancelTrimlineEdit();
                useIssuesStore.getState().clear();
                const eff = buildEffectiveTrimlines(prev);
                useIssuesStore.getState().recompute(prev, eff);
                set({
                    design: prev,
                    history: rest,
                    future: [currentSnap, ...s.future].slice(0, 40),
                    selectedElementId: null,
                });
            },

            redo: () => {
                const s = get();
                if (s.future.length === 0) return;
                const [next, ...restFuture] = s.future;
                const currentSnap: DesignState = JSON.parse(JSON.stringify(s.design));
                usePerformanceStore.getState().clearAllPreviews();
                useMeshEditStore.getState().cancelTrimlineEdit();
                useIssuesStore.getState().clear();
                const eff = buildEffectiveTrimlines(next);
                useIssuesStore.getState().recompute(next, eff);
                set({
                    design: next,
                    history: [currentSnap, ...s.history].slice(0, 40),
                    future: restFuture,
                    selectedElementId: null,
                });
            },

            canUndo: () => get().history.length > 0,
            canRedo: () => get().future.length > 0,

            clearHistory: () => set({ history: [], future: [] }),
        }),
        {
            name: "vertex-design-session",
            /** Keep live design (incl. trimlines) across page refresh before explicit Save. */
            partialize: (state) => ({ design: state.design }),
        },
    ),
);
