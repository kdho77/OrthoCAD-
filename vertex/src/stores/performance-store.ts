import { create } from "zustand";
import type { Side, SideCorrections } from "@/types";
import type { PlacedElement } from "@/types";

export type InteractionSource = "slider" | "gizmo" | "ai" | null;

/** Transient preview state — merged at geometry-build time, committed on pointer-up. */
export interface ElementPreview {
    id: string;
    position?: { x: number; y: number };
    rotationDeg?: number;
    scale?: { x: number; y: number };
    heightMm?: number;
}

export interface PerformanceStore {
    /** True while sliders/gizmos are actively dragged. */
    interacting: boolean;
    interactionSource: InteractionSource;
    showPerformanceMonitor: boolean;

    /** Live correction preview (not yet committed to design store). */
    correctionPreview: Partial<Record<Side, Partial<SideCorrections>>>;
    thicknessPreview: number | null;

    /** Element transform preview during gizmo drag. */
    elementPreviews: Record<string, ElementPreview>;

    setInteracting: (active: boolean, source?: InteractionSource) => void;
    setShowPerformanceMonitor: (show: boolean) => void;
    setCorrectionPreview: (side: Side, patch: Partial<SideCorrections>) => void;
    clearCorrectionPreview: () => void;
    setThicknessPreview: (mm: number | null) => void;
    setElementPreview: (id: string, patch: ElementPreview) => void;
    clearElementPreview: (id: string) => void;
    clearAllPreviews: () => void;
}

export const usePerformanceStore = create<PerformanceStore>((set) => ({
    interacting: false,
    interactionSource: null,
    showPerformanceMonitor: false,
    correctionPreview: {},
    thicknessPreview: null,
    elementPreviews: {},

    setInteracting: (interacting, source = null) =>
        set({ interacting, interactionSource: interacting ? source : null }),

    setShowPerformanceMonitor: (showPerformanceMonitor) => set({ showPerformanceMonitor }),

    setCorrectionPreview: (side, patch) =>
        set((s) => ({
            correctionPreview: {
                ...s.correctionPreview,
                [side]: { ...s.correctionPreview[side], ...patch },
            },
        })),

    clearCorrectionPreview: () => set({ correctionPreview: {}, thicknessPreview: null }),

    setThicknessPreview: (thicknessPreview) => set({ thicknessPreview }),

    setElementPreview: (id, patch) =>
        set((s) => ({
            elementPreviews: {
                ...s.elementPreviews,
                [id]: { ...s.elementPreviews[id], ...patch, id },
            },
        })),

    clearElementPreview: (id) =>
        set((s) => {
            const { [id]: _, ...rest } = s.elementPreviews;
            return { elementPreviews: rest };
        }),

    clearAllPreviews: () =>
        set({ correctionPreview: {}, thicknessPreview: null, elementPreviews: {} }),
}));

/** Merge design-store elements with live gizmo previews. */
export function mergeElementPreviews(elements: PlacedElement[]): PlacedElement[] {
    const previews = usePerformanceStore.getState().elementPreviews;
    if (Object.keys(previews).length === 0) return elements;
    return elements.map((el) => {
        const p = previews[el.id];
        if (!p) return el;
        return {
            ...el,
            ...(p.position ? { position: p.position } : {}),
            ...(p.rotationDeg !== undefined ? { rotationDeg: p.rotationDeg } : {}),
            ...(p.scale ? { scale: p.scale } : {}),
            ...(p.heightMm !== undefined ? { heightMm: p.heightMm } : {}),
        };
    });
}

/** Merge committed corrections with slider preview patches. */
export function mergeCorrections(
    side: Side,
    committed: SideCorrections,
): SideCorrections {
    const preview = usePerformanceStore.getState().correctionPreview[side];
    return preview ? { ...committed, ...preview } : committed;
}
