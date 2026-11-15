import { Boxes, CheckCircle2, Download, FileCode2, Loader2, Lock, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CaseOrderSummary } from "@/components/clinical/CaseOrderSummary";
import { OutputSideBar } from "@/components/clinical/OutputSideBar";
import { PanelHeading } from "@/components/clinical/PanelHeading";
import { Button } from "@/components/ui/button";
import { HardnessRegionList } from "@/features/clinical/HardnessRegionList";
import { ApexPrintMaterialPicker } from "@/features/exports/ApexPrintMaterialPicker";
import type { ApexPrintMaterialId } from "@/features/exports/apex-print-material";
import {
    type ClinicalExportKind,
    clinicalExportFormatTabs,
    defaultClinicalGcodeMaterial,
    defaultGcodeFootScope,
    exportClinicalPrinterGcode,
    type GcodeFootScope,
    gcodeFeetForExport,
} from "@/features/exports/export-panel-clinical";
import { exportDesign, GCODE_EXPORT_STEPS } from "@/features/exports/export-service";
import { stlExportUserMessage } from "@/features/exports/export-user-message";
import { TextSummary } from "@/features/exports/TextSummary";
import { canExport, TOKEN_COST } from "@/features/licensing/license";
import { useSolidValidation } from "@/hooks/useSolidValidation";
import { orderDownloadSides } from "@/lib/geometry/export-geometry";
import {
    manufacturingMachineId,
    setManufacturingSliceTarget,
} from "@/lib/geometry/procedural-wall/manufacturing-solid-context";
import type { HardnessExportReport } from "@/lib/hardness/report";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { useDesignStore } from "@/stores/design-store";
import { useKernelStore } from "@/stores/kernel-store";
import { SIDE_LABELS, type Side } from "@/types";

type ExportKind = ClinicalExportKind | null;

const EXPORT_KIND_LABEL: Record<ClinicalExportKind, string> = {
    stl: "STL",
    "3mf": "3MF",
    glb: "GLB",
    gcode: "G-code",
};

