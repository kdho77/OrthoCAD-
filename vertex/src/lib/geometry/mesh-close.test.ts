// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import * as THREE from "three";
import { extractMergedGeometry } from "@/lib/library/loaders";
import {
    closeMeshPerimeter,
    resampleLoopToCount,
    validateManifold,
} from "@/lib/geometry/mesh-close";

function makeTopBottomGroup(): THREE.Group {
    const group = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(90, 260, 5), new THREE.MeshStandardMaterial());
    top.name = "Top";
    top.position.set(0, 0, 10);
    const bottom = new THREE.Mesh(new THREE.BoxGeometry(90, 260, 5), new THREE.MeshStandardMaterial());
    bottom.name = "Bottom";
    bottom.position.set(0, 0, 0);
    group.add(top, bottom);
    return group;
}

describe("mesh-close — perimeter stitching", () => {
    test("merged Top+Bottom GLB is a false-positive watertight (euler != 2)", () => {
        const merged = extractMergedGeometry(makeTopBottomGroup());
        expect(merged).not.toBeNull();
        const pre = validateManifold(merged!.geometry);
        // Each shell is closed, so openEdges=0 — but the two shells are not bridged.
        expect(pre.openEdges).toBe(0);
        expect(pre.eulerCharacteristic).not.toBe(2);
    });

    test("closeMeshPerimeter produces watertight mesh with Euler=2", () => {
        const merged = extractMergedGeometry(makeTopBottomGroup())!;
        (merged.geometry.userData as { isMultiMeshBase?: boolean }).isMultiMeshBase = true;

        const result = closeMeshPerimeter(merged.geometry);
        expect(result.report.isWatertight).toBe(true);
        expect(result.report.openEdges).toBe(0);
        expect(result.report.nonManifoldEdges).toBe(0);
        expect(result.report.eulerCharacteristic).toBe(2);
        expect(result.bridgeTriangleCount).toBeGreaterThan(0);
        expect(result.rimHeightsMm.length).toBe(8);
    });

    test("resampleLoopToCount preserves loop count and closes evenly", () => {
        const loop = [
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(10, 0, 0),
            new THREE.Vector3(10, 10, 0),
            new THREE.Vector3(0, 10, 0),
        ];
        const resampled = resampleLoopToCount(loop, 8);
        expect(resampled.length).toBe(8);
        expect(resampled[0]!.distanceTo(resampled[7]!)).toBeGreaterThan(0);
    });
});
