// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { Result, ShapeTypes } from "@chili3d/core";
import type { IShape, IShapeFactory, ISolid } from "@chili3d/core";
import { BufferAttribute, BufferGeometry } from "three";

function makeCubeGeometry(): BufferGeometry {
    const positions = new Float32Array([
        0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
        0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1,
    ]);
    const indices = [
        0, 1, 2, 0, 2, 3,
        4, 6, 5, 4, 7, 6,
        0, 4, 5, 0, 5, 1,
        2, 6, 7, 2, 7, 3,
        0, 3, 7, 0, 7, 4,
        1, 5, 6, 1, 6, 2,
    ];
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    return geometry;
}

function makeMockFactory(): IShapeFactory {
    const makeShape = (shapeType: ShapeTypes): IShape =>
        ({
            shapeType,
            isClosed: () => true,
            findSubShapes: () => [],
        }) as IShape;

    return {
        polygon: () => Result.ok(makeShape(ShapeTypes.wire)),
        face: () => Result.ok(makeShape(ShapeTypes.face)),
        shell: () => Result.ok(makeShape(ShapeTypes.shell)),
        solid: () => Result.ok(makeShape(ShapeTypes.solid) as ISolid),
    } as unknown as IShapeFactory;
}

describe("base-occt manufacturing export", () => {
    test("sewGlbGeometryToSolid builds a closed solid from cube mesh", async () => {
        const { sewGlbGeometryToSolid } = await import("@/lib/geometry/base-occt");
        const geometry = makeCubeGeometry();
        const solid = sewGlbGeometryToSolid(makeMockFactory(), geometry);

        expect(solid).not.toBeNull();
        expect(solid!.isClosed()).toBe(true);
        geometry.dispose();
    });
});
