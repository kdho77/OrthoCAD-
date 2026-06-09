// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { create } from "zustand";
import { detectAllOrphans, type Orphan } from "@/lib/geometry/orphan-detection";
import { getDesignTrimline, type TrimlineCurve } from "@/lib/geometry/trimline";
import { getBaseCacheKey, getDesignBase } from "@/lib/geometry/base-asset";
import { useBaseOutlineStore } from "@/stores/base-outline-store";
import type { Side } from "@/types";
import type { DesignState, PlacedElement, Side } from "@/types";

export interface IssuesStore {
    orphans: Orphan[];
    lastComputedAt: string | null;
    /** Recompute from current design + effective trimlines (draft-aware caller should pass effective). */
    recompute: (design: DesignState, effectiveTrimlines: Partial<Record<Side, TrimlineCurve>>) => void;
    clear: () => void;
}

export const useIssuesStore = create<IssuesStore>((set) => ({
    orphans: [],
    lastComputedAt: null,
    recompute: (design, effectiveTrimlines) => {
        const baseOutlines: Partial<Record<Side, TrimlineCurve>> = {};
        // Best-effort: if a base is active, try to attach its outline for base-feature-orphan checks.
        // Use per-side getDesignBase + getBaseCacheKey so that mirrored stock Left (Phase 2) gets the
        // correct mirrored outline while Right gets the source outline. Falls back gracefully for legacy.
        for (const side of ["left", "right"] as Side[]) {
            const b = getDesignBase(design, side);
            const key = getBaseCacheKey(b) ?? b?.assetId ?? null;
            if (key) {
                const o = useBaseOutlineStore.getState().getOutline(key);
                if (o) baseOutlines[side] = o;
            }
        }
        const orphans = detectAllOrphans(design.elements, effectiveTrimlines, baseOutlines);
        set({ orphans, lastComputedAt: new Date().toISOString() });
    },
    clear: () => set({ orphans: [], lastComputedAt: null }),
}));

/** Convenience: build effective trimlines map preferring any live draft the mesh-edit store would have. */
export function buildEffectiveTrimlines(design: DesignState, getDraft?: (side: Side) => TrimlineCurve | null): Partial<Record<Side, TrimlineCurve>> {
    const out: Partial<Record<Side, TrimlineCurve>> = {};
    for (const side of ["left", "right"] as Side[]) {
        const draft = getDraft ? getDraft(side) : null;
        out[side] = draft ?? getDesignTrimline(design, side) ?? undefined;
    }
    return out;
}
