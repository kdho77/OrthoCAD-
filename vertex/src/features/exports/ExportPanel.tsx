import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { CaseOrderSummary } from "@/components/clinical/CaseOrderSummary";
import { ExportTile } from "@/features/exports/ExportTile";
import { buildExportFilename } from "@/features/exports/export-filename";
import { exportDesign } from "@/features/exports/export-service";
import { designRevisionFingerprint, useExportSessionStore } from "@/features/exports/export-session-store";
import { stlExportUserMessage } from "@/features/exports/export-user-message";
import { PrintFooter, useMachineSummaryLine } from "@/features/exports/PrintFooter";
import { PrintProgressCard } from "@/features/exports/PrintProgressCard";
import { TextSummary } from "@/features/exports/TextSummary";
import { showSuperAdminLink } from "@/features/admin/admin-nav";
import { canExport, TOKEN_COST } from "@/features/licensing/license";
import { useSolidValidation } from "@/hooks/useSolidValidation";
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
    const setStep = useClinicalWorkflowStore((s) => s.setStep);
    const [devOpen, setDevOpen] = useState(false);
    const [focusPrint, setFocusPrint] = useState(false);
    const [busy, setBusy] = useState<"stl" | "3mf" | "glb" | null>(null);
    const [errors, setErrors] = useState<Partial<Record<"stl" | "3mf" | "glb", string>>>({});

    const validationSide = exportTarget === "right" ? "right" : "left";
    const validation = useSolidValidation(design, validationSide);
    const stlCheck = canExport(user, license, "stl");
    const threeMfCheck = canExport(user, license, "3mf");
    const glbCheck = canExport(user, license, "glb");

    const session = useExportSessionStore();
    const revision = designRevisionFingerprint(design);
    const machineSummary = useMachineSummaryLine();

    useEffect(() => {
        useExportSessionStore.getState().setDesignRevision(revision);
    }, [revision]);

    const requireTarget = (): boolean => {
        if (exportTarget) return true;
        return false;
    };

    const runStl = async () => {
        if (!exportTarget) return;
        setBusy("stl");
        setErrors((e) => ({ ...e, stl: undefined }));
        session.setProgress({ phase: "exporting", message: "Exporting STL…" });
        try {
            const res = await exportDesign("stl", exportTarget);
            if (res.ok && res.blob) {
                session.recordSuccess({
                    id: `stl-${Date.now()}`,
                    kind: "stl",
                    target: exportTarget,
                    filename: res.filename ?? buildExportFilename("stl", exportTarget),
                    sizeBytes: res.blob.size,
                    blob: res.blob,
                    tokensCharged: TOKEN_COST.stl,
                    designRevision: revision,
                    createdAt: Date.now(),
                });
            } else {
                setErrors((e) => ({ ...e, stl: stlExportUserMessage(res.reason) }));
                session.setProgress({ phase: "idle" });
            }
        } catch (err) {
            setErrors((e) => ({
                ...e,
                stl: stlExportUserMessage(err instanceof Error ? err.message : undefined),
            }));
            session.setProgress({ phase: "idle" });
        } finally {
            setBusy(null);
        }
    };

    const run3mf = async () => {
        if (!exportTarget) return;
        setBusy("3mf");
        setErrors((e) => ({ ...e, "3mf": undefined }));
        session.setProgress({ phase: "exporting", message: "Building 3MF…" });
        try {
            const res = await exportDesign("3mf", exportTarget);
            if (res.ok && res.blob) {
                session.recordSuccess({
                    id: `3mf-${Date.now()}`,
                    kind: "3mf",
                    target: exportTarget,
                    filename: res.filename ?? buildExportFilename("3mf", exportTarget),
                    sizeBytes: res.blob.size,
                    blob: res.blob,
                    tokensCharged: TOKEN_COST["3mf"],
                    designRevision: revision,
                    createdAt: Date.now(),
                });
            } else {
                setErrors((e) => ({ ...e, "3mf": res.reason ?? "3MF export failed" }));
                session.setProgress({ phase: "idle" });
            }
        } catch (err) {
            setErrors((e) => ({ ...e, "3mf": err instanceof Error ? err.message : "3MF export failed" }));
            session.setProgress({ phase: "idle" });
        } finally {
            setBusy(null);
        }
    };

    const runGlb = async () => {
        if (!exportTarget || exportTarget === "pair") return;
        setBusy("glb");
        try {
            await exportDesign("glb", exportTarget);
        } finally {
            setBusy(null);
        }
    };

    const stlRecord = session.byKind.stl;
    const mfRecord = session.byKind["3mf"];
    const gcodeRecord = session.byKind.gcode;
    const cncLocked = machine === "cnc";

    return (
        <div className="relative flex min-h-0 flex-col gap-3 pb-36">
            <CaseOrderSummary />
            <TextSummary />
            <p className="text-[11px] text-muted-foreground">{tokenLine(user?.tokenBalance, license?.status)}</p>

            {validation.error ? (
                <p className="text-xs text-amber-400">{validation.error}</p>
            ) : null}

            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <ExportTile
                    testId="export-tile-gcode"
                    title="G-code"
                    purpose="Prepared print file from the Print step"
                    costLabel={`${TOKEN_COST.gcode} token`}
                    buttonLabel={
                        gcodeRecord && !session.isOutOfDate("gcode")
                            ? "Download G-code"
                            : "Open Print step"
                    }
                    busy={false}
                    onAction={() => {
                        if (gcodeRecord && !session.isOutOfDate("gcode") && gcodeRecord.blob) {
                            const url = URL.createObjectURL(gcodeRecord.blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = gcodeRecord.filename;
                            a.click();
                            URL.revokeObjectURL(url);
                            return;
                        }
                        setFocusPrint(true);
                        setStep("print");
                    }}
                    outOfDate={session.isOutOfDate("gcode")}
                    result={
                        gcodeRecord
                            ? {
                                  filename: gcodeRecord.filename,
                                  sizeBytes: gcodeRecord.sizeBytes,
                                  tokensCharged: gcodeRecord.tokensCharged,
                                  onDownload: () => {
                                      const url = URL.createObjectURL(gcodeRecord.blob);
                                      const a = document.createElement("a");
                                      a.href = url;
                                      a.download = gcodeRecord.filename;
                                      a.click();
                                      URL.revokeObjectURL(url);
                                  },
                              }
                            : undefined
                    }
                />
                <ExportTile
                    testId="export-tile-stl"
                    title="STL"
                    purpose="Mesh for other slicers or CAM"
                    costLabel={`${TOKEN_COST.stl} token`}
                    buttonLabel={`Export STL · ${TOKEN_COST.stl} token`}
                    busy={busy === "stl"}
                    disabled={!stlCheck.ok || !exportTarget}
                    locked={!stlCheck.ok}
                    onAction={() => (requireTarget() ? runStl() : undefined)}
                    outOfDate={session.isOutOfDate("stl")}
                    error={
                        errors.stl
                            ? { message: errors.stl, noTokens: true, onRetry: runStl }
                            : undefined
                    }
                    result={
                        stlRecord
                            ? {
                                  filename: stlRecord.filename,
                                  sizeBytes: stlRecord.sizeBytes,
                                  tokensCharged: stlRecord.tokensCharged,
                                  onDownload: () => {
                                      const url = URL.createObjectURL(stlRecord.blob);
                                      const a = document.createElement("a");
                                      a.href = url;
                                      a.download = stlRecord.filename;
                                      a.click();
                                      URL.revokeObjectURL(url);
                                  },
                              }
                            : undefined
                    }
                />
                <ExportTile
                    testId="export-tile-3mf"
                    title="3MF"
                    purpose="Hardness-aware pack for Bambu / Prusa slicers"
                    badge="Recommended"
                    costLabel={`${TOKEN_COST["3mf"]} token`}
                    buttonLabel={`Export 3MF · ${TOKEN_COST["3mf"]} token`}
                    busy={busy === "3mf"}
                    disabled={!threeMfCheck.ok || !exportTarget}
                    locked={!threeMfCheck.ok}
                    onAction={() => (requireTarget() ? run3mf() : undefined)}
                    outOfDate={session.isOutOfDate("3mf")}
                    error={
                        errors["3mf"]
                            ? { message: errors["3mf"], noTokens: true, onRetry: run3mf }
                            : undefined
                    }
                    result={
                        mfRecord
                            ? {
                                  filename: mfRecord.filename,
                                  sizeBytes: mfRecord.sizeBytes,
                                  tokensCharged: mfRecord.tokensCharged,
                                  onDownload: () => {
                                      const url = URL.createObjectURL(mfRecord.blob);
                                      const a = document.createElement("a");
                                      a.href = url;
                                      a.download = mfRecord.filename;
                                      a.click();
                                      URL.revokeObjectURL(url);
                                  },
                              }
                            : undefined
                    }
                />
            </div>

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
                        <ExportTile
                            testId="export-tile-glb"
                            title="GLB"
                            purpose="Watertight preview solid (super admin)"
                            costLabel="0 tokens"
                            buttonLabel="Download GLB"
                            busy={busy === "glb"}
                            disabled={!glbCheck.ok || !exportTarget || exportTarget === "pair"}
                            onAction={runGlb}
                        />
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
                cncLocked={cncLocked}
                cncLockReason="Left + Right in one file"
                primaryLabel="Export uses target above"
                primaryDisabled
                focusPrimary={focusPrint}
                showTargetPulse={!exportTarget}
                onPrimary={() => undefined}
            />
        </div>
    );
}
