import { create } from "zustand";
import { persist } from "zustand/middleware";
import { serializeTrimlineCurve, type TrimlineCurve } from "@/lib/geometry/trimline";
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
    };
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

    setPattern: (pattern: ScanPattern) => void;
    setMethod: (method: ProductionMethod) => void;
    setThickness: (mm: number) => void;
    setUnit: (unit: Unit) => void;
    setLinked: (linked: boolean) => void;

    /** Patch corrections for a side. When linked, mirrors to the other side. */
    updateCorrection: (side: Side, patch: Partial<SideCorrections>) => void;

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
}

export const useDesignStore = create<DesignStore>()(
    persist(
        (set) => ({
            design: defaultDesign(),
            viewer: { transparent: false, heightmap: false, showLeft: true, showRight: true, view: "iso" },
            selectedElementId: null,
            transformMode: "translate",

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
            setThickness: (thicknessMm) => set((s) => ({ design: { ...s.design, thicknessMm } })),

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
                    const corrections: Corrections = { ...s.design.corrections };
                    corrections[side] = { ...corrections[side], ...patch };
                    if (corrections.linked) {
                        const other: Side = side === "left" ? "right" : "left";
                        corrections[other] = { ...corrections[other], ...patch };
                    }
                    return { design: { ...s.design, corrections } };
                }),

            addElement: (kind, side) =>
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
                    return {
                        design: { ...s.design, elements: [...s.design.elements, el] },
                        selectedElementId: el.id,
                    };
                }),

            addCustomElement: (customElementId, customName, side) =>
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
                    return {
                        design: { ...s.design, elements: [...s.design.elements, el] },
                        selectedElementId: el.id,
                    };
                }),

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

            setBase: (base) =>
                set((s) => ({
                    design: {
                        ...s.design,
                        pattern: "custom",
                        base,
                        customPrefabId: base.assetId,
                        customPrefabName: base.name,
                    },
                })),

            clearBase: () =>
                set((s) => ({
                    design: {
                        ...s.design,
                        pattern: s.design.pattern === "custom" ? "full_contact" : s.design.pattern,
                        base: undefined,
                        customPrefabId: undefined,
                        customPrefabName: undefined,
                    },
                })),

            updateElement: (id, patch) =>
                set((s) => ({
                    design: {
                        ...s.design,
                        elements: s.design.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)),
                    },
                })),

            removeElement: (id) =>
                set((s) => ({
                    design: { ...s.design, elements: s.design.elements.filter((e) => e.id !== id) },
                    selectedElementId: s.selectedElementId === id ? null : s.selectedElementId,
                })),

            selectElement: (selectedElementId) => set({ selectedElementId }),
            setTransformMode: (transformMode) => set({ transformMode }),

            applyPrescription: (result) => {
                usePerformanceStore.getState().setInteracting(true, "ai");
                set((s) => {
                    const corrections: Corrections = {
                        ...s.design.corrections,
                        unit: result.unit ?? s.design.corrections.unit,
                        left: { ...s.design.corrections.left, ...(result.corrections.left ?? {}) },
                        right: { ...s.design.corrections.right, ...(result.corrections.right ?? {}) },
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
                            thicknessMm: result.thicknessMm ?? s.design.thicknessMm,
                            corrections,
                            elements: [...s.design.elements, ...elements],
                        },
                    };
                });
                requestAnimationFrame(() => usePerformanceStore.getState().setInteracting(false));
            },

            loadDesign: (design) => {
                usePerformanceStore.getState().clearAllPreviews();
                useMeshEditStore.getState().cancelTrimlineEdit();
                set({ design, selectedElementId: null });
            },

            setSideTrimline: (side, curve) =>
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
                }),

            clearSideTrimline: (side) =>
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
                }),

            setViewer: (patch) => set((s) => ({ viewer: { ...s.viewer, ...patch } })),
            reset: () => {
                usePerformanceStore.getState().clearAllPreviews();
                useMeshEditStore.getState().cancelTrimlineEdit();
                set({ design: defaultDesign(), selectedElementId: null });
            },
        }),
        {
            name: "vertex-design-session",
            /** Keep live design (incl. trimlines) across page refresh before explicit Save. */
            partialize: (state) => ({ design: state.design }),
        },
    ),
);
