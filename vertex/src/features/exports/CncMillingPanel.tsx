// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Download, Loader2, Lock, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { exportCncGcode } from "@/features/exports/export-service";
import { canExport, TOKEN_COST } from "@/features/licensing/license";
import type { HeelDirection, ToolType } from "@/lib/cnc/types";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { useDesignStore } from "@/stores/design-store";
import { useMillingProfileStore } from "@/stores/milling-profile-store";
import type { Side } from "@/types";

function Field({
    label,
    value,
    unit,
    onChange,
    disabled,
}: {
    label: string;
    value: number;
    unit?: string;
    onChange: (v: number) => void;
    disabled?: boolean;
}) {
    const id = `cnc-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    return (
        <label htmlFor={id} className="block space-y-0.5">
            <span className="text-[10px] text-muted-foreground">{label}</span>
            <span className="flex items-center gap-1">
                <Input
                    id={id}
                    type="number"
                    className="h-7 text-xs"
                    value={value}
                    disabled={disabled}
                    onChange={(e) => onChange(Number(e.target.value))}
                />
                {unit ? <span className="text-[10px] text-muted-foreground">{unit}</span> : null}
            </span>
        </label>
    );
}

export function CncMillingPanel() {
    const { user, license } = useAuthStore();
    const { design, exportSide } = useDesignStore();
    const { profile, setProfile, resetIdaho } = useMillingProfileStore();
    const [status, setStatus] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [feet, setFeet] = useState<"active" | "both">("both");
    const gcodeCheck = canExport(user, license, "gcode");

    const onExport = async () => {
        setBusy(true);
        setStatus("Generating CNC G-code…");
        const sides: Side[] = feet === "both" && design.paired ? ["left", "right"] : [exportSide];
        try {
            const res = await exportCncGcode(sides, profile);
            setStatus(res.ok ? `Exported ${res.filename}` : (res.reason ?? "CNC export failed"));
        } catch (e) {
            setStatus(e instanceof Error ? e.message : "CNC export failed");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
                <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Milling table
                    </div>
                    <div className="text-xs text-foreground">{profile.name}</div>
                </div>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={resetIdaho}>
                    <RotateCcw className="h-3 w-3" /> Idaho
                </Button>
            </div>

            <div className="rounded-md border border-border bg-muted/40 px-2 py-1.5 text-[10px] text-muted-foreground">
                Founder-confirmed Idaho layout: heel toward X0 (left), toe right; one insole per pocket,
                stacked in Y, pockets are full-width table halves. Top offset 2.5 mm is a horizontal overrun
                ring around the outline (not Z). Contour: 10 mm ball (DAMEN VHM D10); flat remains selectable.
            </div>

            <div className="grid grid-cols-2 gap-2">
                <label htmlFor="cnc-heel-direction" className="block space-y-0.5">
                    <span className="text-[10px] text-muted-foreground">Heel direction</span>
                    <select
                        id="cnc-heel-direction"
                        className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs"
                        value={profile.heelDirection}
                        onChange={(e) => setProfile({ heelDirection: e.target.value as HeelDirection })}
                    >
                        <option value="x0">Heel toward X0 (left)</option>
                        <option value="xmax">Heel toward +X</option>
                    </select>
                </label>
                <label htmlFor="cnc-contour-tool" className="block space-y-0.5">
                    <span className="text-[10px] text-muted-foreground">Contour tool</span>
                    <select
                        id="cnc-contour-tool"
                        className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs"
                        value={profile.contourCutter.type}
                        onChange={(e) =>
                            setProfile({
                                contourCutter: {
                                    ...profile.contourCutter,
                                    type: e.target.value as ToolType,
                                },
                            })
                        }
                    >
                        <option value="ball">10 mm ball (DAMEN VHM D10)</option>
                        <option value="flat">10 mm flat</option>
                    </select>
                </label>
            </div>
            {profile.contourCutter.type === "ball" ? (
                <p className="text-[10px] text-amber-400">
                    Ball contour: lowest 5 mm of the wall will be filleted.
                </p>
            ) : null}

            <div className="grid grid-cols-2 gap-2">
                <Field
                    label="Top offset (XY ring)"
                    value={profile.topOffsetMm}
                    unit="mm"
                    onChange={(v) => setProfile({ topOffsetMm: v })}
                />
                <Field
                    label="Free height"
                    value={profile.freeMovementHeightMm}
                    unit="mm"
                    onChange={(v) => setProfile({ freeMovementHeightMm: v })}
                />
                <Field
                    label="Extra movement"
                    value={profile.extraMovementMm}
                    unit="mm"
                    onChange={(v) => setProfile({ extraMovementMm: v })}
                />
                <Field
                    label="Layered"
                    value={profile.layeredMm}
                    unit="mm"
                    onChange={(v) => setProfile({ layeredMm: v })}
                />
                <Field
                    label="Table W"
                    value={profile.tableWidthMm}
                    unit="mm"
                    onChange={(v) => setProfile({ tableWidthMm: v })}
                />
                <Field
                    label="Table L"
                    value={profile.tableLengthMm}
                    unit="mm"
                    onChange={(v) => setProfile({ tableLengthMm: v })}
                />
                <Field
                    label="Material H"
                    value={profile.materialHeightMm}
                    unit="mm"
                    onChange={(v) => setProfile({ materialHeightMm: v })}
                />
                <Field
                    label="Z-offset"
                    value={profile.zOffsetCorrectionMm}
                    unit="mm"
                    onChange={(v) => setProfile({ zOffsetCorrectionMm: v })}
                />
            </div>

            <div className="text-[10px] text-muted-foreground">
                Feeds mm/min · dip {profile.topFeeds.dip} · normal {profile.topFeeds.normal} · slow{" "}
                {profile.topFeeds.slow} · contour {profile.topFeeds.contour}
            </div>

            <div className="flex gap-1">
                {(["both", "active"] as const).map((f) => (
                    <button
                        key={f}
                        type="button"
                        onClick={() => setFeet(f)}
                        className={cn(
                            "flex-1 rounded-md border px-2 py-1 text-[10px]",
                            feet === f
                                ? "border-primary bg-primary/10"
                                : "border-border text-muted-foreground",
                        )}
                    >
                        {f === "both" ? "Both pockets (L+R)" : "Active foot only"}
                    </button>
                ))}
            </div>

            <Button className="w-full" disabled={busy || !gcodeCheck.ok} onClick={onExport}>
                {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                ) : gcodeCheck.ok ? (
                    <Download className="h-4 w-4" />
                ) : (
                    <Lock className="h-4 w-4" />
                )}
                {busy ? "Exporting CNC…" : `Mill · Export CNC G-code · ${TOKEN_COST.gcode} tokens`}
            </Button>
            {!gcodeCheck.ok ? <p className="text-xs text-amber-400">{gcodeCheck.reason}</p> : null}
            {status ? <p className="rounded-md bg-muted px-2 py-1.5 text-xs">{status}</p> : null}
        </div>
    );
}
