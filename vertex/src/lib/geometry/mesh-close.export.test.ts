// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry } from "three";
import {
    closeMeshPerimeter,
    countRimVertsBelowTop,
    detectHeightAxis,
    MeshNotWatertightError,
    validateExportHeightAxis,
} from "@/lib/geometry/mesh-close";

function makeTwoShellGeometry(
    topY: number,
    bottomY: number,
    topCount = 4,
    bottomCount = 4,
): BufferGeometry {
    const positions = new Float32Array((topCount + bottomCount) * 3);
    for (let i = 0; i < topCount; i++) {
        positions[i * 3] = i;
        positions[i * 3 + 1] = topY;
        positions[i * 3 + 2] = 0;
    }
    for (let i = 0; i < bottomCount; i++) {
        const o = topCount + i;
        positions[o * 3] = i;
        positions[o * 3 + 1] = bottomY;
        positions[o * 3 + 2] = 0;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.userData = { isMultiMeshBase: true, topVertexCount: topCount };
    return geometry;
}

describe("mesh-close export axis helpers", () => {
    test("detectHeightAxis picks Y when top shell varies in Y", () => {
        const geometry = makeTwoShellGeometry(10, 0);
        expect(detectHeightAxis(geometry, 4)).toBe("y");
    });

    test("countRimVertsBelowTop identifies bottom rim below top along Y", () => {
        const geometry = makeTwoShellGeometry(10, 0);
        const rimIndices = [4, 5, 6, 7];
        const below = countRimVertsBelowTop(geometry, 4, rimIndices, "y");
        expect(below).toBe(4);
    });

    test("validateExportHeightAxis throws when bottom sits above top", () => {
        const geometry = makeTwoShellGeometry(10, 20);
        expect(() => validateExportHeightAxis(geometry, 4)).toThrow(MeshNotWatertightError);
    });

    test("validateExportHeightAxis passes when bottom is below top", () => {
        const geometry = makeTwoShellGeometry(10, 0);
        expect(() => validateExportHeightAxis(geometry, 4)).not.toThrow();
    });

    test("closeMeshPerimeter exportMode completes on merged Top+Bottom box", async () => {
        const { extractMergedGeometry } = await import("@/lib/library/loaders");
        const { BoxGeometry, Group, Mesh, MeshStandardMaterial } = await import("three");
        const group = new Group();
        const top = new Mesh(new BoxGeometry(90, 260, 5), new MeshStandardMaterial());
        top.name = "Top";
        top.position.set(0, 0, 10);
        const bottom = new Mesh(new BoxGeometry(90, 260, 5), new MeshStandardMaterial());
        bottom.name = "Bottom";
        bottom.position.set(0, 0, 0);
        group.add(top, bottom);

        const merged = extractMergedGeometry(group)!;
        (merged.geometry.userData as { isMultiMeshBase?: boolean }).isMultiMeshBase = true;

        const result = closeMeshPerimeter(merged.geometry, { exportMode: true });
        expect(result.report.isWatertight).toBe(true);
        expect(result.report.eulerCharacteristic).toBe(2);
        expect(result.bridgeTriangleCount).toBeGreaterThan(0);

        result.geometry.dispose();
        merged.geometry.dispose();
        top.geometry.dispose();
        bottom.geometry.dispose();
        (top.material as MeshStandardMaterial).dispose();
        (bottom.material as MeshStandardMaterial).dispose();
    });
});
