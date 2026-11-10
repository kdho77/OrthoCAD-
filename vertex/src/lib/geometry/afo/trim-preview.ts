// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { AfoVec3 } from "./types";

/** Half-length of the placement cross drawn before the first trim click (mm). */
export const AFO_TRIM_CURSOR_ARM_MM = 14;

/** Closed centripetal preview starts at 3 pins. Handles still draw before that. */
export function closedTrimPreviewReady(pinCount: number): boolean {
    return pinCount >= 3;
}

/** Trim wins over marker placement. The two edit modes are never both active. */
export function enterAfoEdit(mode: "trim" | "markers"): { placingTrim: boolean; markersOn: boolean } {
    if (mode === "trim") return { placingTrim: true, markersOn: false };
    return { placingTrim: false, markersOn: true };
}

export function afoEditExclusive(flags: {
    placingTrim: boolean;
    placingLandmarks: boolean;
    placingClinical: boolean;
}): "trim" | "markers" | "idle" {
    if (flags.placingTrim) return "trim";
    if (flags.placingLandmarks || flags.placingClinical) return "markers";
    return "idle";
}

/** Raycast target for AFO trim. The insole sample and scan overlays are not picks. */
export function isAfoCastTrimPick(userData: Record<string, unknown> | undefined | null): boolean {
    if (!userData) return false;
    if (userData.isAfoTrimPick !== true || userData.isAfoCast !== true) return false;
    if (userData.scanId) return false;
    if (userData.isSampleTop === true) return false;
    if (userData.baseName === "SAMPLE_Top") return false;
    return true;
}

/** Viewport badge on the AFO design step names the cast, not the insole sample. */
export function afoDesignBaseLabel(isAfo: boolean, insoleLabel: string): string {
    return isAfo ? "AFO cast" : insoleLabel;
}

export interface AfoTrimPreview {
    /** Committed handles. The first one is the mark; drawn before the loop is valid. */
    marks: AfoVec3[];
    /** On-mesh polyline. Two or more points, including the live tail. Empty until a segment exists. */
    stroke: AfoVec3[];
    /** Cursor sample while placement is active. */
    cursor: AfoVec3 | null;
}

function separated(a: AfoVec3, b: AfoVec3): boolean {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > 0.5;
}

/** Geodesic when it produced a line; otherwise the straight handle polyline. */
export function fallbackTrimPolyline(geodesic: AfoVec3[], handles: AfoVec3[]): AfoVec3[] | null {
    if (geodesic.length >= 2) return geodesic;
    if (handles.length >= 2) return handles;
    return null;
}

/**
 * Visible trim while placing. A cursor is enough to start a line; one handle is a mark;
 * two handles (or a handle plus the cursor) are a segment. The loop does not need to close.
 */
export function afoTrimPreview(input: {
    points: AfoVec3[];
    curve?: AfoVec3[] | null;
    hover?: AfoVec3 | null;
    placing: boolean;
    closed?: boolean;
    /** Geodesic (or other on-mesh) polyline for the committed handles. */
    onMesh?: AfoVec3[] | null;
}): AfoTrimPreview {
    const points = input.points;
    const curve = input.curve ?? [];
    const hover = input.placing ? (input.hover ?? null) : null;
    const onMesh = input.onMesh && input.onMesh.length >= 2 ? input.onMesh : null;
    const handles = onMesh ?? points;
    let tail: AfoVec3 | null = null;
    const last = points[points.length - 1];
    if (hover && last && !input.closed && separated(hover, last)) tail = hover;
    const dense = curve.length >= 4 && curve.length > points.length;
    let stroke: AfoVec3[] = [];
    if (dense && (points.length >= 3 || curve.length >= 4)) stroke = curve.slice();
    else if (!input.placing && curve.length >= 2) stroke = curve.slice();
    else if (tail && handles.length >= 1 && points.length < 3) stroke = [...handles, tail];
    else if (handles.length >= 2) stroke = handles.slice();
    return { marks: points.slice(), stroke, cursor: hover };
}

/** Three axis-aligned segments so placement shows a line before the first click lands. */
export function cursorCrossSegments(cursor: AfoVec3, armMm = AFO_TRIM_CURSOR_ARM_MM): [AfoVec3, AfoVec3][] {
    const arm = Math.max(1, armMm);
    return [
        [
            { x: cursor.x - arm, y: cursor.y, z: cursor.z },
            { x: cursor.x + arm, y: cursor.y, z: cursor.z },
        ],
        [
            { x: cursor.x, y: cursor.y - arm, z: cursor.z },
            { x: cursor.x, y: cursor.y + arm, z: cursor.z },
        ],
        [
            { x: cursor.x, y: cursor.y, z: cursor.z - arm },
            { x: cursor.x, y: cursor.y, z: cursor.z + arm },
        ],
    ];
}
