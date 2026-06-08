// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AlertTriangle, Link2, Unlink } from "lucide-react";
import { useMemo, useState } from "react";
import { SliderField } from "@/components/ui/slider-field";
import { constrainDesignCorrections, hasWedgeViolations } from "@/lib/geometry/clinical-constraints";
import { rafThrottle } from "@/lib/performance/throttle";
import { cn } from "@/lib/utils";
import { useDesignStore } from "@/stores/design-store";
import { mergeCorrections, usePerformanceStore } from "@/stores/performance-store";
import type { Side, SideCorrections, WedgeCorrection } from "@/types";

/**
 * Scalar correction sliders grouped into clinical sections. Pronation/supination
 * wedges (per foot + zone) use edge/unit toggles and auto-activate when value > 0.
 *
 * Section layout (per refined design):
 *  - Apex move lives under **Arch**.
 *  - **Flanges** is its own dedicated section.
 *  - **Heel** holds heel cup depth, heel cup width and the new heel lift.
 */
const FIELDS: { key: keyof SideCorrections; label: string; min: number; max: number; group: string }[] = [
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

const GROUPS = ["Skive", "Arch", "Heel", "Flanges"];

const WEDGE_ZONES = [
    { zone: "rearfoot" as const, label: "Rearfoot" },
    { zone: "forefoot" as const, label: "Forefoot" },
];

const SIDE_LABELS: Record<Side, string> = { left: "Left", right: "Right" };

const previewCorrection = rafThrottle((side: Side, patch: Partial<SideCorrections>) => {
    usePerformanceStore.getState().setCorrectionPreview(side, patch);
});

type WedgeEdge = "lateral" | "medial";
type WedgeUnit = "deg" | "mm";

interface TogglePairProps<T extends string> {
    options: { value: T; label: string }[];
    value: T;
    onChange: (value: T) => void;
    ariaLabel: string;
}

function TogglePair<T extends string>({ options, value, onChange, ariaLabel }: TogglePairProps<T>) {
    return (
        <fieldset className="m-0 grid grid-cols-2 gap-1 border-0 p-0">
            <legend className="sr-only">{ariaLabel}</legend>
            {options.map((option) => (
                <button
                    key={option.value}
                    type="button"
                    onClick={() => onChange(option.value)}
                    className={cn(
                        "rounded border px-1 py-0.5 text-center text-[10px] capitalize",
                        value === option.value
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:bg-muted",
                    )}
                >
                    {option.label}
                </button>
            ))}
        </fieldset>
    );
}

interface WedgeSideControlProps {
    side: Side;
    zoneLabel: string;
    wedge: WedgeCorrection | undefined;
    onPreview: (wedge: WedgeCorrection | undefined) => void;
    onCommit: (wedge: WedgeCorrection | undefined) => void;
}

function wedgeFromState(edge: WedgeEdge, value: number, unit: WedgeUnit): WedgeCorrection | undefined {
    if (value <= 0) return undefined;
    return { side: edge, value, unit };
}

function wedgeMaxForUnit(unit: WedgeUnit): number {
    return unit === "deg" ? 12 : 10;
}

/** One foot column: edge toggle, value input, and unit toggle. Active when value > 0. */
function WedgeSideControl({ side, zoneLabel, wedge, onPreview, onCommit }: WedgeSideControlProps) {
    const [draftEdge, setDraftEdge] = useState<WedgeEdge>("lateral");
    const [draftUnit, setDraftUnit] = useState<WedgeUnit>("deg");
    const [draftValue, setDraftValue] = useState(0);

    const activeEdge = wedge?.side ?? draftEdge;
    const activeUnit = wedge?.unit ?? draftUnit;
    const activeValue = wedge?.value ?? draftValue;
    const max = wedgeMaxForUnit(activeUnit);
    const unitLabel = activeUnit === "deg" ? "°" : "mm";

    const update = (edge: WedgeEdge, value: number, unit: WedgeUnit, commit: boolean) => {
        setDraftEdge(edge);
        setDraftUnit(unit);
        setDraftValue(value);
        const next = wedgeFromState(edge, value, unit);
        if (commit) {
            onCommit(next);
        } else {
            onPreview(next);
        }
    };

    return (
        <div className="space-y-1.5">
            <div className="text-[10px] font-medium text-primary/80">
                {SIDE_LABELS[side]} {zoneLabel}
            </div>
            <TogglePair
                ariaLabel={`${SIDE_LABELS[side]} ${zoneLabel} wedge edge`}
                options={[
                    { value: "lateral", label: "Lateral" },
                    { value: "medial", label: "Medial" },
                ]}
                value={activeEdge}
                onChange={(edge) => update(edge, activeValue, activeUnit, true)}
            />
            <SliderField
                label=""
                value={activeValue}
                min={0}
                max={max}
                step={0.5}
                unit={unitLabel}
                onPreview={(value) => update(activeEdge, value, activeUnit, false)}
                onChange={(value) => update(activeEdge, value, activeUnit, true)}
            />
            <TogglePair
                ariaLabel={`${SIDE_LABELS[side]} ${zoneLabel} wedge unit`}
                options={[
                    { value: "deg", label: "deg" },
                    { value: "mm", label: "mm" },
                ]}
                value={activeUnit}
                onChange={(unit) =>
                    update(activeEdge, Math.min(activeValue, wedgeMaxForUnit(unit)), unit, true)
                }
            />
        </div>
    );
}

export function CorrectionsPanel() {
    const design = useDesignStore((s) => s.design);
    const updateCorrection = useDesignStore((s) => s.updateCorrection);
    const setLinked = useDesignStore((s) => s.setLinked);
    const setThickness = useDesignStore((s) => s.setThickness);
    const setRearfootWedge = useDesignStore((s) => s.setRearfootWedge);
    const setForefootWedge = useDesignStore((s) => s.setForefootWedge);
    const { corrections } = design;
    const thicknessPreview = usePerformanceStore((s) => s.thicknessPreview);
    const setThicknessPreview = usePerformanceStore((s) => s.setThicknessPreview);
    const clearCorrectionPreview = usePerformanceStore((s) => s.clearCorrectionPreview);
    const correctionPreview = usePerformanceStore((s) => s.correctionPreview);

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
            <div className="flex items-center rounded-md bg-muted px-2 py-1.5">
                <button
                    type="button"
                    onClick={() => setLinked(!corrections.linked)}
                    className={cn(
                        "flex items-center gap-1.5 rounded px-2 py-1 text-xs",
                        corrections.linked ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                    )}
                >
                    {corrections.linked ? (
                        <Link2 className="h-3.5 w-3.5" />
                    ) : (
                        <Unlink className="h-3.5 w-3.5" />
                    )}
                    {corrections.linked ? "L+R linked" : "Independent"}
                </button>
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

            <div className="space-y-2 rounded-md border border-border bg-background/50 p-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Pronation/Supination
                </div>
                {showWedgeWarning && (
                    <div className="flex items-center gap-1.5 rounded bg-amber-500/10 p-1.5 text-[10px] text-amber-600">
                        <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                        <span>
                            Wedge value near clinical limit (clamped on change). Check the preview for its
                            effect on wall thickness.
                        </span>
                    </div>
                )}

                {WEDGE_ZONES.map(({ zone, label }, zoneIndex) => {
                    const wedgeKey = `${zone}Wedge` as "rearfootWedge" | "forefootWedge";
                    const setter = zone === "rearfoot" ? setRearfootWedge : setForefootWedge;
                    return (
                        <div key={zone} className={cn(zoneIndex > 0 && "border-t border-border pt-2")}>
                            <div className="grid grid-cols-2 gap-x-3">
                                {(["left", "right"] as Side[]).map((side) => (
                                    <WedgeSideControl
                                        key={side}
                                        side={side}
                                        zoneLabel={label}
                                        wedge={sideValues[side][wedgeKey] as WedgeCorrection | undefined}
                                        onPreview={(newW) =>
                                            previewCorrection(side, {
                                                [wedgeKey]: newW,
                                            } as Partial<SideCorrections>)
                                        }
                                        onCommit={(newW) => {
                                            setter(side, newW);
                                            clearCorrectionPreview();
                                        }}
                                    />
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>

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
                                        unit="mm"
                                        onPreview={(v) =>
                                            previewCorrection(side, {
                                                [f.key]: v,
                                            } as Partial<SideCorrections>)
                                        }
                                        onChange={(v) => {
                                            updateCorrection(side, {
                                                [f.key]: v,
                                            } as Partial<SideCorrections>);
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
