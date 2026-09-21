// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Button } from "@/components/ui/button";
import { useActiveFootSide } from "@/lib/clinical/active-foot-side";
import { useClinicalWorkflowStore, type ElementPlacementFoot } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import { SIDE_LABELS, type Side } from "@/types";

interface ActiveFootSideBarProps {
    /** When true, offer Both (L+R) when corrections are linked. */
    allowBothWhenLinked?: boolean;
}

/** L/R (and optional both) selector aligned with viewer target and clinical rail (#168). */
export function ActiveFootSideBar({ allowBothWhenLinked = false }: ActiveFootSideBarProps) {
    const active = useActiveFootSide();
    const linked = useDesignStore((s) => s.design.corrections.linked);
    const placementFoot = useClinicalWorkflowStore((s) => s.elementPlacementFoot);
    const setPlacementFoot = useClinicalWorkflowStore((s) => s.setElementPlacementFoot);
    const acknowledgeExplicitFootSide = useClinicalWorkflowStore((s) => s.acknowledgeExplicitFootSide);
    const setExportSide = useDesignStore((s) => s.setExportSide);
    const setTarget = useMeshEditStore((s) => s.setTarget);

    const pickSide = (side: Side) => {
        acknowledgeExplicitFootSide(side);
        setPlacementFoot(side);
        setExportSide(side);
        setTarget({ type: "insole", side });
    };

    const pickBoth = () => {
        setPlacementFoot("both");
        setTarget({ type: "insole", side: active });
    };

    const showBoth = allowBothWhenLinked && linked;

    const isActive = (choice: ElementPlacementFoot | Side) => {
        if (choice === "both") return placementFoot === "both";
        return placementFoot !== "both" && active === choice;
    };

    return (
        <div className="flex flex-wrap gap-1">
            {(["left", "right"] as Side[]).map((s) => (
                <Button
                    key={s}
                    size="sm"
                    variant={isActive(s) ? "default" : "secondary"}
                    className="h-8 flex-1 text-[11px]"
                    onClick={() => pickSide(s)}
                >
                    {SIDE_LABELS[s]} foot
                </Button>
            ))}
            {showBoth ? (
                <Button
                    size="sm"
                    variant={isActive("both") ? "default" : "secondary"}
                    className="h-8 w-full text-[11px]"
                    onClick={() => pickBoth()}
                >
                    Both feet (linked L+R)
                </Button>
            ) : null}
        </div>
    );
}

/** Resolve sides for element placement from workflow + active foot. */
export function elementPlacementSides(): Side[] {
    const foot = useClinicalWorkflowStore.getState().elementPlacementFoot;
    if (foot === "both") return ["left", "right"];
    if (foot === "left" || foot === "right") return [foot];
    return [useDesignStore.getState().exportSide];
}
