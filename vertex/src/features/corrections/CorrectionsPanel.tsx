import { Link2, Unlink } from "lucide-react";
import { useMemo } from "react";
import { SliderField } from "@/components/ui/slider-field";
import { rafThrottle } from "@/lib/performance/throttle";
import { useDesignStore } from "@/stores/design-store";
import { mergeCorrections, usePerformanceStore } from "@/stores/performance-store";
import { cn } from "@/lib/utils";
import type { Side, SideCorrections } from "@/types";

const FIELDS: { key: keyof SideCorrections; label: string; min: number; max: number; group: string }[] = [
    { key: "forefootPostingDeg", label: "Forefoot posting", min: -15, max: 15, group: "Pronation / Supination" },
    { key: "rearfootPostingDeg", label: "Rearfoot posting", min: -15, max: 15, group: "Pronation / Supination" },
    { key: "medialSkiveMm", label: "Medial skive", min: 0, max: 8, group: "Skive" },
    { key: "lateralSkiveMm", label: "Lateral skive", min: 0, max: 8, group: "Skive" },
    { key: "archHeightMm", label: "Arch height", min: 0, max: 25, group: "Arch" },
    { key: "archFillMm", label: "Arch fill", min: -10, max: 10, group: "Arch" },
    { key: "heelCupDepthMm", label: "Heel cup depth", min: 0, max: 25, group: "Heel" },
    { key: "heelCupHeightMm", label: "Heel cup height", min: 0, max: 25, group: "Heel" },
    { key: "apexMoveMm", label: "Apex move", min: -30, max: 30, group: "Apex & Wedges" },
    { key: "medialFlangeMm", label: "Medial flange", min: 0, max: 20, group: "Apex & Wedges" },
    { key: "lateralFlangeMm", label: "Lateral flange", min: 0, max: 20, group: "Apex & Wedges" },
];

const GROUPS = ["Pronation / Supination", "Skive", "Arch", "Heel", "Apex & Wedges"];

const previewCorrection = rafThrottle((side: Side, patch: Partial<SideCorrections>) => {
    usePerformanceStore.getState().setCorrectionPreview(side, patch);
});

export function CorrectionsPanel() {
    const { design, updateCorrection, setUnit, setLinked, setThickness } = useDesignStore();
    const { corrections } = design;
    const thicknessPreview = usePerformanceStore((s) => s.thicknessPreview);
    const setThicknessPreview = usePerformanceStore((s) => s.setThicknessPreview);
    const clearCorrectionPreview = usePerformanceStore((s) => s.clearCorrectionPreview);
    const correctionPreview = usePerformanceStore((s) => s.correctionPreview);
    const degField = (key: keyof SideCorrections) => key.endsWith("Deg");

    const displayThickness = thicknessPreview ?? design.thicknessMm;

    const sideValues = useMemo(
        () => ({
            left: mergeCorrections("left", corrections.left),
            right: mergeCorrections("right", corrections.right),
        }),
        [corrections, correctionPreview],
    );

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between rounded-md bg-muted px-2 py-1.5">
                <button
                    type="button"
                    onClick={() => setLinked(!corrections.linked)}
                    className={cn(
                        "flex items-center gap-1.5 rounded px-2 py-1 text-xs",
                        corrections.linked ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                    )}
                >
                    {corrections.linked ? <Link2 className="h-3.5 w-3.5" /> : <Unlink className="h-3.5 w-3.5" />}
                    {corrections.linked ? "L+R linked" : "Independent"}
                </button>
                <div className="flex items-center gap-1 text-xs">
                    {(["mm", "deg"] as const).map((u) => (
                        <button
                            key={u}
                            type="button"
                            onClick={() => setUnit(u)}
                            className={cn("rounded px-2 py-1", corrections.unit === u ? "bg-secondary text-foreground" : "text-muted-foreground")}
                        >
                            {u}
                        </button>
                    ))}
                </div>
            </div>

            <SliderField
                label="Shell thickness"
                value={displayThickness}
                min={1.5}
                max={8}
                step={0.1}
                unit="mm"
                onPreview={(v) => setThicknessPreview(v)}
                onChange={(v) => {
                    setThickness(v);
                    setThicknessPreview(null);
                }}
            />

            {GROUPS.map((group) => (
                <div key={group} className="space-y-2 rounded-md border border-border bg-background/50 p-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group}</div>
                    <div className="grid grid-cols-2 gap-x-3">
                        {(["left", "right"] as Side[]).map((side) => (
                            <div key={side} className="space-y-2">
                                <div className="text-[10px] uppercase text-primary/80">{side}</div>
                                {FIELDS.filter((f) => f.group === group).map((f) => (
                                    <SliderField
                                        key={`${side}-${f.key}`}
                                        label={f.label}
                                        value={sideValues[side][f.key]}
                                        min={f.min}
                                        max={f.max}
                                        step={degField(f.key) ? 0.5 : 0.5}
                                        unit={degField(f.key) ? "°" : "mm"}
                                        onPreview={(v) => previewCorrection(side, { [f.key]: v } as Partial<SideCorrections>)}
                                        onChange={(v) => {
                                            updateCorrection(side, { [f.key]: v } as Partial<SideCorrections>);
                                            clearCorrectionPreview();
                                        }}
                                    />
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}
