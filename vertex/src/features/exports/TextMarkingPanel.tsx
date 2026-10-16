// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { SliderField } from "@/components/ui/slider-field";
import { defaultTextMarking, TEXT_MAX_CHARS } from "@/lib/geometry/text-marking/constants";
import { textControlBounds } from "@/lib/geometry/text-marking/validate";
import { cn } from "@/lib/utils";
import { useDesignStore } from "@/stores/design-store";
import type { TextMode, TextSurface } from "@/types";

export function TextMarkingPanel() {
    const marking = useDesignStore((s) => s.design.textMarking) ?? defaultTextMarking();
    const setTextMarking = useDesignStore((s) => s.setTextMarking);
    const bounds = useMemo(() => textControlBounds(marking.surface), [marking.surface]);
    const wallOff = marking.surface === "wall" && !bounds.wallAvailable;
    const embossOff = marking.surface === "bottom";
    const offsetLabel = marking.mode === "emboss" ? "Emboss height" : "Engrave depth";
    const offsetValue = marking.mode === "emboss" ? marking.heightMm : marking.depthMm;
    const offsetMin = marking.mode === "emboss" ? bounds.heightMin : bounds.depthMin;
    const offsetMax = marking.mode === "emboss" ? bounds.heightMax : bounds.depthMax;
    const offsetDefault = marking.mode === "emboss" ? bounds.heightDefault : bounds.depthDefault;

    const onSurface = (surface: TextSurface) => {
        const next = defaultTextMarking(surface);
        setTextMarking({
            ...next,
            text: marking.text,
            bold: marking.bold,
            letterSpacingMm: marking.letterSpacingMm,
        });
    };

    return (
        <div className="space-y-2 rounded-md border border-border bg-background/40 p-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Custom text
            </div>
            <Input
                value={marking.text}
                maxLength={TEXT_MAX_CHARS}
                placeholder="Patient name (max 40)"
                className="h-8 text-xs"
                onChange={(e) => setTextMarking({ text: e.target.value })}
            />
            <div className="flex gap-1">
                {(["bottom", "wall"] as TextSurface[]).map((s) => (
                    <button
                        key={s}
                        type="button"
                        disabled={s === "wall" && wallOff}
                        onClick={() => onSurface(s)}
                        className={cn(
                            "h-7 flex-1 rounded-md border text-[11px]",
                            marking.surface === s
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-border text-muted-foreground",
                            s === "wall" && wallOff && "cursor-not-allowed opacity-50",
                        )}
                    >
                        {s === "bottom" ? "Bottom" : "Lateral wall"}
                    </button>
                ))}
            </div>
            <div className="flex gap-1">
                {(["engrave", "emboss"] as TextMode[]).map((m) => (
                    <button
                        key={m}
                        type="button"
                        disabled={m === "emboss" && embossOff}
                        onClick={() => setTextMarking({ mode: m })}
                        className={cn(
                            "h-7 flex-1 rounded-md border text-[11px] capitalize",
                            marking.mode === m
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-border text-muted-foreground",
                            m === "emboss" && embossOff && "cursor-not-allowed opacity-50",
                        )}
                    >
                        {m}
                    </button>
                ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                    type="checkbox"
                    checked={marking.bold}
                    onChange={(e) => setTextMarking({ bold: e.target.checked })}
                />
                Bold (Clipper +0.15 mm)
            </label>
            <SliderField
                label="Cap height"
                value={marking.capHeightMm}
                min={bounds.capMin}
                max={bounds.capMax}
                step={0.1}
                unit="mm"
                defaultValue={bounds.capDefault}
                onChange={(v) => setTextMarking({ capHeightMm: v })}
                onReset={() => setTextMarking({ capHeightMm: bounds.capDefault })}
            />
            <SliderField
                label={offsetLabel}
                value={offsetValue}
                min={offsetMin}
                max={offsetMax}
                step={0.2}
                unit="mm"
                defaultValue={offsetDefault}
                onChange={(v) => setTextMarking(marking.mode === "emboss" ? { heightMm: v } : { depthMm: v })}
                onReset={() =>
                    setTextMarking(
                        marking.mode === "emboss" ? { heightMm: offsetDefault } : { depthMm: offsetDefault },
                    )
                }
            />
            <SliderField
                label="Letter spacing"
                value={marking.letterSpacingMm}
                min={0.6}
                max={4}
                step={0.1}
                unit="mm"
                defaultValue={0.6}
                onChange={(v) => setTextMarking({ letterSpacingMm: v })}
                onReset={() => setTextMarking({ letterSpacingMm: 0.6 })}
            />
            {marking.surface === "bottom" ? (
                <SliderField
                    label="Rotation"
                    value={marking.rotationDeg}
                    min={-90}
                    max={90}
                    step={1}
                    unit="°"
                    defaultValue={0}
                    onChange={(v) => setTextMarking({ rotationDeg: v })}
                    onReset={() => setTextMarking({ rotationDeg: 0 })}
                />
            ) : null}
            <SliderField
                label="Placement u"
                value={marking.placementU}
                min={bounds.uMin}
                max={bounds.uMax}
                step={0.01}
                defaultValue={bounds.uDefault}
                onChange={(v) => setTextMarking({ placementU: v })}
                onReset={() => setTextMarking({ placementU: bounds.uDefault })}
            />
            <p className="text-[10px] leading-snug text-muted-foreground">
                Applied at Print after the loft. Bottom is engrave-only and mirrored. Wall text is never
                mirrored.
            </p>
        </div>
    );
}
