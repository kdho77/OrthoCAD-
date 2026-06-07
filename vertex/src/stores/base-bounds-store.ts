// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { create } from "zustand";
import type { BaseBounds } from "@/lib/geometry/base-bounds";

/**
 * Cached BaseBounds (rich silhouette + clinical zoning + safe margins) for
 * loaded base templates. Populated when a base GLB is first used for geometry.
 * Phase 3A consumers: trimline edit seeding, orphan detection, future drag
 * constraint and 3B base sewing registration.
 */
export interface BaseBoundsStore {
    bounds: Record<string, BaseBounds>;
    setBounds: (assetId: string, b: BaseBounds) => void;
    getBounds: (assetId: string) => BaseBounds | null;
    /** Remove a single entry (e.g. after library delete). */
    remove: (assetId: string) => void;
}

export const useBaseBoundsStore = create<BaseBoundsStore>((set, get) => ({
    bounds: {},
    setBounds: (assetId, b) => set((s) => ({ bounds: { ...s.bounds, [assetId]: b } })),
    getBounds: (assetId) => get().bounds[assetId] ?? null,
    remove: (assetId) =>
        set((s) => {
            const { [assetId]: _, ...rest } = s.bounds;
            return { bounds: rest };
        }),
}));
