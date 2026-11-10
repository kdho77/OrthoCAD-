// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { getBaseCacheKey, getDesignBase } from "@/lib/geometry/base-asset";
import { DESIGN_ELEMENT_COLOR } from "@/lib/geometry/element-visualization";
import { ELEMENT_PROFILES, type ElementShape } from "@/lib/geometry/elements";
import { medialSign, meshYFromAnatomicalLateral } from "@/lib/geometry/handedness";
import { heightAt } from "@/lib/geometry/height-field";
import { INSOLE_LENGTH_MM, INSOLE_WIDTH_MM } from "@/lib/geometry/layout";
import { sinkStyloidThickenForSide, sinksForSide } from "@/lib/geometry/migrate-corrections";
import { SAMPLE_TOP_ASSET_ID } from "@/lib/geometry/procedural-wall/sample-top-id";
import {
    type SinkOutlinePoint,
    type SinkOvalFrame,
    type SinkSurfaceContext,
    sinkFrame,
} from "@/lib/geometry/sink";
import { effectiveOutlineHalfWidth } from "@/lib/geometry/trimline";
import { splitOverlayOutline } from "@/lib/hardness/split-overlay";
import type { DesignState, PlacedElement, PlacedSink, Side } from "@/types";

/**
 * Sink planform colors for the Elements viewer. Selected is a brighter magenta.
 * Display only — nothing here writes a mesh.
 */
export const SINK_FOOTPRINT_COLORS = {
    fill: "#e879f9",
    edge: "#e879f9",
    opacity: 1,
    selectedFill: "#ff00ff",
    selectedEdge: "#ffffff",
    selectedOpacity: 1,
} as const;

/** Visible recess for Reverse Morton's and the kinetic wedge. */
export const RECESS_FOOTPRINT_COLORS = {
    fill: "#38bdf8",
    edge: "#e0f2fe",
    opacity: 0.85,
    selectedFill: "#22c55e",
    selectedEdge: "#ffffff",
    selectedOpacity: 0.9,
} as const;

/** Solid design-element purple for Morton's extension, visible on the insole top. */
export const DESIGN_FOOTPRINT_COLORS = {
    fill: DESIGN_ELEMENT_COLOR,
    edge: "#f5d0fe",
    opacity: 1,
    selectedFill: "#22c55e",
    selectedEdge: "#ffffff",
    selectedOpacity: 1,
} as const;

/** Library shapes that are sinks. Kinetic wedges and pads are not in this set. */
const LIBRARY_SINK_SHAPES: ReadonlySet<ElementShape> = new Set(["heel_cup", "navicular_oval"]);

