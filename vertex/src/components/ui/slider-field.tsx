import { cn } from "@/lib/utils";

interface SliderFieldProps {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    unit?: string;
    onChange: (value: number) => void;
    className?: string;
}

// Compact labeled slider + numeric input used throughout the corrections panel.
export function SliderField({
    label,
    value,
    min,
    max,
    step = 0.5,
    unit,
    onChange,
    className,
}: SliderFieldProps) {
    // Clamp to the medically valid range even when typed directly.
    const clamp = (v: number) => Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));
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
                        onChange={(e) => onChange(clamp(Number(e.target.value)))}
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
                onChange={(e) => onChange(clamp(Number(e.target.value)))}
                className="h-1 w-full cursor-pointer appearance-none rounded bg-muted accent-primary"
            />
        </div>
    );
}
