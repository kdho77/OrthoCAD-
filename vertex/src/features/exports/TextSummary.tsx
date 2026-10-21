// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { hasActiveTextMarking } from "@/lib/geometry/text-marking/constants";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";
import type { TextMarking } from "@/types";
import { TextFitList } from "./TextMarkingPanel";

export function textSummaryLine(marking: TextMarking): string {
    const place =
        marking.surface === "bottom" ? "bottom" : marking.surface === "medial" ? "inner side" : "outer side";
    const mode = marking.mode === "emboss" ? "embossed" : "engraved";
    const depth = marking.mode === "emboss" ? marking.heightMm : marking.depthMm;
    const quote = marking.differentOnLR
        ? `L "${marking.textLeft}" / R "${marking.textRight}"`
        : `"${marking.text}"`;
    return `Text: ${quote}, ${place}, ${mode} ${depth.toFixed(1)} mm`;
}

/** Print / Mill and Export. Edit returns to the Elements text control. */
export function TextSummary() {
    const marking = useDesignStore((s) => s.design.textMarking);
    const openTextEditor = useClinicalWorkflowStore((s) => s.openTextEditor);
    if (!marking || !hasActiveTextMarking(marking)) return null;
    return (
        <div className="rounded-md border border-border bg-background/50 px-2 py-2 text-xs">
            <p className="text-foreground">{textSummaryLine(marking)}</p>
            <button
                type="button"
                className="mt-1 text-[11px] font-medium text-primary underline-offset-2 hover:underline"
                onClick={() => openTextEditor()}
            >
                Edit
            </button>
            <TextFitList />
        </div>
    );
}
