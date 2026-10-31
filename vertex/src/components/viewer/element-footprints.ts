// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { ELEMENT_PROFILES, type ElementShape } from "@/lib/geometry/elements";
import { heightAt } from "@/lib/geometry/height-field";
import { sinkStyloidThickenForSide, sinksForSide } from "@/lib/geometry/migrate-corrections";
import { type SinkOvalFrame, sinkFrame } from "@/lib/geometry/sink";
import { effectiveOutlineHalfWidth } from "@/lib/geometry/trimline";
import { splitOverlayOutline } from "@/lib/hardness/split-overlay";
import type { DesignState, PlacedElement, PlacedSink, Side, SinkSurfaceContext } from "@/types";

/**
 * Sink planform colors for the Elements viewer. Selected is a brighter magenta.
 * Display only — nothing here writes a mesh.
 */
export const SINK_FOOTPRINT_COLORS = {
    fill: "#e879f9",
    edge: "#e879f9",
    opacity: 0.72,
    selectedFill: "#ff00ff",
    selectedEdge: "#ffffff",
    selectedOpacity: 0.9,
} as const;

/** Library shapes that are sinks. Kinetic wedges and pads are not in this set. */
const LIBRARY_SINK_SHAPES: ReadonlySet<ElementShape> = new Set(["heel_cup", "navicular_oval"]);

export interface FootprintPose {
    id: string;
    side: Side;
    kind: "element" | "sink";
    /** Heel-origin X in the insole frame (mesh vertex X). */
    x: number;
    /** Mesh Y. Same axis as PlacedElement.position.y (+medial on the left foot). */
    y: number;
    /** Rotation in that mesh XY frame, degrees. Local +X is the long axis before rotating. */
    rotationDeg: number;
    halfLengthMm: number;
    halfWidthMm: number;
    /** Closed ring in element-local mm, centered on the pose. */
    outline: { x: number; y: number }[];
}

export function footprintStyle(selected: boolean): { color: string; opacity: number; edge: string } {
    return selected
        ? {
              color: SINK_FOOTPRINT_COLORS.selectedFill,
              opacity: SINK_FOOTPRINT_COLORS.selectedOpacity,
              edge: SINK_FOOTPRINT_COLORS.selectedEdge,
          }
        : {
              color: SINK_FOOTPRINT_COLORS.fill,
              opacity: SINK_FOOTPRINT_COLORS.opacity,
              edge: SINK_FOOTPRINT_COLORS.edge,
          };
}

/** Heel and navicular library elements. Wedges, pads, and other additions are not sinks. */
export function isLibrarySinkElement(element: PlacedElement): boolean {
    if (element.kind === "custom") return false;
    const shape = ELEMENT_PROFILES[element.kind]?.shape;
    return shape != null && LIBRARY_SINK_SHAPES.has(shape);
}

/** Anatomical +lateral Y to the viewer's mesh Y. */
export function anatomicalToMeshY(yLateral: number, side: Side): number {
    return side === "left" ? -yLateral : yLateral;
}

/** Inverse of {@link anatomicalToMeshY}. */
export function meshToAnatomicalY(yMesh: number, side: Side): number {
    return side === "left" ? -yMesh : yMesh;
}

/**
 * Sink long-axis angle in mesh XY. `frameRotationDeg` is already mirrored for
 * the left foot in anatomical (+lateral) space.
 */
export function sinkMeshRotationDeg(frameRotationDeg: number, side: Side): number {
    return side === "left" ? -frameRotationDeg : frameRotationDeg;
}

export function ellipseOutline(
    halfLengthMm: number,
    halfWidthMm: number,
    segments = 48,
): { x: number; y: number }[] {
    const rx = Math.max(0.5, halfLengthMm);
    const ry = Math.max(0.5, halfWidthMm);
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < segments; i++) {
        const t = (i / segments) * Math.PI * 2;
        pts.push({ x: Math.cos(t) * rx, y: Math.sin(t) * ry });
    }
    return pts;
}

