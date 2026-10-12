// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import type { HermiteStation } from "./loft";
import { applyOutlineClean, cleanClosedLoop, OUTLINE_DEDUPE_MM } from "./outline-clean";

describe("outline clean", () => {
    test("dedupes vertices closer than 0.05 mm and drops collinear spikes", () => {
        const pts = [
            { x: 0, y: 0, z: 0 },
            { x: 0.02, y: 0, z: 0 },
            { x: 4, y: 0, z: 0 },
            { x: 4, y: 0.01, z: 0 },
            { x: 4, y: 3, z: 0 },
            { x: 0, y: 3, z: 0 },
        ];
        const { points, keep } = cleanClosedLoop(pts);
        expect(OUTLINE_DEDUPE_MM).toBe(0.05);
        expect(points.length).toBeLessThan(pts.length);
        expect(keep.length).toBe(points.length);
        expect(points.length).toBeGreaterThanOrEqual(3);
    });

    test("merges matching column stations when the outline is cleaned", () => {
        const stations: HermiteStation[] = [
            { outline: { x: 0, y: 0, z: 0 }, rim: { x: -1, y: 0, z: 8 }, n: { x: -1, y: 0 }, u: 0 },
            { outline: { x: 0.02, y: 0, z: 0 }, rim: { x: -1, y: 0.02, z: 8 }, n: { x: -1, y: 0 }, u: 0.01 },
            { outline: { x: 4, y: 0, z: 0 }, rim: { x: 5, y: 0, z: 8 }, n: { x: 1, y: 0 }, u: 0.3 },
            { outline: { x: 4, y: 3, z: 0 }, rim: { x: 5, y: 3, z: 8 }, n: { x: 1, y: 0 }, u: 0.6 },
            { outline: { x: 0, y: 3, z: 0 }, rim: { x: -1, y: 3, z: 8 }, n: { x: -1, y: 0 }, u: 0.9 },
        ];
        const rimLocal = [10, 11, 12, 13, 14];
        const { dropped } = applyOutlineClean(stations, rimLocal);
        expect(dropped).toBeGreaterThan(0);
        expect(stations.length).toBe(rimLocal.length);
        expect(stations.length).toBeLessThan(5);
    });
});
