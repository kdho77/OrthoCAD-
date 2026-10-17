// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { cloneProfile, IDAHO_PROFILE, skinZ, stepoverMm, toolRadiusMm, wallClearZ } from "@/lib/cnc/profile";

describe("Idaho milling profile seed", () => {
    test("matches founder screenshot values", () => {
        const p = IDAHO_PROFILE;
        expect(p.name).toBe("Vertex Lab (Idaho) - ONE SIDE");
        expect(p.tableWidthMm).toBe(368.3);
        expect(p.tableLengthMm).toBe(260.35);
        expect(p.materialHeightMm).toBe(30);
        expect(p.zeroX).toBe("left");
        expect(p.zeroY).toBe("front");
        expect(p.zeroZ).toBe("bottom");
        expect(p.strategy).toBe("spiral");
        expect(p.dimensions).toBe("2D");
        expect(p.strategyContour).toBe("spiral");
        expect(p.twoSides).toBe(false);
        expect(p.fileExtension).toBe(".gcode");
        expect(p.decimals).toBe(4);
        expect(p.freeMovementHeightMm).toBe(50);
        expect(p.topOffsetMm).toBe(2.5);
        expect(p.zOffsetCorrectionMm).toBe(0);
        expect(p.contourEnabled).toBe(true);
        expect(p.extraMovementMm).toBe(-1);
        expect(p.layeredEnabled).toBe(true);
        expect(p.layeredMm).toBe(15);
        expect(p.flatEnabled).toBe(true);
        expect(p.supportEnabled).toBe(false);
        expect(p.toolpathCutter).toEqual({ diameterMm: 10, type: "ball", rpm: 24000, enabled: true });
        expect(p.contourCutter).toEqual({ diameterMm: 10, type: "ball", rpm: 24000, enabled: true });
        expect(wallClearZ(p)).toBe(6);
        expect(p.topFeeds).toEqual({ dip: 3500, normal: 36000, slow: 3500, contour: 2500 });
        expect(p.pockets).toEqual([
            { x: 0, y: 0, width: 368.3, length: 130.175 },
            { x: 0, y: 130.175, width: 368.3, length: 130.175 },
        ]);
        expect(p.alignX).toBe("left");
        expect(p.alignY).toBe("center");
        expect(p.insolesHorizontal).toBe(true);
        expect(p.customGcode.toolpathStart).toBe("");
        expect(p.heelDirection).toBe("x0");
        expect(p.topOffsetMeaning).toBe("horizontal_overrun");
        expect(skinZ(p)).toBe(1);
        expect(toolRadiusMm(10)).toBe(5);
        expect(stepoverMm(p, "ball")).toBe(1.2);
        expect(stepoverMm(p, "flat")).toBe(3);
    });

    test("flat contour wall-clear stays at skin Z", () => {
        const p = cloneProfile(IDAHO_PROFILE);
        p.contourCutter = { ...p.contourCutter, type: "flat" };
        expect(wallClearZ(p)).toBe(1);
        expect(skinZ(p)).toBe(1);
    });
});
