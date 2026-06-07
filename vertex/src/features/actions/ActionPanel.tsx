// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AlertTriangle, Check, PencilLine, RotateCcw, Undo2, Redo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDesignStore } from "@/stores/design-store";
import { useIssuesStore } from "@/stores/issues-store";
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

            {/* Phase 3A: Production undo/redo + issues (constraints + orphans) surface */}
            <div className="space-y-2 rounded-md border border-border bg-background/50 p-2">
                <div className="flex items-center justify-between text-xs font-medium text-foreground">
                    <span>History</span>
                    <div className="flex gap-1">
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 gap-1 px-1.5 text-[11px]"
                            onClick={() => useDesignStore.getState().undo()}
                            disabled={!useDesignStore.getState().canUndo()}
                            title="Undo (⌘Z)"
                        >
                            <Undo2 className="h-3.5 w-3.5" />
                            Undo
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 gap-1 px-1.5 text-[11px]"
                            onClick={() => useDesignStore.getState().redo()}
                            disabled={!useDesignStore.getState().canRedo()}
                            title="Redo (⌘⇧Z)"
                        >
                            <Redo2 className="h-3.5 w-3.5" />
                            Redo
                        </Button>
                    </div>
                </div>

                {(() => {
                    const orphans = useIssuesStore((s) => s.orphans);
                    const violations = useDesignStore((s) => s.getActiveViolations());
                    const hasIssues = orphans.length > 0 || violations.length > 0;
                    if (!hasIssues) return <p className="text-[10px] text-muted-foreground">No production issues detected.</p>;
                    return (
                        <div className="space-y-1 text-[10px]">
                            {violations.length > 0 && (
                                <div className="flex items-start gap-1.5 rounded bg-amber-500/10 p-1.5 text-amber-600">
                                    <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
                                    <div>
                                        <div className="font-medium">Clinical limits applied</div>
                                        <ul className="list-disc pl-3">
                                            {violations.slice(0, 3).map((vi, i) => (
                                                <li key={i}>{vi.message}</li>
                                            ))}
                                        </ul>
                                    </div>
                                </div>
                            )}
                            {orphans.length > 0 && (
                                <div className="flex items-start gap-1.5 rounded bg-orange-500/10 p-1.5 text-orange-600">
                                    <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
                                    <div>
                                        <div className="font-medium">Orphans / dead features ({orphans.length})</div>
                                        <ul className="list-disc pl-3">
                                            {orphans.slice(0, 2).map((o, i) => (
                                                <li key={i}>{o.label}</li>
                                            ))}
                                            {orphans.length > 2 && <li>+{orphans.length - 2} more</li>}
                                        </ul>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })()}
            </div>
        </div>
    );
}
