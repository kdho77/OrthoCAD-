// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry } from "three";
import { sewGlbInputDiagnostics } from "@/lib/geometry/base-occt";

function makeMultiMeshGeometry(openEdges: number): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
        "position",
        new BufferAttribute(new Float32Array([0, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    );
    geometry.setIndex([0, 1, 2, 3, 4, 5]);
    geometry.userData = { isMultiMeshBase: true, topVertexCount: 3 };
    if (openEdges === 0) {
        geometry.setIndex([0, 1, 2, 3, 4, 5, 0, 2, 3, 2, 4, 3]);
    }
    return geometry;
}

describe("base-occt sew diagnostics", () => {
    test("sewGlbInputDiagnostics reports multi-mesh layout", () => {
        const geometry = makeMultiMeshGeometry(6);
        const diag = sewGlbInputDiagnostics(geometry);
        expect(diag.isMultiMeshBase).toBe(true);
        expect(diag.topVertexCount).toBe(3);
        expect(diag.vertexCount).toBe(6);
        expect(diag.openEdges).toBeGreaterThan(0);
        geometry.dispose();
    });
});
