// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { AFO_TRIM_CLICK_PX } from "./trim-preview";

/** A pin does not move, and no undo step is written, until the pointer travels this far. */
export const AFO_TRIM_DRAG_THRESHOLD_PX = AFO_TRIM_CLICK_PX;

export interface TrimPinGesture {
    pointerId: number;
    pinIndex: number;
    originX: number;
    originY: number;
    /** True after the pointer has passed the drag threshold. */
    dragging: boolean;
    /** The single undo checkpoint for this drag has been written. */
    historyWritten: boolean;
    captured: boolean;
}

/**
 * Confirmed loops stay draggable. Scan-landmark placement owns the pointer,
 * so a trim drag does not start while that session is active.
 */
export function trimPinDragAllowed(args: {
    pinIndex: number | null;
    trimConfirmed: boolean;
    scanPlacementActive: boolean;
    /** False when the pin sits on the far side of the cast from the camera. */
    facesCamera?: boolean;
}): boolean {
    if (args.facesCamera === false) return false;
    if (args.scanPlacementActive) return false;
    if (args.pinIndex == null) return false;
    return Number.isInteger(args.pinIndex) && args.pinIndex >= 0;
}

export function startTrimPinGesture(args: {
    pointerId: number;
    pinIndex: number;
    x: number;
    y: number;
}): TrimPinGesture {
    return {
        pointerId: args.pointerId,
        pinIndex: args.pinIndex,
        originX: args.x,
        originY: args.y,
        dragging: false,
        historyWritten: false,
        captured: false,
    };
}

/** Pointer capture so the drag survives leaving the canvas. */
export function captureTrimDragPointer(
    element: { setPointerCapture?: (pointerId: number) => void },
    pointerId: number,
): boolean {
    if (typeof element.setPointerCapture !== "function") return false;
    element.setPointerCapture(pointerId);
    return true;
}

export function releaseTrimDragPointer(
    element: {
        releasePointerCapture?: (pointerId: number) => void;
        hasPointerCapture?: (pointerId: number) => boolean;
    },
    pointerId: number,
): void {
    if (element.hasPointerCapture && !element.hasPointerCapture(pointerId)) return;
    element.releasePointerCapture?.(pointerId);
}

/**
 * Arm a pin press. Camera orbit is disabled for the whole press so the 4 px
 * threshold is not eaten by a camera move. The pin itself stays put until
 * {@link trimDragMovePlan} reports a drag.
 */
export function beginTrimPinPress(args: {
    pinIndex: number | null;
    trimConfirmed: boolean;
    scanPlacementActive: boolean;
    facesCamera?: boolean;
    pointerId: number;
    x: number;
    y: number;
    element: { setPointerCapture?: (pointerId: number) => void };
}): { gesture: TrimPinGesture | null; captured: boolean; cameraEnabled: boolean } {
    if (
        !trimPinDragAllowed({
            pinIndex: args.pinIndex,
            trimConfirmed: args.trimConfirmed,
            scanPlacementActive: args.scanPlacementActive,
            facesCamera: args.facesCamera,
        }) ||
        args.pinIndex == null
    ) {
        return { gesture: null, captured: false, cameraEnabled: true };
    }
    const captured = captureTrimDragPointer(args.element, args.pointerId);
    const gesture = startTrimPinGesture({
        pointerId: args.pointerId,
        pinIndex: args.pinIndex,
        x: args.x,
        y: args.y,
    });
    gesture.captured = captured;
    return { gesture, captured, cameraEnabled: false };
}

export function trimDragMovePlan(
    gesture: TrimPinGesture,
    x: number,
    y: number,
): { gesture: TrimPinGesture; writeHistory: boolean; dragStarted: boolean } {
    const dist = Math.hypot(x - gesture.originX, y - gesture.originY);
    const dragging = gesture.dragging || dist > AFO_TRIM_DRAG_THRESHOLD_PX;
    const dragStarted = dragging && !gesture.dragging;
    return {
        gesture: { ...gesture, dragging },
        writeHistory: dragging && !gesture.historyWritten,
        dragStarted,
    };
}

export function markTrimDragHistory(gesture: TrimPinGesture): TrimPinGesture {
    return { ...gesture, historyWritten: true };
}
