// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import * as THREE from "three";
import {
    assertClosedSolidAcceptable,
    closedSolidBaselineForExport,
    closeMeshPerimeter,
    DEFAULT_GLB_CLOSED_BASELINE,
    DEFAULT_PROCEDURAL_CLOSED_BASELINE,
    validateManifold,
} from "@/lib/geometry/mesh-close";
import { extractMergedGeometry } from "@/lib/library/loaders";

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

describe("mesh-close — procedural export baseline", () => {
    test("DEFAULT_GLB_CLOSED_BASELINE remains euler=3", () => {
        expect(DEFAULT_GLB_CLOSED_BASELINE.eulerCharacteristic).toBe(3);
    });

    test("genus-0 closed solid passes procedural baseline (euler=2)", () => {
        const merged = extractMergedGeometry(makeTopBottomGroup())!;
        (merged.geometry.userData as { isMultiMeshBase?: boolean }).isMultiMeshBase = true;
        const { geometry } = closeMeshPerimeter(merged.geometry);
        const report = validateManifold(geometry);
        expect(report.openEdges).toBe(0);
        expect(report.eulerCharacteristic).toBe(2);
        expect(closedSolidBaselineForExport(1, true)).toEqual(DEFAULT_PROCEDURAL_CLOSED_BASELINE);
        expect(closedSolidBaselineForExport(1, false)).toEqual(DEFAULT_GLB_CLOSED_BASELINE);
        expect(() =>
            assertClosedSolidAcceptable(geometry, 0, DEFAULT_PROCEDURAL_CLOSED_BASELINE),
        ).not.toThrow();
        geometry.dispose();
    });
});
