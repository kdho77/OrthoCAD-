// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import {
    densifyArchFanStations,
    ensureSourceRimStations,
    evenSplitSourceEdges,
    headingDeltaDeg,
    insertStationPair,
    markSourceRimStations,
    PAIR_SPACING_MIN_MM,
    squarePairingsToB,
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

    test("ensureSourceRimStations puts every source rim vertex on the ring", () => {
        const stations: HermiteStation[] = [
            station(0, 0, 10, 0, 0),
            station(10, 0, 20, 0, 0.5),
            station(5, 8, 15, 8, 0.25),
        ];
        const rimLocal = [0, 1, 2];
        const positions = [10, 0, 8, 20, 0, 8, 15, 8, 8, 15, 0, 8];
        const indices = [0, 1, 2];
        const pattern = [
            { x: 0, y: 0, z: 0 },
            { x: 10, y: 0, z: 0 },
            { x: 5, y: 8, z: 0 },
        ];
        const added = ensureSourceRimStations(
            stations,
            rimLocal,
            positions,
            indices,
            pattern,
            { minX: 0, maxX: 20 },
            [0, 1, 2, 3],
        );
        expect(added).toBe(1);
        expect(rimLocal).toContain(3);
        expect(stations).toHaveLength(4);
        const mid = stations.find((s) => Math.abs(s.rim.x - 15) < 1e-6 && Math.abs(s.rim.y) < 1e-6);
        expect(mid).toBeTruthy();
    });

    test("evenSplitSourceEdges inserts k even R samples, never clustered", () => {
        const stations: HermiteStation[] = [
            station(0, 0, 0, 0, 0),
            station(12, 0, 12, 0, 0.5),
            station(6, 8, 6, 8, 0.25),
        ];
        stations[0]!.tB = 0;
        stations[1]!.tB = 0.5;
        stations[2]!.tB = 0.25;
        const rimLocal = [0, 1, 2];
        const positions = [0, 0, 8, 12, 0, 8, 6, 8, 8];
        const indices = [0, 1, 2];
        const pattern = [
            { x: 0, y: 0, z: 0 },
            { x: 12, y: 0, z: 0 },
            { x: 6, y: 8, z: 0 },
        ];
        const n0 = stations.length;
        evenSplitSourceEdges(
            stations,
            rimLocal,
            positions,
            indices,
            pattern,
            { minX: 0, maxX: 12 },
            undefined,
            4,
        );
        expect(stations.length).toBeGreaterThan(n0);
        const onLong: number[] = [];
        for (const s of stations) {
            if (Math.abs(s.rim.y) < 1e-6 && s.rim.x > 0.1 && s.rim.x < 11.9) {
                onLong.push(s.rim.x);
            }
        }
        onLong.sort((a, b) => a - b);
        expect(onLong.length).toBeGreaterThanOrEqual(2);
        const gaps: number[] = [];
        for (let i = 1; i < onLong.length; i++) gaps.push(onLong[i]! - onLong[i - 1]!);
        const minG = Math.min(...gaps);
        const maxG = Math.max(...gaps);
        expect(maxG / minG).toBeLessThanOrEqual(1.5 + 1e-6);
    });

    test("squarePairingsToB slides B until cosT reaches 0.3", () => {
        const stations: HermiteStation[] = [
            station(0, 0, 8, 0, 0),
            station(4, 0.2, 8, 6, 0.3),
            station(8, 0, 8, 12, 0.6),
            station(4, -2, 0, 6, 0.9),
        ];
        stations[0]!.tB = 0;
        stations[1]!.tB = 0.25;
        stations[2]!.tB = 0.5;
        stations[3]!.tB = 0.75;
        const pattern = [
            { x: 0, y: 0, z: 0 },
            { x: 4, y: 0.2, z: 0 },
            { x: 8, y: 0, z: 0 },
            { x: 4, y: -2, z: 0 },
        ];
        markSourceRimStations(stations, [0, 1, 2, 3], [0, 1, 2, 3]);
        expect(stations.every((s) => s.sourceRim)).toBe(true);
        squarePairingsToB(stations, pattern);
        for (let i = 0; i < stations.length; i++) {
            const dx = stations[i]!.outline.x - stations[i]!.rim.x;
            const dy = stations[i]!.outline.y - stations[i]!.rim.y;
            const len = Math.hypot(dx, dy) || 1;
            const prev = stations[(i + stations.length - 1) % stations.length]!.outline;
            const next = stations[(i + 1) % stations.length]!.outline;
            const tx = next.x - prev.x;
            const ty = next.y - prev.y;
            const tl = Math.hypot(tx, ty) || 1;
            let nx = ty / tl;
            let ny = -tx / tl;
            if (nx * (dx / len) + ny * (dy / len) < 0) {
                nx = -nx;
                ny = -ny;
            }
            const cosT = Math.max(0, (dx / len) * nx + (dy / len) * ny);
            expect(cosT).toBeGreaterThanOrEqual(0.25);
        }
    });
});
