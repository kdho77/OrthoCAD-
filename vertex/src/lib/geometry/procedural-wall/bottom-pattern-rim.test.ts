// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { bottomPatternOutsideComposedRim, minBottomPatternInsetVsTopRimMm } from "./bottom-pattern-rim";
import type { StockWallModel } from "./types";

function squareRimModel(half = 50): Pick<StockWallModel, "top"> {
    const rimLocal = [0, 1, 2, 3];
    const positions = new Float32Array([-half, -half, 0, half, -half, 0, half, half, 0, -half, half, 0]);
    return {
        top: {
            meshPositions: positions,
            rimLocal,
            meshIndices: null,
        },
    };
}

describe("bottom pattern vs composed rim R", () => {
    test("untouched B inside square rim has non-negative min inset", () => {
        const model = squareRimModel();
        const pattern = [
            { x: -40, y: -40, z: 0 },
            { x: 40, y: -40, z: 0 },
            { x: 40, y: 40, z: 0 },
            { x: -40, y: 40, z: 0 },
        ];
        const inset = minBottomPatternInsetVsTopRimMm(pattern, model);
        expect(inset).toBeGreaterThanOrEqual(0);
        expect(bottomPatternOutsideComposedRim(inset)).toBe(false);
    });

    test("one B vertex pushed 1 mm outside turns warning on", () => {
        const model = squareRimModel();
        const pattern = [
            { x: -40, y: -40, z: 0 },
            { x: 51, y: -40, z: 0 },
            { x: 40, y: 40, z: 0 },
            { x: -40, y: 40, z: 0 },
        ];
        const inset = minBottomPatternInsetVsTopRimMm(pattern, model);
        expect(inset).toBeLessThan(-0.2);
        expect(bottomPatternOutsideComposedRim(inset)).toBe(true);
    });
});
