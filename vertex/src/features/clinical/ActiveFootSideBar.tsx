// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { Button } from "@/components/ui/button";
import { useActiveFootSide } from "@/lib/clinical/active-foot-side";
import { type ElementPlacementFoot, useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import { SIDE_LABELS, type Side } from "@/types";

interface ActiveFootSideBarProps {
    /** When true, offer Both (L+R) — default for the sticky Editing control. */
    allowBothWhenLinked?: boolean;
}

/** L/R / Both (linked) selector aligned with viewer target and clinical rail. */
export function ActiveFootSideBar({ allowBothWhenLinked = false }: ActiveFootSideBarProps) {
    const active = useActiveFootSide();
    const linked = useDesignStore((s) => s.design.corrections.linked);
    const placementFoot = useClinicalWorkflowStore((s) => s.elementPlacementFoot);
    const setPlacementFoot = useClinicalWorkflowStore((s) => s.setElementPlacementFoot);
    const acknowledgeExplicitFootSide = useClinicalWorkflowStore((s) => s.acknowledgeExplicitFootSide);
    const acknowledgePairAssignment = useClinicalWorkflowStore((s) => s.acknowledgePairAssignment);
    const setLinked = useDesignStore((s) => s.setLinked);
    const setExportSide = useDesignStore((s) => s.setExportSide);
    const setTarget = useMeshEditStore((s) => s.setTarget);

    const syncTextFeet = (feet: "left" | "right" | "both") => {
        const marking = useDesignStore.getState().design.textMarking;
        if (!marking) return;
        useDesignStore.getState().setTextMarking({ feet });
    };

    const pickSide = (side: Side) => {
        acknowledgeExplicitFootSide(side);
        setPlacementFoot(side);
        setExportSide(side);
        setTarget({ type: "insole", side });
        syncTextFeet(side);
    };

    const pickBoth = () => {
        acknowledgePairAssignment();
        setLinked(true);
        setPlacementFoot("both");
        setTarget({ type: "insole", side: active });
        syncTextFeet("both");
    };

    const showBoth = allowBothWhenLinked || linked || placementFoot === "both";

    const isActive = (choice: ElementPlacementFoot | Side) => {
        if (choice === "both") return placementFoot === "both";
        return placementFoot !== "both" && active === choice;
    };

    return (
        <div className={showBoth ? "grid grid-cols-3 gap-1" : "flex flex-wrap gap-1"}>
            {(["left", "right"] as Side[]).map((s) => (
                <Button
                    key={s}
                    size="sm"
                    variant={isActive(s) ? "default" : "secondary"}
                    className="h-8 text-[11px]"
                    onClick={() => pickSide(s)}
                >
                    {SIDE_LABELS[s]}
                </Button>
            ))}
            {showBoth ? (
                <Button
                    size="sm"
                    variant={isActive("both") ? "default" : "secondary"}
                    className="h-8 text-[11px]"
                    onClick={() => pickBoth()}
                >
                    Both (linked)
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
