// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { Cpu, Loader2, Printer } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { effectiveExportTarget } from "@/features/exports/export-target-default";
import type { ExportOutputTarget } from "@/features/exports/export-target";
import { usePrintExportSettingsStore } from "@/features/exports/print-export-settings-store";
import { useExportPrimaryBusyLabel } from "@/features/exports/viewport-busy-overlay";
import { cn } from "@/lib/utils";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";
import { useMillingProfileStore } from "@/stores/milling-profile-store";
import { SIDE_LABELS, type Side } from "@/types";

export const SEND_TO_PRINTER_TOOLTIP = "Send directly to your Apex V2 printer — coming soon.";

export interface PrintFooterProps {
    machineSummary: string;
    cncLocked?: boolean;
    cncLockReason?: string;
    primaryLabel: string;
    onPrimary: () => void;
    primaryDisabled?: boolean;
    busy?: boolean;
    focusPrimary?: boolean;
    sendToPrinterPlaceholder?: boolean;
    showBackLink?: boolean;
}

export function PrintFooter({
    machineSummary,
    cncLocked,
    cncLockReason,
    primaryLabel,
    onPrimary,
    primaryDisabled,
    busy,
    focusPrimary,
    sendToPrinterPlaceholder,
    showBackLink,
}: PrintFooterProps) {
    const exportTarget = useDesignStore((s) => s.exportTarget);
    const setExportTarget = useDesignStore((s) => s.setExportTarget);
    const goBack = useClinicalWorkflowStore((s) => s.goBack);
    const primaryRef = useRef<HTMLButtonElement>(null);
    const effectiveTarget = effectiveExportTarget(exportTarget, cncLocked);
    const busyLabel = useExportPrimaryBusyLabel(primaryLabel);

    useEffect(() => {
        if (!cncLocked && exportTarget == null) setExportTarget("pair");
    }, [cncLocked, exportTarget, setExportTarget]);

    useEffect(() => {
        if (focusPrimary) primaryRef.current?.focus();
    }, [focusPrimary]);

    const pick = (target: ExportOutputTarget) => {
        if (cncLocked) return;
        setExportTarget(target);
    };

    const choices: ExportOutputTarget[] = ["left", "right", "pair"];

    return (
        <div
            className="sticky bottom-0 z-20 -mx-3 border-t border-border bg-panel/95 px-3 py-2 backdrop-blur"
            data-testid="print-export-footer"
        >
            <div className="space-y-2">
                <div
                    className="grid grid-cols-3 gap-1 rounded-md border border-border p-0.5"
                    data-testid="export-target-selector"
                >
                    {choices.map((choice) => {
                        const locked = cncLocked && choice !== "pair";
                        const active = effectiveTarget === choice;
                        return (
                            <button
                                key={choice}
                                type="button"
                                disabled={locked}
                                title={locked ? cncLockReason : undefined}
                                onClick={() => pick(choice)}
                                className={cn(
                                    "h-8 rounded-sm text-[11px] font-medium",
                                    active
                                        ? "bg-primary text-primary-foreground"
                                        : "text-muted-foreground hover:bg-muted/60",
                                    locked && "cursor-not-allowed opacity-40",
                                )}
                            >
                                {choice === "pair" ? "Pair" : SIDE_LABELS[choice as Side]}
                            </button>
                        );
                    })}
                </div>
                {cncLocked ? (
                    <p className="text-[10px] text-muted-foreground">{cncLockReason}</p>
                ) : null}
                <p className="truncate text-[11px] text-muted-foreground" data-testid="print-export-summary">
                    {machineSummary}
                </p>
                <div className="flex flex-col gap-1.5">
                    <Button
                        ref={primaryRef}
                        className="h-9 w-full gap-2"
                        disabled={primaryDisabled || busy}
                        onClick={onPrimary}
                        data-testid="print-export-primary"
                    >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                        {busy ? busyLabel : primaryLabel}
                    </Button>
                    {sendToPrinterPlaceholder ? (
                        <Button
                            type="button"
                            variant="outline"
                            className="h-9 w-full opacity-60"
                            disabled
                            aria-disabled="true"
                            title={SEND_TO_PRINTER_TOOLTIP}
                            data-testid="export-send-to-printer"
                            onClick={(event) => event.preventDefault()}
                        >
                            <Printer className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            Send to printer — coming soon
                        </Button>
                    ) : null}
                </div>
                {showBackLink ? (
                    <button
                        type="button"
                        className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                        onClick={() => goBack()}
                    >
                        Back
                    </button>
                ) : null}
            </div>
        </div>
    );
}

export function MachineSegment({
    machine,
    setMachine,
}: {
    machine: "printer" | "cnc";
    setMachine: (m: "printer" | "cnc") => void;
    hint?: string;
}) {
    return (
        <div className="flex gap-1 rounded-md border border-border p-0.5" data-testid="machine-segment">
            {(
                [
                    { id: "printer" as const, label: "3D printer", icon: Printer },
                    { id: "cnc" as const, label: "CNC", icon: Cpu },
                ] as const
            ).map((m) => (
                <button
                    key={m.id}
                    type="button"
                    onClick={() => setMachine(m.id)}
                    className={cn(
                        "flex h-8 flex-1 items-center justify-center gap-1 rounded-sm px-2 text-[11px] font-medium",
                        machine === m.id
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-muted/60",
                    )}
                >
                    <m.icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {m.label}
                </button>
            ))}
        </div>
    );
}

export function useMachineSummaryLine(): string {
    const machine = useMillingProfileStore((s) => s.machine);
    const design = useDesignStore((s) => s.design);
    const materialId = usePrintExportSettingsStore((s) => s.apexMaterialId);
    const hardness = design.printRecipe?.defaultHardness ?? "Medium";
    if (machine === "cnc") return "Idaho CNC · straight walls";
    const material =
        materialId === "ApexLight"
            ? "Light"
            : materialId === "ApexCore"
              ? "Core"
              : materialId === "ApexBounce"
                ? "Bounce"
                : materialId === "ApexForge"
                  ? "Forge"
                  : "TPU";
    return `Apex V2 · TPU · ${material} · ${hardness}`;
}
