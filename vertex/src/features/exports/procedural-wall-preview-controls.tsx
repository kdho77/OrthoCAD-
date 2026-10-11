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
 * Print-step grinding dropdown. Procedural walls are on by default (SAMPLE_Top +
 * faired pattern, Grinding Straight). Legacy Default.glb is not a selectable stock.
 */
export function ProceduralWallPreviewControls({ onWallStyle }: ProceduralWallPreviewControlsProps) {
    const wallStyle = useDesignStore((s) => s.viewer.wallStyle ?? "straight");
    const setViewer = useDesignStore((s) => s.setViewer);

    return (
        <div className="space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Grinding
            </div>
            <div className="flex gap-2">
                {WALL_STYLES.map((t) => (
                    <button
                        key={t}
                        type="button"
                        onClick={() => {
                            setViewer({ wallModel: "procedural", wallStyle: t });
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
                SAMPLE_Top + faired bottom pattern (heel ~8 mm, ~0 toe inset). Overlay is independent of the
                top trimline. Grinding default is Straight.
            </div>
        </div>
    );
}
