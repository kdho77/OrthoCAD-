// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test, beforeEach } from "@rstest/core";
import { BufferAttribute, BufferGeometry } from "three";
import type { DesignState } from "@/types";

const mockEnsureWatertight = rs.fn<(geometry: BufferGeometry) => BufferGeometry>();
const mockCloseLiveViewerMeshToSolid = rs.fn<(geometry: BufferGeometry) => BufferGeometry>();
const mockSerializeBinarySTL = rs.fn<() => ArrayBuffer>();
const mockBuildModifiedBaseGeometry = rs.fn<() => Promise<BufferGeometry | null>>();

const mockDesign: DesignState = {
    method: "printing_solid",
    thicknessMm: 3,
    corrections: { left: [], right: [] },
    elements: [],
    bases: {
        left: { assetId: "stock-default", source: "stock", glbPath: "Templates/Default.glb" },
    },
} as DesignState;

let viewerGeometry: BufferGeometry | null = null;
let viewerBuilding = false;

rs.mock("@/stores/design-store", () => ({
    useDesignStore: {
        getState: () => ({ design: mockDesign }),
    },
}));

rs.mock("@/stores/viewer-geometry-store", () => ({
    getLiveViewerGeometry: () => viewerGeometry,
    isViewerGeometryBuilding: () => viewerBuilding,
}));

rs.mock("@/lib/geometry/mesh-export", () => ({
    closeLiveViewerMeshToSolid: (geometry: BufferGeometry) => mockCloseLiveViewerMeshToSolid(geometry),
    serializeBinarySTL: () => mockSerializeBinarySTL(),
}));

rs.mock("@/lib/geometry/mesh-close", () => ({
    ensureWatertightForExport: (geometry: BufferGeometry) => mockEnsureWatertight(geometry),
    MeshNotWatertightError: class MeshNotWatertightError extends Error {},
}));

rs.mock("@/lib/geometry/base-asset", () => ({
    getDesignBase: () => mockDesign.bases?.left ?? null,
    loadBaseGeometry: rs.fn(async () => makeTestGeometry()),
    baseModifierFieldAuthoritative: () => ({
        side: "left",
        lengthMm: 260,
        widthMm: 90,
        thicknessMm: 3,
        corrections: [],
        elements: [],
    }),
}));

rs.mock("@/lib/geometry/base-modifier", () => ({
    applyBaseModifiers: (geometry: BufferGeometry) => geometry.clone(),
}));

rs.mock("@/lib/chili3d/kernel", () => ({
    getKernel: () => ({
        buildInsole: rs.fn(() => makeTestGeometry()),
        buildInsoleSolid: rs.fn(),
        buildFromBase: rs.fn(),
        exportSTL: rs.fn(),
    }),
    isAuthoritativeKernel: () => false,
}));

rs.mock("@/lib/geometry/kernel-build", () => ({
    insoleParamsFromDesign: () => ({
        side: "left",
        lengthMm: 260,
        widthMm: 90,
        thicknessMm: 3,
        corrections: [],
        elements: [],
    }),
    isOcctKernelActive: () => false,
}));

rs.mock("@/lib/geometry/trimline", () => ({
    getDesignTrimline: () => null,
    sampleDefaultOutline: () => [],
}));

rs.mock("@/lib/geometry/geometry-engine", () => ({
    geometryEngine: {
        buildTrimlineMesh: rs.fn(async () => makeTestGeometry()),
    },
}));

rs.mock("@/lib/geometry/glb-export", () => ({
    meshFromGeometry: (geometry: BufferGeometry) => ({ geometry, material: {} }),
    exportObjectToGlb: rs.fn(async () => ({ arrayBuffer: new ArrayBuffer(32) })),
}));

function makeTestGeometry(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
        "position",
        new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    );
    geometry.setIndex([0, 1, 2]);
    geometry.userData = { isMultiMeshBase: true, topVertexCount: 3 };
    return geometry;
}

describe("export-geometry routing", () => {
    beforeEach(() => {
        viewerGeometry = makeTestGeometry();
        viewerBuilding = false;
        mockEnsureWatertight.mockReset();
        mockCloseLiveViewerMeshToSolid.mockReset();
        mockSerializeBinarySTL.mockReset();
        mockBuildModifiedBaseGeometry.mockReset();
        mockCloseLiveViewerMeshToSolid.mockImplementation((geometry) => geometry);
        mockSerializeBinarySTL.mockReturnValue(new ArrayBuffer(256));
        mockEnsureWatertight.mockImplementation((geometry) => geometry);
    });

    test("exportModeFromMethod maps manufacturing methods", async () => {
        const { exportModeFromMethod } = await import("@/lib/geometry/export-geometry");
        expect(exportModeFromMethod("printing_solid")).toBe("manufacturing");
        expect(exportModeFromMethod("milling_3axis")).toBe("manufacturing");
        expect(exportModeFromMethod("printing_shell")).toBe("preview");
    });

    test("manufacturing export uses live viewer geometry and mesh-close without OCCT", async () => {
        const live = makeTestGeometry();
        viewerGeometry = live;

        const { buildExportStl } = await import("@/lib/geometry/export-geometry");
        const result = await buildExportStl("left", { exportMode: "manufacturing" });

        expect(mockCloseLiveViewerMeshToSolid).toHaveBeenCalled();
        expect(mockSerializeBinarySTL).toHaveBeenCalled();
        expect(result.byteLength).toBeGreaterThan(0);
    });

    test("throws ExportGeometryNotReadyError when viewer geometry is building", async () => {
        viewerBuilding = true;

        const { buildExportStl, ExportGeometryNotReadyError } = await import("@/lib/geometry/export-geometry");
        await expect(buildExportStl("left", { exportMode: "manufacturing" })).rejects.toBeInstanceOf(
            ExportGeometryNotReadyError,
        );
    });

    test("falls back to rebuilt geometry when viewer store is empty", async () => {
        viewerGeometry = null;

        const { buildExportStl } = await import("@/lib/geometry/export-geometry");
        const result = await buildExportStl("left", { exportMode: "manufacturing" });

        expect(mockCloseLiveViewerMeshToSolid).toHaveBeenCalled();
        expect(mockSerializeBinarySTL).toHaveBeenCalled();
        expect(result.byteLength).toBeGreaterThan(0);
    });

    test("GLB download path does not call ensureWatertightForExport", async () => {
        const { buildExportGlb } = await import("@/lib/geometry/export-geometry");
        await buildExportGlb("left");
        expect(mockEnsureWatertight).not.toHaveBeenCalled();
    });

    test("exportManufacturingStlAttempt returns STL from live viewer geometry", async () => {
        viewerGeometry = makeTestGeometry();
        const { exportManufacturingStlAttempt } = await import("@/lib/geometry/export-geometry");
        const result = await exportManufacturingStlAttempt(mockDesign, "left");
        expect(result).not.toBeNull();
        expect(result!.byteLength).toBeGreaterThan(0);
    });
});
