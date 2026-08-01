import { useEffect, useRef, useState } from "react";
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
}: SliderFieldProps) {
    const setInteracting = usePerformanceStore((s) => s.setInteracting);
    const clamp = (v: number) => Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));
    // Local value keeps the range + numeric readout instant while geometry rebuilds throttle.
    const [localValue, setLocalValue] = useState(value);
    const draggingRef = useRef(false);

    useEffect(() => {
        if (!draggingRef.current) setLocalValue(value);
    }, [value]);

    const handlePreview = (v: number) => {
        const c = clamp(v);
        setLocalValue(c);
        if (onPreview) onPreview(c);
        else onChange(c);
    };

    const handleCommit = (v: number) => {
        const cv = clamp(v);
        const isDepth = label.toLowerCase().includes("depth");
        if (isDepth) {
            console.log("[HC-DEPTH] commit:start", {
                ts: performance.now(),
                label,
                sliderDomValue: cv,
                reactPropValue: value,
                propVsDom: value - cv,
                interacting: usePerformanceStore.getState().interacting,
                preview: usePerformanceStore.getState().correctionPreview,
            });
        }
        draggingRef.current = false;
        setLocalValue(cv);
        setInteracting(false);
        onChange(cv);
        if (isDepth) {
            console.log("[HC-DEPTH] commit:end", {
                ts: performance.now(),
                sliderDomValue: cv,
                interacting: usePerformanceStore.getState().interacting,
                preview: usePerformanceStore.getState().correctionPreview,
            });
        }
    };

    const onPointerDown = () => {
        draggingRef.current = true;
        setInteracting(true, "slider");
    };

    return (
        <div className={cn("space-y-1", className)}>
            <div className="flex items-center justify-between">
                <label htmlFor={`slider-${label}`} className="text-xs text-muted-foreground">
                    {label}
                </label>
                <div className="flex items-center gap-1">
                    {displayText != null ? (
                        <span className="flex h-6 w-16 items-center justify-end px-1 text-xs tabular-nums text-muted-foreground">
                            {displayText}
                        </span>
                    ) : (
                        <input
                            id={`slider-${label}`}
                            type="number"
                            value={localValue}
                            min={min}
                            max={max}
                            step={step}
                            onChange={(e) => handleCommit(Number(e.target.value))}
                            className="h-6 w-16 rounded border border-input bg-background px-1 text-right text-xs tabular-nums focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                    )}
                    {unit ? <span className="w-5 text-xs text-muted-foreground">{unit}</span> : null}
                </div>
            </div>
            <input
                id={displayText != null ? `slider-${label}` : undefined}
                type="range"
                value={localValue}
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
