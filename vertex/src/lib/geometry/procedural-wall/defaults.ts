// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { ProceduralWallStyle } from "./modifiers";

/**
 * Default grinding / wall mid-style for new procedural sessions.
 * Kendon rule: Hybrid when crease gates pass on Default; otherwise Round.
 */
export const DEFAULT_PROCEDURAL_WALL_STYLE: ProceduralWallStyle = "hybrid";

/** Session viewer fallback when {@link ViewerSettings.wallStyle} is unset. */
export function viewerWallStyleOrDefault(style?: ProceduralWallStyle | null): ProceduralWallStyle {
    return style ?? DEFAULT_PROCEDURAL_WALL_STYLE;
}
