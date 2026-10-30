// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

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

    test("edgePlaneN is the top face sharing the rim edge", () => {
        const pos = [0, 0, 2, 2, 0, 2, 1, 1, 2.5, 0, 2, 2];
        const indices = [0, 1, 2, 0, 3, 1];
        const junct = rimJunctions(
            pos,
            indices,
            [0, 1],
            [
                { x: 0, y: -1 },
                { x: 0, y: -1 },
            ],
            0,
        );
        const n = junct[0]?.edgePlaneN;
        expect(n).toBeDefined();
        if (!n) return;
        const len = Math.hypot(n.x, n.y, n.z);
        expect(len).toBeCloseTo(1, 6);
        const ax = 2;
        const ay = 0;
        const az = 0;
        const bx = 1;
        const by = 1;
        const bz = 0.5;
        const fx = ay * bz - az * by;
        const fy = az * bx - ax * bz;
        const fz = ax * by - ay * bx;
        const fl = Math.hypot(fx, fy, fz) || 1;
        const want = { x: fx / fl, y: fy / fl, z: fz / fl };
        const dot = Math.abs(n.x * want.x + n.y * want.y + n.z * want.z);
        expect(dot).toBeGreaterThan(0.999);
    });
});
