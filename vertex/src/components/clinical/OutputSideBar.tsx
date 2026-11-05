// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { Button } from "@/components/ui/button";
import { useDesignStore } from "@/stores/design-store";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { SIDE_LABELS, type Side } from "@/types";

export function OutputSideBar({
    showPair,
    continueLabel,
    onContinue,
}: {
    showPair?: boolean;
    continueLabel?: string;
    onContinue?: () => void;
}) {
    const exportSide = useDesignStore((s) => s.exportSide);
    const setExportSide = useDesignStore((s) => s.setExportSide);
    const placementFoot = useClinicalWorkflowStore((s) => s.elementPlacementFoot);
    const linked = useDesignStore((s) => s.design.corrections.linked);
    const pairActive = showPair && (linked || placementFoot === "both");

    return (
        <div className="space-y-2 border-t border-border pt-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Output</div>
            <div className={pairActive ? "grid grid-cols-3 gap-1" : "grid grid-cols-2 gap-1"}>
                {(["left", "right"] as Side[]).map((s) => (
                    <Button
                        key={s}
                        size="sm"
                        variant={exportSide === s && placementFoot !== "both" ? "default" : "secondary"}
                        className="h-8 text-[11px]"
                        onClick={() => setExportSide(s)}
                    >
                        {SIDE_LABELS[s]}
                    </Button>
                ))}
                {pairActive ? (
                    <Button size="sm" variant="secondary" className="h-8 text-[11px]" disabled>
                        Pair
                    </Button>
                ) : null}
            </div>
            {continueLabel && onContinue ? (
                <Button type="button" className="h-8 w-full text-[12px]" onClick={onContinue}>
                    {continueLabel}
                </Button>
            ) : null}
        </div>
    );
}
