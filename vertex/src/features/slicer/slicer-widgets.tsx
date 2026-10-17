// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { VertexSlicePrintDirection } from "../../../shared/vertexslice/contract";
import { formatDimensionsMm, type FootSideTag, unitsWarning } from "./slicer-mesh";
import type { SlicerFileSlot, SliceStep } from "./slicer-state";

export const SLICER_SLOW_MS = 20_000;
export const SLICER_STEPS: SliceStep[] = ["Preparing", "Slicing", "Packaging"];

export function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileChip({
    slot,
    pair,
    uploading,
    validating,
    onRemove,
    onSide,
    onInches,
}: {
    slot: SlicerFileSlot;
    pair: boolean;
    uploading: boolean;
    validating: boolean;
    onRemove: () => void;
    onSide: (side: FootSideTag) => void;
    onInches: () => void;
}) {
    const warn = slot.mesh && !slot.treatedAsInches ? unitsWarning(slot.mesh.bounds.lengthMm) : null;
    return (
        <div className="mt-3 rounded-md border border-border bg-background p-2.5">
            <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                    <div className="truncate text-sm">{slot.file.name}</div>
                    <div className="text-[11px] text-muted-foreground">{formatBytes(slot.file.size)}</div>
                </div>
                <button
                    type="button"
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label="Remove"
                    onClick={onRemove}
                >
                    <X className="h-4 w-4" />
                </button>
            </div>
            {uploading ? (
                <div className="mt-2 h-1.5 overflow-hidden rounded bg-muted">
                    <div className="h-full bg-primary" style={{ width: `${slot.progress}%` }} />
                </div>
            ) : null}
            {validating ? <p className="mt-2 text-xs text-muted-foreground">Checking file…</p> : null}
            {slot.mesh ? (
                <p className="mt-2 text-xs text-muted-foreground">{formatDimensionsMm(slot.mesh.bounds)}</p>
            ) : null}
            {slot.issue ? (
                <p className="mt-2 text-xs text-destructive">
                    {slot.issue.message} {slot.issue.fix}
                </p>
            ) : null}
            {warn ? (
                <div className="mt-2 rounded bg-amber-500/15 p-2 text-xs text-amber-200">
                    {warn === "small"
                        ? "This looks shorter than 150 mm, which often means the file is in inches."
                        : "This looks longer than 350 mm, which may be a units problem."}
                    <Button type="button" size="sm" variant="outline" className="ml-2" onClick={onInches}>
                        Treat as inches
                    </Button>
                </div>
            ) : null}
            {pair ? (
                <div className="mt-2 flex gap-2">
                    {(["left", "right"] as const).map((side) => (
                        <button
                            key={side}
                            type="button"
                            onClick={() => onSide(side)}
                            className={cn(
                                "rounded px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                slot.side === side ? "bg-primary text-primary-foreground" : "bg-muted",
                            )}
                        >
                            {side === "left" ? "Left" : "Right"}
                        </button>
                    ))}
                </div>
            ) : (
                <p className="mt-2 text-[11px] text-muted-foreground">One file at a time.</p>
            )}
        </div>
    );
}

export function Segmented({
    ariaLabel,
    value,
    onChange,
    options,
}: {
    ariaLabel: string;
    value: VertexSlicePrintDirection;
    onChange: (v: VertexSlicePrintDirection) => void;
    options: { value: VertexSlicePrintDirection; label: string; hint: string }[];
}) {
    return (
        <div
            role="radiogroup"
            aria-label={ariaLabel}
            className="mt-2 flex rounded-md border border-border p-0.5"
            onKeyDown={(e) => {
                const i = options.findIndex((o) => o.value === value);
                if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                    e.preventDefault();
                    onChange(options[(i + 1) % options.length].value);
                }
                if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                    e.preventDefault();
                    onChange(options[(i - 1 + options.length) % options.length].value);
                }
            }}
        >
            {options.map((opt) => {
                const selected = opt.value === value;
                return (
                    <label
                        key={opt.value}
                        title={opt.hint}
                        className={cn(
                            "flex flex-1 cursor-pointer items-center justify-center gap-1 rounded px-2 py-1.5 text-sm focus-within:ring-2 focus-within:ring-ring",
                            selected
                                ? "bg-secondary text-foreground"
                                : "text-muted-foreground hover:text-foreground",
                        )}
                    >
                        <input
                            type="radio"
                            name="slicer-print-direction"
                            className="sr-only"
                            checked={selected}
                            onChange={() => onChange(opt.value)}
                        />
                        <svg width="12" height="12" viewBox="0 0 12 12" className="opacity-80">
                            <title>{opt.hint}</title>
                            {opt.value === "toe_first" ? (
                                <path
                                    d="M2 6h7M7 3l3 3-3 3"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.5"
                                />
                            ) : (
                                <path
                                    d="M10 6H3M5 3L2 6l3 3"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.5"
                                />
                            )}
                        </svg>
                        {opt.label}
                    </label>
                );
            })}
        </div>
    );
}
