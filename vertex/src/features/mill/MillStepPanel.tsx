// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { RotateCcw } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CncMillingPanel } from "@/features/exports/CncMillingPanel";
import { evaluatePlacedPart, placeWorkpieces } from "@/lib/cnc/placement";
import { cn } from "@/lib/utils";
import { useMillingProfileStore } from "@/stores/milling-profile-store";
import { SIDE_LABELS, type Side } from "@/types";
import { useMillWorkpieces } from "./use-mill-workpieces";

function normalizeDeg(deg: number): number {
    const n = ((((deg + 180) % 360) + 360) % 360) - 180;
    return Math.abs(n) < 1e-9 ? 0 : n;
}

export function MillStepPanel() {
    const { parts, loading } = useMillWorkpieces();
    const profile = useMillingProfileStore((s) => s.profile);
    const placements = useMillingProfileStore((s) => s.placements);
    const millSelected = useMillingProfileStore((s) => s.millSelected);
    const setMillSelected = useMillingProfileStore((s) => s.setMillSelected);
    const patchPlacement = useMillingProfileStore((s) => s.patchPlacement);
    const resetPlacements = useMillingProfileStore((s) => s.resetPlacements);

    const placed = useMemo(() => {
        try {
            return placeWorkpieces(profile, parts, placements, { validate: false });
        } catch {
            return [];
        }
    }, [profile, parts, placements]);

    const targetSide: Side | null = millSelected ?? placed[0]?.side ?? null;
    const target = placed.find((p) => p.side === targetSide) ?? null;
    const issue = target ? evaluatePlacedPart(target, profile) : null;
    const issues = placed
        .map((p) => ({ side: p.side, issue: evaluatePlacedPart(p, profile) }))
        .filter((x) => !x.issue.ok);

    const applyRotation = (nextDeg: number) => {
        if (!target) return;
        if (millSelected !== target.side) setMillSelected(target.side);
        patchPlacement(target.side, {
            tx: target.tx,
            ty: target.ty,
            rotationDeg: normalizeDeg(nextDeg),
        });
    };

    return (
        <div className="space-y-3">
            <div className="rounded-md border border-primary/30 bg-primary/5 px-2 py-2 text-[11px] leading-snug text-foreground">
                <p className="font-medium">Recommended path</p>
                <p className="mt-1 text-muted-foreground">
                    Place each insole in its pocket (heel toward X0, left edge by default), then export CNC
                    G-code. Drag to move, use the handle or angle controls to rotate. Parts that leave the
                    pocket or table turn red — export still runs and reports the reason.
                </p>
            </div>

            <div className="space-y-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Placement
                </div>
                <div className="flex gap-1">
                    {placed.map((p) => (
                        <button
                            key={p.side}
                            type="button"
                            onClick={() => setMillSelected(p.side)}
                            className={cn(
                                "flex-1 rounded-md border px-2 py-1 text-[10px]",
                                millSelected === p.side
                                    ? "border-primary bg-primary/10 text-foreground"
                                    : "border-border text-muted-foreground",
                            )}
                        >
                            {SIDE_LABELS[p.side]}
                        </button>
                    ))}
                </div>
                {loading ? (
                    <p className="text-[10px] text-muted-foreground">Loading insole geometry…</p>
                ) : target ? (
                    <p className="text-[10px] text-muted-foreground">
                        {SIDE_LABELS[target.side]} · x {target.tx.toFixed(2)} mm · y {target.ty.toFixed(2)} mm
                    </p>
                ) : (
                    <p className="text-[10px] text-muted-foreground">No insole geometry to place.</p>
                )}
            </div>

            <div className="space-y-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Rotate
                </div>
                <div className="flex flex-wrap gap-1">
                    {([-90, -5, 5, 90] as const).map((d) => (
                        <Button
                            key={d}
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="h-7 flex-1 px-2 text-[10px]"
                            disabled={!target}
                            onClick={() => applyRotation((target?.rotationDeg ?? 0) + d)}
                        >
                            {d > 0 ? `+${d}°` : `${d}°`}
                        </Button>
                    ))}
                </div>
                <label htmlFor="mill-rotation-deg" className="block space-y-0.5">
                    <span className="text-[10px] text-muted-foreground">Free angle (deg CCW)</span>
                    <Input
                        id="mill-rotation-deg"
                        type="number"
                        step={0.1}
                        className="h-7 text-xs"
                        disabled={!target}
                        value={target ? Number(target.rotationDeg.toFixed(2)) : 0}
                        onChange={(e) => applyRotation(Number(e.target.value))}
                    />
                </label>
            </div>

            <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 w-full text-[11px]"
                onClick={() => resetPlacements()}
            >
                <RotateCcw className="h-3 w-3" />
                Reset to default (left edge)
            </Button>

            {issues.length > 0 ? (
                <div className="space-y-1 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">
                    {issues.map((x) => (
                        <p key={x.side}>
                            {SIDE_LABELS[x.side]}: {x.issue.reason}
                        </p>
                    ))}
                </div>
            ) : issue?.ok ? (
                <p className="text-[10px] text-muted-foreground">Placement is inside the pocket and table.</p>
            ) : null}

            <CncMillingPanel />
        </div>
    );
}
