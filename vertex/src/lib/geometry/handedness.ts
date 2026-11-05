// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { Side } from "@/types";

/**
 * Sign of footprint-frame mesh Y that points to the medial (big-toe) edge.
 *
 * The stock mesh is authored as a left foot. After `reorientToFootprintFrame`
 * the midfoot arch sits on −Y, so `medialSign("left")` is −1. The right foot
 * is that mesh reflected across the width axis, so `medialSign("right")` is +1.
 *
 * Every new element must place its medial side with this sign. Do not invent
 * a fresh left/right Y flip — the first pass in this repo comes out mirrored.
 *
 * Anatomical +lateral (used inside sink ovals) is the opposite direction:
 * the smaller anatomical Y is medial. Convert with {@link meshYFromAnatomicalLateral}.
 */
export function medialSign(side: Side): 1 | -1 {
    return side === "left" ? -1 : 1;
}

/**
 * Mesh Y of an anatomical +lateral coordinate.
 * Medial (the smaller anatomical value) lands on {@link medialSign}.
 * The map is its own inverse: ±1 reflection applied twice is identity.
 */
export function meshYFromAnatomicalLateral(yLateral: number, side: Side): number {
    return -medialSign(side) * yLateral;
}
