// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { MIN_FILLET_RINGS } from "./hermite";
import type { HermiteStation } from "./loft";
import { I_CLEARANCE_MM, I_MIN_EDGE_MM, placeSimpleInnerRing, sampleBottomWallFillet } from "./quad-grid";

describe("generated plantar quad grid", () => {
    test("bottom fillet is monotonic in n and ends at the outline", () => {
        const P1 = { n: 8, z: 0.2 };
        const rings = sampleBottomWallFillet(P1, 2.4, 1.4);
        expect(rings.length).toBeGreaterThanOrEqual(MIN_FILLET_RINGS);
        for (let i = 1; i < rings.length; i++) {
            const cur = rings[i];
            const prev = rings[i - 1];
            expect(cur && prev && cur.n >= prev.n - 1e-9).toBe(true);
        }
        const last = rings[rings.length - 1];
        const first = rings[0];
        expect(last?.n).toBeCloseTo(P1.n, 6);
        expect(last?.z).toBeCloseTo(P1.z, 6);
        expect(first && first.n < P1.n).toBe(true);
        expect(first && first.z > P1.z).toBe(true);
    });

    test("inner ring I is simple, cleared, and min-edge safe", () => {
        const n = 32;
        const stations: HermiteStation[] = [];
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            const ox = 30 * Math.cos(a);
            const oy = 16 * Math.sin(a);
            stations.push({
                outline: { x: ox, y: oy, z: 0 },
                rim: { x: ox + Math.cos(a) * 4, y: oy + Math.sin(a) * 4, z: 12 },
                n: { x: Math.cos(a), y: Math.sin(a) },
                u: i / n,
            });
        }
        const placed = placeSimpleInnerRing(stations);
        expect(placed.minEdgeMm).toBeGreaterThanOrEqual(I_MIN_EDGE_MM);
        expect(placed.minClearanceMm).toBeGreaterThanOrEqual(I_CLEARANCE_MM - 1e-6);
        expect(Math.abs(placed.turning - 1)).toBeLessThan(0.05);
    });
});
