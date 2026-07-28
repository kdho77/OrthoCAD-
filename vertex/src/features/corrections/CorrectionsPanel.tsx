// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AlertTriangle, Link2, Lock, Unlink, Unlock } from "lucide-react";
import { useMemo, useState } from "react";
import { SliderField } from "@/components/ui/slider-field";
import { constrainDesignCorrections, hasWedgeViolations } from "@/lib/geometry/clinical-constraints";
import {
    SKIVE_ANGLE_MAX_DEG,
    SKIVE_ANGLE_MIN_DEG,
    SKIVE_DEFAULT_ANGLE_DEG,
    solveSkiveDerived,
} from "@/lib/geometry/heel-skive";
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
 *  - **Skive** is a dedicated Kirby control (depth + angle/location solver).
 */
const FIELDS: { key: keyof SideCorrections; label: string; min: number; max: number; group: string }[] = [
    { key: "archHeightMm", label: "Arch height", min: 0, max: 18, group: "Arch" },
    { key: "archFillMm", label: "Arch fill", min: 0, max: 12, group: "Arch" },
    { key: "apexMoveMm", label: "Apex move", min: -12, max: 12, group: "Arch" },
    { key: "heelCupDepthMm", label: "Heel cup depth", min: 0, max: 10, group: "Heel" },
    { key: "heelCupWidthMm", label: "Heel cup width", min: 0, max: 10, group: "Heel" },
    { key: "heelLiftMm", label: "Heel lift", min: 0, max: 20, group: "Heel" },
    { key: "medialFlangeMm", label: "Medial flange", min: 0, max: 8, group: "Flanges" },
    { key: "lateralFlangeMm", label: "Lateral flange", min: 0, max: 8, group: "Flanges" },
];

const GROUPS = ["Arch", "Heel", "Flanges"];

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

interface SkiveSideControlProps {
    side: Side;
    values: SideCorrections;
    onPreview: (patch: Partial<SideCorrections>) => void;
    onCommit: (patch: Partial<SideCorrections>) => void;
}

/**
 * Kirby skive controls: depth drivers + angle/location with D6 lock.
 * Effect copy is moment language — not degrees of correction or predicted motion.
 */
