// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HardnessPicker } from "@/features/elements/HardnessPicker";
import { useDesignStore } from "@/stores/design-store";
import {
    CLASS_DISPLAY_NAMES,
    CLASS_PREVIEW_COLORS,
    NAMED_HARDNESS_CLASSES,
} from "../../../shared/print-recipe/hardness-class-table";

function ToggleRow({
    label,
    checked,
    onChange,
    testId,
}: {
    label: string;
    checked: boolean;
    onChange: (next: boolean) => void;
    testId: string;
}) {
    return (
        <label className="flex items-center justify-between gap-2 text-xs text-foreground">
            <span>{label}</span>
            <button
                type="button"
                role="switch"
                aria-checked={checked}
                aria-label={label}
                data-testid={testId}
                onClick={() => onChange(!checked)}
                className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                    checked ? "bg-cyan-400" : "bg-muted"
                }`}
            >
                <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                        checked ? "left-4" : "left-0.5"
                    }`}
                />
            </button>
        </label>
    );
}

export function HardnessLegend({ compact = false }: { compact?: boolean }) {
    return (
        <div
            className={compact ? "flex flex-wrap gap-x-2 gap-y-1" : "space-y-1"}
            data-testid="hardness-legend"
        >
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Hardness
            </div>
            <ul className={compact ? "flex flex-wrap gap-x-2 gap-y-1" : "space-y-0.5"}>
                {NAMED_HARDNESS_CLASSES.map((name) => (
                    <li key={name} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ background: CLASS_PREVIEW_COLORS[name] }}
                        />
                        {CLASS_DISPLAY_NAMES[name]}
                    </li>
                ))}
            </ul>
        </div>
    );
}

export function ResourceSettingsPanel() {
    const selectedElementId = useDesignStore((s) => s.selectedElementId);
    const elements = useDesignStore((s) => s.design.elements);
    const updateElement = useDesignStore((s) => s.updateElement);
    const selected = elements.find((e) => e.id === selectedElementId) ?? null;
    if (!selected) return null;

    return (
        <div className="space-y-2" data-testid="resource-settings">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Resource settings
            </div>
            <HardnessPicker
                id={selected.id}
                required
                value={{
                    regionId: selected.regionId,
                    hardnessClass: selected.hardnessClass ?? "Medium",
                    priority: selected.priority,
                    depth: selected.depth,
                    overrides: selected.overrides,
                }}
                onChange={(patch) => updateElement(selected.id, patch)}
            />
        </div>
    );
}

export function SplitSettingsPanel() {
    const splitElements = useDesignStore((s) => Boolean(s.design.splitElements));
    const smoothElements = useDesignStore((s) => Boolean(s.design.smoothElements));
    const selectedElementId = useDesignStore((s) => s.selectedElementId);
    const setSplitElements = useDesignStore((s) => s.setSplitElements);
    const setSmoothElements = useDesignStore((s) => s.setSmoothElements);
    const selected = Boolean(selectedElementId);

    return (
        <div className="space-y-3" data-testid="split-settings">
            {splitElements && selected ? <ResourceSettingsPanel /> : null}

            <div className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Settings
                </div>
                <ToggleRow
                    label="Split elements"
                    checked={splitElements}
                    onChange={setSplitElements}
                    testId="split-elements-toggle"
                />
                <ToggleRow
                    label="Smooth elements"
                    checked={smoothElements}
                    onChange={setSmoothElements}
                    testId="smooth-elements-toggle"
                />
                {smoothElements ? (
                    <p className="text-[10px] text-muted-foreground">
                        Smooth is saved with the design. Boundary smoothing needs CAD sign-off — geometry is
                        unchanged.
                    </p>
                ) : null}
            </div>

            <div className="space-y-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Additions
                </div>
                <Button
                    type="button"
                    size="sm"
                    variant={splitElements ? "default" : "secondary"}
                    className="h-8"
                    data-testid="additions-split-button"
                    onClick={() => setSplitElements(true)}
                >
                    <Scissors className="h-3.5 w-3.5" />
                    Split
                </Button>
            </div>

            {splitElements ? <HardnessLegend /> : null}
        </div>
    );
}
