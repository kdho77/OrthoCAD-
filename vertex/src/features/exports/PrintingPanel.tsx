import { Cpu, Download, Lock, Printer, Play } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { SliderField } from "@/components/ui/slider-field";
import { getKernel } from "@/lib/chili3d/kernel";
import { insoleParamsFromDesign } from "@/lib/geometry/kernel-build";
import { type CamOverrides, type CamResult, generateGcode, presetsForMethod } from "@/lib/kiri";
import { canExport, TOKEN_COST } from "@/features/licensing/license";
import { exportGcode, generateHybridGcode, type GrindingStyleInput } from "@/features/exports/export-service";
import { useAuthStore } from "@/stores/auth-store";
import { useDesignStore } from "@/stores/design-store";
import { cn } from "@/lib/utils";
import type { Side } from "@/types";

function fmtTime(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function PrintingPanel() {
    const { user, license } = useAuthStore();
    const { design } = useDesignStore();
    const [side, setSide] = useState<Side>("left");
    const [layerHeight, setLayerHeight] = useState(0.3);
    const [infill, setInfill] = useState(25);
    const [toolDia, setToolDia] = useState(6);
    const [result, setResult] = useState<CamResult | null>(null);
    const [status, setStatus] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    // Hybrid manufacturing (server-side solid + G-code) controls
    const [grindingStyle, setGrindingStyle] = useState<GrindingStyleInput>({ type: "straight", angle_degrees: 8 });

    const presets = useMemo(() => presetsForMethod(design.method), [design.method]);
    const [presetId, setPresetId] = useState(presets[0]?.id ?? "");
    const preset = presets.find((p) => p.id === presetId) ?? presets[0];

    const isBeltPreset = !!preset?.beltAngleDeg;

    const isCnc = design.method === "milling_3axis";
    const gcodeCheck = canExport(user, license, "gcode");

    const overrides: CamOverrides = isCnc
        ? { toolDiameterMm: toolDia }
        : { layerHeightMm: layerHeight, infillDensity: infill / 100 };

    const buildGeom = () => getKernel().buildInsole(insoleParamsFromDesign(design, side, "full"));

    const onPreview = () => {
        if (!preset) return;
        setBusy(true);
        setStatus(null);
        try {
            setResult(generateGcode(buildGeom(), preset, overrides));
        } catch (e) {
            setStatus(e instanceof Error ? e.message : "Toolpath generation failed");
        } finally {
            setBusy(false);
        }
    };

    const onExport = async () => {
        if (!preset) return;
        setBusy(true);
        const res = await exportGcode(side, preset, overrides);
        setStatus(res.ok ? `Exported ${res.filename} (-${TOKEN_COST.gcode} tokens)` : (res.reason ?? "Export failed"));
        if (res.ok && res.stats) setResult((r) => (r ? r : { gcode: "", stats: res.stats!, moveCount: 0 }));
        setBusy(false);
    };

    const onHybridGenerate = async () => {
        if (!preset || !isBeltPreset) return;
        setBusy(true);
        setStatus("Generating hybrid G-code on server (authoritative solid + belt transform + slicing)…");
        setResult(null);
        try {
            // The helper (generateHybridGcode) derives baseAssetId (and baseGlbUrl) internally
            // from the current design state in useDesignStore at the time of the call.
            // This is the canonical place that assembles the full server payload.
            // baseAssetId will be included (when a base is active) so the server can do
            // authoritative CustomPrefab lookup + signed URL (see export-service.ts).
            // designId is also passed when an active persisted design exists.
            const res = await generateHybridGcode(side, preset, grindingStyle, overrides);
            if (res.ok) {
                const idPart = res.productionId ? ` [production ${res.productionId}]` : '';
                setStatus(`Hybrid G-code exported ${res.filename || 'file'}${idPart} (server-side generation; tokens deducted on success)`);
            } else {
                setStatus(res.reason ?? "Hybrid generation failed");
            }
            // Note: the hybrid path handles its own download + audit inside the service helper.
            // Improved feedback: status reflects server nature and success-only deduction.
        } catch (e) {
            setStatus(e instanceof Error ? e.message : "Hybrid G-code generation failed (unexpected error)");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex gap-1">
                {(["left", "right"] as Side[]).map((s) => (
                    <Button key={s} size="sm" variant={side === s ? "default" : "secondary"} className="h-8 flex-1" onClick={() => setSide(s)}>
                        {s} insole
                    </Button>
                ))}
            </div>

            <div className="space-y-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {isCnc ? "Mill preset" : "Printer preset"}
                </div>
                {presets.map((p) => (
                    <button
                        key={p.id}
                        type="button"
                        onClick={() => setPresetId(p.id)}
                        className={cn(
                            "flex w-full items-center gap-2 rounded-md border px-2 py-2 text-left text-xs",
                            presetId === p.id ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground",
                        )}
                    >
                        {isCnc ? <Cpu className="h-3.5 w-3.5" /> : <Printer className="h-3.5 w-3.5" />}
                        {p.name}
                        {p.beltAngleDeg ? <span className="ml-auto rounded bg-muted px-1 text-[10px]">belt {p.beltAngleDeg}°</span> : null}
                    </button>
                ))}
            </div>

            {isBeltPreset && (
                <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Grinding Style (server hybrid)
                    </div>
                    <div className="flex gap-2">
                        {(["straight", "rounded"] as const).map((t) => (
                            <button
                                key={t}
                                type="button"
                                onClick={() =>
                                    setGrindingStyle(
                                        t === "straight"
                                            ? { type: "straight", angle_degrees: 8 }
                                            : { type: "rounded", radius_mm: 3 },
                                    )
                                }
                                className={cn(
                                    "flex-1 rounded-md border px-2 py-1 text-xs",
                                    grindingStyle.type === t
                                        ? "border-primary bg-primary/10"
                                        : "border-border bg-background text-muted-foreground",
                                )}
                            >
                                {t === "straight" ? "Straight (draft)" : "Rounded (fillet)"}
                            </button>
                        ))}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                        {grindingStyle.type === "straight"
                            ? `Draft angle ${grindingStyle.angle_degrees ?? 8}°`
                            : `Fillet radius ${grindingStyle.radius_mm ?? 3} mm`}
                    </div>
                </div>
            )}

            {isCnc ? (
                <SliderField label="Tool diameter" value={toolDia} min={1} max={12} step={0.5} unit="mm" onChange={setToolDia} />
            ) : (
                <>
                    <SliderField label="Layer height" value={layerHeight} min={0.1} max={0.6} step={0.05} unit="mm" onChange={setLayerHeight} />
                    <SliderField label="Infill" value={infill} min={0} max={100} step={5} unit="%" onChange={setInfill} />
                </>
            )}

            <Button variant="secondary" className="w-full" disabled={busy || !preset} onClick={onPreview}>
                <Play className="h-4 w-4" /> {busy ? "Generating…" : "Generate toolpath"}
            </Button>

            {result ? (
                <div className="space-y-1 rounded-md border border-border bg-background/50 p-2 text-xs">
                    <Row label="Moves" value={result.moveCount.toLocaleString()} />
                    <Row label="Est. time" value={fmtTime(result.stats.estimatedTimeSec)} />
                    {!isCnc ? <Row label="Material" value={`${(result.stats.estimatedMaterialMm3 / 1000).toFixed(1)} cm³`} /> : null}
                    <Row label="Path length" value={`${((result.stats.extrudeDistanceMm + result.stats.travelDistanceMm) / 1000).toFixed(1)} m`} />
                </div>
            ) : null}

            <Button className="w-full" disabled={busy || !preset || !gcodeCheck.ok} onClick={onExport}>
                {gcodeCheck.ok ? <Download className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                Export G-code · {TOKEN_COST.gcode} tokens (client)
            </Button>

            {isBeltPreset && (
                <Button
                    variant="default"
                    className="w-full"
                    disabled={busy || !preset}
                    onClick={onHybridGenerate}
                    title="Uses server-side authoritative solid (Grinding Style sides) + belt pre-transform + slicing"
                >
                    <Download className="h-4 w-4" /> Generate Hybrid G-code (Server) — {grindingStyle.type}
                </Button>
            )}

            {!gcodeCheck.ok ? <p className="text-xs text-amber-400">{gcodeCheck.reason}</p> : null}
            {status ? <p className="rounded-md bg-muted px-2 py-1.5 text-xs">{status}</p> : null}

            <p className="text-xs text-muted-foreground">
                {preset?.beltAngleDeg
                    ? `Belt presets support client preview or server hybrid (Grinding Style + authoritative solid).`
                    : "In-house CAM engine (Kiri:Moto-compatible seam)."}
            </p>
        </div>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex justify-between">
            <span className="text-muted-foreground">{label}</span>
            <span className="capitalize tabular-nums">{value}</span>
        </div>
    );
}
