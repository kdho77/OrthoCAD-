// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Check, PencilLine, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import { cn } from "@/lib/utils";
import type { Side } from "@/types";

/**
 * Action panel for insole editing workflows — trimline reshape with confirm/cancel.
 * Mirrors the Rhino-style edit session: pick a point on the outline, drag to reshape,
 * then confirm or cancel.
 */
export function ActionPanel() {
    const viewer = useDesignStore((s) => s.viewer);
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

    return (
        <div className="space-y-3">
            <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Edit actions
                </div>
                <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
                    Click the insole outline in the viewer or choose a side below to reshape the trimline.
                    Drag along the perimeter to adjust the foot shape in real time.
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
                            </Button>
                        );
                    })}
                </div>

                {isEditing ? (
                    <div className="space-y-2 border-t border-border pt-2">
                        <p className="text-[10px] text-muted-foreground">
                            Editing <span className="font-medium text-foreground">{activeSide}</span> outline.
                            Click a control point or the trimline, then drag to reshape. Preview updates live in red.
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
                    </div>
                ) : (
                    <p className="text-[10px] text-muted-foreground">
                        No active edit session. Select a side or click the outline in the 3D view.
                    </p>
                )}
            </div>
        </div>
    );
}
