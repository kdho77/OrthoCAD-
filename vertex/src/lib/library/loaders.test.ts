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

/**
 * Re-pack a geometry's position + normal into a single interleaved buffer, the
 * layout GLB exporters (e.g. Rhino) commonly emit. `mergeGeometries` cannot
 * merge these, so this exercises the de-interleaving merge path.
 */
function toInterleaved(geo: THREE.BufferGeometry): THREE.BufferGeometry {
    const src = geo.index ? geo.toNonIndexed() : geo.clone();
    const pos = src.getAttribute("position");
    const nor = src.getAttribute("normal") ?? (src.computeVertexNormals(), src.getAttribute("normal"));
    const count = pos.count;
    const data = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) {
        data[i * 6] = pos.getX(i);
        data[i * 6 + 1] = pos.getY(i);
        data[i * 6 + 2] = pos.getZ(i);
        data[i * 6 + 3] = nor.getX(i);
        data[i * 6 + 4] = nor.getY(i);
        data[i * 6 + 5] = nor.getZ(i);
    }
    const buffer = new THREE.InterleavedBuffer(data, 6);
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.InterleavedBufferAttribute(buffer, 3, 0));
    out.setAttribute("normal", new THREE.InterleavedBufferAttribute(buffer, 3, 3));
    return out;
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

    test("merges interleaved-attribute meshes without dropping any sub-mesh", () => {
        // Real GLBs store position/normal interleaved; the previous mergeGeometries
        // path failed on these and silently kept only the first mesh.
        const top = toInterleaved(new THREE.BoxGeometry(90, 260, 5));
        const bottom = toInterleaved(new THREE.BoxGeometry(90, 260, 5));
        const group = makeGroup([
            { name: "Top", geo: top, position: [0, 0, 10] },
            { name: "Bottom", geo: bottom, position: [0, 0, 0] },
        ]);

        const merged = extractMergedGeometry(group);
        expect(merged).not.toBeNull();
        expect(merged!.meshCount).toBe(2);

        // Bounds must span BOTH meshes — proof the bottom mesh was not dropped.
        merged!.geometry.computeBoundingBox();
        const box = merged!.geometry.boundingBox!;
        expect(box.max.z).toBeGreaterThan(box.min.z + 10);
        expect(merged!.geometry.getAttribute("position").count).toBeGreaterThan(0);
        // Result is plain (de-interleaved) BufferAttributes, not interleaved.
        expect(
            (merged!.geometry.getAttribute("position") as THREE.InterleavedBufferAttribute)
                .isInterleavedBufferAttribute,
        ).toBeFalsy();
    });
});
