// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePerformanceStore } from "@/stores/performance-store";

interface SliderFieldProps {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    unit?: string;
    onChange: (value: number) => void;
    /** Live preview during drag — does not commit to design store until pointer-up. */
    onPreview?: (value: number) => void;
    className?: string;
    /** When set, replaces the numeric readout (e.g. "—" for inactive derived fields). */
    displayText?: string;
    /** Restore this value (shows a reset control when current differs). */
    defaultValue?: number;
    onReset?: () => void;
    /** e.g. "from PF" when the value originated from a preset. */
    originLabel?: string;
}

/**
 * Compact labeled slider with preview/commit split for smooth CAD interaction.
 * During pointer drag, only `onPreview` fires (rAF-throttled via caller).
 * On pointer-up, `onChange` commits the final value.
 */
export function SliderField({
    label,
    value,
    min,
    max,
    step = 0.5,
    unit,
    onChange,
    onPreview,
    className,
    displayText,
    defaultValue,
    onReset,
    originLabel,
}: SliderFieldProps) {
    const setInteracting = usePerformanceStore((s) => s.setInteracting);
    const clamp = (v: number) => Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));

    const handlePreview = (v: number) => {
        const c = clamp(v);
        if (onPreview) onPreview(c);
        else onChange(c);
    };

    const handleCommit = (v: number) => {
        const cv = clamp(v);
        setInteracting(false);
        onChange(cv);
    };

    const onPointerDown = () => setInteracting(true, "slider");
    const canReset = onReset != null && (defaultValue == null || Math.abs(value - defaultValue) > 1e-6);
    const controlId = `slider-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

    return (
        <div className={cn("space-y-1", className)}>
            <div className="flex items-center justify-between">
                <label htmlFor={controlId} className="text-xs text-muted-foreground">
                    {label}
                </label>
                <div className="flex items-center gap-1">
                    {originLabel ? (
                        <span className="max-w-[4.5rem] truncate rounded bg-primary/15 px-1 py-0.5 text-[9px] text-primary">
                            {originLabel}
                        </span>
                    ) : null}
                    {displayText != null ? (
                        <span className="flex h-6 w-16 items-center justify-end px-1 text-xs tabular-nums text-muted-foreground">
                            {displayText}
                        </span>
                    ) : (
                        <input
                            type="number"
                            value={value}
                            min={min}
                            max={max}
                            step={step}
                            onChange={(e) => handleCommit(Number(e.target.value))}
                            className="h-6 w-16 rounded border border-input bg-background px-1 text-right text-xs tabular-nums focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                    )}
                    {unit ? <span className="w-5 text-xs text-muted-foreground">{unit}</span> : null}
                    {canReset ? (
                        <button
                            type="button"
                            title="Reset"
                            onClick={() => onReset()}
                            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                            <RotateCcw className="h-3 w-3" />
                        </button>
                    ) : null}
                </div>
            </div>
            <input
                id={controlId}
                type="range"
                value={value}
                min={min}
                max={max}
                step={step}
                onPointerDown={onPointerDown}
                onPointerUp={(e) => handleCommit(Number(e.currentTarget.value))}
                onChange={(e) => handlePreview(Number(e.target.value))}
                className="h-1 w-full cursor-pointer appearance-none rounded bg-muted accent-primary"
            />
        </div>
    );
}
