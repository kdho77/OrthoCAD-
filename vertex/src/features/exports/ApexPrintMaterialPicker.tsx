// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import {
    APEX_PRINT_MATERIAL_OPTIONS,
    type ApexPrintMaterialId,
} from "@/features/exports/apex-print-material";
import { cn } from "@/lib/utils";

export function ApexPrintMaterialPicker({
    value,
    onChange,
    pulse,
    compact,
}: {
    value: ApexPrintMaterialId | null;
    onChange: (id: ApexPrintMaterialId) => void;
    pulse?: boolean;
    compact?: boolean;
}) {
    return (
        <div className="space-y-1" data-testid="apex-print-material-picker">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Material
            </div>
            <div
                className={cn(
                    "grid grid-cols-2 gap-1 rounded-md border p-0.5",
                    pulse ? "animate-pulse border-amber-400" : "border-border",
                )}
            >
                {APEX_PRINT_MATERIAL_OPTIONS.map((opt) => {
                    const active = value === opt.id;
                    return (
                        <button
                            key={opt.id}
                            type="button"
                            disabled={!opt.enabled}
                            title={!opt.enabled ? opt.disabledReason : undefined}
                            data-testid={`apex-material-${opt.id}`}
                            onClick={() => {
                                if (opt.enabled) onChange(opt.id);
                            }}
                            className={cn(
                                compact ? "h-8 text-[10px]" : "py-2 text-[11px]",
                                "rounded-sm px-1 font-medium",
                                active
                                    ? "bg-primary text-primary-foreground"
                                    : "text-muted-foreground hover:bg-muted/60",
                                !opt.enabled && "cursor-not-allowed opacity-45",
                            )}
                        >
                            {opt.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
