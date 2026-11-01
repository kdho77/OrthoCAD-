// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { ChevronRight, Cpu, Play, Printer } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { SliderField } from "@/components/ui/slider-field";
import { CncMillingPanel } from "@/features/exports/CncMillingPanel";
import { ApexPrintMaterialPicker } from "@/features/exports/ApexPrintMaterialPicker";
import { type GrindingStyleInput } from "@/features/exports/export-service";
import { useExportSessionStore } from "@/features/exports/export-session-store";
import { MachineSegment, PrintFooter, useMachineSummaryLine } from "@/features/exports/PrintFooter";
import { PrintProgressCard } from "@/features/exports/PrintProgressCard";
import {
    ProceduralWallPreviewControls,
    type ProceduralWallStyleChoice,
} from "@/features/exports/procedural-wall-preview-controls";
import { canExport } from "@/features/licensing/license";
import { getKernel } from "@/lib/geometry/geometry-kernel";
import { insoleParamsFromDesign } from "@/lib/geometry/kernel-build";
import { type CamOverrides, type CamResult, generateGcode, presetsForMethod } from "@/lib/kiri";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";
import { useExportFileTypeStore } from "@/features/exports/export-file-type-store";
import { usePrintExportSettingsStore } from "@/features/exports/print-export-settings-store";
import { useMillingProfileStore } from "@/stores/milling-profile-store";
import { usePreviewLoftStatusStore } from "@/stores/preview-loft-status-store";
import { SIDE_LABELS, type Side } from "@/types";
import { infillFractionFromRecipe, migratePrintRecipe } from "../../../shared/print-recipe/print-recipe";

