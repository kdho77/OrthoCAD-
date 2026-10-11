// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry } from "three";
import { countJunctionBandSlivers } from "./metrics";
import { splitAcuteTriangles } from "./reconstruct";

function edgeUses(indices: number[]): Map<string, number> {
    const use = new Map<string, number>();
    const bump = (a: number, b: number): void => {
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        use.set(key, (use.get(key) ?? 0) + 1);
    };
    for (let t = 0; t < indices.length; t += 3) {
        bump(indices[t]!, indices[t + 1]!);
        bump(indices[t + 1]!, indices[t + 2]!);
        bump(indices[t + 2]!, indices[t]!);
    }
    return use;
}

function ribbonMesh(): { positions: number[]; indices: number[]; band: Set<number> } {
    // 20×1 last strip plus plantar on B-B and an upper strip on P-P.
    const B0 = 0;
    const B1 = 1;
    const P0 = 2;
    const P1 = 3;
    const S = 4;
    const U0 = 5;
    const U1 = 6;
    const positions = [0, 0, 0, 20, 0, 0, 0, 0, 1, 20, 0, 1, 10, 5, 0, 0, 0, 2, 20, 0, 2];
    const indices = [P0, B1, P1, P0, B0, B1, B0, B1, S, U0, P1, U1, U0, P0, P1];
    return { positions, indices, band: new Set([B0, B1]) };
}

describe("splitAcuteTriangles", () => {
    test("splits the 20:1 last-strip ribbon so junction min-angle is at least 5deg", () => {
        const { positions, indices, band } = ribbonMesh();
        const before = new BufferGeometry();
        before.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
        before.setIndex(indices.slice());
        expect(countJunctionBandSlivers(before, band, 20, 5)).toBeGreaterThan(0);

        splitAcuteTriangles(positions, indices, 0, band);

        const after = new BufferGeometry();
        after.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
        after.setIndex(indices);
        expect(countJunctionBandSlivers(after, band, 20, 5)).toBe(0);
        for (const [key, n] of edgeUses(indices)) {
            const [a, b] = key.split(",").map(Number);
            if ((a ?? 0) >= 7 || (b ?? 0) >= 7) expect(n).toBe(2);
        }
        before.dispose();
        after.dispose();
    });
});