function SkiveSideControl({ side, values, onPreview, onCommit }: SkiveSideControlProps) {
    const driven = values.skiveDriven ?? "location";
    const angleDeg = values.skiveAngleDeg ?? SKIVE_DEFAULT_ANGLE_DEG;
    const depthForSolve = Math.max(values.medialSkiveMm, values.lateralSkiveMm);
    const derived = solveSkiveDerived({
        depthMm: depthForSolve,
        angleDeg,
        locationPct: values.skiveLocationPct ?? 50,
        driven,
        heelWidthMm: 70,
    });
    const locationPct =
        driven === "location" ? derived.locationPct : (values.skiveLocationPct ?? derived.locationPct);
    const displayAngle = driven === "angle" ? derived.angleDeg : angleDeg;

    const push = (patch: Partial<SideCorrections>, commit: boolean) => {
        if (commit) onCommit(patch);
        else onPreview(patch);
    };

    const toggleDriven = () => {
        const next = driven === "location" ? "angle" : "location";
        // Promoting a derived field locks it; the other becomes derived.
        onCommit({
            skiveDriven: next,
            skiveAngleDeg: displayAngle,
            skiveLocationPct: locationPct,
        });
    };

    return (
        <div className="space-y-2">
            <div className="text-[10px] uppercase text-primary/80">{SIDE_LABELS[side]}</div>
            <SliderField
                label="Medial depth"
                value={values.medialSkiveMm}
                min={0}
                max={8}
                step={0.5}
                unit="mm"
                onPreview={(v) => push({ medialSkiveMm: v }, false)}
                onChange={(v) => push({ medialSkiveMm: v }, true)}
            />
            <div className="text-[10px] text-muted-foreground">supination moment</div>
            <SliderField
                label="Lateral depth"
                value={values.lateralSkiveMm}
                min={0}
                max={8}
                step={0.5}
                unit="mm"
                onPreview={(v) => push({ lateralSkiveMm: v }, false)}
                onChange={(v) => push({ lateralSkiveMm: v }, true)}
            />
            <div className="text-[10px] text-muted-foreground">pronation moment</div>
            <div className="flex items-center gap-1">
                <div className="min-w-0 flex-1">
                    <SliderField
                        label="Angle"
                        value={displayAngle}
                        min={SKIVE_ANGLE_MIN_DEG}
                        max={SKIVE_ANGLE_MAX_DEG}
                        step={1}
                        unit="deg"
                        onPreview={(v) =>
                            push(
                                {
                                    skiveAngleDeg: v,
                                    skiveDriven: "location",
                                    skiveLocationPct: solveSkiveDerived({
                                        depthMm: depthForSolve,
                                        angleDeg: v,
                                        locationPct,
                                        driven: "location",
                                        heelWidthMm: 70,
                                    }).locationPct,
                                },
                                false,
                            )
                        }
                        onChange={(v) =>
                            push(
                                {
                                    skiveAngleDeg: v,
                                    skiveDriven: "location",
                                    skiveLocationPct: solveSkiveDerived({
                                        depthMm: depthForSolve,
                                        angleDeg: v,
                                        locationPct,
                                        driven: "location",
                                        heelWidthMm: 70,
                                    }).locationPct,
                                },
                                true,
                            )
                        }
                    />
                </div>
                <button
                    type="button"
                    title={driven === "location" ? "Angle locked (location derived)" : "Unlock angle"}
                    onClick={toggleDriven}
                    className="mt-4 rounded border border-border p-1 text-muted-foreground hover:bg-muted"
                >
                    {driven === "location" ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                </button>
            </div>
            <div className="flex items-center gap-1">
                <div className="min-w-0 flex-1">
                    <SliderField
                        label="Location"
                        value={Math.round(locationPct)}
                        min={0}
                        max={100}
                        step={1}
                        unit="%"
                        onPreview={(v) =>
                            push(
                                {
                                    skiveLocationPct: v,
                                    skiveDriven: "angle",
                                    skiveAngleDeg: solveSkiveDerived({
                                        depthMm: depthForSolve,
                                        angleDeg: displayAngle,
                                        locationPct: v,
                                        driven: "angle",
                                        heelWidthMm: 70,
                                    }).angleDeg,
                                },
                                false,
                            )
                        }
                        onChange={(v) =>
                            push(
                                {
                                    skiveLocationPct: v,
                                    skiveDriven: "angle",
                                    skiveAngleDeg: solveSkiveDerived({
                                        depthMm: depthForSolve,
                                        angleDeg: displayAngle,
                                        locationPct: v,
                                        driven: "angle",
                                        heelWidthMm: 70,
                                    }).angleDeg,
                                },
                                true,
                            )
                        }
                    />
                </div>
                <button
                    type="button"
                    title={driven === "angle" ? "Location locked (angle derived)" : "Unlock location"}
                    onClick={toggleDriven}
                    className="mt-4 rounded border border-border p-1 text-muted-foreground hover:bg-muted"
                >
                    {driven === "angle" ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                </button>
            </div>
        </div>
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

    // mergeCorrections reads live preview from the performance store; keep
    // correctionPreview in deps so slider drags re-render committed+preview values.
    const sideValues = useMemo(() => {
        void correctionPreview;
        return {
            left: mergeCorrections("left", corrections.left),
            right: mergeCorrections("right", corrections.right),
        };
    }, [corrections, correctionPreview]);

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

            <div className="space-y-2 rounded-md border border-border bg-background/50 p-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Skive
                </div>
                <div className="grid grid-cols-2 gap-x-3">
                    {(["left", "right"] as Side[]).map((side) => (
                        <SkiveSideControl
                            key={side}
                            side={side}
                            values={sideValues[side]}
                            onPreview={(patch) => previewCorrection(side, patch)}
                            onCommit={(patch) => {
                                const preview = usePerformanceStore.getState().correctionPreview[side] ?? {};
                                updateCorrection(side, { ...preview, ...patch });
                                clearCorrectionPreview();
                            }}
                        />
                    ))}
                </div>
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
                                            if (f.key === "heelCupDepthMm") {
                                                console.log("[HC-DEPTH] panel:onChange:pre", {
                                                    ts: performance.now(),
                                                    side,
                                                    requested: v,
                                                    storeBefore:
                                                        useDesignStore.getState().design.corrections[side]
                                                            .heelCupDepthMm,
                                                });
                                            }
                                            // Flush sibling preview fields so committing one slider
                                            // does not wipe uncommitted values from other sliders
                                            // (e.g. depth preview lost when width pointer-up fires).
                                            const preview =
                                                usePerformanceStore.getState().correctionPreview[side] ?? {};
                                            updateCorrection(side, {
                                                ...preview,
                                                [f.key]: v,
                                            } as Partial<SideCorrections>);
                                            if (f.key === "heelCupDepthMm") {
                                                console.log("[HC-DEPTH] panel:onChange:post", {
                                                    ts: performance.now(),
                                                    side,
                                                    requested: v,
                                                    storeAfter:
                                                        useDesignStore.getState().design.corrections[side]
                                                            .heelCupDepthMm,
                                                    previewAfter:
                                                        usePerformanceStore.getState().correctionPreview,
                                                });
                                            }
                                            clearCorrectionPreview();
                                            if (f.key === "heelCupDepthMm") {
                                                console.log("[HC-DEPTH] panel:previewCleared", {
                                                    ts: performance.now(),
                                                    store: useDesignStore.getState().design.corrections[side]
                                                        .heelCupDepthMm,
                                                    preview: usePerformanceStore.getState().correctionPreview,
                                                });
                                            }
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
