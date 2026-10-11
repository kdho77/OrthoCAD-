// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { MIN_FILLET_RINGS } from "./hermite";
import { rimJunctions, sampleBottomWallFillet } from "./quad-grid";

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

    test("rim junctions keep past-vertical adjacent faces", () => {
        const pos = [0, 0, 0, 0.1, 0.5, -1, 0.1, -0.5, -1];
        const indices = [0, 1, 2];
        const junct = rimJunctions(pos, indices, [0], [{ x: 1, y: 0 }], 0);
        expect(junct[0]?.planeN.z).toBeLessThan(0);
        expect(Math.abs(((junct[0]?.slopeRad ?? 0) * 180) / Math.PI)).toBeGreaterThan(90);
    });
});
