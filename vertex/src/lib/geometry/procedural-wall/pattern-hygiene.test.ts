// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { clipperRoundInset, clipperUnion, hygieneBottomPattern, turningNumber } from "./pattern-hygiene";

describe("pattern hygiene", () => {
    test("Clipper2 union makes a simple +1 outline", () => {
        const n = 48;
        const loop = Array.from({ length: n }, (_, i) => {
            const a = (i / n) * Math.PI * 2;
            return { x: 40 * Math.cos(a), y: 18 * Math.sin(a), z: 0 };
        });
        const unioned = clipperUnion(loop);
        expect(Math.abs(turningNumber(unioned) - 1)).toBeLessThan(0.05);
        const inset = clipperRoundInset(unioned, 3);
        expect(inset.length).toBeGreaterThan(8);
        expect(Math.abs(turningNumber(inset) - 1)).toBeLessThan(0.05);
    });

    test("hygiene rejects a pattern that leaves the rim", () => {
        const rim = Array.from({ length: 32 }, (_, i) => {
            const a = (i / 32) * Math.PI * 2;
            return { x: 20 * Math.cos(a), y: 12 * Math.sin(a), z: 0 };
        });
        const outside = Array.from({ length: 24 }, (_, i) => {
            const a = (i / 24) * Math.PI * 2;
            return { x: 30 * Math.cos(a), y: 18 * Math.sin(a), z: 0 };
        });
        expect(() => hygieneBottomPattern(outside, { rimPlan: rim, requireInsideRim: true })).toThrow(
            /outside the TopSheet rim|from the rim/,
        );
    });
});