function outlineHalfExtents(outline: { x: number; y: number }[]): {
    halfLengthMm: number;
    halfWidthMm: number;
} {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of outline) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    if (!Number.isFinite(minX)) return { halfLengthMm: 8, halfWidthMm: 8 };
    return { halfLengthMm: (maxX - minX) / 2, halfWidthMm: (maxY - minY) / 2 };
}

/** Clinical planform of a library heel or navicular sink. Scale and side are already applied. */
export function elementFootprintPose(element: PlacedElement, lengthMm: number): FootprintPose {
    const outline = splitOverlayOutline(element);
    const extents = outlineHalfExtents(outline);
    return {
        id: element.id,
        side: element.side,
        kind: "element",
        x: lengthMm / 2 + element.position.x,
        y: element.position.y,
        rotationDeg: element.rotationDeg,
        halfLengthMm: extents.halfLengthMm,
        halfWidthMm: extents.halfWidthMm,
        outline,
    };
}

export function sinkSurfaceContext(
    sink: PlacedSink,
    side: Side,
    lengthMm: number,
    widthMm: number,
): SinkSurfaceContext {
    return { side, lengthMm, widthMm, sinks: [sink] };
}

/** Circle or oval planform of an MPJ / styloid sink, in the same frame as the cut. */
export function sinkFootprintPose(
    sink: PlacedSink,
    side: Side,
    lengthMm: number,
    widthMm: number,
): FootprintPose | null {
    const frame = sinkFrame(sink, sinkSurfaceContext(sink, side, lengthMm, widthMm));
    if (!frame) return null;
    return poseFromSinkFrame(sink.id, side, frame);
}

export function poseFromSinkFrame(id: string, side: Side, frame: SinkOvalFrame): FootprintPose {
    return {
        id,
        side,
        kind: "sink",
        x: frame.cx,
        y: anatomicalToMeshY(frame.cy, side),
        rotationDeg: sinkMeshRotationDeg(frame.rotationDeg, side),
        halfLengthMm: frame.halfLengthMm,
        halfWidthMm: frame.halfWidthMm,
        outline: ellipseOutline(frame.halfLengthMm, frame.halfWidthMm),
    };
}

/** Local outline point (long axis +X) to anatomical millimetres. */
export function footprintLocalToAnatomical(
    pose: FootprintPose,
    localX: number,
    localY: number,
): { x: number; yLateral: number } {
    const a = (pose.rotationDeg * Math.PI) / 180;
    const dx = localX * Math.cos(a) - localY * Math.sin(a);
    const dy = localX * Math.sin(a) + localY * Math.cos(a);
    return {
        x: pose.x + dx,
        yLateral: meshToAnatomicalY(pose.y + dy, pose.side),
    };
}

/** Height of the insole top under a footprint, plus a small lift so the patch sits on it. */
export function footprintSurfaceZ(
    design: DesignState,
    side: Side,
    xHeel: number,
    yMesh: number,
    lengthMm: number,
    widthMm: number,
): number {
    const u = lengthMm > 1e-6 ? Math.max(0, Math.min(1, xHeel / lengthMm)) : 0;
    const half = effectiveOutlineHalfWidth(u, lengthMm, widthMm, null) * (widthMm / 2);
    const vSigned = half > 1e-6 ? Math.max(-1, Math.min(1, yMesh / half)) : 0;
    const sinks = sinksForSide(design, side);
    const z = heightAt(u, vSigned, {
        side,
        lengthMm,
        widthMm,
        thicknessMm: design.thicknessMm,
        corrections: design.corrections[side],
        includeElements: false,
        includeSkives: false,
        shellThicknessMode: design.shellThicknessMode,
        shellThicknessRfMm: design.shellThicknessRfMm,
        shellThicknessMfMm: design.shellThicknessMfMm,
        shellThicknessFfMm: design.shellThicknessFfMm,
        shellThicknessBlendMm: design.shellThicknessBlendMm,
        method: design.method,
        ...(sinks ? { sinks, sinkStyloidThicken: sinkStyloidThickenForSide(design, side) } : {}),
    });
    return (Number.isFinite(z) ? z : design.thicknessMm) + 0.45;
}
