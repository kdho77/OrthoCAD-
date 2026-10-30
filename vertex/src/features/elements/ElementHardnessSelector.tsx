// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { useEffect, useRef } from "react";
import { elementDisplayName } from "@/lib/library/manifest";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";
import {
    CLASS_DISPLAY_NAMES,
    CLASS_PREVIEW_COLORS,
    NAMED_HARDNESS_CLASSES,
} from "../../../shared/print-recipe/hardness-class-table";

/** Small, keyboard-accessible Print selector; values come from the export's shared table. */
export function ElementHardnessSelector({ elementId }: { elementId: string }) {
    const element = useDesignStore((s) => s.design.elements.find((e) => e.id === elementId));
    const selected = useDesignStore((s) => s.selectedElementId === elementId);
    const print = useClinicalWorkflowStore((s) => s.step === "print");
    const setHardness = useDesignStore((s) => s.setElementHardness);
    const select = useDesignStore((s) => s.selectElement);
    const container = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (selected && print) {
            const root = container.current;
            (
                root?.querySelector<HTMLButtonElement>("[aria-pressed=true]") ??
                root?.querySelector<HTMLButtonElement>("[data-hardness-option]")
            )?.focus();
        }
    }, [selected, print]);
    if (!element || !selected || !print) return null;
    const name = elementDisplayName(element.kind, element.customName);
    return (
        <div
            ref={container}
            role="dialog"
            aria-label={`Hardness: ${name}, ${element.side}`}
            data-testid="element-hardness-popup"
            className="w-48 rounded-lg border border-border bg-panel p-2.5 text-foreground shadow-xl"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
                if (!(event.ctrlKey || event.metaKey)) event.stopPropagation();
                if (event.key === "Escape") {
                    event.preventDefault();
                    select(null);
                }
            }}
        >
            <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                    <div className="text-xs font-semibold capitalize">
                        {name} · {element.side}
                    </div>
                    <div className="text-[11px] text-muted-foreground">Hardness</div>
                </div>
                <button
                    type="button"
                    aria-label="Close hardness selector"
                    onClick={() => select(null)}
                    className="rounded px-1.5 text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-cyan-400"
                >
                    ×
                </button>
            </div>
            <fieldset className="space-y-1" aria-label="Element hardness">
                {NAMED_HARDNESS_CLASSES.map((hardness) => (
                    <button
                        key={hardness}
                        type="button"
                        data-hardness-option={hardness}
                        aria-pressed={element.hardnessClass === hardness}
                        className="flex min-h-9 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 aria-pressed:bg-muted"
                        onClick={() => setHardness(elementId, hardness)}
                    >
                        <span
                            aria-hidden="true"
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: CLASS_PREVIEW_COLORS[hardness] }}
                        />
                        {CLASS_DISPLAY_NAMES[hardness]}
                        {element.hardnessClass === hardness ? (
                            <span aria-hidden="true" className="ml-auto">
                                ✓
                            </span>
                        ) : null}
                    </button>
                ))}
            </fieldset>
        </div>
    );
}
