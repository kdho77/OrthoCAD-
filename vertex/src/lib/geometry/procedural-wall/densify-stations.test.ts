// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import {
    densifyArchFanStations,
    headingDeltaDeg,
    insertStationPair,
    PAIR_SPACING_MIN_MM,
} from "./densify-stations";
import type { HermiteStation } from "./loft";

function station(x: number, y: number, rx: number, ry: number, u: number): HermiteStation {
    return {
        outline: { x, y, z: 0 },
        rim: { x: rx, y: ry, z: 8 },
        n: { x: 1, y: 0 },
        u,
    };
}

describe("pair-insert densify", () => {
    test("inserts R on the top-boundary edge and B on the pattern", () => {
        const stations: HermiteStation[] = [
            station(0, 0, 10, 0, 0),
            station(10, 0, 20, 0, 0.5),
            station(5, 8, 15, 8, 0.25),
        ];
        const rimLocal = [0, 1, 2];
        const positions = [10, 0, 8, 20, 0, 8, 15, 8, 8];
        const indices = [0, 1, 2];
        const pattern = [
            { x: 0, y: 0, z: 0 },
            { x: 10, y: 0, z: 0 },
            { x: 5, y: 8, z: 0 },
        ];
        const orig = positions.slice();
        insertStationPair(stations, rimLocal, positions, indices, pattern, { minX: 0, maxX: 20 }, 0);
        expect(stations).toHaveLength(4);
        expect(positions.slice(0, 9)).toEqual(orig);
        const R = stations[1]!.rim;
        expect(R.x).toBeCloseTo(15, 5);
        expect(R.y).toBeCloseTo(0, 5);
        expect(R.z).toBeCloseTo(8, 5);
        expect(stations[1]!.outline.x).toBeGreaterThan(0);
        expect(indices.length).toBe(6);
    });

    test("heading densify stops at 3° or 0.3 mm", () => {
        const stations: HermiteStation[] = [
            station(0, 0, 0, 4, 0.2),
            station(12, 6, 12, 4, 0.4),
            station(24, 0, 24, 4, 0.6),
            station(12, -2, 12, 0, 0.9),
        ];
        const rimLocal = [0, 1, 2, 3];
        const positions = [0, 4, 8, 12, 4, 8, 24, 4, 8, 12, 0, 8];
        const indices = [0, 1, 3, 1, 2, 3];
        const pattern = stations.map((s) => ({ ...s.outline }));
        densifyArchFanStations(stations, rimLocal, positions, indices, pattern, { minX: 0, maxX: 24 });
        for (let i = 0; i < stations.length; i++) {
            const a = stations[i]!;
            const b = stations[(i + 1) % stations.length]!;
            const ds = Math.min(
                Math.hypot(b.rim.x - a.rim.x, b.rim.y - a.rim.y),
                Math.hypot(b.outline.x - a.outline.x, b.outline.y - a.outline.y),
            );
            const head = headingDeltaDeg(a, b);
            expect(head <= 3 + 1e-3 || ds <= 2 * PAIR_SPACING_MIN_MM + 1e-6).toBe(true);
        }
    });
});
