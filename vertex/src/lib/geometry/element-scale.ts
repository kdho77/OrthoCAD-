// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import type { PlacedElement } from "@/types";

type Scale = PlacedElement["scale"];
export const ELEMENT_SCALE_MIN = 0.25;
export const ELEMENT_SCALE_MAX = 3;

/** One common multiplier preserves the current proportions, including at limits. */
export function resizeElementScale(current: Scale, axis: keyof Scale, value: number, locked = true): Scale {
    if (!Number.isFinite(value)) return current;
    if (!locked) {
        return { ...current, [axis]: Math.max(ELEMENT_SCALE_MIN, Math.min(ELEMENT_SCALE_MAX, value)) };
    }
    if (current.x <= 0 || current.y <= 0) return current;
    const minFactor = Math.max(ELEMENT_SCALE_MIN / current.x, ELEMENT_SCALE_MIN / current.y);
    const maxFactor = Math.min(ELEMENT_SCALE_MAX / current.x, ELEMENT_SCALE_MAX / current.y);
    const factor = Math.max(minFactor, Math.min(maxFactor, value / current[axis]));
    return { x: current.x * factor, y: current.y * factor };
}

/** Resolve a gizmo drag against its starting scale, never against a previous preview. */
export function gizmoElementScale(start: Scale, proposed: Scale, locked = true): Scale {
    if (!locked) {
        return resizeElementScale(resizeElementScale(start, "x", proposed.x, false), "y", proposed.y, false);
    }
    // TransformControls resets inactive axes to their drag-start values. The axis
    // with the larger relative change therefore drives X/Y and planar handles alike.
    const axis = Math.abs(proposed.x / start.x - 1) >= Math.abs(proposed.y / start.y - 1) ? "x" : "y";
    return resizeElementScale(start, axis, proposed[axis]);
}