export interface FootprintPose {
    id: string;
    side: Side;
    kind: "element" | "sink";
    /** Heel-origin X in the insole frame (mesh vertex X). */
    x: number;
    /** Mesh Y. Medial is medialSign(side): −Y on the left foot, +Y on the right. */
    y: number;
    /** Rotation in that mesh XY frame, degrees. Local +X is the long axis before rotating. */
    rotationDeg: number;
    halfLengthMm: number;
    halfWidthMm: number;
    /** Closed ring in element-local mm, centered on the pose. */
    outline: { x: number; y: number }[];
    /** Design additions use the purple element color. Sinks stay magenta. */
    tone?: "sink" | "design" | "recess";
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

export function designFootprintStyle(selected: boolean): { color: string; opacity: number; edge: string } {
    return selected
        ? {
              color: DESIGN_FOOTPRINT_COLORS.selectedFill,
              opacity: DESIGN_FOOTPRINT_COLORS.selectedOpacity,
              edge: DESIGN_FOOTPRINT_COLORS.selectedEdge,
          }
        : {
              color: DESIGN_FOOTPRINT_COLORS.fill,
              opacity: DESIGN_FOOTPRINT_COLORS.opacity,
              edge: DESIGN_FOOTPRINT_COLORS.edge,
          };
}

export function recessFootprintStyle(selected: boolean): { color: string; opacity: number; edge: string } {
    return selected
        ? {
              color: RECESS_FOOTPRINT_COLORS.selectedFill,
              opacity: RECESS_FOOTPRINT_COLORS.selectedOpacity,
              edge: RECESS_FOOTPRINT_COLORS.selectedEdge,
          }
        : {
              color: RECESS_FOOTPRINT_COLORS.fill,
              opacity: RECESS_FOOTPRINT_COLORS.opacity,
              edge: RECESS_FOOTPRINT_COLORS.edge,
          };
}

/** Raising Morton's and the lowering 1st-ray / kinetic-wedge recesses. */
export function showsDesignFootprint(element: PlacedElement): boolean {
    return (
        element.kind === "mortons_extension" ||
        element.kind === "reverse_mortons" ||
        element.kind === "kinetic_wedge"
    );
}

/** Heel and navicular library elements. Wedges, pads, and other additions are not sinks. */
export function isLibrarySinkElement(element: PlacedElement): boolean {
    if (element.kind === "custom") return false;
    const shape = ELEMENT_PROFILES[element.kind]?.shape;
    return shape != null && LIBRARY_SINK_SHAPES.has(shape);
}

/** Anatomical +lateral Y to mesh Y. Medial lands on {@link medialSign}. */
export function anatomicalToMeshY(yLateral: number, side: Side): number {
    return meshYFromAnatomicalLateral(yLateral, side);
}

/** Inverse of {@link anatomicalToMeshY}. The ±1 reflection is its own inverse. */
export function meshToAnatomicalY(yMesh: number, side: Side): number {
    return meshYFromAnatomicalLateral(yMesh, side);
}

/**
 * Sink long-axis angle in mesh XY. `frameRotationDeg` is the anatomical angle
 * (already mirrored left-to-right). Mirroring Y negates it, and the mirror
 * factor is −medialSign.
 */
export function sinkMeshRotationDeg(frameRotationDeg: number, side: Side): number {
    return -medialSign(side) * frameRotationDeg;
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

/**
 * Mesh outline in the base's footprint frame, when the viewer has published one.
 * Morton's uses it so the medial edge sits on the insole that is on screen.
 */
export function footOutlineForSide(
    design: DesignState,
    side: Side,
    outlines: Record<string, { points: { x: number; y: number }[] } | undefined>,
): { x: number; y: number }[] | null {
    const wallModel = design.viewer?.wallModel ?? "procedural";
    const base = getDesignBase(design, side);
    const proceduralKey =
        wallModel === "procedural" && base
            ? `${SAMPLE_TOP_ASSET_ID}:${side}:${base.mirrored ? "m" : "p"}`
            : null;
    const baseKey = getBaseCacheKey(base) ?? base?.assetId ?? null;
    const curve = (proceduralKey ? outlines[proceduralKey] : null) ?? (baseKey ? outlines[baseKey] : null);
    if (!curve || curve.points.length < 6) return null;
    return curve.points.map((p) => ({ x: p.x, y: p.y }));
}

/** Clinical planform of a library heel or navicular sink. Scale and side are already applied. */
export function elementFootprintPose(
    element: PlacedElement,
    lengthMm: number,
    widthMm = (lengthMm / INSOLE_LENGTH_MM) * INSOLE_WIDTH_MM,
    footOutline?: { x: number; y: number }[] | null,
): FootprintPose {
    const outline = splitOverlayOutline(
        element,
        element.kind === "mortons_extension" ? { lengthMm, widthMm, outline: footOutline } : undefined,
    );
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
        tone:
            element.kind === "mortons_extension"
                ? "design"
                : element.kind === "reverse_mortons" || element.kind === "kinetic_wedge"
                  ? "recess"
                  : "sink",
    };
}

export function sinkSurfaceContext(
    sink: PlacedSink,
    side: Side,
    lengthMm: number,
    widthMm: number,
    footOutline?: SinkOutlinePoint[] | null,
): SinkSurfaceContext {
    return {
        side,
        lengthMm,
        widthMm,
        medialYSign: medialSign(side),
        sinks: [sink],
        ...(footOutline && footOutline.length >= 6 ? { footOutline } : {}),
    };
}

/** Circle or oval planform of an MPJ / styloid / wedge sink, in the same frame as the cut. */
export function sinkFootprintPose(
    sink: PlacedSink,
    side: Side,
    lengthMm: number,
    widthMm: number,
    footOutline?: SinkOutlinePoint[] | null,
): FootprintPose | null {
    const frame = sinkFrame(sink, sinkSurfaceContext(sink, side, lengthMm, widthMm, footOutline));
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
