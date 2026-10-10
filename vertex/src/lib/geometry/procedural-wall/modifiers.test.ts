// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import type { HermiteStation } from "./loft";
import {
    clampPostingOnStations,
    clampPostingOnTopSheet,
    plantarNormalAt,
    plantarZDelta,
    postingZDelta,
} from "./modifiers";

function station(
    R: { x: number; y: number; z: number },
    B: { x: number; y: number; z: number },
    u = 0,
): HermiteStation {
    const dx = B.x - R.x;
    const dy = B.y - R.y;
    const len = Math.hypot(dx, dy) || 1;
    return { outline: B, rim: R, n: { x: dx / len, y: dy / len }, u };
}

describe("plantar posting", () => {
    test("plantarNormalAt is the finite-difference slope of zDelta", () => {
        const n = plantarNormalAt(0, 0, (_x, y) => 0.2 * y, 0.5);
        expect(n.z).toBeGreaterThan(0);
        expect(n.y).toBeLessThan(0);
        expect(n.x).toBeCloseTo(0, 5);
    });

    test("clampPostingOnStations caps a raise that would starve minWall+r1+r2", () => {
        const stations = [station({ x: 10, y: 0, z: 4 }, { x: 7, y: 0, z: 0 })];
        const raw = () => 3;
        const { zDelta, postingClamps } = clampPostingOnStations(stations, raw, 0.5, 0.5, 0.8);
        expect(postingClamps).toHaveLength(1);
        expect(postingClamps[0]!.droppedMm).toBeCloseTo(0.8, 5);
        expect(zDelta(7, 0)).toBeCloseTo(2.2, 5);
        expect(4 - zDelta(7, 0)).toBeCloseTo(1.8, 5);
        const short = [station({ x: 10, y: 0, z: 1 }, { x: 7, y: 0, z: 0 })];
        const idle = clampPostingOnStations(short, () => 0, 0.5, 0.5, 0.8);
        expect(idle.postingClamps).toHaveLength(0);
        expect(idle.zDelta(7, 0)).toBe(0);
        const forced = clampPostingOnStations(stations, () => 3, 0.5, 0.5, 0.8, [
            { station: 0, extraMm: 0.4 },
        ]);
        expect(forced.postingClamps.length).toBeGreaterThan(0);
        expect(forced.zDelta(7, 0)).toBeLessThan(2.2);
    });

    test("postingZDelta tilts the top; plantarZDelta stays 0", () => {
        const bounds = { minX: 0, maxX: 100, minY: -20, maxY: 20 };
        const input = {
            corrections: {
                forefootPostingDeg: 0,
                rearfootPostingDeg: 4,
                medialSkiveMm: 0,
                lateralSkiveMm: 0,
                archFillMm: 0,
                archHeightMm: 0,
                heelCupDepthMm: 0,
                heelCupHeightMm: 0,
                heelCupWidthMm: 0,
                heelLiftMm: 10,
                apexMoveMm: 0,
                medialFlangeMm: 0,
                lateralFlangeMm: 0,
            },
            medialYSign: 1 as const,
        };
        const pos = postingZDelta(10, 20, bounds, input);
        const neg = postingZDelta(10, -20, bounds, input);
        expect(pos).toBeGreaterThan(0);
        expect(neg).toBeLessThan(0);
        expect(plantarZDelta(10, 20, bounds, input)).toBe(0);
        expect(plantarZDelta(10, -20, bounds, input)).toBe(0);
    });

    test("clampPostingOnTopSheet raises a starved rim so top-0 >= minWall+r1+r2", () => {
        const topPos = new Float32Array([10, 0, 1, 0, 0, 4]);
        const clamps = clampPostingOnTopSheet(topPos, [0], 0.5, 0.5, 0.8);
        expect(clamps).toHaveLength(1);
        expect(clamps[0]!.droppedMm).toBeCloseTo(0.8, 5);
        expect(topPos[2]).toBeCloseTo(1.8, 5);
        expect(topPos[5]).toBeCloseTo(4.8, 5);
        const idle = clampPostingOnTopSheet(new Float32Array([10, 0, 4]), [0], 0.5, 0.5, 0.8);
        expect(idle).toHaveLength(0);
    });
});
