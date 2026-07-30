// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry, Vector3 } from "three";
import { capBoundaryLoopInPlaceForTest } from "@/lib/geometry/mesh-close";

/**
 * Synthetic open quad whose ShapeUtils primary diagonal (0–2) is already used
 * twice in the shell — primary triangulation adds nothing; alternate diagonal
 * (1–3) must seal the hole.
 */
function makeBlockedDiagonalQuadHole(): { geo: BufferGeometry; loop: Vector3[] } {
    // Vertices: square in XY at z=0, plus two extras forming a shared 0–2 edge pair.
    //   0--1
    //   | /|
    //   3--2
    // Boundary loop CCW: 0,1,2,3. ShapeUtils typically splits on diag 0–2.
    // Pre-seed TWO triangles that already use edge 0–2 (count=2) so that diagonal
    // is blocked for the cap; leave 1–3 free.
    const positions = new Float32Array([
        0,
        0,
        0, // 0
        10,
        0,
        0, // 1
        10,
        10,
        0, // 2
        0,
        10,
        0, // 3
        5,
        5,
        -1, // 4 below — with 0,2 forms one face on diag 0-2
        5,
        5,
        1, // 5 above — with 0,2 forms second face on diag 0-2
    ]);
    const indices = [
        0,
        2,
        4, // uses 0-2
        0,
        5,
        2, // uses 0-2 again → count=2
    ];
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(positions, 3));
    geo.setIndex(indices);
    const loop = [new Vector3(0, 0, 0), new Vector3(10, 0, 0), new Vector3(10, 10, 0), new Vector3(0, 10, 0)];
    return { geo, loop };
}

describe("capBoundaryLoopInPlace alternate 4-gon diagonal", () => {
    test("exercises alternate diagonal when ShapeUtils primary diagonal is blocked", () => {
        const { geo, loop } = makeBlockedDiagonalQuadHole();
        const indexBefore = geo.index!.count;
        const result = capBoundaryLoopInPlaceForTest(geo, loop);
        expect(result.capped).toBe(true);
        expect(result.usedAlternateDiagonal).toBe(true);
        expect(geo.index!.count).toBeGreaterThan(indexBefore);
        // Alternate split uses diag 1–3 → triangles (0,1,3) and (1,2,3).
        const arr = Array.from(geo.index!.array as ArrayLike<number>);
        const added = arr.slice(indexBefore);
        const asTris = [];
        for (let i = 0; i < added.length; i += 3) {
            asTris.push([added[i], added[i + 1], added[i + 2]].sort((a, b) => a! - b!).join(","));
        }
        expect(asTris).toContain("0,1,3");
        expect(asTris).toContain("1,2,3");
        geo.dispose();
    });
});
