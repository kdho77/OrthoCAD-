// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import * as THREE from "three";
import { closeMeshPerimeter, MeshNotWatertightError } from "@/lib/geometry/mesh-close";
import { extractMergedGeometry } from "@/lib/library/loaders";

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

describe("GLB loaders — mesh order", () => {
    test("Bottom-before-Top traversal still yields Top-first vertex layout", () => {
        const group = makeGroup([
            { name: "Bottom", geo: new THREE.BoxGeometry(90, 260, 5), position: [0, 0, 0] },
            { name: "Top", geo: new THREE.BoxGeometry(90, 260, 5), position: [0, 0, 10] },
        ]);

        const merged = extractMergedGeometry(group)!;
        expect(merged.meshNames[0]).toMatch(/top/i);
        expect(() => closeMeshPerimeter(merged.geometry)).not.toThrow(MeshNotWatertightError);
        merged.geometry.dispose();
    });
});
