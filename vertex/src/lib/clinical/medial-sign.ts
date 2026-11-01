// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { Side } from "@/types";

/**
 * Medial/lateral sign used across height-field, wedges, and scan landmark suggest.
 * Left foot: medial is −1 in vSigned space (matches fit-arch-from-scan / wedge.ts).
 */
export function medialSign(side: Side): number {
    return side === "left" ? -1 : 1;
}

/** Width-axis sign for landmark crest search (+Y medial on left scan frame). */
export function medialWidthSignForSide(side: Side): number {
    return side === "left" ? 1 : -1;
}
