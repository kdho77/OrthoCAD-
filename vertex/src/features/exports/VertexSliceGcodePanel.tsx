// Part of the Chili3d Project, under the AGPL-3.0 License.

import { Download, Lock, Printer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { SliderField } from "@/components/ui/slider-field";
import { stlExportUserMessage } from "@/features/exports/export-user-message";
import { canExport } from "@/features/licensing/license";
import { buildExportStl, exportModeFromMethod } from "@/lib/geometry/export-geometry";
import { cn } from "@/lib/utils";
import {
    BELT_PRINT_DIRECTIONS,
    type BeltPrintDirection,
    defaultInfillPctForRecipe,
    vertexSliceProfileIdForRecipe,
} from "@/lib/vertexslice/profile-map";
import {
    DEFAULT_VERTEX_SLICE_MATERIAL,
    FALLBACK_VERTEX_SLICE_MATERIALS,
    fetchVertexSliceMaterials,
    isVertexSliceConfigured,
    sliceStlWithVertexSlice,
    type VertexSliceMaterial,
    vertexSliceBaseUrl,
    vertexSliceGcodeFilename,
    vertexSliceMaterialOptionLabel,
} from "@/lib/vertexslice/slice-client";
import { useAuthStore } from "@/stores/auth-store";
import { useDesignStore } from "@/stores/design-store";
import { SIDE_LABELS, type Side } from "@/types";
import { migratePrintRecipe } from "../../../shared/print-recipe/print-recipe";

function downloadText(text: string, filename: string) {
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

interface VertexSliceGcodePanelProps {
    clinicalMode?: boolean;
}

export function VertexSliceGcodePanel({ clinicalMode = false }: VertexSliceGcodePanelProps) {
    const { user, license } = useAuthStore();
    const { design, exportSide, setExportSide } = useDesignStore();
    const printRecipe = migratePrintRecipe(design.printRecipe);
    const defaultInfill = defaultInfillPctForRecipe(printRecipe);
    const profileId = vertexSliceProfileIdForRecipe(printRecipe);

    const [wallLoops, setWallLoops] = useState(1);
    const [infillPct, setInfillPct] = useState(defaultInfill);
    const [printDirection, setPrintDirection] = useState<BeltPrintDirection>("toe_first");
    const [materials, setMaterials] = useState<VertexSliceMaterial[]>(FALLBACK_VERTEX_SLICE_MATERIALS);
    const [material, setMaterial] = useState(DEFAULT_VERTEX_SLICE_MATERIAL);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState<string | null>(null);

    const gcodeCheck = canExport(user, license, "gcode");
    const configured = isVertexSliceConfigured();

    const infillChoices = useMemo(() => [14, 20, 26, 32, 38] as const, []);

    useEffect(() => {
        if (!configured) return;
        let cancelled = false;
        void (async () => {
            const loaded = await fetchVertexSliceMaterials(vertexSliceBaseUrl());
            if (cancelled) return;
            setMaterials(loaded.materials);
            setMaterial((current) => {
                if (loaded.materials.some((m) => m.id === current)) return current;
                return loaded.defaultId;
            });
        })();
        return () => {
            cancelled = true;
        };
    }, [configured]);

    const onGenerate = async () => {
        if (!configured) {
            setStatus("VertexSlice slicer URL is not configured (VITE_VERTEXSLICE_SLICER_URL).");
            return;
        }
        setBusy(true);
        setStatus("Exporting solid STL and slicing on VertexSlice…");
        try {
            const stl = await buildExportStl(exportSide, {
                exportMode: exportModeFromMethod(design.method),
            });
            if (!stl?.byteLength) {
                setStatus("Could not export manufacturing STL.");
                return;
            }
            const { gcode, sliceSeconds } = await sliceStlWithVertexSlice({
                baseUrl: vertexSliceBaseUrl(),
                profileId,
                stl,
                wallLoops,
                infillDensityPct: infillPct,
                printDirection,
                material,
                fileName: `orthocad-${exportSide}.stl`,
            });
            const filename = vertexSliceGcodeFilename({
                side: exportSide,
                printDirection,
                material,
            });
            downloadText(gcode, filename);
            const t =
                sliceSeconds != null && Number.isFinite(sliceSeconds)
                    ? ` (${sliceSeconds.toFixed(1)}s on server)`
                    : "";
            setStatus(`Downloaded ${filename}${t} · Apex V2 95A · ${profileId}`);
        } catch (e) {
            setStatus(stlExportUserMessage(e instanceof Error ? e.message : "G-code generation failed"));
        } finally {
            setBusy(false);
        }
    };

    if (!configured) {
        return (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-2 text-[11px] text-amber-200">
                VertexSlice cloud slicer is not configured. Set{" "}
                <code className="text-foreground">VITE_VERTEXSLICE_SLICER_URL</code> (and{" "}
                <code className="text-foreground">VITE_VERTEXSLICE_API_KEY</code> if required) on Vercel.
            </p>
        );
    }

    return (
        <div className="space-y-3 rounded-md border border-border bg-background/50 p-2">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <Printer className="h-3.5 w-3.5" />
                VertexSlice · Apex V2 95A
            </div>

            {!clinicalMode ? (
                <div className="flex gap-1">
                    {(["left", "right"] as Side[]).map((s) => (
                        <Button
                            key={s}
                            size="sm"
                            variant={exportSide === s ? "default" : "secondary"}
                            className="h-8 flex-1"
                            onClick={() => setExportSide(s)}
                        >
                            {SIDE_LABELS[s]} insole
                        </Button>
                    ))}
                </div>
            ) : null}

            <p className="text-[10px] text-muted-foreground">
                Profile: <span className="text-foreground">{profileId}</span> · hardness{" "}
                {printRecipe.defaultHardness} · gyroid · layer 0.42 mm
            </p>

            <label className="block space-y-1">
                <div className="text-[11px] text-muted-foreground">Material</div>
                <select
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={material}
                    aria-label="Material"
                    onChange={(e) => setMaterial(e.target.value)}
                >
                    {materials.map((m) => (
                        <option key={m.id} value={m.id}>
                            {vertexSliceMaterialOptionLabel(m)}
                        </option>
                    ))}
                </select>
            </label>

            <SliderField
                label="Wall loops"
                value={wallLoops}
                min={1}
                max={3}
                step={1}
                unit=""
                onChange={setWallLoops}
            />

            <div className="space-y-1">
                <div className="text-[11px] text-muted-foreground">Infill density (gyroid)</div>
                <div className="flex flex-wrap gap-1">
                    {infillChoices.map((pct) => (
                        <button
                            key={pct}
                            type="button"
                            onClick={() => setInfillPct(pct)}
                            className={cn(
                                "rounded border px-2 py-0.5 text-[10px]",
                                infillPct === pct
                                    ? "border-primary bg-primary/15 text-foreground"
                                    : "border-border text-muted-foreground",
                            )}
                        >
                            {pct}%
                        </button>
                    ))}
                </div>
            </div>

            <div className="space-y-1">
                <div className="text-[11px] text-muted-foreground">Belt advance</div>
                <div className="flex flex-col gap-1">
                    {BELT_PRINT_DIRECTIONS.map((d) => (
                        <button
                            key={d.id}
                            type="button"
                            onClick={() => setPrintDirection(d.id)}
                            className={cn(
                                "rounded-md border px-2 py-1.5 text-left text-[11px]",
                                printDirection === d.id
                                    ? "border-primary bg-primary/10"
                                    : "border-border text-muted-foreground",
                            )}
                        >
                            {d.label}
                        </button>
                    ))}
                </div>
            </div>

            <Button className="w-full" disabled={busy || !gcodeCheck.ok} onClick={onGenerate}>
                {gcodeCheck.ok ? <Download className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                {busy ? "Generating G-code…" : "Generate G-code"}
            </Button>

            {!gcodeCheck.ok ? <p className="text-xs text-amber-400">{gcodeCheck.reason}</p> : null}
            {status ? <p className="rounded-md bg-muted px-2 py-1.5 text-xs">{status}</p> : null}
        </div>
    );
}
