// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { PolyPoint } from "./curves";
import type { StockWallModel } from "./types";

/** Min signed inset of pattern stations vs the composed top rim (mm). Negative = outside R. */
export function minBottomPatternInsetVsTopRimMm(
    pattern: ReadonlyArray<PolyPoint>,
    model: Pick<StockWallModel, "top">,
): number {
    const pos = model.top.meshPositions;
    const rimLocal = model.top.rimLocal ?? [];
    if (!pos || pattern.length < 4 || rimLocal.length < 8) return Infinity;
    let minInset = Infinity;
    for (let i = 0; i < pattern.length; i++) {
        const b = pattern[i];
        if (!b) continue;
        const ri = rimLocal[i % rimLocal.length];
        if (ri === undefined) continue;
        const rx = pos[ri * 3]!;
        const ry = pos[ri * 3 + 1]!;
        minInset = Math.min(minInset, Math.hypot(b.x - rx, b.y - ry));
    }
    return minInset;
}

export const BOTTOM_PATTERN_RIM_SLACK_MM = 0.2;

export function bottomPatternOutsideComposedRim(minInsetMm: number): boolean {
    return Number.isFinite(minInsetMm) && minInsetMm < -BOTTOM_PATTERN_RIM_SLACK_MM;
}
