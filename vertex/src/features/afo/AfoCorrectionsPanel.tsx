// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { SliderField } from "@/components/ui/slider-field";
import { applyAfoCorrections } from "@/lib/geometry/afo/corrections";
import {
    AFO_ARCH_RANGE,
    AFO_BRACE_HEIGHT_MM,
    AFO_BRACE_HEIGHT_RANGE,
    AFO_FOOT_LIFT_RANGE,
    AFO_HEEL_LIFT_RANGE,
    AFO_HEEL_WIDTH_RANGE,
    AFO_REAR_ROT_RANGE,
    AFO_SIDE_ROT_RANGE,
    AFO_SMOOTH_ITERATIONS,
    AFO_SMOOTH_RANGE,
    defaultAfoCorrections,
} from "@/lib/geometry/afo/defaults";
import { getAfoState, patchAfoState, useAfoStore } from "@/stores/afo-store";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";
import { SIDE_LABELS } from "@/types";

export function AfoCorrectionsPanel() {
    const afo = useDesignStore((s) => s.design.afo) ?? getAfoState();
    const c = afo.corrections ?? defaultAfoCorrections();
    const side = afo.side;
    const placement = useClinicalWorkflowStore((s) => s.elementPlacementFoot);
    const scanned =
        placement === "both" ? side : placement === "left" || placement === "right" ? placement : side;
    const castMesh = useAfoStore((s) => s.castMesh);
    const setCorrected = useAfoStore((s) => s.setCorrectedMesh);

    const patch = (partial: Partial<typeof c>) => {
        const next = { ...c, ...partial };
        patchAfoState({ corrections: next }, "afo-corrections");
        if (castMesh) setCorrected(applyAfoCorrections(castMesh, next));
    };

    return (
        <div className="space-y-3 text-xs">
            <p className="text-muted-foreground">
                Corrections apply only to the scanned side ({SIDE_LABELS[scanned]}).
            </p>
            {scanned === "left" || scanned === "right" ? (
                <div className="space-y-2">
                    <SliderField
                        label="Leg rear rotation"
                        value={c.legRearDeg}
                        min={AFO_REAR_ROT_RANGE[0]}
                        max={AFO_REAR_ROT_RANGE[1]}
                        step={0.5}
                        unit="°"
                        defaultValue={0}
                        onChange={(v) => patch({ legRearDeg: v })}
                    />
                    <SliderField
                        label="Leg side rotation"
                        value={c.legSideDeg}
                        min={AFO_SIDE_ROT_RANGE[0]}
                        max={AFO_SIDE_ROT_RANGE[1]}
                        step={0.5}
                        unit="°"
                        defaultValue={0}
                        onChange={(v) => patch({ legSideDeg: v })}
                    />
                    <SliderField
                        label="Heel lift"
                        value={c.heelLiftMm}
                        min={AFO_HEEL_LIFT_RANGE[0]}
                        max={AFO_HEEL_LIFT_RANGE[1]}
                        unit="mm"
                        defaultValue={0}
                        onChange={(v) => patch({ heelLiftMm: v })}
                    />
                    <SliderField
                        label="Foot lift medial"
                        value={c.footLiftMedMm}
                        min={AFO_FOOT_LIFT_RANGE[0]}
                        max={AFO_FOOT_LIFT_RANGE[1]}
                        unit="mm"
                        defaultValue={0}
                        onChange={(v) => patch({ footLiftMedMm: v })}
                    />
                    <SliderField
                        label="Foot lift lateral"
                        value={c.footLiftLatMm}
                        min={AFO_FOOT_LIFT_RANGE[0]}
                        max={AFO_FOOT_LIFT_RANGE[1]}
                        unit="mm"
                        defaultValue={0}
                        onChange={(v) => patch({ footLiftLatMm: v })}
                    />
                    <SliderField
                        label="Medial arch"
                        value={c.medialArchMm}
                        min={AFO_ARCH_RANGE[0]}
                        max={AFO_ARCH_RANGE[1]}
                        unit="mm"
                        defaultValue={0}
                        onChange={(v) => patch({ medialArchMm: v })}
                    />
                    <SliderField
                        label="Heel width"
                        value={c.heelWidthMm}
                        min={AFO_HEEL_WIDTH_RANGE[0]}
                        max={AFO_HEEL_WIDTH_RANGE[1]}
                        unit="mm"
                        defaultValue={0}
                        onChange={(v) => patch({ heelWidthMm: v })}
                    />
                    <SliderField
                        label="Brace height"
                        value={c.braceHeightMm}
                        min={AFO_BRACE_HEIGHT_RANGE[0]}
                        max={AFO_BRACE_HEIGHT_RANGE[1]}
                        unit="mm"
                        defaultValue={AFO_BRACE_HEIGHT_MM}
                        onChange={(v) => patch({ braceHeightMm: v })}
                    />
                    <SliderField
                        label="Smooth"
                        value={c.smoothIterations}
                        min={AFO_SMOOTH_RANGE[0]}
                        max={AFO_SMOOTH_RANGE[1]}
                        step={1}
                        defaultValue={AFO_SMOOTH_ITERATIONS}
                        onChange={(v) => patch({ smoothIterations: Math.round(v) })}
                    />
                </div>
            ) : (
                <p className="rounded-md border border-dashed border-border px-2 py-3 text-center text-muted-foreground">
                    Select the scanned foot above to edit corrections.
                </p>
            )}
        </div>
    );
}
