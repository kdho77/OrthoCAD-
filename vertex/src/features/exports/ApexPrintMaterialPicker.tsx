// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import {
    APEX_PRINT_MATERIAL_OPTIONS,
    type ApexPrintMaterialId,
    apexPrintMaterialById,
    isApexPrintMaterialExportReady,
} from "@/features/exports/apex-print-material";

export function ApexPrintMaterialPicker({
    value,
    onChange,
    disabled,
}: {
    value: ApexPrintMaterialId;
    onChange: (id: ApexPrintMaterialId) => void;
    disabled?: boolean;
}) {
    const selected = apexPrintMaterialById(value);
    return (
        <div className="space-y-1" data-testid="apex-print-material-picker">
            <label className="block space-y-1" htmlFor="gcode-material">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Material
                </span>
                <select
                    id="gcode-material"
                    data-testid="gcode-material"
                    className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
                    value={value}
                    disabled={disabled}
                    onChange={(event) => {
                        const next = event.target.value as ApexPrintMaterialId;
                        if (!isApexPrintMaterialExportReady(next)) return;
                        onChange(next);
                    }}
                >
                    {APEX_PRINT_MATERIAL_OPTIONS.map((opt) => (
                        <option
                            key={opt.id}
                            value={opt.id}
                            disabled={!opt.enabled}
                            title={opt.disabledReason}
                            data-testid={`apex-material-${opt.id}`}
                        >
                            {opt.label}
                        </option>
                    ))}
                </select>
            </label>
            {selected.shoreLabel ? (
                <p className="text-[10px] text-muted-foreground" data-testid="gcode-material-shore">
                    {selected.label} · {selected.shoreLabel}
                </p>
            ) : null}
        </div>
    );
}
