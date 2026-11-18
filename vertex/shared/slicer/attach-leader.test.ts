// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import {
    applySacrificialLeaderBlock,
    binaryStlTriangleCount,
    LEADER_BLOCK_DEPTH_MM,
    LEADER_BRIDGE_LENGTH_MM,
    LEADER_SUFFIX_TRIANGLE_COUNT,
} from "../../src/lib/geometry/leader-block";
import {
    attachLeaderToPositions,
    attachSacrificialLeader,
    LEADER_NOT_MILLIMETERS,
    LEADER_NOT_THINNER_TOE,
    LEADER_UNCERTAIN_BOTTOM,
    LEADER_UNCERTAIN_DIRECTION,
    slicerToeCoordinate,
} from "./attach-leader";
import { stlBytes, taperedInsole } from "./tapered-insole-fixture";

function extent(positions: Float32Array, axis: 0 | 1 | 2): { min: number; max: number } {
    let min = Infinity;
    let max = -Infinity;
    for (let i = axis; i < positions.length; i += 3) {
        const value = positions[i] ?? 0;
        if (value < min) min = value;
        if (value > max) max = value;
    }
    return { min, max };
}

describe("slicer sacrificial leader", () => {
    test("toe first marks the max of the long axis, heel first marks the min", () => {
        const bounds = {
            min: [0, 0, 0] as [number, number, number],
            max: [200, 80, 12] as [number, number, number],
            size: [200, 80, 12] as [number, number, number],
        };
        expect(slicerToeCoordinate(bounds, "toe_first")).toEqual({ axis: 0, at: 200 });
        expect(slicerToeCoordinate(bounds, "heel_first")).toEqual({ axis: 0, at: 0 });
    });

    test("toggle geometry matches the CAD leader and fuses it into the toe", () => {
        const positions = taperedInsole((x, y, z) => [x, y, z]);
        const attached = attachLeaderToPositions(positions, "toe_first");
        expect(attached.ok).toBe(true);
        if (!attached.ok) return;
        const stl = attached.bytes.buffer.slice(
            attached.bytes.byteOffset,
            attached.bytes.byteOffset + attached.bytes.byteLength,
        );
        expect(binaryStlTriangleCount(stl)).toBe(positions.length / 9 + LEADER_SUFFIX_TRIANGLE_COUNT);
        const before = extent(positions, 0);
        const after = extent(attached.positions, 0);
        expect(after.max - before.max).toBeCloseTo(LEADER_BRIDGE_LENGTH_MM + LEADER_BLOCK_DEPTH_MM, 2);
        expect(after.min).toBeCloseTo(before.min, 2);
        const direct = applySacrificialLeaderBlock(stlBytes(positions));
        expect(binaryStlTriangleCount(direct)).toBe(binaryStlTriangleCount(stl));
        expect(attached.bytes.byteLength).toBe(direct.byteLength);
        let embedded = false;
        let pastToe = false;
        let onSole = false;
        const leaderStart = (positions.length / 9) * 9;
        for (let i = leaderStart; i < attached.positions.length; i += 3) {
            const x = attached.positions[i] ?? 0;
            const z = attached.positions[i + 2] ?? 0;
            if (x < before.max - 0.2 && x > before.max - 12) embedded = true;
            if (x > before.max + 15) pastToe = true;
            if (Math.abs(z) < 0.05) onSole = true;
        }
        expect(embedded).toBe(true);
        expect(pastToe).toBe(true);
        expect(onSole).toBe(true);
    });

    test("a rotated upload gets the leader on the toe and on the sole", () => {
        const turned = taperedInsole((x, y, z) => [y, x, z]);
        const beforeY = extent(turned, 1);
        const attached = attachLeaderToPositions(turned, "toe_first");
        expect(attached.ok).toBe(true);
        if (!attached.ok) return;
        const afterY = extent(attached.positions, 1);
        expect(afterY.max - beforeY.max).toBeCloseTo(LEADER_BRIDGE_LENGTH_MM + LEADER_BLOCK_DEPTH_MM, 2);
        expect(afterY.min).toBeCloseTo(beforeY.min, 2);

        const soleUp = taperedInsole((x, y, z) => [x, y, 12 - z]);
        const beforeX = extent(soleUp, 0);
        const flipped = attachLeaderToPositions(soleUp, "toe_first");
        expect(flipped.ok).toBe(true);
        if (!flipped.ok) return;
        const afterX = extent(flipped.positions, 0);
        expect(afterX.max - beforeX.max).toBeCloseTo(LEADER_BRIDGE_LENGTH_MM + LEADER_BLOCK_DEPTH_MM, 2);
        let onSole = false;
        const leaderStart = (soleUp.length / 9) * 9;
        for (let i = leaderStart; i < flipped.positions.length; i += 3) {
            const z = flipped.positions[i + 2] ?? 0;
            if (Math.abs(z - 12) < 0.05) onSole = true;
        }
        expect(onSole).toBe(true);
    });

    test("the thick end is refused so the leader is not fused to the heel", () => {
        const positions = taperedInsole((x, y, z) => [x, y, z]);
        const refused = attachLeaderToPositions(positions, "heel_first");
        expect(refused.ok).toBe(false);
        if (refused.ok) return;
        expect(refused.message).toBe(LEADER_NOT_THINNER_TOE);
    });

    test("a cube, a flat slab, and a tiny mesh are refused", () => {
        const cube = boxPositions(80, 80, 80);
        const cubeResult = attachLeaderToPositions(cube, "toe_first");
        expect(cubeResult.ok).toBe(false);
        if (!cubeResult.ok) expect(cubeResult.message).toBe(LEADER_UNCERTAIN_DIRECTION);

        const slab = boxPositions(200, 80, 8);
        const slabResult = attachLeaderToPositions(slab, "toe_first");
        expect(slabResult.ok).toBe(false);
        if (!slabResult.ok) expect(slabResult.message).toBe(LEADER_UNCERTAIN_BOTTOM);

        const tiny = taperedInsole((x, y, z) => [x / 25.4, y / 25.4, z / 25.4]);
        const tinyResult = attachLeaderToPositions(tiny, "toe_first");
        expect(tinyResult.ok).toBe(false);
        if (!tinyResult.ok) expect(tinyResult.message).toBe(LEADER_NOT_MILLIMETERS);
    });

    test("bytes of a binary STL round-trip through the same leader function", () => {
        const positions = taperedInsole((x, y, z) => [x, y, z]);
        const raw = new Uint8Array(stlBytes(positions));
        const attached = attachSacrificialLeader(raw, "toe_first");
        expect(attached.ok).toBe(true);
        if (!attached.ok) return;
        const direct = new Uint8Array(applySacrificialLeaderBlock(raw.buffer.slice(0)));
        expect(Buffer.from(attached.bytes).equals(Buffer.from(direct))).toBe(true);
    });
});

function boxPositions(length: number, width: number, height: number): Float32Array {
    const x0 = 0;
    const x1 = length;
    const y0 = -width / 2;
    const y1 = width / 2;
    const z0 = 0;
    const z1 = height;
    const corners = [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y1, z0],
        [x0, y1, z0],
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
    ];
    const faces = [
        [0, 2, 1],
        [0, 3, 2],
        [4, 5, 6],
        [4, 6, 7],
        [0, 1, 5],
        [0, 5, 4],
        [1, 2, 6],
        [1, 6, 5],
        [2, 3, 7],
        [2, 7, 6],
        [3, 0, 4],
        [3, 4, 7],
    ];
    const verts: number[] = [];
    for (const [a, b, c] of faces) {
        verts.push(...(corners[a] ?? []), ...(corners[b] ?? []), ...(corners[c] ?? []));
    }
    return Float32Array.from(verts);
}
