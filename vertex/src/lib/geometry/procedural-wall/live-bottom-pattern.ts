// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import type { TrimlineCurve } from "@/lib/geometry/trimline";
import { curveToPolyPoints } from "@/stores/bottom-pattern-store";
import type { PolyPoint } from "./curves";
import { hashPatternPoints } from "./preview-loft-ui";

/**
 * Print reconstruct must read the LIVE current bottom pattern at generate
 * time: the Edit-bottom-pattern draft if one is open, otherwise the stored
 * curve (which already includes width / widen). Never a load or Base snapshot.
 */
export function resolveLiveBottomPattern(input: {
    draft?: TrimlineCurve | null;
    stored?: TrimlineCurve | null;
}): PolyPoint[] | null {
    const live = input.draft ?? input.stored;
    if (!live?.points?.length) return null;
    return curveToPolyPoints(live);
}

/** True when the live pattern no longer matches the hash baked into the last solid. */
export function livePatternMarksSolidStale(
    previousHash: string | null | undefined,
    live: PolyPoint[] | null | undefined,
): boolean {
    if (!live?.length) return false;
    const next = hashPatternPoints(live);
    return previousHash != null && previousHash !== next;
}

export function hashLiveBottomPattern(points: PolyPoint[] | null | undefined): string {
    return points?.length ? hashPatternPoints(points) : "empty";
}
