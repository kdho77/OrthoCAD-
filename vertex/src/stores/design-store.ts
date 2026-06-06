import { create } from "zustand";
import type {
    Corrections,
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

export interface ViewerSettings {
    transparent: boolean;
    heightmap: boolean;
    showLeft: boolean;
    showRight: boolean;
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
    updateCorrection: (
        side: Side,
        patch: Partial<SideCorrections>,
    ) => void;

    addElement: (kind: ElementKind, side: Side) => void;
    updateElement: (id: string, patch: Partial<PlacedElement>) => void;
    removeElement: (id: string) => void;
    selectElement: (id: string | null) => void;
    setTransformMode: (mode: TransformMode) => void;

    /** Atomically apply an AI-parsed prescription to the design. */
    applyPrescription: (result: PrescriptionParseResult) => void;

    setViewer: (patch: Partial<ViewerSettings>) => void;
    reset: () => void;
}

export const useDesignStore = create<DesignStore>((set) => ({
    design: defaultDesign(),
    viewer: { transparent: false, heightmap: false, showLeft: true, showRight: true },
    selectedElementId: null,
    transformMode: "translate",

    setPattern: (pattern) =>
        set((s) => ({ design: { ...s.design, pattern } })),
    setMethod: (method) =>
        set((s) => ({ design: { ...s.design, method } })),
    setThickness: (thicknessMm) =>
        set((s) => ({ design: { ...s.design, thicknessMm } })),

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
            return { design: { ...s.design, elements: [...s.design.elements, el] }, selectedElementId: el.id };
        }),

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

    applyPrescription: (result) =>
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
        }),

    setViewer: (patch) => set((s) => ({ viewer: { ...s.viewer, ...patch } })),
    reset: () => set({ design: defaultDesign(), selectedElementId: null }),
}));
