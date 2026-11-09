// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { Side } from "@/types";

/**
 * Which border of the foot an element or sink belongs on.
 * `midline` is the width center. Never copy a left-foot mesh Y onto the right foot.
 */
export type AnatomicalSide = "medial" | "lateral" | "midline";

/**
 * Sign of footprint-frame mesh Y that points to the medial (big-toe) edge.
 *
 * The stock mesh is authored as a left foot. After `reorientToFootprintFrame`
 * the midfoot arch sits on −Y, so `medialSign("left")` is −1. The right foot
 * is that mesh reflected across the width axis, so `medialSign("right")` is +1.
 *
 * Every element and sink must place its medial/lateral side with
 * {@link meshYForAnatomicalSide}. Do not invent a fresh `side === "left" ? -1 : 1`.
 *
 * Anatomical +lateral (used inside sink ovals) is the opposite direction:
 * the smaller anatomical Y is medial. Convert with {@link meshYFromAnatomicalLateral}.
 * Height-field samples use the opposite sign of mesh Y ({@link heightFieldYFromMeshY}):
 * +Y is left-foot medial.
 */
export function medialSign(side: Side): 1 | -1 {
    return side === "left" ? -1 : 1;
}

/** Mesh-Y sign of a medial or lateral border. Midline has no sign. */
export function meshYSign(footSide: Side, anatomicalSide: Exclude<AnatomicalSide, "midline">): 1 | -1 {
    const medial = medialSign(footSide);
    return anatomicalSide === "medial" ? medial : medial === 1 ? -1 : 1;
}

/**
 * Footprint-frame mesh Y (mm) for an anatomical side.
 * Medial on the left is −Y and on the right is +Y. Lateral is the opposite.
 * A midline placement is 0. Magnitude is always a positive distance from center.
 */
export function meshYForAnatomicalSide(
    footSide: Side,
    anatomicalSide: AnatomicalSide,
    magnitudeMm: number,
): number {
    if (anatomicalSide === "midline" || !(magnitudeMm > 0)) return 0;
    return meshYSign(footSide, anatomicalSide) * magnitudeMm;
}

/**
 * Height-field Y of a footprint-frame mesh Y.
 * The height field's +Y is left-foot medial, which is −mesh Y.
 * The map is its own inverse.
 */
export function heightFieldYFromMeshY(meshY: number): number {
    return -meshY;
}

/**
 * Mesh Y of an anatomical +lateral coordinate.
 * Medial (the smaller anatomical value) lands on {@link medialSign}.
 * The map is its own inverse: ±1 reflection applied twice is identity.
 */
export function meshYFromAnatomicalLateral(yLateral: number, side: Side): number {
    return -medialSign(side) * yLateral;
}
