// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { useDesignStore } from "@/stores/design-store";
import {
    attachSoleUvFrameToRecipe,
    gyroidInfillPctForHardness,
    HARDNESS_NAMES,
    type HardnessName,
    type MaterialZoneV1,
    migratePrintRecipe,
} from "../../../shared/print-recipe/print-recipe";
import { HARDNESS_OVERLAY_COLORS, HARDNESS_ZONE_PRESETS } from "../../../shared/print-recipe/hardness-zone-presets";
import { qcSummaryForRecipe } from "../../../shared/print-recipe/zone-validation";
import { evaluateHardnessZonesForProduction } from "../../../shared/print-recipe/hardness-zone-guard";

function UvOverlay({ zones }: { zones: MaterialZoneV1[] }) {
    return (
        <div className="space-y-0.5">
            <p className="text-[10px] text-muted-foreground">
                Top-down UV map (sole footprint). Matches the tinted regions on the 3D insole; not a scan photo.
            </p>
            <svg viewBox="0 0 100 50" className="h-24 w-full rounded border border-border bg-muted/30">
            <rect x={0} y={0} width={100} height={50} fill="rgba(255,255,255,0.04)" />
            {zones.map((z) => {
                const pts = z.boundarySoleUv.map((p) => `${p.u * 100},${((1 - p.v) / 2) * 50}`).join(" ");
                const fill = HARDNESS_OVERLAY_COLORS[z.hardnessName] ?? "rgba(255,255,255,0.2)";
                return (
                    <polygon key={z.zoneId} points={pts} fill={fill} stroke="rgba(255,255,255,0.35)" strokeWidth={0.4} />
                );
            })}
            <text x={2} y={6} className="fill-muted-foreground text-[3px]">
                heel → toe
            </text>
        </svg>
        </div>
    );
}

export function HardnessZonesPanel() {
    const design = useDesignStore((s) => s.design);
    const {
        addHardnessZoneFromPreset,
        removeHardnessZone,
        clearHardnessZones,
        setOverrideSoftWins,
        updateHardnessZoneHardness,
    } = useDesignStore();
    const [expanded, setExpanded] = useState(false);

    const recipe = migratePrintRecipe(design.printRecipe);
    const layout = insoleLayoutFromDesign(design);
    const enriched = attachSoleUvFrameToRecipe(recipe, layout.lengthMm, layout.widthMm);
    const zones = enriched.zones;

    const productionGate = useMemo(
        () => evaluateHardnessZonesForProduction(recipe, layout.lengthMm, layout.widthMm),
        [recipe, layout.lengthMm, layout.widthMm],
    );
    const validation = productionGate.issues;

    const qcRows = useMemo(() => qcSummaryForRecipe(enriched), [enriched]);
    const hasAccommodative = zones.some((z) => z.lesionTags?.includes("accommodative"));

    const showZonesUi = expanded || zones.length > 0;

    return (
        <div className="space-y-2 rounded-md border border-border p-2">
            <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Hardness zones
                </div>
                {!showZonesUi ? (
                    <Button type="button" size="sm" variant="secondary" className="h-7 text-xs" onClick={() => setExpanded(true)}>
                        Add zone
                    </Button>
                ) : null}
            </div>

            {!showZonesUi ? (
                <p className="text-[10px] text-muted-foreground">
                    Single device hardness ({recipe.defaultHardness},{" "}
                    {gyroidInfillPctForHardness(recipe.defaultHardness)}% gyroid target). Add a zone for regional
                    stiffness.
                </p>
            ) : null}

            {showZonesUi ? (
                <>
                    <UvOverlay zones={zones} />
                    <div className="flex flex-wrap gap-1">
                        {HARDNESS_ZONE_PRESETS.map((preset) => (
                            <Button
                                key={preset.id}
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 text-[10px]"
                                onClick={() => addHardnessZoneFromPreset(preset.id, recipe.defaultHardness)}
                            >
                                + {preset.label}
                            </Button>
                        ))}
                    </div>

                    {zones.length ? (
                        <p className="text-[10px] text-muted-foreground">
                            Areas you do not cover with a zone keep{" "}
                            <span className="text-foreground">{recipe.defaultHardness}</span> (
                            {gyroidInfillPctForHardness(recipe.defaultHardness)}% gyroid target).
                        </p>
                    ) : null}

                    {zones.length ? (
                        <ul className="space-y-1">
                            {zones.map((z) => (
                                <li
                                    key={z.zoneId}
                                    className="flex items-center gap-2 rounded border border-border bg-background/40 px-2 py-1 text-[10px]"
                                >
                                    <span
                                        className="h-3 w-3 shrink-0 rounded-sm border border-white/20"
                                        style={{ background: HARDNESS_OVERLAY_COLORS[z.hardnessName] }}
                                    />
                                    <span className="flex-1 truncate">{z.anatomicLabel}</span>
                                    <select
                                        className="rounded border border-border bg-background px-1 py-0.5 text-[10px]"
                                        value={z.hardnessName}
                                        onChange={(e) =>
                                            updateHardnessZoneHardness(z.zoneId, e.target.value as HardnessName)
                                        }
                                    >
                                        {HARDNESS_NAMES.map((h) => (
                                            <option key={h} value={h}>
                                                {h} ({gyroidInfillPctForHardness(h)}%)
                                            </option>
                                        ))}
                                    </select>
                                    <button
                                        type="button"
                                        className="text-muted-foreground hover:text-foreground"
                                        onClick={() => removeHardnessZone(z.zoneId)}
                                    >
                                        ×
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-[10px] text-muted-foreground">No zones yet — pick a preset or keep uniform hardness.</p>
                    )}

                    {hasAccommodative ? (
                        <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
                            <input
                                type="checkbox"
                                checked={!!recipe.overrideSoftWins}
                                onChange={(e) => setOverrideSoftWins(e.target.checked)}
                            />
                            Override soft-wins (QC audit: explicit hardness wins over accommodative tags)
                        </label>
                    ) : null}

                    {validation.length ? (
                        <div
                            className="space-y-0.5 rounded border border-amber-500/40 bg-amber-500/10 p-1.5 text-[10px] text-amber-200"
                            role="alert"
                        >
                            <p className="font-semibold">Fix zones before production G-code</p>
                            {validation.map((v) => (
                                <p key={`${v.code}-${v.message}`}>{v.message}</p>
                            ))}
                        </div>
                    ) : null}

                    <div className="space-y-0.5 rounded bg-muted/40 p-1.5 text-[10px]">
                        <div className="font-semibold text-muted-foreground">QC summary</div>
                        {qcRows.map((row) => (
                            <div key={row.anatomicLabel} className="flex justify-between gap-2 tabular-nums">
                                <span>{row.anatomicLabel}</span>
                                <span>
                                    {row.hardnessName} · {row.gyroidPct}% gyroid
                                    {row.profileId ? ` · ${row.profileId}` : ""}
                                </span>
                            </div>
                        ))}
                        {zones.length ? (
                            <p className="pt-0.5 text-muted-foreground">
                                Remainder uses device hardness ({recipe.defaultHardness}) everywhere outside
                                listed zones.
                            </p>
                        ) : null}
                    </div>

                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-full text-xs text-muted-foreground"
                        onClick={() => {
                            clearHardnessZones();
                            setExpanded(false);
                        }}
                    >
                        Undo to uniform hardness
                    </Button>
                </>
            ) : null}
        </div>
    );
}
