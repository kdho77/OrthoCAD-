// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import * as THREE from "three";
import {
    assertClosedSolidAcceptable,
    assertIndexedVerticesSeparated,
    assertProceduralIndexSolid,
    closedSolidBaselineForExport,
    closeMeshPerimeter,
    DEFAULT_GLB_CLOSED_BASELINE,
    DEFAULT_PROCEDURAL_CLOSED_BASELINE,
    validateManifold,
    validateManifoldIndexed,
} from "@/lib/geometry/mesh-close";
import { wantsProceduralExportSolid } from "@/lib/geometry/procedural-wall/preview-loft-ui";
import { extractMergedGeometry } from "@/lib/library/loaders";

/** Indexed tetrahedron: V=4 E=6 F=4, Euler=2, every edge shared by two faces. */
function makeClosedTetra(apex: [number, number, number] = [0, 0, 10]): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    const [x, y, z] = apex;
    geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0, x, y, z]), 3),
    );
    geometry.setIndex([0, 1, 2, 0, 3, 1, 0, 2, 3, 1, 3, 2]);
    return geometry;
}

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

    test("procedural gate uses index topology and rejects vertices within 1e-4 mm", () => {
        const clean = makeClosedTetra();
        const indexed = validateManifoldIndexed(clean);
        expect(indexed.openEdges).toBe(0);
        expect(indexed.nonManifoldEdges).toBe(0);
        expect(indexed.eulerCharacteristic).toBe(2);
        expect(() => assertProceduralIndexSolid(clean)).not.toThrow();
        expect(() => assertIndexedVerticesSeparated(clean)).not.toThrow();
        expect(() => assertClosedSolidAcceptable(clean, 0, DEFAULT_PROCEDURAL_CLOSED_BASELINE)).not.toThrow();

        // Same index graph, but vertex 3 falls in vertex 0's QUANT 1e4 cell.
        // Position-keyed analyzeManifold reports euler=3; index topology stays 2.
        const collapsed = makeClosedTetra([1e-5, 0, 0]);
        const collapsedIndex = validateManifoldIndexed(collapsed);
        expect(collapsedIndex.openEdges).toBe(0);
        expect(collapsedIndex.nonManifoldEdges).toBe(0);
        expect(collapsedIndex.eulerCharacteristic).toBe(2);
        expect(validateManifold(collapsed).eulerCharacteristic).toBe(3);
        expect(() => assertIndexedVerticesSeparated(collapsed)).toThrow(/1e-4/);
        expect(() => assertProceduralIndexSolid(collapsed)).toThrow(/1e-4/);

        const separated = makeClosedTetra([2e-4, 0, 0]);
        expect(() => assertIndexedVerticesSeparated(separated)).not.toThrow();
        expect(validateManifoldIndexed(separated).eulerCharacteristic).toBe(2);
        expect(() => assertProceduralIndexSolid(separated)).not.toThrow();

        clean.dispose();
        collapsed.dispose();
        separated.dispose();
    });

    test("wantsProceduralExportSolid defaults false unless SAMPLE_Top or explicit procedural", () => {
        expect(wantsProceduralExportSolid(null)).toBe(false);
        expect(wantsProceduralExportSolid({ assetId: "other", glbPath: "Templates/Other.glb" })).toBe(false);
        expect(
            wantsProceduralExportSolid({ assetId: "other", glbPath: "Templates/Other.glb" }, "procedural"),
        ).toBe(true);
        expect(
            wantsProceduralExportSolid({ assetId: "other", glbPath: "Templates/Other.glb" }, "legacy"),
        ).toBe(false);
        expect(
            wantsProceduralExportSolid({ assetId: "sample-top", glbPath: "Templates/SAMPLE_Top.glb" }),
        ).toBe(true);
        expect(
            wantsProceduralExportSolid(
                { assetId: "stock-default", glbPath: "Templates/Default.glb" },
                "procedural",
            ),
        ).toBe(false);
    });
});
