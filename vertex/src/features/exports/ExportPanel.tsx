import { ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CaseOrderSummary } from "@/components/clinical/CaseOrderSummary";
import { showSuperAdminLink } from "@/features/admin/admin-nav";
import { ExportFileTypePicker } from "@/features/exports/ExportFileTypePicker";
import { PAIR_MULTI_DOWNLOAD_HINT } from "@/features/exports/export-download";
import {
    exportPrimaryButtonLabel,
    useExportFileTypeStore,
} from "@/features/exports/export-file-type-store";
import { designRevisionFingerprint, useExportSessionStore } from "@/features/exports/export-session-store";
import { downloadBlob } from "@/features/exports/export-download";
import { exportDesign } from "@/features/exports/export-service";
import { PrintFooter, useMachineSummaryLine } from "@/features/exports/PrintFooter";
import { usePrintExportSettingsStore } from "@/features/exports/print-export-settings-store";
import { PrintProgressCard } from "@/features/exports/PrintProgressCard";
import { ResultCard } from "@/features/exports/ResultCard";
import { runExportForChoice } from "@/features/exports/run-export-action";
import { TextSummary } from "@/features/exports/TextSummary";
import { canExport } from "@/features/licensing/license";
import { presetsForMethod } from "@/lib/kiri";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";
import { useMillingProfileStore } from "@/stores/milling-profile-store";

function tokenLine(userBalance: number | undefined, licenseStatus: string | undefined): string {
    return `${userBalance ?? 0} tokens · License ${licenseStatus ?? "none"}`;
}

