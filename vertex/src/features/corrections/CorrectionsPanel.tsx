// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AlertTriangle, Link2, Unlink } from "lucide-react";
import { useMemo } from "react";
import { SliderField } from "@/components/ui/slider-field";
import { constrainDesignCorrections, hasWedgeViolations } from "@/lib/geometry/clinical-constraints";
import { rafThrottle } from "@/lib/performance/throttle";
import { cn } from "@/lib/utils";
import { useDesignStore } from "@/stores/design-store";
import { mergeCorrections, usePerformanceStore } from "@/stores/performance-store";
import type { Side, SideCorrections, WedgeCorrection } from "@/types";

/**
 * Scalar correction sliders grouped into clinical sections. The medial/lateral
 * wedge system is rendered separately (see the Wedges section in the JSX) because
 * each wedge is an object ({ side, value, unit }) rather than a plain number.
 *
 * Section layout (per refined design):
 *  - Apex move lives under **Arch**.
 *  - **Flanges** is its own dedicated section.
 *  - **Heel** holds heel cup depth, heel cup width and the new heel lift.
 */
const FIELDS: { key: keyof SideCorrections; label: string; min: number; max: number; group: string }[] = [
    { key: "forefootPostingDeg", label: "Forefoot posting", min: -12, max: 12, group: "Pronation / Supination" },
    { key: "rearfootPostingDeg", label: "Rearfoot posting", min: -10, max: 10, group: "Pronation / Supination" },
    { key: "medialSkiveMm", label: "Medial skive", min: 0, max: 7, group: "Skive" },
    { key: "lateralSkiveMm", label: "Lateral skive", min: 0, max: 7, group: "Skive" },
    { key: "archHeightMm", label: "Arch height", min: 0, max: 18, group: "Arch" },
    { key: "archFillMm", label: "Arch fill", min: 0, max: 12, group: "Arch" },
    { key: "apexMoveMm", label: "Apex move", min: -12, max: 12, group: "Arch" },
    { key: "heelCupDepthMm", label: "Heel cup depth", min: 0, max: 10, group: "Heel" },
    { key: "heelCupWidthMm", label: "Heel cup width", min: 0, max: 10, group: "Heel" },
    { key: "heelLiftMm", label: "Heel lift", min: 0, max: 20, group: "Heel" },
    { key: "medialFlangeMm", label: "Medial flange", min: 0, max: 8, group: "Flanges" },
    { key: "lateralFlangeMm", label: "Lateral flange", min: 0, max: 8, group: "Flanges" },
];

const GROUPS = ["Pronation / Supination", "Skive", "Arch", "Heel", "Flanges"];

const previewCorrection = rafThrottle((side: Side, patch: Partial<SideCorrections>) => {
    usePerformanceStore.getState().setCorrectionPreview(side, patch);
});

