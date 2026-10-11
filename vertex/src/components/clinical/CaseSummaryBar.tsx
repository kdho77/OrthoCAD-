// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    formatUsShoeSizeLabel,
    insoleLayoutFromDesign,
    normalizeShoeSizeSystem,
} from "@/lib/geometry/shoe-size";
import { normalizeShoeWidth, SHOE_WIDTH_LABELS } from "@/lib/geometry/shoe-width";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";

const METHOD_LABEL: Record<string, string> = {
    printing_solid: "Printing solid",
    printing_shell: "Printing shell",
    milling_3axis: "Milling 3-axis",
};

const PATTERN_LABEL: Record<string, string> = {
    full_contact: "Full Contact",
    prefab_3d: "Prefab 3D",
    flat: "Flat",
    custom: "Custom",
};

export function CaseSummaryBar() {
    const design = useDesignStore((s) => s.design);
    const setStep = useClinicalWorkflowStore((s) => s.setStep);
    const layout = insoleLayoutFromDesign(design);
    const width = normalizeShoeWidth(design.shoeWidth);
    const system = normalizeShoeSizeSystem(design.sizeSystem);
    const size =
        system === "uk"
            ? `UK ${design.ukSize ?? layout.ukSize}`
            : system === "mm"
              ? `${layout.footLengthMm.toFixed(0)} mm`
              : formatUsShoeSizeLabel(layout.usMenSize);

    const parts: Array<{ label: string; step: "setup" | "base" }> = [
        { label: size, step: "setup" },
        { label: SHOE_WIDTH_LABELS[width], step: "setup" },
        { label: METHOD_LABEL[design.method] ?? design.method, step: "setup" },
        { label: PATTERN_LABEL[design.pattern] ?? design.pattern, step: "base" },
    ];

    return (
        <div className="flex flex-wrap items-center gap-1 border-b border-border bg-background px-3 py-1 text-[11px]">
            {parts.map((p, i) => (
                <span key={`${p.step}-${p.label}`} className="flex items-center gap-1">
                    {i > 0 ? <span className="text-muted-foreground">·</span> : null}
                    <button
                        type="button"
                        onClick={() => setStep(p.step)}
                        className="text-foreground underline-offset-2 hover:underline"
                    >
                        {p.label}
                    </button>
                </span>
            ))}
        </div>
    );
}
