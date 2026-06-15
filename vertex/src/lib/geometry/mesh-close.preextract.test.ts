// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry, MeshStandardMaterial, BoxGeometry, Group, Mesh } from "three";
import { extractMergedGeometry } from "@/lib/library/loaders";
import {
    prepareReducedExportGeometry,
    preextractExportBottomRimLoop,
    resolveMultiMeshBaseLoopsForTest,
    type ExportRimPoint,
} from "@/lib/geometry/mesh-close";

function makeTopBottomGroup(): Group {
    const group = new Group();
    const top = new Mesh(new BoxGeometry(90, 260, 5), new MeshStandardMaterial());
    top.name = "Top";
    top.position.set(0, 0, 10);
    const bottom = new Mesh(new BoxGeometry(90, 260, 5), new MeshStandardMaterial());
    bottom.name = "Bottom";
    bottom.position.set(0, 0, 0);
    group.add(top, bottom);
    return group;
}

function makeSeamOpenMergedGeometry(): { geometry: BufferGeometry; topVertexCount: number } {
    const topVertexCount = 8;
    const bottomPadCount = 4;
    const positions = new Float32Array((topVertexCount + bottomPadCount) * 3);

    const topCorners = [
        [-45, -130, 10],
        [45, -130, 10],
        [45, 130, 10],
        [-45, 130, 10],
        [-45, -130, 15],
        [45, -130, 15],
        [45, 130, 15],
        [-45, 130, 15],
    ];
    for (let i = 0; i < topVertexCount; i++) {
        positions[i * 3] = topCorners[i]![0]!;
        positions[i * 3 + 1] = topCorners[i]![1]!;
        positions[i * 3 + 2] = topCorners[i]![2]!;
    }
    for (let i = 0; i < bottomPadCount; i++) {
        const o = topVertexCount + i;
        positions[o * 3] = -45 + i * 30;
        positions[o * 3 + 1] = 0;
        positions[o * 3 + 2] = 0;
    }

    const indices = [
        0, 1, 5, 0, 5, 4,
        1, 2, 6, 1, 6, 5,
        2, 3, 7, 2, 7, 6,
        3, 0, 4, 3, 4, 7,
        4, 5, 6, 4, 6, 7,
        8, 9, 10, 8, 10, 11,
    ];

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.userData = { isMultiMeshBase: true, topVertexCount };
    return { geometry, topVertexCount };
}

describe("mesh-close pre-extract bottom rim", () => {
    test("preextractExportBottomRimLoop matches resolveMultiMeshBaseLoops bottom loop", () => {
        const { geometry, topVertexCount: topVc } = makeSeamOpenMergedGeometry();

        const preextracted = preextractExportBottomRimLoop(geometry, topVc);
        const legacy = resolveMultiMeshBaseLoopsForTest(geometry, topVc);

        expect(legacy).not.toBeNull();
        expect(preextracted.length).toBe(legacy!.bottom.length);
        let maxDist = 0;
        for (let i = 0; i < preextracted.length; i++) {
            maxDist = Math.max(maxDist, preextracted[i]!.distanceTo(legacy!.bottom[i]!));
        }
        expect(maxDist).toBeLessThan(0.01);

        geometry.dispose();
    });

    test("prepareReducedExportGeometry uses precomputed rim without resolveMultiMeshBaseLoops", () => {
        const rim: ExportRimPoint[] = [
            { x: -45, y: -130, z: 0 },
            { x: 45, y: -130, z: 0 },
            { x: 45, y: 130, z: 0 },
            { x: -45, y: 130, z: 0 },
        ];

        const merged = extractMergedGeometry(makeTopBottomGroup())!;
        const topVc = (merged.geometry.userData as { topVertexCount: number }).topVertexCount;
        const topPositions = merged.geometry.getAttribute("position").array as Float32Array;
        const topIndices = merged.geometry.getIndex()!.array as ArrayLike<number>;

        const bottomPadCount = 55_000;
        const totalVerts = topVc + bottomPadCount;
        const positions = new Float32Array(totalVerts * 3);
        positions.set(topPositions.subarray(0, topVc * 3), 0);

        const indices: number[] = [];
        for (let i = 0; i < topIndices.length; i++) {
            indices.push(Number(topIndices[i]));
        }

        const geometry = new BufferGeometry();
        geometry.setAttribute("position", new BufferAttribute(positions, 3));
        geometry.setIndex(indices);
        geometry.userData = { isMultiMeshBase: true, topVertexCount: topVc };

        const result = prepareReducedExportGeometry(geometry, { precomputedBottomRim: rim });
        expect(result.usedReducedBottom).toBe(true);
        expect(result.bottomRimVertexCount).toBe(4);
        expect(result.geometry.getAttribute("position").count).toBe(topVc + 4);

        result.geometry.dispose();
        geometry.dispose();
        merged.geometry.dispose();
    });
});