export function ExportPanel({
    clinicalExportStep = false,
    hideOutputSide = false,
    exportLocked = false,
}: {
    clinicalExportStep?: boolean;
    hideOutputSide?: boolean;
    /** AFO shell inputs moved. STL, 3MF, and G-code stay disabled. */
    exportLocked?: boolean;
}) {
    const { user, license } = useAuthStore();
    const { design, exportSide, setExportSide, viewer } = useDesignStore();
    const [status, setStatus] = useState<string | null>(null);
    const [progress, setProgress] = useState<string | null>(null);
    const [busyKind, setBusyKind] = useState<ExportKind>(null);
    const [exportKind, setExportKind] = useState<ExportKind>("stl");
    const [material, setMaterial] = useState<ApexPrintMaterialId>(() => defaultClinicalGcodeMaterial());
    const [includeLeaderBlock, setIncludeLeaderBlock] = useState(true);
    const [gcodeScope, setGcodeScope] = useState<GcodeFootScope>(() => defaultGcodeFootScope(design));
    const abortRef = useRef(false);
    const formatTabs = clinicalExportFormatTabs(design.method);
    const orderSides = orderDownloadSides(design);
    const pairedOrder = orderSides.length > 1;
    const gcodeFeet = gcodeFeetForExport(design, pairedOrder ? gcodeScope : defaultGcodeFootScope(design));

    useEffect(() => {
        setManufacturingSliceTarget({
            productId: material,
            machineId: manufacturingMachineId(design.method, material),
        });
    }, [material, design.method]);

    const stlCheck = canExport(user, license, "stl");
    const glbCheck = canExport(user, license, "glb");
    const threeMfCheck = canExport(user, license, "3mf");
    const gcodeCheck = canExport(user, license, "gcode");
    const busy = busyKind !== null;

    const activeCheck =
        exportKind === "stl"
            ? stlCheck
            : exportKind === "glb"
              ? glbCheck
              : exportKind === "gcode"
                ? gcodeCheck
                : threeMfCheck;
    const tokenCost =
        exportKind === "stl"
            ? TOKEN_COST.stl
            : exportKind === "glb"
              ? TOKEN_COST.glb
              : exportKind === "gcode"
                ? TOKEN_COST.gcode * Math.max(1, gcodeFeet.length)
                : TOKEN_COST["3mf"];

    const chooseGcodeScope = (scope: GcodeFootScope) => {
        setGcodeScope(scope);
        if (scope === "left" || scope === "right") setExportSide(scope);
    };

    const runExport = async () => {
        if (exportLocked || !exportKind) return;
        abortRef.current = false;
        setBusyKind(exportKind);
        if (exportKind === "gcode") {
            setProgress(GCODE_EXPORT_STEPS.prepare);
            setStatus(null);
            setManufacturingSliceTarget({
                productId: material,
                machineId: manufacturingMachineId(design.method, material),
            });
        }
        try {
            if (exportKind === "stl") {
                const res = await exportDesign("stl", exportSide);
                setStatus(
                    res.ok
                        ? `Exported ${res.filename} (-${TOKEN_COST.stl} token)`
                        : stlExportUserMessage(res.reason),
                );
            } else if (exportKind === "3mf") {
                const res = await exportDesign("3mf", exportSide);
                setStatus(
                    res.ok
                        ? `Exported ${res.filename} (-${TOKEN_COST["3mf"]} token)`
                        : (res.reason ?? "3MF export failed"),
                );
            } else if (exportKind === "gcode") {
                const res = await exportClinicalPrinterGcode({
                    side: exportSide,
                    feet: pairedOrder ? gcodeScope : defaultGcodeFootScope(design),
                    design,
                    wallStyle: viewer.wallStyle,
                    apexMaterialId: material,
                    includeLeaderBlock,
                    onProgress: setProgress,
                    shouldAbort: () => abortRef.current,
                });
                setStatus(
                    res.cancelled
                        ? "Export cancelled. No G-code was downloaded."
                        : res.ok
                          ? `Exported ${res.filename} (-${TOKEN_COST.gcode * Math.max(1, gcodeFeet.length)} tokens)`
                          : stlExportUserMessage(res.reason ?? "G-code export failed"),
                );
            } else {
                const res = await exportDesign("glb", exportSide);
                setStatus(
                    res.ok
                        ? `Exported ${res.filename} (-${TOKEN_COST.glb} token)`
                        : (res.reason ?? "GLB export failed"),
                );
            }
        } catch (e) {
            setStatus(stlExportUserMessage(e instanceof Error ? e.message : undefined));
        } finally {
            setBusyKind(null);
            setProgress(null);
        }
    };

    if (clinicalExportStep) {
        return (
            <div className="space-y-3">
                <PanelHeading
                    title="Export"
                    info="Pick a file type, then download. A paired order's G-code downloads left and right. Choose Left or Right for one foot."
                    trailing={
                        <span className="text-[10px] tabular-nums text-muted-foreground">
                            {user?.tokenBalance ?? 0} tokens
                        </span>
                    }
                />
                <div className="flex flex-wrap gap-1">
                    {formatTabs.map((id) => (
                        <Button
                            key={id}
                            size="sm"
                            variant={exportKind === id ? "default" : "secondary"}
                            className="h-8 min-w-[3.5rem] flex-1 text-[11px]"
                            data-export-kind={id}
                            onClick={() => setExportKind(id)}
                        >
                            {EXPORT_KIND_LABEL[id]}
                        </Button>
                    ))}
                </div>
                {exportKind === "gcode" ? (
                    <>
                        <ApexPrintMaterialPicker
                            value={material}
                            onChange={(next) => {
                                setMaterial(next);
                                setManufacturingSliceTarget({
                                    productId: next,
                                    machineId: manufacturingMachineId(design.method, next),
                                });
                            }}
                            disabled={busy}
                        />
                        <label className="flex items-start gap-2 text-[11px]">
                            <input
                                type="checkbox"
                                className="mt-0.5"
                                data-testid="gcode-leader-block"
                                checked={includeLeaderBlock}
                                disabled={busy}
                                onChange={(event) => setIncludeLeaderBlock(event.target.checked)}
                            />
                            <span>
                                Sacrificial leader block
                                <span className="block text-[10px] text-muted-foreground">
                                    Added on the manufacturing STL before slicing. Mesh and CNC exports skip
                                    it.
                                </span>
                            </span>
                        </label>
                    </>
                ) : null}
                {exportKind === "gcode" ? (
                    <div className="space-y-2 border-t border-border pt-2" data-testid="gcode-output-scope">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Output
                        </div>
                        <div className={pairedOrder ? "grid grid-cols-3 gap-1" : "grid grid-cols-2 gap-1"}>
                            {(["left", "right"] as const).map((side) => (
                                <Button
                                    key={side}
                                    size="sm"
                                    variant={gcodeScope === side ? "default" : "secondary"}
                                    className="h-8 text-[11px]"
                                    data-testid={`gcode-output-${side}`}
                                    data-selected={gcodeScope === side ? "true" : "false"}
                                    disabled={busy || !orderSides.includes(side)}
                                    onClick={() => chooseGcodeScope(side)}
                                >
                                    {SIDE_LABELS[side]}
                                </Button>
                            ))}
                            {pairedOrder ? (
                                <Button
                                    size="sm"
                                    variant={gcodeScope === "both" ? "default" : "secondary"}
                                    className="h-8 text-[11px]"
                                    data-testid="gcode-output-both"
                                    data-selected={gcodeScope === "both" ? "true" : "false"}
                                    disabled={busy}
                                    onClick={() => chooseGcodeScope("both")}
                                >
                                    Both
                                </Button>
                            ) : null}
                        </div>
                    </div>
                ) : (
                    <OutputSideBar />
                )}
                <Button
                    className="w-full"
                    data-testid="clinical-export-download"
                    aria-busy={busy}
                    disabled={
                        exportLocked ||
                        !activeCheck.ok ||
                        busy ||
                        (exportKind === "gcode" && gcodeFeet.length === 0)
                    }
                    onClick={() => void runExport()}
                >
                    {busyKind ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : activeCheck.ok ? (
                        <Download className="h-4 w-4" />
                    ) : (
                        <Lock className="h-4 w-4" />
                    )}
                    {busyKind
                        ? (progress ?? "Exporting…")
                        : exportKind === "gcode"
                          ? gcodeFeet.length > 1
                              ? `Download G-code · both feet · ${tokenCost} tokens`
                              : `Download G-code · ${tokenCost} tokens`
                          : `Download · ${tokenCost} token`}
                </Button>
                {busyKind === "gcode" ? (
                    <Button
                        type="button"
                        variant="secondary"
                        className="w-full"
                        data-testid="gcode-export-cancel"
                        onClick={() => {
                            abortRef.current = true;
                        }}
                    >
                        Cancel export
                    </Button>
                ) : null}
                {progress ? (
                    <p
                        role="status"
                        data-testid="gcode-export-progress"
                        className="text-[11px] text-muted-foreground"
                    >
                        {progress}
                    </p>
                ) : null}
                {!activeCheck.ok ? <p className="text-[10px] text-amber-400">{activeCheck.reason}</p> : null}
                {status ? <p className="rounded-md bg-muted px-2 py-1 text-[11px]">{status}</p> : null}
            </div>
        );
    }

    return <LegacyExportPanel hideOutputSide={hideOutputSide} exportLocked={exportLocked} />;
}

