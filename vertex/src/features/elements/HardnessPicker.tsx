// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import {
    CLASS_DISPLAY_NAMES,
    CLASS_PREVIEW_COLORS,
    classLineWidthMm,
    HARDNESS_CLASS_TABLE,
    NAMED_HARDNESS_CLASSES,
    type RegionHardnessClass,
} from "../../../shared/print-recipe/hardness-class-table";
import type { DepthSpec, HardnessOverrides } from "../../../shared/print-recipe/hardness-region";
import {
    DEFAULT_ELEMENT_DEPTH,
    DEFAULT_ELEMENT_PRIORITY,
} from "../../../shared/print-recipe/hardness-region";

export interface HardnessPickerValue {
    regionId?: string;
    hardnessClass?: RegionHardnessClass;
    priority?: number;
    depth?: DepthSpec;
    overrides?: HardnessOverrides;
}

interface Props {
    id: string;
    value: HardnessPickerValue;
    onChange: (patch: HardnessPickerValue) => void;
    /** Resource settings: hardness is required (default Medium). */
    required?: boolean;
}

const selectClass =
    "h-7 w-full rounded-md border border-border bg-background px-1.5 text-[11px] text-foreground";

export function HardnessPicker({ id, value, onChange, required = false }: Props) {
    const cls = value.hardnessClass;
    const priority = value.priority ?? DEFAULT_ELEMENT_PRIORITY;
    const customPct = value.overrides?.sparseInfillDensityPct ?? 26;

    const setClass = (next: RegionHardnessClass | "") => {
        if (!next) {
            onChange({
                hardnessClass: undefined,
                regionId: undefined,
                priority: undefined,
                depth: undefined,
                overrides: undefined,
            });
            return;
        }
        onChange({
            regionId: value.regionId ?? id,
            hardnessClass: next,
            priority,
            depth: value.depth ?? { ...DEFAULT_ELEMENT_DEPTH },
            overrides: next === "Custom" ? { sparseInfillDensityPct: customPct } : undefined,
        });
    };

    return (
        <div className="space-y-1.5" data-testid="element-hardness-picker">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Hardness
            </div>
            <select
                className={selectClass}
                value={cls ?? (required ? "Medium" : "")}
                onChange={(e) => setClass(e.target.value as RegionHardnessClass | "")}
                aria-label="Hardness"
                data-testid="hardness-dropdown"
            >
                {required ? null : <option value="">Device default (no modifier)</option>}
                {NAMED_HARDNESS_CLASSES.map((name) => (
                    <option key={name} value={name}>
                        {CLASS_DISPLAY_NAMES[name]}
                    </option>
                ))}
            </select>
            {cls && cls !== "Custom" ? (
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: CLASS_PREVIEW_COLORS[cls] }}
                    />
                    <span>
                        {HARDNESS_CLASS_TABLE[cls].sparseInfillDensityPct}% gyroid ·{" "}
                        {classLineWidthMm(cls).toFixed(1)} mm
                        {HARDNESS_CLASS_TABLE[cls].pendingCouponValidation ? " · pending coupon" : ""}
                    </span>
                </div>
            ) : null}
            {cls ? (
                <label className="flex flex-1 items-center justify-between text-[11px] text-muted-foreground">
                    Priority
                    <input
                        type="number"
                        className="h-7 w-16 rounded-md border border-border bg-background px-1.5 text-right text-[11px] text-foreground"
                        value={priority}
                        onChange={(e) =>
                            onChange({
                                regionId: value.regionId ?? id,
                                hardnessClass: cls,
                                priority: Number(e.target.value),
                                depth: value.depth ?? { ...DEFAULT_ELEMENT_DEPTH },
                                overrides: value.overrides,
                            })
                        }
                        aria-label="Hardness priority"
                    />
                </label>
            ) : null}
        </div>
    );
}
