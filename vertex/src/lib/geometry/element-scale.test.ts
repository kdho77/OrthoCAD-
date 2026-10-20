// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { gizmoElementScale, resizeElementScale } from "./element-scale";

describe("proportional element scaling", () => {
    test("defaults to equal XY resizing from either axis", () => {
        expect(resizeElementScale({ x: 1, y: 1 }, "x", 2)).toEqual({ x: 2, y: 2 });
        expect(resizeElementScale({ x: 1, y: 1 }, "y", 0.5)).toEqual({ x: 0.5, y: 0.5 });
    });
    test("preserves existing proportions and clamps both axes by one factor", () => {
        expect(resizeElementScale({ x: 1, y: 2 }, "x", 2)).toEqual({ x: 1.5, y: 3 });
        expect(resizeElementScale({ x: 1, y: 2 }, "y", 0.25)).toEqual({ x: 0.25, y: 0.5 });
        expect(resizeElementScale({ x: 1, y: 2 }, "x", 0.5)).toEqual({ x: 0.5, y: 1 });
    });
    test("unlock allows independent sizing", () => {
        expect(resizeElementScale({ x: 1, y: 2 }, "x", 2, false)).toEqual({ x: 2, y: 2 });
        expect(gizmoElementScale({ x: 1, y: 1 }, { x: 2, y: 0.5 }, false)).toEqual({ x: 2, y: 0.5 });
    });
    test("X, Y and planar gizmo handles share the lock and prevent flips", () => {
        const start = { x: 1, y: 2 };
        expect(gizmoElementScale(start, { x: 1.2, y: 2 }, true)).toEqual({ x: 1.2, y: 2.4 });
        expect(gizmoElementScale(start, { x: 1, y: 1 }, true)).toEqual({ x: 0.5, y: 1 });
        expect(gizmoElementScale(start, { x: 1.25, y: 2.5 }, true)).toEqual({ x: 1.25, y: 2.5 });
        expect(gizmoElementScale(start, { x: -2, y: 2 }, true)).toEqual({ x: 0.25, y: 0.5 });
    });
});
