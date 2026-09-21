// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { correctionDeltaAt } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { shellEdgeDistalDeltaAt } from "@/lib/geometry/shell-edge";
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

function field(method: "printing_solid" | "printing_shell", edge?: number): HeightFieldParams {
    return {
        side: "left",
        lengthMm: 266,
        widthMm: 95,
        thicknessMm: 3,
        shellThicknessMode: "uniform",
        method,
        shellEdgeThicknessMm: edge ?? 2,
        distalTaperDistanceMm: 20,
        postTaperAngleDeg: 15,
        corrections: neutralCorrections(),
        elements: [],
        includeSkives: false,
        includeElements: false,
        trimline: null,
    };
}

describe("rigid-shell edge / distal", () => {
    test("solid FDM — no shell-edge correction delta vs itself", () => {
        const solid = field("printing_solid", 3);
        expect(correctionDeltaAt(0.9, 0.95, solid, solid)).toBe(0);
    });

    test("printing_shell edge raises perimeter vs interior", () => {
        const rim = shellEdgeDistalDeltaAt(0.12, 1, {
            lengthMm: 266,
            widthMm: 95,
            shellEdgeThicknessMm: 4,
            postFilletMm: 2,
            postTaperAngleDeg: 15,
        });
        const interior = shellEdgeDistalDeltaAt(0.12, 0.2, {
            lengthMm: 266,
            widthMm: 95,
            shellEdgeThicknessMm: 4,
            postFilletMm: 2,
        });
        expect(rim).toBeGreaterThan(interior);
        expect(rim - interior).toBeGreaterThan(0.05);
    });

    test("distal shorten reduces rim raise toward toe", () => {
        const heelRim = shellEdgeDistalDeltaAt(0.2, 1, {
            lengthMm: 266,
            widthMm: 95,
            shellEdgeThicknessMm: 4,
            distalTaperDistanceMm: 30,
            postFilletMm: 2,
        });
        const toeRim = shellEdgeDistalDeltaAt(0.98, 1, {
            lengthMm: 266,
            widthMm: 95,
            shellEdgeThicknessMm: 4,
            distalTaperDistanceMm: 30,
            postFilletMm: 2,
        });
        expect(heelRim).toBeGreaterThan(toeRim);
    });

    test("correction delta only when printing_shell", () => {
        const solid = field("printing_solid", 4);
        const shell = field("printing_shell", 4);
        const dSolid = correctionDeltaAt(0.12, 1, shell, solid);
        expect(dSolid).toBeGreaterThan(0.05);
    });
});
