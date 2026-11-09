// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { getActiveFootSide } from "@/lib/clinical/active-foot-side";
import { cn } from "@/lib/utils";
import { useDesignStore } from "@/stores/design-store";
import { leaveOutlineEdit, useMeshEditStore } from "@/stores/mesh-edit-store";

/** Sidebar entries for the outline tools that live on the Base step. */
export function OutlineEditEntries() {
    const wallModel = useDesignStore((s) => s.viewer.wallModel ?? "procedural");
    const editMode = useMeshEditStore((s) => s.editMode);
    const showBottom = wallModel === "procedural";

    const enter = (tool: "trimline" | "bottom-pattern") => {
        const state = useMeshEditStore.getState();
        if (tool === "trimline" && state.editMode === "edit-trimline" && state.trimlineEdit) return;
        if (
            tool === "bottom-pattern" &&
            state.editMode === "edit-bottom-pattern" &&
            state.bottomPatternEdit
        ) {
            return;
        }
        if (!leaveOutlineEdit({ promptIfDirty: true })) return;
        const side = getActiveFootSide();
        if (tool === "trimline") useMeshEditStore.getState().beginTrimlineEdit(side);
        else useMeshEditStore.getState().beginBottomPatternEdit(side);
    };

    return (
        <div className="space-y-1.5 rounded-md border border-border bg-background/40 p-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Outline
            </div>
            <button
                type="button"
                onClick={() => enter("trimline")}
                className={cn(
                    "w-full rounded-md border px-2 py-2 text-left text-[11px] transition-colors",
                    editMode === "edit-trimline"
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-background text-muted-foreground hover:border-primary/50",
                )}
            >
                Edit trimline
            </button>
            {showBottom ? (
                <button
                    type="button"
                    onClick={() => enter("bottom-pattern")}
                    className={cn(
                        "w-full rounded-md border px-2 py-2 text-left text-[11px] transition-colors",
                        editMode === "edit-bottom-pattern"
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-border bg-background text-muted-foreground hover:border-primary/50",
                    )}
                >
                    Edit bottom pattern
                </button>
            ) : null}
        </div>
    );
}
