// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { create } from "zustand";
import { detectAllOrphans, type Orphan } from "@/lib/geometry/orphan-detection";
import { getDesignTrimline, type TrimlineCurve } from "@/lib/geometry/trimline";
import { useBaseOutlineStore } from "@/stores/base-outline-store";
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
        // Callers that have the assetId can pre-populate; here we read the outline store.
        const baseId = (design.base?.assetId ?? design.customPrefabId) || null;
        if (baseId) {
            const o = useBaseOutlineStore.getState().getOutline(baseId);
            if (o) {
                baseOutlines.left = o;
                baseOutlines.right = o; // outline is side-agnostic in raw frame
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
