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
}: SliderFieldProps) {
    const setInteracting = usePerformanceStore((s) => s.setInteracting);
    const clamp = (v: number) => Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));

    const handlePreview = (v: number) => {
        const c = clamp(v);
        if (onPreview) onPreview(c);
        else onChange(c);
    };

    const handleCommit = (v: number) => {
        const committed = clamp(v);
        // Commit design state before clearing the interacting flag so the idle
        // geometry rebuild reads the final slider value (not a stale preview).
        onChange(committed);
        setInteracting(false);
    };

    const onPointerDown = () => setInteracting(true, "slider");

    return (
        <div className={cn("space-y-1", className)}>
            <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground">{label}</label>
                <div className="flex items-center gap-1">
                    <input
                        type="number"
                        value={value}
                        min={min}
                        max={max}
                        step={step}
                        onChange={(e) => handleCommit(Number(e.target.value))}
                        className="h-6 w-16 rounded border border-input bg-background px-1 text-right text-xs tabular-nums focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                    {unit ? <span className="w-5 text-xs text-muted-foreground">{unit}</span> : null}
                </div>
            </div>
            <input
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
