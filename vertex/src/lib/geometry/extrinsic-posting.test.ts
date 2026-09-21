// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { correctionDeltaAt } from "@/lib/geometry/base-modifier";
import { extrinsicPostingBottomDeltaAt } from "@/lib/geometry/extrinsic-posting";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import type { SideCorrections } from "@/types";

function neutralCorrections(): SideCorrections {
    return {
        forefootPostingDeg: 0,
        rearfootPostingDeg: 0,
        medialSkiveMm: 0,
        lateralSkiveMm: 0,
        archFillMm: 0,
        archHeightMm: 0,
        heelCupDepthMm: 0,
        heelCupHeightMm: 0,
        heelCupWidthMm: 0,
        heelLiftMm: 0,
        apexMoveMm: 0,
        medialFlangeMm: 0,
        lateralFlangeMm: 0,
    };
}

describe("extrinsic posting blocks", () => {
    test("bottom delta negative (adds volume) at RF high side", () => {
        const dz = extrinsicPostingBottomDeltaAt(
            0.1,
            0.9,
            "left",
            { ...neutralCorrections(), extrinsicPostingRfMm: 5, extrinsicPostingPolarity: "pronation" },
            { postFilletMm: 2, postTaperAngleDeg: 15, widthMm: 95 },
        );
        expect(dz).toBeLessThan(-0.5);
    });

    test("contact contour unchanged — top delta zero with extrinsic only", () => {
        const base: HeightFieldParams = {
            side: "left",
            lengthMm: 266,
            widthMm: 95,
            thicknessMm: 3,
            shellThicknessMode: "uniform",
            corrections: neutralCorrections(),
            elements: [],
            includeSkives: false,
            includeElements: false,
            trimline: null,
        };
        const active = {
            ...base,
            corrections: {
                ...neutralCorrections(),
                extrinsicPostingRfMm: 8,
            },
        };
        expect(correctionDeltaAt(0.1, -0.7, active, base)).toBe(0);
    });
});
