// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Check, PencilLine, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import { cn } from "@/lib/utils";
import type { Side } from "@/types";

/**
 * Action panel for insole editing workflows — trimline reshape with confirm/cancel.
 * Confirmed curves are written to `design.trimlines` (persisted on Save + page refresh).
 */
export function ActionPanel() {
    const viewer = useDesignStore((s) => s.viewer);
    const designTrimlines = useDesignStore((s) => s.design.trimlines);
    const clearSideTrimline = useDesignStore((s) => s.clearSideTrimline);
    const editMode = useMeshEditStore((s) => s.editMode);
    const trimlineEdit = useMeshEditStore((s) => s.trimlineEdit);
    const beginTrimlineEdit = useMeshEditStore((s) => s.beginTrimlineEdit);
    const confirmTrimlineEdit = useMeshEditStore((s) => s.confirmTrimlineEdit);
    const cancelTrimlineEdit = useMeshEditStore((s) => s.cancelTrimlineEdit);

    const isEditing = editMode === "edit-trimline" && trimlineEdit !== null;
    const activeSide = trimlineEdit?.side ?? "left";

    const startEdit = (side: Side) => {
        beginTrimlineEdit(side);
    };

    const hasCustom = (side: Side) => Boolean(designTrimlines?.[side]?.length);

    return (
        <div className="space-y-3">
            <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Edit actions
                </div>
                <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
                    Click anywhere on the insole outline in the viewer, or pick a side below.
                    Confirmed trimlines are saved with the design and included in STL export.
                </p>
            </div>

            <div className="space-y-2 rounded-md border border-border bg-background/50 p-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <PencilLine className="h-3.5 w-3.5 text-primary" />
                    Edit trimline
                </div>

                <div className="flex gap-1">
                    {(["left", "right"] as Side[]).map((side) => {
                        const visible = side === "left" ? viewer.showLeft : viewer.showRight;
                        return (
                            <Button
                                key={side}
                                size="sm"
                                variant={isEditing && activeSide === side ? "default" : "secondary"}
                                className={cn("h-7 flex-1 capitalize", !visible && "opacity-50")}
                                disabled={!visible}
                                onClick={() => startEdit(side)}
                            >
                                {side}
                                {hasCustom(side) ? (
                                    <span className="ml-1 text-[9px] text-primary">●</span>
                                ) : null}
                            </Button>
                        );
                    })}
                </div>

                <div className="flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                    {(["left", "right"] as Side[]).map((side) =>
                        hasCustom(side) ? (
                            <span key={side} className="rounded bg-muted px-1.5 py-0.5 capitalize">
                                {side}: custom outline
                            </span>
                        ) : null,
                    )}
                </div>

                {isEditing ? (
                    <div className="space-y-2 border-t border-border pt-2">
                        <p className="text-[10px] text-muted-foreground">
                            Editing <span className="font-medium text-foreground">{activeSide}</span> outline.
                            Click the trimline or a yellow handle, then drag. Red preview while dragging.
                        </p>
                        <div className="flex gap-1">
                            <Button
                                size="sm"
                                variant="default"
                                className="h-7 flex-1 gap-1 text-[11px]"
                                onClick={confirmTrimlineEdit}
                            >
                                <Check className="h-3 w-3" />
                                Confirm
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                className="h-7 flex-1 gap-1 text-[11px]"
                                onClick={cancelTrimlineEdit}
                            >
                                <X className="h-3 w-3" />
                                Cancel
                            </Button>
                        </div>
                        {hasCustom(activeSide) ? (
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-full gap-1 text-[11px] text-muted-foreground"
                                onClick={() => {
                                    clearSideTrimline(activeSide);
                                    cancelTrimlineEdit();
                                }}
                            >
                                <RotateCcw className="h-3 w-3" />
                                Reset {activeSide} to default outline
                            </Button>
                        ) : null}
                    </div>
                ) : (
                    <p className="text-[10px] text-muted-foreground">
                        No active edit session. Click the outline in the 3D view for the fastest start.
                    </p>
                )}
            </div>
        </div>
    );
}
