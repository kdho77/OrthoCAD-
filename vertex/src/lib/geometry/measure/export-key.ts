// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { manufacturingFingerprintForActiveExport, orderDownloadSides } from "@/lib/geometry/export-geometry";
import { useBaseOutlineStore } from "@/stores/base-outline-store";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import type { Side } from "@/types";

function xyz(
    points: Array<{ x: number; y: number; z: number }> | undefined,
): Array<[number, number, number]> | null {
    if (!points) return null;
    return points.map((p) => [p.x, p.y, p.z]);
}

function curveKey(side: Side): string {
    const draft = useMeshEditStore.getState().getActiveDraftTrimline(side);
    const stored = useDesignStore.getState().design.trimlines?.[side];
    const bottom = useBottomPatternStore.getState().getPattern(side);
    const bottomDraft = useMeshEditStore.getState().getActiveDraftBottomPattern(side);
    return JSON.stringify({
        draft: xyz(draft?.points),
        stored: xyz(stored),
        bottom: xyz(bottom?.points),
        bottomDraft: xyz(bottomDraft?.points),
    });
}

/**
 * Changes when the manufacturing solid would. The fingerprint covers elements,
 * sinks, trim, and the bottom pattern. Outline edits are appended because they
 * are not all inside that fingerprint.
 */
export function insoleExportRefreshKey(): string {
    const design = useDesignStore.getState().design;
    const sides = orderDownloadSides(design);
    const outlines = useBaseOutlineStore.getState().outlines;
    const outlineKey = Object.keys(outlines)
        .sort()
        .map((id) => {
            const curve = outlines[id];
            return `${id}:${curve?.points.length ?? 0}:${curve?.points[0]?.x ?? 0}`;
        })
        .join(",");
    const parts = sides.map((side) => {
        let fingerprint = "";
        try {
            fingerprint = manufacturingFingerprintForActiveExport(side);
        } catch (error) {
            fingerprint = error instanceof Error ? error.message : "no-fingerprint";
        }
        return `${side}:${fingerprint}:${curveKey(side)}`;
    });
    return `${parts.join("|")}|outline:${outlineKey}|elements:${JSON.stringify(design.elements)}|corrections:${JSON.stringify(design.corrections)}`;
}

export function insoleExportSides(): Side[] {
    return orderDownloadSides(useDesignStore.getState().design);
}
