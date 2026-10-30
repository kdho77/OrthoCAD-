// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { useEffect, useRef } from "react";
import { SliderField } from "@/components/ui/slider-field";
import { ELEMENT_SCALE_MAX, ELEMENT_SCALE_MIN, resizeElementScale } from "@/lib/geometry/element-scale";
import { useDesignStore } from "@/stores/design-store";
import { usePerformanceStore } from "@/stores/performance-store";
import type { PlacedElement } from "@/types";

export function ElementScaleControls({ element }: { element: PlacedElement }) {
    const preview = usePerformanceStore((s) => s.elementPreviews[element.id]?.scale);
    const frame = useRef<number | null>(null);
    const pending = useRef<PlacedElement["scale"] | null>(null);
    const cancelPreview = () => {
        if (frame.current !== null) cancelAnimationFrame(frame.current);
        frame.current = null;
        pending.current = null;
    };
    useEffect(
        () => () => {
            if (frame.current !== null) cancelAnimationFrame(frame.current);
            frame.current = null;
            pending.current = null;
            usePerformanceStore.getState().clearElementPreview(element.id);
        },
        [element.id],
    );
    const locked = element.scaleLocked !== false;
    const scale = preview ?? element.scale;
    const change = (axis: "x" | "y", value: number, commit: boolean) => {
        const next = resizeElementScale(element.scale, axis, value, locked);
        if (commit) {
            cancelPreview();
            useDesignStore.getState().updateElement(element.id, { scale: next });
            usePerformanceStore.getState().clearElementPreview(element.id);
        } else {
            pending.current = next;
            if (frame.current === null) {
                frame.current = requestAnimationFrame(() => {
                    frame.current = null;
                    if (pending.current) {
                        usePerformanceStore
                            .getState()
                            .setElementPreview(element.id, { id: element.id, scale: pending.current });
                    }
                });
            }
        }
    };
    return (
        <div className="space-y-3">
            <label className="flex items-center gap-2 text-xs">
                <input
                    type="checkbox"
                    checked={locked}
                    onChange={(event) => {
                        cancelPreview();
                        usePerformanceStore.getState().clearElementPreview(element.id);
                        useDesignStore
                            .getState()
                            .updateElement(element.id, { scaleLocked: event.target.checked });
                    }}
                />
                Lock proportions
            </label>
            {(["x", "y"] as const).map((axis) => (
                <SliderField
                    key={axis}
                    label={`Scale ${axis.toUpperCase()}`}
                    value={scale[axis]}
                    min={ELEMENT_SCALE_MIN}
                    max={ELEMENT_SCALE_MAX}
                    step={0.05}
                    onPreview={(value) => change(axis, value, false)}
                    onChange={(value) => change(axis, value, true)}
                />
            ))}
        </div>
    );
}
