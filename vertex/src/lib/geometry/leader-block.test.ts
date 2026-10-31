// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import {
    APEX_LIGHT_LAYER_HEIGHT_MM,
    LEADER_ACROSS_BELT_MM,
    LEADER_ALONG_BELT_MM,
    LEADER_HEIGHT_MM,
    LEADER_START_GANTRY_Y_MM,
    LEADER_TRIANGLE_COUNT,
    leaderFloorZMm,
    predictedLeaderStart,
    readBinaryStl,
    rotatedBounds,
    rotateToeFirst,
    stlBounds,
    stlForBeltGcodeExport,
    writeBinaryStl,
} from "@/lib/geometry/leader-block";

function viewerBox(): ArrayBuffer {
    const p = (x: number, y: number, z: number) => ({ x, y, z });
    const x0 = 0;
    const x1 = 100;
    const y0 = 0;
    const y1 = 40;
    const z0 = 0;
    const z1 = 4;
    const v = [
        p(x0, y0, z0),
        p(x1, y0, z0),
        p(x1, y1, z0),
        p(x0, y1, z0),
        p(x0, y0, z1),
        p(x1, y0, z1),
        p(x1, y1, z1),
        p(x0, y1, z1),
    ];
    const faces: Array<[number, number, number]> = [
        [0, 2, 1],
        [0, 3, 2],
        [4, 5, 6],
        [4, 6, 7],
        [0, 1, 5],
        [0, 5, 4],
        [3, 6, 2],
        [3, 7, 6],
        [0, 4, 7],
        [0, 7, 3],
        [1, 2, 6],
        [1, 6, 5],
    ];
    return writeBinaryStl(faces.map(([a, b, c]) => [v[a], v[b], v[c]]));
}

describe("belt export leader block", () => {
    test("default export STL includes the leader in front of the toe", () => {
        const viewer = viewerBox();
        const exported = stlForBeltGcodeExport(viewer);
        const part = readBinaryStl(viewer);
        const withLeader = readBinaryStl(exported);

        expect(withLeader.length).toBe(part.length + LEADER_TRIANGLE_COUNT);

        const partBelt = rotatedBounds(part);
        const belt = rotatedBounds(withLeader);
        expect(partBelt.minY - belt.minY).toBeCloseTo(LEADER_ALONG_BELT_MM, 5);
        expect(belt.minZ).toBeCloseTo(partBelt.minZ, 5);
        const front = withLeader
            .flat()
            .map(rotateToeFirst)
            .filter((v) => v.y < partBelt.minY - 1e-4);
        const frontZ = front.map((v) => v.z);
        const frontX = front.map((v) => v.x);
        expect(Math.min(...frontZ)).toBeCloseTo(partBelt.minZ + leaderFloorZMm(), 5);
        expect(Math.max(...frontZ) - Math.min(...frontZ)).toBeCloseTo(LEADER_HEIGHT_MM, 5);
        expect(Math.max(...frontX) - Math.min(...frontX)).toBeCloseTo(LEADER_ACROSS_BELT_MM, 5);

        const start = predictedLeaderStart(APEX_LIGHT_LAYER_HEIGHT_MM);
        expect(start.y).toBeCloseTo(LEADER_START_GANTRY_Y_MM, 6);
        expect(start.z).toBeCloseTo(0.651, 3);
    });

    test("toggle off omits the leader", () => {
        const viewer = viewerBox();
        const exported = stlForBeltGcodeExport(viewer, { addLeaderBlock: false });
        expect(exported).toBe(viewer);
        expect(readBinaryStl(exported).length).toBe(readBinaryStl(viewer).length);
        expect(stlBounds(readBinaryStl(exported))).toEqual(stlBounds(readBinaryStl(viewer)));
    });
});
