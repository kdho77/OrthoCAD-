// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry, Vector3 } from "three";
import {
    buildTwoPointerBridgeTriangles,
    generateBridgeStrip,
    validateManifoldDetailed,
} from "@/lib/geometry/mesh-close";

function makeCircleLoop(count: number, radius: number, z: number): Vector3[] {
    const loop: Vector3[] = [];
    for (let i = 0; i < count; i++) {
        const t = (i / count) * Math.PI * 2;
        loop.push(new Vector3(Math.cos(t) * radius, Math.sin(t) * radius, z));
    }
    return loop;
}

describe("two-pointer bridge manifold", () => {
    test("two-pointer bridge produces zero non-manifold edges for 4:8 rim ratio", () => {
        const top = makeCircleLoop(4, 10, 5);
        const bot = makeCircleLoop(8, 10, 0);
        const bridge = generateBridgeStrip(top, bot);

        const geo = new BufferGeometry();
        geo.setAttribute("position", new BufferAttribute(new Float32Array(bridge.positions), 3));
        geo.setIndex(bridge.indices);

        const { openEdges, nonManifoldEdges } = validateManifoldDetailed(geo, "test-4-8");
        expect(openEdges).toBe(4 + 8);
        expect(nonManifoldEdges).toBe(0);

        geo.dispose();
    });

    test("two-pointer bridge with 8:8 rim ratio is manifold", () => {
        const top = makeCircleLoop(8, 10, 5);
        const bot = makeCircleLoop(8, 10, 0);
        const bridge = generateBridgeStrip(top, bot);

        const geo = new BufferGeometry();
        geo.setAttribute("position", new BufferAttribute(new Float32Array(bridge.positions), 3));
        geo.setIndex(bridge.indices);

        const { nonManifoldEdges } = validateManifoldDetailed(geo, "test-8-8");
        expect(nonManifoldEdges).toBe(0);

        geo.dispose();
    });

    test("buildTwoPointerBridgeTriangles uses only consecutive rim vertices", () => {
        const top = makeCircleLoop(4, 10, 5);
        const bot = makeCircleLoop(8, 10, 0);
        const positions: number[] = [];
        const push = (v: Vector3) => {
            const i = positions.length / 3;
            positions.push(v.x, v.y, v.z);
            return i;
        };
        const topIdx = top.map((p) => push(p));
        const botIdx = bot.map((p) => push(p));
        const centroid = new Vector3();
        const getPosition = (vi: number) =>
            new Vector3(positions[vi * 3]!, positions[vi * 3 + 1]!, positions[vi * 3 + 2]!);

        const tris = buildTwoPointerBridgeTriangles(top, topIdx, bot, botIdx, getPosition, centroid);
        expect(tris.length).toBeGreaterThan(0);
        expect(tris.length % 3).toBe(0);
        expect(tris.length / 3).toBe(top.length + bot.length);
    });
});