export function ExportPanel() {
    const { user, license } = useAuthStore();
    const { design, exportTarget } = useDesignStore();
    const machine = useMillingProfileStore((s) => s.machine);
    const millingProfile = useMillingProfileStore((s) => s.profile);
    const setStep = useClinicalWorkflowStore((s) => s.setStep);
    const fileType = useExportFileTypeStore((s) => s.exportFileType);
    const hydrateFileType = useExportFileTypeStore((s) => s.hydrateForCurrentUser);
    const printSettings = usePrintExportSettingsStore();
    const [devOpen, setDevOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [pulseType, setPulseType] = useState(false);
    const [pulseTarget, setPulseTarget] = useState(false);
    const [error, setError] = useState<{ message: string; noTokens?: boolean } | null>(null);

    const revision = designRevisionFingerprint(design);
    const machineSummary = useMachineSummaryLine();
    const cncLocked = machine === "cnc";
    const session = useExportSessionStore();
    const activeRecord = fileType ? session.byKind[fileType] : undefined;
    const outOfDate = fileType ? session.isOutOfDate(fileType) : false;

    const presets = useMemo(() => presetsForMethod(design.method), [design.method]);
    const preset = presets.find((p) => p.id === printSettings.presetId) ?? presets[0];

    const licenseOk =
        fileType === "gcode"
            ? canExport(user, license, "gcode").ok
            : fileType === "stl"
              ? canExport(user, license, "stl").ok
              : fileType === "3mf"
                ? canExport(user, license, "3mf").ok
                : true;

    useEffect(() => {
        hydrateFileType();
    }, [hydrateFileType]);

    useEffect(() => {
        useExportSessionStore.getState().setDesignRevision(revision);
    }, [revision]);

    const onExport = async () => {
        if (!fileType) {
            setPulseType(true);
            window.setTimeout(() => setPulseType(false), 1200);
            return;
        }
        if (!exportTarget) {
            setPulseTarget(true);
            window.setTimeout(() => setPulseTarget(false), 1200);
            return;
        }
        if (!licenseOk) return;

        setBusy(true);
        setError(null);
        session.setProgress({
            phase: fileType === "gcode" ? "slicing" : "exporting",
            message: fileType === "gcode" ? "Generating G-code…" : `Exporting ${fileType.toUpperCase()}…`,
        });
        try {
            const outcome = await runExportForChoice({
                choice: fileType,
                target: exportTarget,
                cnc: cncLocked,
                preset,
                grindingStyle: printSettings.grindingStyle,
                overrides: printSettings.overrides,
                millingProfile,
                designRevision: revision,
            });
            if (outcome.ok) {
                session.recordSuccess(outcome.record);
            } else {
                setError({ message: outcome.reason, noTokens: outcome.noTokens });
                session.setProgress({ phase: "idle" });
            }
        } finally {
            setBusy(false);
        }
    };

    const runGlb = async () => {
        if (!exportTarget || exportTarget === "pair") return;
        await exportDesign("glb", exportTarget);
    };

    return (
        <div className="relative flex min-h-0 flex-col gap-3 pb-36">
            <CaseOrderSummary />
            <TextSummary />
            <p className="text-[11px] text-muted-foreground">{tokenLine(user?.tokenBalance, license?.status)}</p>

            <ExportFileTypePicker pulse={pulseType} />

            {fileType === "gcode" ? (
                <div className="rounded-md border border-border bg-background/40 px-2 py-2 text-[11px]">
                    <p className="text-muted-foreground">{machineSummary}</p>
                    <button
                        type="button"
                        className="mt-1 text-primary hover:underline"
                        onClick={() => setStep("print")}
                    >
                        Edit in Print
                    </button>
                </div>
            ) : null}

            {activeRecord ? (
                <ResultCard
                    filename={activeRecord.files?.length ? undefined : activeRecord.filename}
                    sizeBytes={activeRecord.files?.length ? undefined : activeRecord.sizeBytes}
                    estimatedTimeSec={
                        activeRecord.files?.length ? undefined : activeRecord.estimatedTimeSec
                    }
                    materialLabel={
                        activeRecord.files?.length ? undefined : activeRecord.materialLabel
                    }
                    tokensCharged={activeRecord.tokensCharged}
                    outOfDate={outOfDate}
                    multiDownloadHint={PAIR_MULTI_DOWNLOAD_HINT}
                    files={
                        activeRecord.files?.map((part) => ({
                            label: part.side === "left" ? "Left" : part.side === "right" ? "Right" : undefined,
                            filename: part.filename,
                            sizeBytes: part.sizeBytes,
                            estimatedTimeSec: part.estimatedTimeSec,
                            materialLabel: part.materialLabel,
                            onDownload: () => downloadBlob(part.blob, part.filename),
                        })) ?? undefined
                    }
                    onDownload={
                        activeRecord.files?.length
                            ? undefined
                            : () => downloadBlob(activeRecord.blob, activeRecord.filename)
                    }
                />
            ) : null}

            {error ? (
                <ResultCard
                    error={error.message}
                    noTokensCharged={error.noTokens}
                    onRetry={onExport}
                />
            ) : null}

            {showSuperAdminLink(user?.role) ? (
                <div>
                    <button
                        type="button"
                        onClick={() => setDevOpen((v) => !v)}
                        className="flex w-full items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                    >
                        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", devOpen && "rotate-90")} />
                        Developer
                    </button>
                    {devOpen ? (
                        <button
                            type="button"
                            data-testid="export-dev-glb"
                            className="mt-2 w-full rounded-md border border-border px-2 py-2 text-left text-xs hover:bg-muted/40"
                            onClick={runGlb}
                        >
                            Download GLB (0 tokens)
                        </button>
                    ) : null}
                </div>
            ) : null}

            {session.sessionFiles.length > 0 ? (
                <div className="space-y-1" data-testid="session-export-files">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Files this session
                    </div>
                    <ul className="space-y-1 text-[11px]">
                        {session.sessionFiles.map((file) => (
                            <li key={file.id} className="flex items-center justify-between gap-2">
                                <span className="truncate">{file.filename}</span>
                                <button
                                    type="button"
                                    className="shrink-0 text-primary hover:underline"
                                    onClick={() => {
                                        const url = URL.createObjectURL(file.blob);
                                        const a = document.createElement("a");
                                        a.href = url;
                                        a.download = file.filename;
                                        a.click();
                                        URL.revokeObjectURL(url);
                                    }}
                                >
                                    Re-download
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}

            <PrintProgressCard />

            <PrintFooter
                machineSummary={machineSummary}
                hideSummary
                hideOutputHint
                cncLocked={cncLocked}
                cncLockReason="Left + Right in one file"
                primaryLabel={exportPrimaryButtonLabel(fileType, cncLocked)}
                onPrimary={onExport}
                busy={busy}
                showTargetPulse={pulseTarget}
                primaryDisabled={fileType ? !licenseOk : false}
            />
            {!fileType && pulseType ? (
                <p className="text-[10px] text-amber-400">Pick a file type</p>
            ) : null}
            {!exportTarget && pulseTarget ? (
                <p className="text-[10px] text-amber-400">Pick Left, Right, or Pair</p>
            ) : null}
            {fileType && !licenseOk ? (
                <p className="text-xs text-amber-400">
                    {canExport(user, license, fileType === "gcode" ? "gcode" : fileType).reason}
                </p>
            ) : null}
        </div>
    );
}
