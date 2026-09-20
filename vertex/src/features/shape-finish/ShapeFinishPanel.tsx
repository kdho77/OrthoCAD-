// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Link2, Unlink } from "lucide-react";
import { useMemo } from "react";
import { SliderField } from "@/components/ui/slider-field";
import { ActiveFootSideBar } from "@/features/clinical/ActiveFootSideBar";
import { ShapeFinishQcBlock } from "@/features/shape-finish/ShapeFinishQcBlock";
import { useActiveFootSide } from "@/lib/clinical/active-foot-side";
import {
    evaluateShapeFinishQc,
    shapeFinishWallRisk,
} from "@/lib/geometry/shape-finish-gates";
import { getSideShapeFinish, SHAPE_FINISH_DEFAULTS } from "@/lib/geometry/shape-finish-modifiers";
import { cn } from "@/lib/utils";
import { useDesignStore } from "@/stores/design-store";
import type { ArchSkiveSide, Side, SideShapeFinish } from "@/types";

const SIDE_LABELS: Record<Side, string> = { left: "Left", right: "Right" };

const ARCH_SKIVE_SIDES: { value: ArchSkiveSide; label: string }[] = [
    { value: "medial", label: "Medial" },
    { value: "lateral", label: "Lateral" },
    { value: "central", label: "Central" },
];

function thicknessForSide(
    design: ReturnType<typeof useDesignStore.getState>["design"],
    side: Side,
): number {
    if (design.paired) {
        return side === "left" ? design.paired.leftThicknessMm : design.paired.rightThicknessMm;
    }
    return design.thicknessMm;
}

function commitShapeFinish(
    side: Side,
    patch: Partial<SideShapeFinish>,
    design: ReturnType<typeof useDesignStore.getState>["design"],
    updateShapeFinish: (side: Side, patch: Partial<SideShapeFinish>) => void,
): void {
    const next = { ...getSideShapeFinish(design, side), ...patch };
    const qcInput = {
        side,
        sf: next,
        thicknessMm: thicknessForSide(design, side),
        archHeightMm: design.corrections[side].archHeightMm + design.corrections[side].archFillMm,
        heelSkiveMedialMm: design.corrections[side].medialSkiveMm,
        heelSkiveLateralMm: design.corrections[side].lateralSkiveMm,
    };
    const risk = shapeFinishWallRisk(qcInput);
    if (risk.atRisk && (patch.archGrindDepthMm !== undefined || patch.archSkiveMm !== undefined)) {
        if (!window.confirm(risk.message)) return;
    }
    updateShapeFinish(side, patch);
}

export function ShapeFinishPanel() {
    const design = useDesignStore((s) => s.design);
    const side = useActiveFootSide();
    const updateShapeFinish = useDesignStore((s) => s.updateShapeFinish);
    const setShapeFinishLinked = useDesignStore((s) => s.setShapeFinishLinked);
    const linked = design.shapeFinish?.linked ?? true;
    const sf = getSideShapeFinish(design, side);
    const corr = design.corrections[side];

    const qcItems = useMemo(
        () =>
            evaluateShapeFinishQc({
                side,
                sf,
                thicknessMm: thicknessForSide(design, side),
                archHeightMm: corr.archHeightMm + corr.archFillMm,
                heelSkiveMedialMm: corr.medialSkiveMm,
                heelSkiveLateralMm: corr.lateralSkiveMm,
            }),
        [side, sf, design, corr],
    );

    const onPatch = (patch: Partial<SideShapeFinish>) => {
        commitShapeFinish(side, patch, design, updateShapeFinish);
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
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

            <ActiveFootSideBar />

            <p className="text-[11px] leading-snug text-muted-foreground">
                Top cover adds clearance for cover bulk — it does not change heel cup depth. Arch grind
                deepens the plantar only — not arch height or fill.
            </p>

            <SliderField
                label="Top cover accommodate"
                value={sf.topCoverAccommodateMm}
                min={SHAPE_FINISH_DEFAULTS.topCoverAccommodateMm.min}
                max={SHAPE_FINISH_DEFAULTS.topCoverAccommodateMm.max}
                step={0.1}
                unit="mm"
                onChange={(v) => onPatch({ topCoverAccommodateMm: v })}
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
                onChange={(v) => onPatch({ archGrindDepthMm: v })}
            />

            <SliderField
                label="Arch skive"
                value={sf.archSkiveMm}
                min={SHAPE_FINISH_DEFAULTS.archSkiveMm.min}
                max={SHAPE_FINISH_DEFAULTS.archSkiveMm.max}
                step={0.1}
                unit="mm"
                onChange={(v) => onPatch({ archSkiveMm: v })}
            />
            {sf.archSkiveMm > 0 ? (
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
            ) : null}

            <ShapeFinishQcBlock items={qcItems} />
        </div>
    );
}
