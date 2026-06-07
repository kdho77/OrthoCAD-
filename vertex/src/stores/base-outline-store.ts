// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { create } from "zustand";
import { cloneTrimline, type TrimlineCurve } from "@/lib/geometry/trimline";

/**
 * Outlines derived from loaded base meshes, keyed by the base asset id. Computed
 * once when a base GLB is loaded (see `useBaseInsoleGeometry`) and read by the
 * trimline system so editing a base starts from an outline that follows the real
 * mesh boundary instead of the parametric default. The outline lives in the base
 * mesh's raw footprint frame, so it lines up with how the base is rendered for
 * both sides (the side only changes the group offset, not the raw coordinates).
 */
export interface BaseOutlineStore {
    outlines: Record<string, TrimlineCurve>;
    setOutline: (assetId: string, curve: TrimlineCurve) => void;
    getOutline: (assetId: string) => TrimlineCurve | null;
}

export const useBaseOutlineStore = create<BaseOutlineStore>((set, get) => ({
    outlines: {},
    setOutline: (assetId, curve) =>
        set((s) => ({ outlines: { ...s.outlines, [assetId]: cloneTrimline(curve) } })),
    getOutline: (assetId) => get().outlines[assetId] ?? null,
}));
