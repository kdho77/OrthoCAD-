// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { fitClosedC2Spline, lowCurvatureStartIndex, resampleClosedC2, startAtLowCurvature } from "./curves";
import { assertClosedStationRing, assertPeriodicQuadStrip, rotateStationRing } from "./ring-seam";

function ellipse(n: number, rx = 110, ry = 42, cx = 120): Array<{ x: number; y: number; z: number }> {
    return Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2;
        return { x: cx + rx * Math.cos(a), y: ry * Math.sin(a), z: 0 };
    });
}

describe("closed ring seam", () => {
    test("low-curvature start sits in the midfoot, not the heel apex", () => {
        const loop = ellipse(80);
        const bounds = { minX: 10, maxX: 230 };
        const started = startAtLowCurvature(loop, bounds);
        const u0 = (started[0]!.x - bounds.minX) / (bounds.maxX - bounds.minX);
        expect(u0).toBeGreaterThan(0.3);
        expect(u0).toBeLessThan(0.55);
        const heel = loop.reduce((b, p) => (p.x < b.x ? p : b), loop[0]!);
        expect(Math.hypot(started[0]!.x - heel.x, started[0]!.y - heel.y)).toBeGreaterThan(20);
        expect(lowCurvatureStartIndex(started, bounds)).toBe(0);
    });

    test("C2 resample does not duplicate first/last", () => {
        const raw = ellipse(60);
        const loop = resampleClosedC2(fitClosedC2Spline(raw), 80);
        const a = loop[0]!;
        const b = loop[loop.length - 1]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0.5);
    });

    test("rotateStationRing and wrap asserts", () => {
        const n = 12;
        const stations = Array.from({ length: n }, (_, i) => {
            const a = (i / n) * Math.PI * 2;
            return {
                outline: { x: 40 * Math.cos(a), y: 18 * Math.sin(a), z: 0 },
                rim: { x: 48 * Math.cos(a), y: 22 * Math.sin(a), z: 8 },
                n: { x: Math.cos(a), y: Math.sin(a) },
                u: (Math.cos(a) + 1) / 2,
            };
        });
        const rimLocal = stations.map((_, i) => i + 3);
        rotateStationRing(stations, rimLocal, { minX: -48, maxX: 48 });
        expect(() => assertClosedStationRing(stations, rimLocal)).not.toThrow();
        const u0 = stations[0]!.u;
        expect(u0).toBeGreaterThan(0.25);
        expect(u0).toBeLessThan(0.75);
        const nS = stations.length;
        const nJ = 4;
        const vert = (j: number, i: number) => {
            const s = ((i % nS) + nS) % nS;
            return j * nS + s;
        };
        expect(() => assertPeriodicQuadStrip(nS, nJ, vert)).not.toThrow();
        expect(() => assertClosedStationRing(stations, [...rimLocal.slice(0, -1), rimLocal[0]!])).toThrow(
            /duplicate wrap rim/,
        );
    });
});
