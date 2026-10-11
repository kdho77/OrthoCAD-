// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { cn } from "@/lib/utils";
import { useDesignStore } from "@/stores/design-store";

const WALL_STYLES = ["straight", "round", "hybrid"] as const;

export type ProceduralWallStyleChoice = (typeof WALL_STYLES)[number];

interface ProceduralWallPreviewControlsProps {
    /** Sync the Print-step server-hybrid grinding preset when a wall style is picked. */
    onWallStyle?: (style: ProceduralWallStyleChoice) => void;
}

/**
 * Print-step controls for the existing viewer.wallModel flag.
 * Grinding Straight / Round / Hybrid only applies when the flag is procedural.
 */
export function ProceduralWallPreviewControls({ onWallStyle }: ProceduralWallPreviewControlsProps) {
    const wallModel = useDesignStore((s) => s.viewer.wallModel ?? "legacy");
    const wallStyle = useDesignStore((s) => s.viewer.wallStyle ?? "straight");
    const setViewer = useDesignStore((s) => s.setViewer);
    const procedural = wallModel === "procedural";

    return (
        <div className="space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Wall model
            </div>
            <div className="flex gap-2">
                {(["legacy", "procedural"] as const).map((mode) => (
                    <button
                        key={mode}
                        type="button"
                        onClick={() => setViewer({ wallModel: mode })}
                        className={cn(
                            "flex-1 rounded-md border px-2 py-1 text-xs capitalize",
                            wallModel === mode
                                ? "border-primary bg-primary/10"
                                : "border-border bg-background text-muted-foreground",
                        )}
                    >
                        {mode}
                    </button>
                ))}
            </div>
            {procedural ? (
                <>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Grinding
                    </div>
                    <div className="flex gap-2">
                        {WALL_STYLES.map((t) => (
                            <button
                                key={t}
                                type="button"
                                onClick={() => {
                                    setViewer({ wallStyle: t });
                                    onWallStyle?.(t);
                                }}
                                className={cn(
                                    "flex-1 rounded-md border px-2 py-1 text-xs capitalize",
                                    wallStyle === t
                                        ? "border-primary bg-primary/10"
                                        : "border-border bg-background text-muted-foreground",
                                )}
                            >
                                {t}
                            </button>
                        ))}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                        Wall mid-style. Bottom stays flat; top and rim stay put. Viewer-only preview.
                    </div>
                </>
            ) : (
                <div className="text-[10px] text-muted-foreground">
                    Procedural walls stay off until this flag is set. Export still uses the stock mesh.
                </div>
            )}
        </div>
    );
}
