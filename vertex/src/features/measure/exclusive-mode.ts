// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

/**
 * Measurement clicks and marker / trim clicks do not share the pointer.
 * Callers gate their own handlers; this does not move markers or edit splines.
 */
export function measurementOwnsPointer(toolArmed: boolean): boolean {
    return toolArmed;
}

export function markerPlacementBlocked(toolArmed: boolean): boolean {
    return measurementOwnsPointer(toolArmed);
}

export function trimEditBlocked(toolArmed: boolean): boolean {
    return measurementOwnsPointer(toolArmed);
}
