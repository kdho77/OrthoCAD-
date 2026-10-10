// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry } from "three";
import { countJunctionBandSlivers } from "./metrics";
import { splitAcuteTriangles } from "./reconstruct";

function ribbonMesh(): { positions: number[]; indices: number[]; band: Set<number> } {
    // 20×1 last strip (C_MIN = spacing/20) plus a plantar face on B-B.
    const B0 = 0;
    const B1 = 1;
    const P0 = 2;
    const P1 = 3;
    const S = 4;
    const positions = [0, 0, 0, 20, 0, 0, 0, 0, 1, 20, 0, 1, 10, 5, 0];
    const indices = [P0, B1, P1, P0, B0, B1, B0, B1, S];
    return { positions, indices, band: new Set([B0, B1]) };
}

describe("splitAcuteTriangles", () => {
    test("splits the 20:1 last-strip ribbon so junction min-angle is at least 5deg", () => {
        const { positions, indices, band } = ribbonMesh();
        const before = new BufferGeometry();
        before.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
        before.setIndex(indices.slice());
        expect(countJunctionBandSlivers(before, band, 20)).toBeGreaterThan(0);

        splitAcuteTriangles(positions, indices, 0, band);

        const after = new BufferGeometry();
        after.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
        after.setIndex(indices);
        expect(countJunctionBandSlivers(after, band, 20)).toBe(0);
        before.dispose();
        after.dispose();
    });
});
