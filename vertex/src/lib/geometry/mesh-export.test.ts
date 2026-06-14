// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry, MeshStandardMaterial, BoxGeometry, Group, Mesh } from "three";
import { extractMergedGeometry } from "@/lib/library/loaders";
import {
    closeMeshToSolid,
    concatTopBottomShells,
    serializeBinarySTL,
} from "@/lib/geometry/mesh-export";
import { validateManifold } from "@/lib/geometry/mesh-close";

function makeFlatQuad(z: number): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
        "position",
        new BufferAttribute(new Float32Array([0, 0, z, 10, 0, z, 0, 10, z, 10, 10, z]), 3),
    );
    geometry.setIndex([0, 1, 2, 1, 3, 2]);
    return geometry;
}

function splitShellByVertexRange(
    geometry: BufferGeometry,
    rangeStart: number,
    rangeEnd: number,
): BufferGeometry {
    const pos = geometry.getAttribute("position");
    const index = geometry.index;
    const remap = new Map<number, number>();
    const newPos: number[] = [];
    const newIdx: number[] = [];
    const map = (vi: number): number => {
        if (!remap.has(vi)) {
            remap.set(vi, remap.size);
            newPos.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
        }
        return remap.get(vi)!;
    };

    if (index) {
        for (let t = 0; t < index.count; t += 3) {
            const i0 = index.getX(t);
            const i1 = index.getX(t + 1);
            const i2 = index.getX(t + 2);
            if (i0 < rangeStart || i0 >= rangeEnd) continue;
            if (i1 < rangeStart || i1 >= rangeEnd) continue;
            if (i2 < rangeStart || i2 >= rangeEnd) continue;
            newIdx.push(map(i0), map(i1), map(i2));
        }
    }

    const out = new BufferGeometry();
    out.setAttribute("position", new BufferAttribute(new Float32Array(newPos), 3));
    if (newIdx.length > 0) out.setIndex(newIdx);
    return out;
}

describe("mesh-export", () => {
    test("closeMeshToSolid closes synthetic top and bottom quads", () => {
        const top = makeFlatQuad(5);
        const bottom = makeFlatQuad(0);
        const merged = concatTopBottomShells(top, bottom);
        expect(merged.getAttribute("position").count).toBe(8);
        expect((merged.userData as { topVertexCount: number }).topVertexCount).toBe(4);
        merged.dispose();

        const solid = closeMeshToSolid(top, bottom);
        const report = validateManifold(solid);
        expect(report.isWatertight).toBe(true);
        expect(report.openEdges).toBe(0);
        expect(Number.isFinite(solid.getAttribute("position").getX(0))).toBe(true);
        solid.dispose();
        top.dispose();
        bottom.dispose();
    });

    test("serializeBinarySTL writes valid header and triangle count", () => {
        const geometry = new BufferGeometry();
        geometry.setAttribute(
            "position",
            new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
        );

        const buffer = serializeBinarySTL(geometry);
        expect(buffer.byteLength).toBe(134);
        const view = new DataView(buffer);
        expect(view.getUint32(80, true)).toBe(1);
        expect(view.getFloat32(96, true)).toBe(0);
        expect(view.getFloat32(100, true)).toBe(0);
        expect(view.getFloat32(104, true)).toBe(0);
        geometry.dispose();
    });

    test("closeMeshToSolid on GLB-style top/bottom shells is watertight", () => {
        const group = new Group();
        const top = new Mesh(new BoxGeometry(90, 260, 5), new MeshStandardMaterial());
        top.name = "Top";
        top.position.set(0, 0, 10);
        const bottom = new Mesh(new BoxGeometry(90, 260, 5), new MeshStandardMaterial());
        bottom.name = "Bottom";
        bottom.position.set(0, 0, 0);
        group.add(top, bottom);

        const merged = extractMergedGeometry(group)!;
        const topVc = (merged.geometry.userData as { topVertexCount: number }).topVertexCount;
        const total = merged.geometry.getAttribute("position").count;

        const topShell = splitShellByVertexRange(merged.geometry, 0, topVc);
        const bottomShell = splitShellByVertexRange(merged.geometry, topVc, total);

        const solid = closeMeshToSolid(topShell, bottomShell);
        const report = validateManifold(solid);
        expect(report.isWatertight).toBe(true);
        expect(report.eulerCharacteristic).toBe(2);

        solid.dispose();
        topShell.dispose();
        bottomShell.dispose();
        merged.geometry.dispose();
        top.geometry.dispose();
        bottom.geometry.dispose();
        (top.material as MeshStandardMaterial).dispose();
        (bottom.material as MeshStandardMaterial).dispose();
    });
});
