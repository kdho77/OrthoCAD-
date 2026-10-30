// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { formatHalfSize, insoleLayoutFromDesign, normalizeShoeSizeSystem } from "@/lib/geometry/shoe-size";
import { formatShoeWidthSummary } from "@/lib/geometry/shoe-width";
import type { ClinicalStepId } from "@/stores/clinical-workflow-store";
import type { DesignState } from "@/types";

export const CASE_METHOD_LABEL: Record<string, string> = {
    printing_solid: "Printing solid",
    printing_shell: "Printing shell",
    milling_3axis: "Milling 3-axis",
};

export const CASE_PATTERN_LABEL: Record<string, string> = {
    full_contact: "Full Contact",
    prefab_3d: "Prefab 3D",
    flat: "Flat",
    custom: "Custom",
};

export interface CaseSummaryPart {
    id: "size" | "width" | "method" | "pattern";
    title: string;
    label: string;
    step: Extract<ClinicalStepId, "setup" | "base">;
}

export function caseSizeLabel(design: DesignState): string {
    const layout = insoleLayoutFromDesign(design);
    const system = normalizeShoeSizeSystem(design.sizeSystem);
    if (system === "uk") return `UK ${design.ukSize ?? layout.ukSize}`;
    if (system === "mm") return `${layout.footLengthMm.toFixed(0)} mm`;
    return `US M${formatHalfSize(layout.usMenSize)}`;
}

export function caseSummaryParts(design: DesignState): CaseSummaryPart[] {
    return [
        { id: "size", title: "Size", label: caseSizeLabel(design), step: "setup" },
        { id: "width", title: "Width", label: formatShoeWidthSummary(design), step: "setup" },
        {
            id: "method",
            title: "Method",
            label: CASE_METHOD_LABEL[design.method] ?? design.method,
            step: "setup",
        },
        {
            id: "pattern",
            title: "Pattern",
            label: CASE_PATTERN_LABEL[design.pattern] ?? design.pattern,
            step: "base",
        },
    ];
}

/** e.g. "US M9 · Wide · Printing solid · Full Contact" */
export function formatCaseSummaryLine(design: DesignState): string {
    return caseSummaryParts(design)
        .map((p) => p.label)
        .join(" · ");
}
