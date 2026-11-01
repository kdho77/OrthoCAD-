// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { cn } from "@/lib/utils";
import { useDesignStore } from "@/stores/design-store";

const WALL_STYLES = ["straight", "round", "hybrid"] as const;

export type ProceduralWallStyleChoice = (typeof WALL_STYLES)[number];

interface ProceduralWallPreviewControlsProps {
    /** Sync the Print-step server-hybrid grinding preset when a wall style is picked. */
    onWallStyle?: (style: ProceduralWallStyleChoice) => void;
    compact?: boolean;
}

/**
 * Print-step grinding dropdown. Procedural walls are on by default (SAMPLE_Top +
 * faired pattern, Grinding Straight). Legacy Default.glb is not a selectable stock.
 */
export function ProceduralWallPreviewControls({
    onWallStyle,
    compact,
}: ProceduralWallPreviewControlsProps) {
    const wallStyle = useDesignStore((s) => s.viewer.wallStyle ?? "straight");
    const setViewer = useDesignStore((s) => s.setViewer);

    return (
        <div className={compact ? "flex gap-1" : "space-y-1.5"}>
            {compact ? null : (
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Grinding
                </div>
            )}
            <div className="flex gap-1">
                {WALL_STYLES.map((t) => (
                    <button
                        key={t}
                        type="button"
                        onClick={() => {
                            setViewer({ wallModel: "procedural", wallStyle: t });
                            onWallStyle?.(t);
                        }}
                        className={cn(
                            "flex-1 rounded-md border px-2 text-[11px] capitalize",
                            compact ? "h-8" : "py-1 text-xs",
                            wallStyle === t
                                ? "border-primary bg-primary/10"
                                : "border-border bg-background text-muted-foreground",
                        )}
                    >
                        {t}
                    </button>
                ))}
            </div>
        </div>
    );
}
