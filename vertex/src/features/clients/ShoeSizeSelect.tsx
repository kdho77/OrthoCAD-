// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useMemo, useState } from "react";
import {
    DEFAULT_SHOE_SIZE_SYSTEM,
    displaySizeForUsMen,
    normalizeUsMenSize,
    SHOE_SIZE_UNITS,
    type ShoeSizeDisplayUnit,
    shoeSizePickerOptions,
    usMenSizeFromDisplayUnit,
} from "@/lib/geometry/shoe-size";

const UNIT_LABELS: Record<ShoeSizeDisplayUnit, string> = {
    us: "US",
    uk: "UK",
    eu: "EU",
    mm: "MM",
};

export function ShoeSizeSelect({
    label,
    testId,
    value,
    onChange,
    initialUnit = DEFAULT_SHOE_SIZE_SYSTEM,
}: {
    label: string;
    testId: string;
    value: number | undefined;
    onChange: (usMenSize: number | undefined) => void;
    initialUnit?: ShoeSizeDisplayUnit;
}) {
    const [unit, setUnit] = useState<ShoeSizeDisplayUnit>(initialUnit);

    const options = useMemo(() => shoeSizePickerOptions(unit), [unit]);

    const selectedDisplay =
        value != null && Number.isFinite(value) ? displaySizeForUsMen(unit, value) : undefined;

    const selectValue =
        selectedDisplay != null
            ? String(unit === "mm" ? selectedDisplay : normalizePickerScalar(unit, selectedDisplay))
            : "";

    return (
        <label className="text-xs text-muted-foreground" data-testid={`${testId}-field`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{label}</span>
                <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <span>Sizing:</span>
                    {SHOE_SIZE_UNITS.map((u) => (
                        <button
                            key={u}
                            type="button"
                            data-testid={`${testId}-unit-${u}`}
                            className={
                                unit === u
                                    ? "rounded bg-primary/15 px-2 py-0.5 text-foreground"
                                    : "rounded px-2 py-0.5 hover:text-foreground"
                            }
                            onClick={() => setUnit(u)}
                        >
                            {UNIT_LABELS[u]}
                        </button>
                    ))}
                </span>
            </div>
            <select
                data-testid={testId}
                aria-label={label}
                className="mt-1 block min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                value={selectValue}
                onChange={(event) => {
                    const raw = event.target.value.trim();
                    if (!raw) {
                        onChange(undefined);
                        return;
                    }
                    const parsed = Number(raw);
                    if (!Number.isFinite(parsed)) {
                        onChange(undefined);
                        return;
                    }
                    onChange(usMenSizeFromDisplayUnit(unit, parsed));
                }}
            >
                <option value="">Select size</option>
                {options.map((option) => (
                    <option key={`${unit}-${option.value}`} value={String(option.value)}>
                        {option.label}
                    </option>
                ))}
            </select>
        </label>
    );
}

function normalizePickerScalar(unit: ShoeSizeDisplayUnit, value: number): number {
    if (unit === "us") return normalizeUsMenSize(value);
    return value;
}