/** Full export panel for Print advanced and legacy paths. */
function LegacyExportPanel({
    hideOutputSide = false,
    exportLocked = false,
}: {
    hideOutputSide?: boolean;
    exportLocked?: boolean;
}) {
    const { user, license } = useAuthStore();
    const { design, exportSide, setExportSide } = useDesignStore();
    const kernelName = useKernelStore((s) => s.name);
    const [status, setStatus] = useState<string | null>(null);
    const [busyKind, setBusyKind] = useState<ExportKind>(null);
    const validation = useSolidValidation(design, exportSide);
    const [report, setReport] = useState<HardnessExportReport | null>(null);
    const [warning, setWarning] = useState<string | null>(null);

    const stlCheck = canExport(user, license, "stl");
    const glbCheck = canExport(user, license, "glb");
    const threeMfCheck = canExport(user, license, "3mf");
    const busy = busyKind !== null;

    const handleStl = async () => {
        if (exportLocked) return;
        setBusyKind("stl");
        try {
            const res = await exportDesign("stl", exportSide);
            setStatus(
                res.ok
                    ? `Exported ${res.filename} (-${TOKEN_COST.stl} token)`
                    : stlExportUserMessage(res.reason),
            );
            setWarning(res.warning ?? null);
        } catch (e) {
            setStatus(stlExportUserMessage(e instanceof Error ? e.message : undefined));
        } finally {
            setBusyKind(null);
        }
    };

    const handle3mf = async () => {
        if (exportLocked) return;
        setBusyKind("3mf");
        setStatus("Building 3MF with hardness modifiers…");
        try {
            const res = await exportDesign("3mf", exportSide);
            setStatus(
                res.ok
                    ? `Exported ${res.filename} (-${TOKEN_COST["3mf"]} token)`
                    : (res.reason ?? "3MF export failed"),
            );
            setReport(res.report ?? null);
            setWarning(res.warning ?? null);
        } catch (e) {
            setStatus(e instanceof Error ? e.message : "3MF export failed");
        } finally {
            setBusyKind(null);
        }
    };

    const handleGlb = async () => {
        if (exportLocked) return;
        setBusyKind("glb");
        setStatus("Generating GLB…");
        try {
            const res = await exportDesign("glb", exportSide);
            setStatus(
                res.ok
                    ? `Exported ${res.filename} (-${TOKEN_COST.glb} token)`
                    : (res.reason ?? "GLB export failed"),
            );
        } finally {
            setBusyKind(null);
        }
    };

    const watertightLabel = validation.error
        ? "Export geometry invalid"
        : validation.isWatertight
          ? "Watertight solid"
          : validation.triangleCount > 0
            ? `${validation.openEdges} open edges`
            : "Analyzing…";

    return (
        <div className="space-y-3">
            <CaseOrderSummary />
            <TextSummary />
            <div className="rounded-md border border-border bg-background/50 p-2 text-xs">
                <div className="flex justify-between">
                    <span className="text-muted-foreground">Token balance</span>
                    <span className="tabular-nums">{user?.tokenBalance ?? 0}</span>
                </div>
                <div className="mt-1 flex justify-between">
                    <span className="text-muted-foreground">License</span>
                    <span>{license?.status ?? "none"}</span>
                </div>
                <div className="mt-1 flex justify-between">
                    <span className="text-muted-foreground">Kernel</span>
                    <span className="capitalize">{kernelName.replace(/-/g, " ")}</span>
                </div>
            </div>

            {hideOutputSide ? null : (
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
            )}

            <div
                className={cn(
                    "flex items-center justify-between rounded-md border px-2 py-1.5 text-xs",
                    validation.isWatertight
                        ? "border-emerald-500/40 text-emerald-400"
                        : "border-amber-500/40 text-amber-400",
                )}
            >
                <span className="flex items-center gap-1.5">
                    {validation.isWatertight ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : (
                        <TriangleAlert className="h-3.5 w-3.5" />
                    )}
                    {watertightLabel}
                </span>
                <span className="tabular-nums text-muted-foreground">
                    {validation.triangleCount > 0 ? `${validation.triangleCount.toLocaleString()} tris` : "—"}
                </span>
            </div>

            {validation.error ? <p className="text-xs text-amber-400">{validation.error}</p> : null}
            <HardnessRegionList />

            {design.method === "milling_3axis" ? (
                <p className="rounded-md border border-border px-2 py-2 text-xs text-muted-foreground">
                    This order mills an L+R CNC file. Print STL, 3MF, and print G-code are not produced. Use
                    the Mill step.
                </p>
            ) : null}

            <Button
                className="w-full"
                disabled={exportLocked || !stlCheck.ok || busy || design.method === "milling_3axis"}
                onClick={handleStl}
            >
                {busyKind === "stl" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                ) : stlCheck.ok ? (
                    <Download className="h-4 w-4" />
                ) : (
                    <Lock className="h-4 w-4" />
                )}
                {busyKind === "stl" ? "Exporting STL…" : `Export STL · ${TOKEN_COST.stl} token`}
            </Button>
            {!stlCheck.ok ? <p className="text-xs text-amber-400">{stlCheck.reason}</p> : null}

            <Button
                className="w-full"
                disabled={exportLocked || !threeMfCheck.ok || busy || design.method === "milling_3axis"}
                onClick={handle3mf}
            >
                {busyKind === "3mf" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                ) : threeMfCheck.ok ? (
                    <Download className="h-4 w-4" />
                ) : (
                    <Lock className="h-4 w-4" />
                )}
                {busyKind === "3mf" ? "Exporting 3MF…" : `Export 3MF · ${TOKEN_COST["3mf"]} token`}
            </Button>
            {!threeMfCheck.ok ? <p className="text-xs text-amber-400">{threeMfCheck.reason}</p> : null}

            <Button
                variant="secondary"
                className="w-full"
                disabled={exportLocked || !glbCheck.ok || busy || design.method === "milling_3axis"}
                onClick={handleGlb}
                title="Download a watertight, print-ready GLB (top + tapered side walls + bottom) of the current trimline."
            >
                {busyKind === "glb" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                ) : glbCheck.ok ? (
                    <Boxes className="h-4 w-4" />
                ) : (
                    <Lock className="h-4 w-4" />
                )}
                {busyKind === "glb"
                    ? "Generating GLB…"
                    : TOKEN_COST.glb > 0
                      ? `Download GLB · ${TOKEN_COST.glb} token`
                      : "Download GLB"}
            </Button>
            {!glbCheck.ok ? <p className="text-xs text-amber-400">{glbCheck.reason}</p> : null}

            <div className="flex items-center gap-2 rounded-md border border-border px-2 py-2 text-xs text-muted-foreground">
                <FileCode2 className="h-4 w-4" />
                {design.method === "milling_3axis" ? (
                    <>
                        3-axis CNC G-code is in the <span className="text-foreground">Mill</span> step ·{" "}
                        {TOKEN_COST.gcode} tokens
                    </>
                ) : (
                    <>
                        3D-printer and 3-axis CNC G-code are in the{" "}
                        <span className="text-foreground">Print</span> step · {TOKEN_COST.gcode} tokens
                    </>
                )}
            </div>

            {status ? <p className="rounded-md bg-muted px-2 py-1.5 text-xs">{status}</p> : null}
            {warning ? (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-100/90">
                    {warning}
                </p>
            ) : null}
            {report ? (
                <div
                    data-testid="hardness-export-report"
                    className="space-y-1 rounded-md border border-border bg-background/50 p-2 text-[11px]"
                >
                    <div className="font-semibold uppercase tracking-wide text-muted-foreground">
                        Export report {report.ok ? "· ok" : "· failed"}
                    </div>
                    {report.errors.map((e) => (
                        <p key={e} className="text-destructive">
                            {e}
                        </p>
                    ))}
                    {report.warnings.map((w) => (
                        <p key={w} className="text-amber-200">
                            {w}
                        </p>
                    ))}
                    <ul className="space-y-0.5">
                        {report.regions.map((r) => (
                            <li key={r.regionId} className="flex justify-between gap-2">
                                <span>
                                    {r.regionId} · {r.kind} · {r.hardnessClass} · {r.status}
                                </span>
                                <span className="tabular-nums text-muted-foreground">
                                    {r.volumeMm3.toFixed(1)} mm³
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
        </div>
    );
}
