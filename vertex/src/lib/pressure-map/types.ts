// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type {
    DesignPressureMaps,
    PressureMapAlignment,
    PressureMapContentBounds,
    PressureMapFoot,
    Side,
} from "@/types";

export type { DesignPressureMaps, PressureMapAlignment, PressureMapContentBounds, PressureMapFoot };

/** Manual fine-tune applied on top of auto alignment (footprint mm / degrees). */
export const DEFAULT_PRESSURE_MAP_ALIGNMENT: PressureMapAlignment = {
    offsetMm: { x: 0, y: 0 },
    scale: 1,
    rotationDeg: 0,
};

/** Same medialSign convention as height-field / trimline footprint Y. */
export function medialFootprintSign(side: Side): 1 | -1 {
    return side === "left" ? -1 : 1;
}

export function isPressureMapMime(mime: string): mime is PressureMapFoot["mimeType"] {
    return mime === "image/png" || mime === "image/jpeg" || mime === "image/jpg";
}

export function normalizePressureMapMime(mime: string): PressureMapFoot["mimeType"] {
    if (mime === "image/jpg") return "image/jpeg";
    if (mime === "image/png" || mime === "image/jpeg") return mime;
    throw new Error(`Unsupported pressure map type: ${mime}`);
}
