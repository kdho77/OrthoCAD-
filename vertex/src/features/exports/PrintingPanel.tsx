import { Printer } from "lucide-react";
import { useState } from "react";
import { PRINTER_PRESETS } from "@/lib/kiri";
import { cn } from "@/lib/utils";

export function PrintingPanel() {
    const [presetId, setPresetId] = useState(PRINTER_PRESETS[0].id);
    const preset = PRINTER_PRESETS.find((p) => p.id === presetId) ?? PRINTER_PRESETS[0];

    return (
        <div className="space-y-3">
            <div className="space-y-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Printer preset</div>
                {PRINTER_PRESETS.map((p) => (
                    <button
                        key={p.id}
                        type="button"
                        onClick={() => setPresetId(p.id)}
                        className={cn(
                            "flex w-full items-center gap-2 rounded-md border px-2 py-2 text-left text-xs",
                            presetId === p.id ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground",
                        )}
                    >
                        <Printer className="h-3.5 w-3.5" />
                        {p.name}
                    </button>
                ))}
            </div>

            <div className="space-y-1 rounded-md border border-border bg-background/50 p-2 text-xs">
                <Row label="Method" value={preset.method.replace("_", " ")} />
                {preset.beltAngleDeg !== undefined ? <Row label="Belt angle" value={`${preset.beltAngleDeg}°`} /> : null}
                {preset.nozzleMm !== undefined ? <Row label="Nozzle" value={`${preset.nozzleMm} mm`} /> : null}
                {preset.layerHeightMm !== undefined ? <Row label="Layer height" value={`${preset.layerHeightMm} mm`} /> : null}
                {preset.material ? <Row label="Material" value={preset.material} /> : null}
                <Row label="Bed" value={`${preset.bed.x}×${preset.bed.y === 100000 ? "∞" : preset.bed.y}×${preset.bed.z}`} />
            </div>

            <p className="text-xs text-muted-foreground">
                Slicing (belt 45°) and 3-axis CNC toolpaths are produced by Kiri:Moto in Phase 3.
            </p>
        </div>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex justify-between">
            <span className="text-muted-foreground">{label}</span>
            <span className="capitalize">{value}</span>
        </div>
    );
}
