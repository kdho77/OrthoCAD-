// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { ViewerSettings } from "@/stores/design-store";
import { useDesignStore } from "@/stores/design-store";

const WALL_MODELS = new Set<NonNullable<ViewerSettings["wallModel"]>>(["legacy", "procedural"]);
const WALL_STYLES = new Set<NonNullable<ViewerSettings["wallStyle"]>>(["straight", "round", "hybrid"]);

function readSearch(search: string): URLSearchParams {
    const q = search.startsWith("?") ? search.slice(1) : search;
    return new URLSearchParams(q);
}

/** Parse `?wallModel=` / `?wallStyle=` without touching the store. */
export function parseViewerWallFlag(
    search: string,
): Partial<Pick<ViewerSettings, "wallModel" | "wallStyle">> {
    const params = readSearch(search);
    const patch: Partial<Pick<ViewerSettings, "wallModel" | "wallStyle">> = {};
    const wallModel = params.get("wallModel");
    const wallStyle = params.get("wallStyle");
    if (wallModel && WALL_MODELS.has(wallModel as NonNullable<ViewerSettings["wallModel"]>)) {
        patch.wallModel = wallModel as NonNullable<ViewerSettings["wallModel"]>;
    }
    if (wallStyle && WALL_STYLES.has(wallStyle as NonNullable<ViewerSettings["wallStyle"]>)) {
        patch.wallStyle = wallStyle as NonNullable<ViewerSettings["wallStyle"]>;
    }
    return patch;
}

/**
 * Hydrate the existing viewer.wallModel / wallStyle flag from the URL.
 * No-op when the store already matches so React re-renders do not retrigger reconstruct.
 */
export function applyViewerWallFlagFromSearch(search: string): boolean {
    const patch = parseViewerWallFlag(search);
    if (patch.wallModel === undefined && patch.wallStyle === undefined) return false;
    const viewer = useDesignStore.getState().viewer;
    const nextModel = patch.wallModel ?? viewer.wallModel;
    const nextStyle = patch.wallStyle ?? viewer.wallStyle;
    if (viewer.wallModel === nextModel && viewer.wallStyle === nextStyle) return false;
    useDesignStore.getState().setViewer(patch);
    return true;
}
