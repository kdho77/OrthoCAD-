// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry } from "three";
import {
    closeGlbInsoleToSolid,
    extractBoundaryLoops,
    submeshByVertexRange,
    validateManifold,
} from "@/lib/geometry/mesh-close";

function mergeTopBottomShells(top: BufferGeometry, bottom: BufferGeometry): BufferGeometry {
    const topPos = top.getAttribute("position");
    const botPos = bottom.getAttribute("position");
    const total = topPos.count + botPos.count;
    const positions = new Float32Array(total * 3);
    positions.set(topPos.array as Float32Array, 0);
    positions.set(botPos.array as Float32Array, topPos.count * 3);

    const topIdx = top.index ? Array.from(top.index.array) : Array.from({ length: topPos.count }, (_, i) => i);
    const botIdx = bottom.index
        ? Array.from(bottom.index.array).map((i) => i + topPos.count)
        : Array.from({ length: botPos.count }, (_, i) => i + topPos.count);

    const out = new BufferGeometry();
    out.setAttribute("position", new BufferAttribute(positions, 3));
    out.setIndex([...topIdx, ...botIdx]);
    out.userData = { isMultiMeshBase: true, sourceMeshNames: ["Top", "Bottom"], topVertexCount: topPos.count };
    return out;
}

/** Simple dome top + flat bottom with one boundary loop each. */
function buildDomePair(): BufferGeometry {
    const top = new BufferGeometry();
    top.setAttribute(
        "position",
        new BufferAttribute(
            new Float32Array([
                0, 0, 5,
                10, 0, 3,
                5, 10, 3,
                5, -10, 3,
            ]),
            3,
        ),
    );
    top.setIndex([0, 1, 2, 0, 3, 1]);

    const bottom = new BufferGeometry();
    bottom.setAttribute(
        "position",
        new BufferAttribute(
            new Float32Array([
                0, 0, 0,
                10, 0, 0,
                5, 10, 0,
                5, -10, 0,
            ]),
            3,
        ),
    );
    bottom.setIndex([0, 2, 1, 0, 1, 3]);

    return mergeTopBottomShells(top, bottom);
}

describe("closeGlbInsoleToSolid", () => {
    test("submeshByVertexRange uses local indices and each shell has one rim loop", () => {
        const merged = buildDomePair();
        const topVc = (merged.userData as { topVertexCount: number }).topVertexCount;
        const total = merged.getAttribute("position").count;

        const topSub = submeshByVertexRange(merged, 0, topVc);
        const botSub = submeshByVertexRange(merged, topVc, total);

        const topIdx = topSub.index!;
        const botIdx = botSub.index!;
        let topMax = -1;
        let botMax = -1;
        for (let i = 0; i < topIdx.count; i++) topMax = Math.max(topMax, topIdx.getX(i));
        for (let i = 0; i < botIdx.count; i++) botMax = Math.max(botMax, botIdx.getX(i));

        expect(topMax).toBeLessThan(topSub.getAttribute("position").count);
        expect(botMax).toBeLessThan(botSub.getAttribute("position").count);
        expect(extractBoundaryLoops(topSub).length).toBe(1);
        expect(extractBoundaryLoops(botSub).length).toBe(1);

        topSub.dispose();
        botSub.dispose();
        merged.dispose();
    });

    test("closes synthetic dome pair to watertight solid", () => {
        const raw = buildDomePair();
        const pre = validateManifold(raw);
        expect(pre.openEdges).toBeGreaterThan(0);

        const closed = closeGlbInsoleToSolid(raw);
        const post = validateManifold(closed);
        expect(post.openEdges).toBe(0);
        expect(post.isWatertight).toBe(true);
        expect(post.eulerCharacteristic).toBe(2);

        raw.dispose();
        closed.dispose();
    });
});
