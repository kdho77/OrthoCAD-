// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { Cpu, Printer } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ExportOutputTarget } from "@/features/exports/export-target";
import { exportTargetLabel } from "@/features/exports/export-target";
import { cn } from "@/lib/utils";
import { useDesignStore } from "@/stores/design-store";
import { useMillingProfileStore } from "@/stores/milling-profile-store";
import { SIDE_LABELS, type Side } from "@/types";

export interface PrintFooterProps {
    machineSummary: string;
    cncLocked?: boolean;
    cncLockReason?: string;
    primaryLabel: string;
    secondaryLabel?: string;
    onPrimary: () => void;
    onSecondary?: () => void;
    primaryDisabled?: boolean;
    showTargetPulse?: boolean;
    busy?: boolean;
    focusPrimary?: boolean;
    /** Hide the one-line machine summary (Export footer). */
    hideSummary?: boolean;
    /** Hide the output hint under the primary button. */
    hideOutputHint?: boolean;
}

export function PrintFooter({
    machineSummary,
    cncLocked,
    cncLockReason,
    primaryLabel,
    secondaryLabel,
    onPrimary,
    onSecondary,
    primaryDisabled,
    showTargetPulse,
    busy,
    focusPrimary,
    hideSummary,
    hideOutputHint,
}: PrintFooterProps) {
    const exportTarget = useDesignStore((s) => s.exportTarget);
    const setExportTarget = useDesignStore((s) => s.setExportTarget);
    const primaryRef = useRef<HTMLButtonElement>(null);
    const [pulseTarget, setPulseTarget] = useState(false);

    useEffect(() => {
        if (focusPrimary) primaryRef.current?.focus();
    }, [focusPrimary]);

    useEffect(() => {
        if (showTargetPulse) {
            setPulseTarget(true);
            const id = window.setTimeout(() => setPulseTarget(false), 1200);
            return () => window.clearTimeout(id);
        }
    }, [showTargetPulse]);

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
                    className={cn(
                        "grid grid-cols-3 gap-1 rounded-md border p-0.5",
                        pulseTarget ? "animate-pulse border-amber-400" : "border-border",
                    )}
                    data-testid="export-target-selector"
                >
                    {choices.map((choice) => {
                        const locked = cncLocked && choice !== "pair";
                        const active = exportTarget === choice || (cncLocked && choice === "pair");
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
                {hideSummary ? null : (
                    <p className="truncate text-[11px] text-muted-foreground">{machineSummary}</p>
                )}
                <div className="flex flex-col gap-1.5">
                    <Button
                        ref={primaryRef}
                        className="h-9 w-full"
                        disabled={primaryDisabled || busy}
                        onClick={onPrimary}
                        data-testid="print-export-primary"
                    >
                        {primaryLabel}
                    </Button>
                    {secondaryLabel && onSecondary ? (
                        <Button
                            variant="secondary"
                            className="h-8 w-full"
                            disabled={busy}
                            onClick={onSecondary}
                        >
                            {secondaryLabel}
                        </Button>
                    ) : null}
                </div>
                {exportTarget && !hideOutputHint ? (
                    <p className="text-[10px] text-muted-foreground">
                        Output: {exportTargetLabel(exportTarget)}
                    </p>
                ) : null}
            </div>
        </div>
    );
}

export function MachineSegment({
    machine,
    setMachine,
    hint,
}: {
    machine: "printer" | "cnc";
    setMachine: (m: "printer" | "cnc") => void;
    hint: string;
}) {
    return (
        <div className="space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Machine</div>
            <div className="flex gap-1">
                {(
                    [
                        { id: "printer" as const, label: "3D printer", icon: Printer },
                        { id: "cnc" as const, label: "3-axis CNC", icon: Cpu },
                    ] as const
                ).map((m) => (
                    <button
                        key={m.id}
                        type="button"
                        onClick={() => setMachine(m.id)}
                        className={cn(
                            "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border px-2 text-xs",
                            machine === m.id
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-border bg-background text-muted-foreground",
                        )}
                    >
                        <m.icon className="h-3.5 w-3.5" />
                        {m.label}
                    </button>
                ))}
            </div>
            <p className="text-[10px] leading-snug text-muted-foreground">{hint}</p>
        </div>
    );
}

export function useMachineSummaryLine(): string {
    const machine = useMillingProfileStore((s) => s.machine);
    const design = useDesignStore((s) => s.design);
    const hardness = design.printRecipe?.defaultHardness ?? "Medium";
    return machine === "cnc" ? "Idaho CNC · straight walls" : `Apex Belt V2 · TPU · 45° · ${hardness}`;
}
