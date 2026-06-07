// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import * as THREE from "three";
import { countMeshes, extractMergedGeometry, extractPrimaryGeometry } from "./loaders";

/** Build a GLB-like group with separately-named meshes (mirrors Top/Bottom bases). */
function makeGroup(meshes: { name: string; geo: THREE.BufferGeometry; position?: [number, number, number] }[]) {
    const group = new THREE.Group();
    for (const m of meshes) {
        const mesh = new THREE.Mesh(m.geo, new THREE.MeshStandardMaterial());
        mesh.name = m.name;
        if (m.position) mesh.position.set(...m.position);
        group.add(mesh);
    }
    return group;
}

describe("GLB loaders — multi-mesh base support", () => {
    test("merges separate Top + Bottom meshes into one base geometry", () => {
        const group = makeGroup([
            { name: "Top", geo: new THREE.BoxGeometry(90, 260, 5), position: [0, 0, 10] },
            { name: "Bottom", geo: new THREE.BoxGeometry(90, 260, 5), position: [0, 0, 0] },
        ]);

        const merged = extractMergedGeometry(group);
        expect(merged).not.toBeNull();
        expect(merged!.meshCount).toBe(2);
        expect(merged!.meshNames).toEqual(["Top", "Bottom"]);

        const pos = merged!.geometry.getAttribute("position");
        expect(pos).toBeTruthy();
        expect(pos.count).toBeGreaterThan(0);

        // Merged bounds span both meshes (Z from ~ -2.5 to ~12.5).
        merged!.geometry.computeBoundingBox();
        const box = merged!.geometry.boundingBox!;
        expect(box.max.z).toBeGreaterThan(box.min.z + 10);
    });

    test("bakes per-mesh world transforms into the merged geometry", () => {
        const group = makeGroup([
            { name: "Top", geo: new THREE.BoxGeometry(10, 10, 2), position: [0, 0, 50] },
            { name: "Bottom", geo: new THREE.BoxGeometry(10, 10, 2), position: [0, 0, -50] },
        ]);
        const merged = extractMergedGeometry(group);
        merged!.geometry.computeBoundingBox();
        const box = merged!.geometry.boundingBox!;
        // The +50 / -50 offsets must be reflected, proving matrices were applied.
        expect(box.max.z).toBeGreaterThan(45);
        expect(box.min.z).toBeLessThan(-45);
    });

    test("countMeshes reports every mesh in the group", () => {
        const group = makeGroup([
            { name: "Top", geo: new THREE.BoxGeometry(1, 1, 1) },
            { name: "Bottom", geo: new THREE.BoxGeometry(1, 1, 1) },
            { name: "Edge", geo: new THREE.BoxGeometry(1, 1, 1) },
        ]);
        expect(countMeshes(group)).toEqual({ count: 3, names: ["Top", "Bottom", "Edge"] });
    });

    test("single-mesh GLB still loads (backward compatible)", () => {
        const group = makeGroup([{ name: "Shell", geo: new THREE.BoxGeometry(90, 260, 20) }]);
        const merged = extractMergedGeometry(group);
        expect(merged!.meshCount).toBe(1);
        expect(extractPrimaryGeometry(group)).not.toBeNull();
    });

    test("empty group returns null", () => {
        expect(extractMergedGeometry(new THREE.Group())).toBeNull();
    });
});
