// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AlertTriangle, Check, PencilLine, Redo2, RotateCcw, Undo2, X } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { constrainDesignCorrections } from "@/lib/geometry/clinical-constraints";
import { cn } from "@/lib/utils";
import { useDesignStore } from "@/stores/design-store";
import { useIssuesStore } from "@/stores/issues-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import type { Side } from "@/types";

/**
 * Action panel for insole editing workflows — trimline reshape with confirm/cancel.
 * Confirmed curves are written to `design.trimlines` (persisted on Save + page refresh).
 */
export function ActionPanel() {
    const viewer = useDesignStore((s) => s.viewer);
    const designTrimlines = useDesignStore((s) => s.design.trimlines);
    const designBottomPatterns = useDesignStore((s) => s.design.bottomPatterns);
    const clearSideTrimline = useDesignStore((s) => s.clearSideTrimline);
    const clearSideBottomPattern = useDesignStore((s) => s.clearSideBottomPattern);
    const editMode = useMeshEditStore((s) => s.editMode);
    const trimlineEdit = useMeshEditStore((s) => s.trimlineEdit);
    const beginTrimlineEdit = useMeshEditStore((s) => s.beginTrimlineEdit);
    const confirmTrimlineEdit = useMeshEditStore((s) => s.confirmTrimlineEdit);
    const cancelTrimlineEdit = useMeshEditStore((s) => s.cancelTrimlineEdit);
    const bottomPatternEdit = useMeshEditStore((s) => s.bottomPatternEdit);
    const beginBottomPatternEdit = useMeshEditStore((s) => s.beginBottomPatternEdit);
    const confirmBottomPatternEdit = useMeshEditStore((s) => s.confirmBottomPatternEdit);
    const cancelBottomPatternEdit = useMeshEditStore((s) => s.cancelBottomPatternEdit);
    const setBottomPatternDraft = useMeshEditStore((s) => s.setBottomPatternDraft);
    const orphans = useIssuesStore((s) => s.orphans);
    const design = useDesignStore((s) => s.design);
    const violations = useMemo(() => {
        const { violations: all } = constrainDesignCorrections(
            design.corrections.left,
            design.corrections.right,
            design.thicknessMm,
            design.corrections.linked,
        );
        const seen = new Set<string>();
        return all.filter((vi) => {
            const key = `${vi.field}:${vi.message}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }, [design.corrections, design.thicknessMm]);

    const isEditing = editMode === "edit-trimline" && trimlineEdit !== null;
    const isEditingBottom = editMode === "edit-bottom-pattern" && bottomPatternEdit !== null;
    const activeSide = trimlineEdit?.side ?? bottomPatternEdit?.side ?? "left";

    const startEdit = (side: Side) => {
        beginTrimlineEdit(side);
    };

    const hasCustom = (side: Side) => Boolean(designTrimlines?.[side]?.length);
    const hasBottom = (side: Side) => Boolean(designBottomPatterns?.[side]?.outline?.length);

    const draftDepth = bottomPatternEdit?.draft.depthMm ?? designBottomPatterns?.[activeSide]?.depthMm ?? 6;

    return (
        <div className="space-y-3">
            <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Edit actions
                </div>
                <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
                    Click anywhere on the insole outline in the viewer, or pick a side below. Confirmed
                    trimlines are saved with the design and included in STL export.
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

            <div className="space-y-2 rounded-md border border-border bg-background/50 p-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <PencilLine className="h-3.5 w-3.5 text-sky-500" />
                    Bottom pattern
                </div>
                <p className="text-[10px] leading-relaxed text-muted-foreground">
                    Flat manufacturing outline (independent of the top trimline). Cyan points reshape; purple
                    box translates; amber ring rotates. Depth is constant (no contour).
                </p>
                <div className="flex gap-1">
                    {(["left", "right"] as Side[]).map((side) => {
                        const visible = side === "left" ? viewer.showLeft : viewer.showRight;
                        return (
                            <Button
                                key={side}
                                size="sm"
                                variant={isEditingBottom && activeSide === side ? "default" : "secondary"}
                                className={cn("h-7 flex-1 capitalize", !visible && "opacity-50")}
                                disabled={!visible}
                                onClick={() => beginBottomPatternEdit(side)}
                            >
                                {side}
                                {hasBottom(side) ? (
                                    <span className="ml-1 text-[9px] text-sky-500">●</span>
                                ) : null}
                            </Button>
                        );
                    })}
                </div>

                {isEditingBottom && bottomPatternEdit ? (
                    <div className="space-y-2 border-t border-border pt-2">
                        <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                            <span>Depth (mm)</span>
                            <input
                                type="number"
                                min={0}
                                step={0.5}
                                className="h-7 w-20 rounded border border-border bg-background px-1.5 text-foreground"
                                value={draftDepth}
                                onChange={(e) => {
                                    const v = Number(e.target.value);
                                    if (!Number.isFinite(v)) return;
                                    setBottomPatternDraft({
                                        ...bottomPatternEdit.draft,
                                        depthMm: Math.max(0, v),
                                    });
                                }}
                            />
                        </label>
                        <div className="flex gap-1">
                            <Button
                                size="sm"
                                variant="default"
                                className="h-7 flex-1 gap-1 text-[11px]"
                                onClick={confirmBottomPatternEdit}
                            >
                                <Check className="h-3 w-3" />
                                Confirm
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                className="h-7 flex-1 gap-1 text-[11px]"
                                onClick={cancelBottomPatternEdit}
                            >
                                <X className="h-3 w-3" />
                                Cancel
                            </Button>
                        </div>
                        {hasBottom(activeSide) ? (
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-full gap-1 text-[11px] text-muted-foreground"
                                onClick={() => {
                                    clearSideBottomPattern(activeSide);
                                    cancelBottomPatternEdit();
                                }}
                            >
                                <RotateCcw className="h-3 w-3" />
                                Clear {activeSide} bottom pattern
                            </Button>
                        ) : null}
                    </div>
                ) : (
                    <p className="text-[10px] text-muted-foreground">
                        Optional. Creates a default scaled outline when you start editing.
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

                {orphans.length === 0 && violations.length === 0 ? (
                    <p className="text-[10px] text-muted-foreground">No production issues detected.</p>
                ) : (
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
                                    <div className="font-medium">
                                        Orphans / dead features ({orphans.length})
                                    </div>
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
                )}
            </div>
        </div>
    );
}