export function CorrectionsPanel() {
    const design = useDesignStore((s) => s.design);
    const updateCorrection = useDesignStore((s) => s.updateCorrection);
    const setUnit = useDesignStore((s) => s.setUnit);
    const setLinked = useDesignStore((s) => s.setLinked);
    const setThickness = useDesignStore((s) => s.setThickness);
    const setRearfootWedge = useDesignStore((s) => s.setRearfootWedge);
    const setForefootWedge = useDesignStore((s) => s.setForefootWedge);
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

    // Soft clinical warnings for wedges approaching their limits (non-blocking).
    // Derived in useMemo — never select getActiveViolations() directly (returns a new
    // array each call and triggers React useSyncExternalStore infinite loop / #185).
    const showWedgeWarning = useMemo(() => {
        const { violations } = constrainDesignCorrections(
            corrections.left,
            corrections.right,
            design.thicknessMm,
            corrections.linked,
        );
        return hasWedgeViolations(violations);
    }, [corrections, design.thicknessMm]);

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
                            className={cn(
                                "rounded px-2 py-1",
                                corrections.unit === u ? "bg-secondary text-foreground" : "text-muted-foreground",
                            )}
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
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {group}
                    </div>
                    <div className="grid grid-cols-2 gap-x-3">
                        {(["left", "right"] as Side[]).map((side) => (
                            <div key={side} className="space-y-2">
                                <div className="text-[10px] uppercase text-primary/80">{side}</div>
                                {FIELDS.filter((f) => f.group === group).map((f) => (
                                    <SliderField
                                        key={`${side}-${f.key}`}
                                        label={f.label}
                                        value={sideValues[side][f.key] as number}
                                        min={f.min}
                                        max={f.max}
                                        step={0.5}
                                        unit={degField(f.key) ? "°" : "mm"}
                                        onPreview={(v) =>
                                            previewCorrection(side, { [f.key]: v } as Partial<SideCorrections>)
                                        }
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

            {/* Medial / lateral wedge system — dedicated section.
                Per zone (Rearfoot / Forefoot) the user picks None / Medial / Lateral
                (mutually exclusive) and a value with a per-wedge mm/deg toggle. Each
                side (L/R) is independent; linked mode mirrors via the store setters. */}
            <div className="space-y-2 rounded-md border border-border bg-background/50 p-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Wedges (Plantar Surface)
                </div>
                <div className="text-[10px] text-muted-foreground">
                    Raises one edge of the zone and tapers to 0 on the opposite edge. mm = absolute edge raise; deg =
                    angle resolved against the current local width at each station (auto-adjusts with the trimline).
                    Applied on top of posting/arch; the flat bottom stays stable.
                </div>
                {showWedgeWarning && (
                    <div className="flex items-center gap-1.5 rounded bg-amber-500/10 p-1.5 text-[10px] text-amber-600">
                        <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                        <span>Wedge value near clinical limit (clamped on change). Check the preview for its effect on wall thickness.</span>
                    </div>
                )}

                {(["rearfoot", "forefoot"] as const).map((zone) => {
                    const zoneLabel = zone === "rearfoot" ? "Rearfoot" : "Forefoot";
                    const setter = zone === "rearfoot" ? setRearfootWedge : setForefootWedge;
                    const wedgeKey = `${zone}Wedge` as "rearfootWedge" | "forefootWedge";
                    return (
                        <div key={zone} className="space-y-2 border-t border-border pt-2">
                            <div className="text-[10px] font-medium text-primary/80">{zoneLabel}</div>
                            <div className="grid grid-cols-2 gap-x-3">
                                {(["left", "right"] as Side[]).map((side) => {
                                    const w = sideValues[side][wedgeKey] as WedgeCorrection | undefined;
                                    const isActive = !!w;
                                    const currentSide = w?.side ?? "medial";
                                    const currentUnit = w?.unit ?? "mm";
                                    const currentValue = w?.value ?? 3;

                                    const previewWedge = (newW: WedgeCorrection | undefined) => {
                                        previewCorrection(side, { [wedgeKey]: newW } as Partial<SideCorrections>);
                                    };

                                    const commitWedge = (newW: WedgeCorrection | undefined) => {
                                        setter(side, newW);
                                        clearCorrectionPreview();
                                    };

                                    return (
                                        <div key={side} className="space-y-1.5">
                                            <div className="text-[10px] uppercase text-primary/80">{side}</div>

                                            {/* None / Medial / Lateral — mutually exclusive choice. */}
                                            <div className="flex gap-1 text-[10px]">
                                                {(["none", "medial", "lateral"] as const).map((choice) => {
                                                    const selected =
                                                        (choice === "none" && !isActive) ||
                                                        (choice !== "none" && isActive && currentSide === choice);
                                                    return (
                                                        <button
                                                            key={choice}
                                                            type="button"
                                                            onClick={() => {
                                                                if (choice === "none") {
                                                                    commitWedge(undefined);
                                                                } else {
                                                                    commitWedge({
                                                                        side: choice,
                                                                        value: currentValue,
                                                                        unit: currentUnit,
                                                                    });
                                                                }
                                                            }}
                                                            className={cn(
                                                                "flex-1 rounded border px-1.5 py-0.5 capitalize",
                                                                selected
                                                                    ? "border-primary bg-primary text-primary-foreground"
                                                                    : "border-border bg-background text-muted-foreground hover:bg-muted",
                                                            )}
                                                        >
                                                            {choice}
                                                        </button>
                                                    );
                                                })}
                                            </div>

                                            {/* Value + per-wedge unit toggle (only when a wedge is active). */}
                                            {isActive && (
                                                <div className="flex items-center gap-2">
                                                    <div className="flex-1">
                                                        <SliderField
                                                            label=""
                                                            value={currentValue}
                                                            min={0}
                                                            max={currentUnit === "mm" ? 10 : 12}
                                                            step={0.5}
                                                            unit={currentUnit === "mm" ? "mm" : "°"}
                                                            onPreview={(v) =>
                                                                previewWedge({
                                                                    side: currentSide,
                                                                    value: v,
                                                                    unit: currentUnit,
                                                                })
                                                            }
                                                            onChange={(v) =>
                                                                commitWedge({
                                                                    side: currentSide,
                                                                    value: v,
                                                                    unit: currentUnit,
                                                                })
                                                            }
                                                        />
                                                    </div>
                                                    <div className="flex overflow-hidden rounded border border-border text-[10px]">
                                                        {(["mm", "deg"] as const).map((u) => (
                                                            <button
                                                                key={u}
                                                                type="button"
                                                                onClick={() =>
                                                                    commitWedge({
                                                                        side: currentSide,
                                                                        value: currentValue,
                                                                        unit: u,
                                                                    })
                                                                }
                                                                className={cn(
                                                                    "px-1.5 py-0.5",
                                                                    currentUnit === u
                                                                        ? "bg-secondary"
                                                                        : "hover:bg-muted",
                                                                )}
                                                            >
                                                                {u}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