function fmtTime(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

interface PrintingPanelProps {
    clinicalMode?: boolean;
    primaryOnly?: boolean;
    showWallPreview?: boolean;
    /** Material / hardness block inserted between preset and grinding in clinical layout. */
    materialSection?: ReactNode;
    advancedSections?: ReactNode;
}

export function PrintingPanel({
    clinicalMode = false,
    primaryOnly = false,
    showWallPreview,
    materialSection,
    advancedSections,
}: PrintingPanelProps) {
    const { user, license } = useAuthStore();
    const { design, exportSide, exportTarget, setExportTarget, setViewer } = useDesignStore();
    const machine = useMillingProfileStore((s) => s.machine);
    const setMachine = useMillingProfileStore((s) => s.setMachine);
    const cncSelected = machine === "cnc";
    const printRecipe = migratePrintRecipe(design.printRecipe);
    const recipeInfillPct = Math.round(infillFractionFromRecipe(printRecipe) * 100);
    const [layerHeight, setLayerHeight] = useState(0.3);
    const [infill, setInfill] = useState(recipeInfillPct);
    const [toolDia, setToolDia] = useState(6);
    const [result, setResult] = useState<CamResult | null>(null);
    const [busy, setBusy] = useState(false);
    const [pulseTarget, setPulseTarget] = useState(false);
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const setStep = useClinicalWorkflowStore((s) => s.setStep);
    const preselectGcode = useExportFileTypeStore((s) => s.preselectGcode);

    const session = useExportSessionStore();
    const machineSummary = useMachineSummaryLine();
    const apexMaterialId = usePrintExportSettingsStore((s) => s.apexMaterialId);
    const setPrintExportSettings = usePrintExportSettingsStore((s) => s.setPrintExportSettings);
    const loftPhases = usePreviewLoftStatusStore((s) => s.phaseBySide);

    const [grindingStyle, setGrindingStyle] = useState<GrindingStyleInput>({
        type: "straight",
        angle_degrees: 8,
    });

    const presets = useMemo(() => presetsForMethod(design.method), [design.method]);
    const defaultPreset = useMemo(() => presets.find((p) => p.beltAngleDeg) ?? presets[0], [presets]);
    const [presetId, setPresetId] = useState(defaultPreset?.id ?? "");
    const preset = presets.find((p) => p.id === presetId) ?? defaultPreset;
    const isBeltPreset = !!preset?.beltAngleDeg;
    const isCnc = design.method === "milling_3axis";
    const gcodeCheck = canExport(user, license, "gcode");

    const overrides: CamOverrides = isCnc
        ? { toolDiameterMm: toolDia }
        : {
              layerHeightMm: layerHeight,
              infillDensity: (clinicalMode ? recipeInfillPct : infill) / 100,
          };

    useEffect(() => {
        if (!preset) return;
        usePrintExportSettingsStore.getState().setPrintExportSettings({
            presetId: preset.id,
            grindingStyle,
            overrides,
        });
    }, [preset?.id, grindingStyle, overrides.layerHeightMm, overrides.infillDensity, overrides.toolDiameterMm]);

    useEffect(() => {
        if (cncSelected) setExportTarget("pair");
    }, [cncSelected, setExportTarget]);

    useEffect(() => {
        const working = Object.values(loftPhases).some(
            (p) => p === "lofting" || p === "queued" || p === "fetching",
        );
        const store = useExportSessionStore.getState();
        if (working) store.setProgress({ phase: "building", message: "Building walls…" });
        else if (store.progress.phase === "building") store.setProgress({ phase: "idle" });
    }, [loftPhases]);

    const buildGeom = () => getKernel().buildInsole(insoleParamsFromDesign(design, exportSide, "full"));

    const onPreview = () => {
        if (!preset) return;
        setBusy(true);
        try {
            setResult(generateGcode(buildGeom(), preset, overrides));
        } catch (e) {
            /* preview only */
        } finally {
            setBusy(false);
        }
    };

    const continueToExport = () => {
        if (!exportTarget && !cncSelected) {
            setPulseTarget(true);
            return;
        }
        preselectGcode();
        setStep("export");
    };

    const showPrimaryOnly = clinicalMode && primaryOnly;
    const showProceduralWallControls = !cncSelected && (showWallPreview ?? !showPrimaryOnly);

    const onWallStyle = (t: ProceduralWallStyleChoice) => {
        setViewer({ wallStyle: t });
        setGrindingStyle(
            t === "straight" ? { type: "straight", angle_degrees: 8 } : { type: "rounded", radius_mm: 3 },
        );
    };

    const recommendedHint =
        machine === "cnc"
            ? "CNC export reads the finished design; walls stay straight on the Idaho table."
            : "Build the procedural solid here, then continue to Export for downloadable files.";

    if (clinicalMode) {
        return (
            <div className="relative flex flex-col gap-3 pb-40">
                <MachineSegment machine={machine} setMachine={setMachine} hint={recommendedHint} />

                {cncSelected ? <CncMillingPanel /> : null}

                {!cncSelected ? (
                    <div className="space-y-1.5">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Preset
                        </div>
                        {presets.map((p) => (
                            <button
                                key={p.id}
                                type="button"
                                onClick={() => setPresetId(p.id)}
                                className={cn(
                                    "flex w-full items-center gap-2 rounded-md border px-2 py-2 text-left text-xs",
                                    presetId === p.id
                                        ? "border-primary bg-primary/10 text-foreground"
                                        : "border-border bg-background text-muted-foreground",
                                )}
                            >
                                <Printer className="h-3.5 w-3.5" />
                                {p.name}
                                {p.beltAngleDeg ? (
                                    <span className="ml-auto rounded bg-muted px-1 text-[10px]">
                                        belt {p.beltAngleDeg}°
                                    </span>
                                ) : null}
                            </button>
                        ))}
                    </div>
                ) : null}

                {!cncSelected ? (
                    <ApexPrintMaterialPicker
                        value={apexMaterialId}
                        onChange={(id) => setPrintExportSettings({ apexMaterialId: id })}
                    />
                ) : null}

                {materialSection}

                <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Grinding
                    </div>
                    {showProceduralWallControls ? (
                        <ProceduralWallPreviewControls onWallStyle={onWallStyle} />
                    ) : (
                        <p className="text-[10px] text-muted-foreground">Straight walls (CNC)</p>
                    )}
                </div>

                <button
                    type="button"
                    onClick={() => setAdvancedOpen((v) => !v)}
                    className="flex w-full items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                    aria-expanded={advancedOpen}
                >
                    <ChevronRight
                        className={cn("h-3.5 w-3.5 transition-transform", advancedOpen && "rotate-90")}
                    />
                    Advanced
                </button>
                {advancedOpen ? (
                    <div className="space-y-3 rounded-md border border-border bg-background/40 p-2">
                        {advancedSections}
                        <p className="text-[10px] text-muted-foreground">
                            Layer height {layerHeight} mm · gyroid infill {recipeInfillPct}% (from hardness)
                        </p>
                        {!isCnc ? (
                            <>
                                <SliderField
                                    label="Layer height"
                                    value={layerHeight}
                                    min={0.1}
                                    max={0.6}
                                    step={0.05}
                                    unit="mm"
                                    onChange={setLayerHeight}
                                />
                                <SliderField
                                    label="Infill"
                                    value={infill}
                                    min={0}
                                    max={100}
                                    step={5}
                                    unit="%"
                                    onChange={setInfill}
                                />
                            </>
                        ) : null}
                    </div>
                ) : null}

                <PrintProgressCard />

                {!gcodeCheck.ok ? <p className="text-xs text-amber-400">{gcodeCheck.reason}</p> : null}

                <PrintFooter
                    machineSummary={machineSummary}
                    cncLocked={cncSelected}
                    cncLockReason="Left + Right in one file"
                    primaryLabel="Continue to Export"
                    onPrimary={continueToExport}
                    showTargetPulse={pulseTarget}
                />
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <MachineSegment machine={machine} setMachine={setMachine} hint={recommendedHint} />
            {cncSelected ? <CncMillingPanel /> : null}
            {!cncSelected ? (
                <div className="flex gap-1">
                    {(["left", "right"] as Side[]).map((s) => (
                        <Button
                            key={s}
                            size="sm"
                            variant={exportSide === s ? "default" : "secondary"}
                            className="h-8 flex-1"
                            onClick={() => setExportTarget(s)}
                        >
                            {SIDE_LABELS[s]} insole
                        </Button>
                    ))}
                </div>
            ) : null}
            {!cncSelected ? (
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
                                presetId === p.id
                                    ? "border-primary bg-primary/10 text-foreground"
                                    : "border-border bg-background text-muted-foreground",
                            )}
                        >
                            {isCnc ? <Cpu className="h-3.5 w-3.5" /> : <Printer className="h-3.5 w-3.5" />}
                            {p.name}
                        </button>
                    ))}
                </div>
            ) : null}
            {!cncSelected ? (
                <ApexPrintMaterialPicker
                    value={apexMaterialId}
                    onChange={(id) => setPrintExportSettings({ apexMaterialId: id })}
                />
            ) : null}
            {showProceduralWallControls ? <ProceduralWallPreviewControls onWallStyle={onWallStyle} /> : null}
            {!clinicalMode ? (
                <Button variant="secondary" className="w-full" disabled={busy || !preset} onClick={onPreview}>
                    <Play className="h-4 w-4" /> {busy ? "Generating…" : "Generate toolpath"}
                </Button>
            ) : null}
            {result ? (
                <div className="space-y-1 rounded-md border border-border bg-background/50 p-2 text-xs">
                    <Row label="Est. time" value={fmtTime(result.stats.estimatedTimeSec)} />
                </div>
            ) : null}
            {!clinicalMode ? (
                <Button
                    variant="secondary"
                    className="w-full"
                    disabled={busy || !preset}
                    onClick={() => {
                        preselectGcode();
                        setStep("export");
                    }}
                >
                    Continue to Export
                </Button>
            ) : null}
        </div>
    );
}
