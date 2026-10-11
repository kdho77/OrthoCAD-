// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { insoleLayoutForUsMenSize } from "./shoe-size";
import {
    SHOE_WIDTH_HEEL_CAP_MM,
    shoeWidthBallScale,
    shoeWidthHeelScale,
    shoeWidthScaleAtU,
} from "./shoe-width";

describe("shoe width rule", () => {
    test("ball delta is ±0.5 mm at sizes 6 / 9 / 12", () => {
        for (const size of [6, 9, 12]) {
            const ball = insoleLayoutForUsMenSize(size).widthMm;
            for (const [id, delta] of [
                ["narrow", -5],
                ["medium", 0],
                ["wide", 5],
                ["extra_wide", 10],
            ] as const) {
                const scale = shoeWidthBallScale(ball, id);
                expect(Math.abs((scale - 1) * ball - delta)).toBeLessThanOrEqual(0.5);
            }
        }
    });

    test("heel stays within ±2 mm of Medium", () => {
        for (const size of [6, 9, 12]) {
            const layout = insoleLayoutForUsMenSize(size);
            const ball = layout.widthMm;
            const heel = ball * 0.62;
            const wide = shoeWidthHeelScale(heel, ball, "wide");
            expect(Math.abs(wide.deltaMm)).toBeLessThanOrEqual(SHOE_WIDTH_HEEL_CAP_MM + 1e-6);
            expect(shoeWidthScaleAtU(0.02, ball, heel, "wide")).toBeCloseTo(wide.scale, 5);
            expect(shoeWidthScaleAtU(0.7, ball, heel, "wide")).toBeCloseTo(
                shoeWidthBallScale(ball, "wide"),
                5,
            );
        }
    });

    test("length is unchanged — scale is Y-only", () => {
        expect(shoeWidthBallScale(95, "wide")).toBeCloseTo(100 / 95, 6);
    });
});
