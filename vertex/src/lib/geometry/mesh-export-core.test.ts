// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry, MeshStandardMaterial, BoxGeometry, Group, Mesh } from "three";
import { extractMergedGeometry } from "@/lib/library/loaders";
import { MeshNotWatertightError, prepareReducedExportGeometry } from "@/lib/geometry/mesh-close";
import { closeAndSerializeExportPayload } from "@/lib/geometry/mesh-export-core";

describe("mesh-export-core", () => {
    test("prepareReducedExportGeometry keeps small meshes intact", () => {
        const geometry = new BufferGeometry();
        geometry.setAttribute(
            "position",
            new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]), 3),
        );
        geometry.setIndex([0, 1, 2, 0, 2, 3]);
        geometry.userData = { isMultiMeshBase: true, topVertexCount: 2 };

        const result = prepareReducedExportGeometry(geometry);
        expect(result.usedReducedBottom).toBe(false);
        result.geometry.dispose();
        geometry.dispose();
    });

    test("prepareReducedExportGeometry reduces large GLB-style bottom to rim cap", () => {
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
        const bottomVc = total - topVc;

        Object.defineProperty(merged.geometry.userData, "topVertexCount", {
            value: topVc,
            writable: true,
        });

        const result = prepareReducedExportGeometry(merged.geometry);
        if (bottomVc > 50_000) {
            expect(result.usedReducedBottom).toBe(true);
            expect(result.bottomRimVertexCount).toBeGreaterThan(0);
            expect(result.bottomRimVertexCount).toBeLessThan(2000);
            const reducedVerts = result.geometry.getAttribute("position").count;
            expect(reducedVerts).toBeLessThan(total);
        } else {
            expect(result.usedReducedBottom).toBe(false);
        }

        result.geometry.dispose();
        merged.geometry.dispose();
        top.geometry.dispose();
        bottom.geometry.dispose();
        (top.material as MeshStandardMaterial).dispose();
        (bottom.material as MeshStandardMaterial).dispose();
    });

    test("closeAndSerializeExportPayload returns non-empty STL bytes", () => {
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
        const positions = new Float32Array(merged.geometry.getAttribute("position").array as ArrayLike<number>);
        const indices = merged.geometry.getIndex()
            ? new Uint32Array(merged.geometry.getIndex()!.array as ArrayLike<number>)
            : null;

        const result = closeAndSerializeExportPayload({ positions, indices }, topVc);
        expect(result.stlBuffer.byteLength).toBeGreaterThan(134);

        merged.geometry.dispose();
        top.geometry.dispose();
        bottom.geometry.dispose();
        (top.material as MeshStandardMaterial).dispose();
        (bottom.material as MeshStandardMaterial).dispose();
    });

    test("closeAndSerializeExportPayload rejects inverted height axis before bridge weld", () => {
        const geometry = new BufferGeometry();
        geometry.setAttribute(
            "position",
            new BufferAttribute(
                new Float32Array([
                    0, 10, 0, 1, 10, 0, 0, 10, 1, 0, 20, 0, 1, 20, 0, 0, 20, 1,
                ]),
                3,
            ),
        );
        geometry.setIndex([0, 1, 2, 3, 5, 4]);
        const positions = new Float32Array(geometry.getAttribute("position").array as ArrayLike<number>);
        const indices = new Uint32Array(geometry.getIndex()!.array as ArrayLike<number>);

        expect(() => closeAndSerializeExportPayload({ positions, indices }, 3)).toThrow(
            MeshNotWatertightError,
        );
        geometry.dispose();
    });
});
