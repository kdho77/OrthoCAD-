import { Cpu, Download, Lock, Printer, Play } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { SliderField } from "@/components/ui/slider-field";
import { getKernel } from "@/lib/chili3d";
import { INSOLE_LENGTH_MM, INSOLE_WIDTH_MM } from "@/lib/geometry/layout";
import { type CamOverrides, type CamResult, generateGcode, presetsForMethod } from "@/lib/kiri";
import { canExport, TOKEN_COST } from "@/features/licensing/license";
import { exportGcode } from "@/features/exports/export-service";
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

    const presets = useMemo(() => presetsForMethod(design.method), [design.method]);
    const [presetId, setPresetId] = useState(presets[0]?.id ?? "");
    const preset = presets.find((p) => p.id === presetId) ?? presets[0];

    const isCnc = design.method === "milling_3axis";
    const gcodeCheck = canExport(user, license, "gcode");

    const overrides: CamOverrides = isCnc
        ? { toolDiameterMm: toolDia }
        : { layerHeightMm: layerHeight, infillDensity: infill / 100 };

    const buildGeom = () =>
        getKernel().buildInsole({
            side,
            lengthMm: INSOLE_LENGTH_MM,
            widthMm: INSOLE_WIDTH_MM,
            thicknessMm: design.thicknessMm,
            corrections: design.corrections[side],
            elements: design.elements.filter((e) => e.side === side),
        });

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
                Export G-code · {TOKEN_COST.gcode} tokens
            </Button>
            {!gcodeCheck.ok ? <p className="text-xs text-amber-400">{gcodeCheck.reason}</p> : null}
            {status ? <p className="rounded-md bg-muted px-2 py-1.5 text-xs">{status}</p> : null}

            <p className="text-xs text-muted-foreground">
                {preset?.beltAngleDeg
                    ? `Belt mode applies a ${preset.beltAngleDeg}° gantry transform for continuous TPU printing.`
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
