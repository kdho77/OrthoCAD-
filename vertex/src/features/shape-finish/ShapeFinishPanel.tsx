// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Link2, Unlink } from "lucide-react";
import { SliderField } from "@/components/ui/slider-field";
import {
    getSideShapeFinish,
    SHAPE_FINISH_DEFAULTS,
    shapeFinishQcLines,
} from "@/lib/geometry/shape-finish-modifiers";
import { cn } from "@/lib/utils";
import { useDesignStore } from "@/stores/design-store";
import type { ArchSkiveSide, Side } from "@/types";

const SIDE_LABELS: Record<Side, string> = { left: "Left", right: "Right" };

const ARCH_SKIVE_SIDES: { value: ArchSkiveSide; label: string }[] = [
    { value: "medial", label: "Medial" },
    { value: "lateral", label: "Lateral" },
    { value: "central", label: "Central" },
];

export function ShapeFinishPanel() {
    const design = useDesignStore((s) => s.design);
    const exportSide = useDesignStore((s) => s.exportSide);
    const updateShapeFinish = useDesignStore((s) => s.updateShapeFinish);
    const setShapeFinishLinked = useDesignStore((s) => s.setShapeFinishLinked);
    const linked = design.shapeFinish?.linked ?? true;
    const side = exportSide;
    const sf = getSideShapeFinish(design, side);
    const corr = design.corrections[side];
    const qc = shapeFinishQcLines(side, sf, {
        medial: corr.medialSkiveMm,
        lateral: corr.lateralSkiveMm,
    });

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Shape / Finish</h3>
                <button
                    type="button"
                    className={cn(
                        "inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted",
                    )}
                    onClick={() => setShapeFinishLinked(!linked)}
                    aria-label={linked ? "Unlink L/R shape finish" : "Link L/R shape finish"}
                >
                    {linked ? <Link2 className="h-3.5 w-3.5" /> : <Unlink className="h-3.5 w-3.5" />}
                    {linked ? "L/R linked" : SIDE_LABELS[side]}
                </button>
            </div>

            <SliderField
                label="Top cover accommodate"
                value={sf.topCoverAccommodateMm}
                min={SHAPE_FINISH_DEFAULTS.topCoverAccommodateMm.min}
                max={SHAPE_FINISH_DEFAULTS.topCoverAccommodateMm.max}
                step={0.1}
                unit="mm"
                onChange={(v) => updateShapeFinish(side, { topCoverAccommodateMm: v })}
            />

            <label className="flex items-center justify-between gap-2 text-xs">
                <span>Trimmable forefoot</span>
                <input
                    type="checkbox"
                    checked={sf.trimmableForefoot}
                    onChange={(e) => updateShapeFinish(side, { trimmableForefoot: e.target.checked })}
                />
            </label>
            {sf.trimmableForefoot ? (
                <SliderField
                    label="Extra distal"
                    value={sf.trimmableForefootExtraMm}
                    min={SHAPE_FINISH_DEFAULTS.trimmableForefootExtraMm.min}
                    max={SHAPE_FINISH_DEFAULTS.trimmableForefootExtraMm.max}
                    step={0.5}
                    unit="mm"
                    onChange={(v) => updateShapeFinish(side, { trimmableForefootExtraMm: v })}
                />
            ) : null}

            <SliderField
                label="Arch grind depth (plantar)"
                value={sf.archGrindDepthMm}
                min={SHAPE_FINISH_DEFAULTS.archGrindDepthMm.min}
                max={SHAPE_FINISH_DEFAULTS.archGrindDepthMm.max}
                step={0.1}
                unit="mm"
                onChange={(v) => updateShapeFinish(side, { archGrindDepthMm: v })}
            />

            <SliderField
                label="Arch skive"
                value={sf.archSkiveMm}
                min={SHAPE_FINISH_DEFAULTS.archSkiveMm.min}
                max={SHAPE_FINISH_DEFAULTS.archSkiveMm.max}
                step={0.1}
                unit="mm"
                onChange={(v) => updateShapeFinish(side, { archSkiveMm: v })}
            />
            <div className="flex gap-1">
                {ARCH_SKIVE_SIDES.map((opt) => (
                    <button
                        key={opt.value}
                        type="button"
                        className={cn(
                            "flex-1 rounded border px-2 py-1 text-xs",
                            sf.archSkiveSide === opt.value
                                ? "border-primary bg-primary/10"
                                : "border-border text-muted-foreground",
                        )}
                        onClick={() => updateShapeFinish(side, { archSkiveSide: opt.value })}
                    >
                        {opt.label}
                    </button>
                ))}
            </div>

            <div className="rounded-md border border-border bg-background/50 p-2 text-xs">
                <p className="mb-1 font-medium text-muted-foreground">QC (shape / finish)</p>
                <ul className="space-y-0.5">
                    {qc.map((line) => (
                        <li key={line.key} className="flex justify-between gap-2">
                            <span className="text-muted-foreground">{line.label}</span>
                            <span className="tabular-nums text-right">{line.value}</span>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}
