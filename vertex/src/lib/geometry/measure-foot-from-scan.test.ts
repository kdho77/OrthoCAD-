// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import {
    measureBallWidthMm,
    measureFootLengthMm,
    suggestShoeSizeFromScan,
} from "@/lib/geometry/measure-foot-from-scan";
import { footLengthMmToUsMen, usMenFootLengthMm } from "@/lib/geometry/shoe-size";

describe("measureFootLengthMm", () => {
    test("recovers heel→toe oriented AABB span along X", () => {
        const pts: number[] = [];
        for (let i = 0; i <= 80; i++) {
            pts.push((270 * i) / 80, 10, 0);
            pts.push((270 * i) / 80, -10, 0);
        }
        const len = measureFootLengthMm({
            positions: pts,
            vertexCount: pts.length / 3,
            displayScale: 1,
            dominantRawAxis: "x",
        });
        expect(len).toBeCloseTo(270, 5);
    });

    test("applies displayScale for metre-unit scans", () => {
        const pts: number[] = [];
        for (let i = 0; i <= 80; i++) {
            pts.push((0.26 * i) / 80, 0.02, 0);
        }
        const len = measureFootLengthMm({
            positions: pts,
            vertexCount: pts.length / 3,
            displayScale: 1000,
            dominantRawAxis: "x",
        });
        expect(len).toBeCloseTo(260, 0);
    });

    test("orients Y-dominant scans onto length axis", () => {
        const pts: number[] = [];
        for (let i = 0; i <= 80; i++) {
            pts.push(0.01, (270 * i) / 80, 0);
        }
        const len = measureFootLengthMm({
            positions: pts,
            vertexCount: pts.length / 3,
            displayScale: 1,
            dominantRawAxis: "y",
        });
        expect(len).toBeCloseTo(270, 0);
    });
});

describe("suggestShoeSizeFromScan", () => {
    test("maps Men’s 9 foot length to US 9", () => {
        const foot = usMenFootLengthMm(9);
        const s = suggestShoeSizeFromScan({ footLengthMm: foot, sizeSystem: "us" });
        expect(s.usMenSize).toBe(9);
        expect(s.inRange).toBe(true);
        expect(s.confidence).toBe("high");
        expect(s.layout.lengthMm).toBeCloseTo(260, 5);
    });

    test("maps longer feet to larger half-sizes", () => {
        const foot = usMenFootLengthMm(11);
        const s = suggestShoeSizeFromScan({ footLengthMm: foot });
        expect(s.usMenSize).toBe(11);
        expect(footLengthMmToUsMen(foot)).toBe(11);
    });

    test("flags out-of-range length as low confidence", () => {
        const s = suggestShoeSizeFromScan({ footLengthMm: 180 });
        expect(s.inRange).toBe(false);
        expect(s.confidence).toBe("low");
        expect(s.warnings.length).toBeGreaterThan(0);
    });
});

describe("measureBallWidthMm", () => {
    test("scales marker distance by displayScale", () => {
        const w = measureBallWidthMm({ x: 0, y: 0, z: 0 }, { x: 0, y: 0.09, z: 0 }, 1000);
        expect(w).toBeCloseTo(90, 5);
    });
});
