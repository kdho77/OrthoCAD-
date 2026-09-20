// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Track 5b — Bio+CAD gate checks for print/shell shape-finish modifiers.
 */

import { describe, expect, test } from "@rstest/core";
import { type HeightFieldParams, heightAt } from "@/lib/geometry/height-field";
import { gateArchGrindDepth, gateTopCoverAccommodate } from "@/lib/geometry/shape-finish-gates";
import { TRACK5B_MIN_WALL_MM, topCoverAccommodateDeltaAt } from "@/lib/geometry/shape-finish-modifiers";
import type { SideCorrections } from "@/types";

function neu(): SideCorrections {
    return {
        forefootPostingDeg: 0,
        rearfootPostingDeg: 0,
        medialSkiveMm: 0,
        lateralSkiveMm: 0,
        archFillMm: 0,
        archHeightMm: 0,
        heelCupDepthMm: 12,
        heelCupHeightMm: 0,
        heelCupWidthMm: 0,
        heelLiftMm: 0,
        apexMoveMm: 0,
        medialFlangeMm: 0,
        lateralFlangeMm: 0,
    };
}

function field(shapeFinish: HeightFieldParams["shapeFinish"]): HeightFieldParams {
    return {
        side: "right",
        lengthMm: 260,
        widthMm: 95,
        thicknessMm: 3,
        corrections: neu(),
        elements: [],
        includeSkives: false,
        includeElements: false,
        trimline: null,
        shapeFinish,
    };
}

describe("Track 5b gates", () => {
    test("top cover does not change heel cup depth setpoint in height field", () => {
        const base = heightAt(0.1, 0.85, field(null));
        const withCover = heightAt(
            0.1,
            0.85,
            field({
                topCoverAccommodateMm: 1.5,
                trimmableForefoot: true,
                trimmableForefootExtraMm: 5,
                archGrindDepthMm: 0,
                archSkiveMm: 0,
                archSkiveSide: "medial",
            }),
        );
        const coverDelta = withCover - base;
        const expected = topCoverAccommodateDeltaAt(0.1, 0.85, 1.5);
        expect(coverDelta).toBeCloseTo(expected, 3);
        expect(gateTopCoverAccommodate(1.5, coverDelta).ok).toBe(true);
    });

    test("arch grind gate enforces min wall 0.8 mm", () => {
        const fail = gateArchGrindDepth(4, 2.5, 0, 0.5);
        expect(fail.ok).toBe(false);
        expect(TRACK5B_MIN_WALL_MM).toBe(0.8);
        expect(fail.failures.some((f) => f.includes("0.8"))).toBe(true);
    });
});
