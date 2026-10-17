// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    CLASS_PREVIEW_COLORS,
    HARDNESS_CLASS_TABLE,
    REGION_HARDNESS_CLASSES,
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
}

const selectClass =
    "h-7 w-full rounded-md border border-border bg-background px-1.5 text-[11px] text-foreground";

export function HardnessPicker({ id, value, onChange }: Props) {
    const cls = value.hardnessClass;
    const priority = value.priority ?? DEFAULT_ELEMENT_PRIORITY;
    const customPct = value.overrides?.sparseInfillDensityPct ?? 22;

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
            overrides: next === "Custom" ? { sparseInfillDensityPct: customPct } : value.overrides,
        });
    };

    return (
        <div className="space-y-1.5" data-testid="element-hardness-picker">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Hardness
            </div>
            <select
                className={selectClass}
                value={cls ?? ""}
                onChange={(e) => setClass(e.target.value as RegionHardnessClass | "")}
                aria-label="Hardness class"
            >
                <option value="">Device default (no modifier)</option>
                {REGION_HARDNESS_CLASSES.map((name) => (
                    <option key={name} value={name}>
                        {name}
                        {name !== "Custom"
                            ? ` · ${HARDNESS_CLASS_TABLE[name].sparseInfillDensityPct}% gyroid`
                            : " · 5–100%"}
                    </option>
                ))}
            </select>
            {cls ? (
                <>
                    <div className="flex items-center gap-1.5">
                        <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ background: CLASS_PREVIEW_COLORS[cls] }}
                        />
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
                    </div>
                    {cls === "Custom" ? (
                        <label className="flex items-center justify-between text-[11px] text-muted-foreground">
                            Custom density %
                            <input
                                type="number"
                                min={5}
                                max={100}
                                className="h-7 w-16 rounded-md border border-border bg-background px-1.5 text-right text-[11px] text-foreground"
                                value={customPct}
                                onChange={(e) =>
                                    onChange({
                                        regionId: value.regionId ?? id,
                                        hardnessClass: "Custom",
                                        priority,
                                        depth: value.depth ?? { ...DEFAULT_ELEMENT_DEPTH },
                                        overrides: {
                                            sparseInfillDensityPct: Number(e.target.value),
                                        },
                                    })
                                }
                            />
                        </label>
                    ) : null}
                </>
            ) : null}
        </div>
    );
}
