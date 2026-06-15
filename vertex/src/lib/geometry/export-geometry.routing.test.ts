// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test, beforeEach } from "@rstest/core";
import { BufferAttribute, BufferGeometry } from "three";
import type { DesignState } from "@/types";

const mockExportManufacturingStlFromLiveMesh = rs.fn<(geometry: BufferGeometry) => ArrayBuffer | null>();
const mockEnsureKernelReady = rs.fn<() => Promise<boolean>>();

let viewerGeometry: BufferGeometry | null = null;
let viewerBuilding = false;
let authoritativeKernel = true;

const mockDesign: DesignState = {
    method: "printing_solid",
    thicknessMm: 3,
    corrections: { left: [], right: [] },
    elements: [],
    bases: {
        left: { assetId: "stock-default", source: "stock", glbPath: "Templates/Default.glb" },
    },
} as DesignState;

function makeStlBuffer(byteLength = 256): ArrayBuffer {
    const buffer = new ArrayBuffer(byteLength);
    const view = new Uint8Array(buffer);
    view[80] = 1;
    view[81] = 0;
    view[82] = 0;
    view[83] = 0;
    return buffer;
}

rs.mock("@/stores/design-store", () => ({
    useDesignStore: {
        getState: () => ({ design: mockDesign }),
    },
}));

rs.mock("@/stores/viewer-geometry-store", () => ({
    getLiveViewerGeometry: () => viewerGeometry,
    isViewerGeometryBuilding: () => viewerBuilding,
}));

rs.mock("@/lib/chili3d/kernel", () => ({
    ensureKernelReady: (...args: unknown[]) => mockEnsureKernelReady(...(args as [])),
    getKernel: () => ({
        buildInsole: rs.fn(() => makeTestGeometry()),
        buildInsoleSolid: rs.fn(),
        buildFromBase: rs.fn(),
        exportSTL: rs.fn(),
        exportManufacturingStlFromLiveMesh: (geometry: BufferGeometry) =>
            mockExportManufacturingStlFromLiveMesh(geometry),
    }),
    isAuthoritativeKernel: () => authoritativeKernel,
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
        authoritativeKernel = true;
        mockEnsureKernelReady.mockReset();
        mockEnsureKernelReady.mockResolvedValue(true);
        mockExportManufacturingStlFromLiveMesh.mockReset();
        mockExportManufacturingStlFromLiveMesh.mockReturnValue(makeStlBuffer());
    });

    test("exportModeFromMethod maps manufacturing methods", async () => {
        const { exportModeFromMethod } = await import("@/lib/geometry/export-geometry");
        expect(exportModeFromMethod("printing_solid")).toBe("manufacturing");
        expect(exportModeFromMethod("milling_3axis")).toBe("manufacturing");
        expect(exportModeFromMethod("printing_shell")).toBe("preview");
    });

    test("manufacturing export sends live viewer geometry to OCCT sewing", async () => {
        const live = makeTestGeometry();
        viewerGeometry = live;

        const { buildExportStl } = await import("@/lib/geometry/export-geometry");
        const result = await buildExportStl("left", { exportMode: "manufacturing" });

        expect(mockEnsureKernelReady).toHaveBeenCalledTimes(1);
        expect(mockExportManufacturingStlFromLiveMesh).toHaveBeenCalledTimes(1);
        expect(mockExportManufacturingStlFromLiveMesh).toHaveBeenCalledWith(live);
        expect(result.byteLength).toBeGreaterThan(84);
    });

    test("preview export uses direct STL tessellation without OCCT sewing", async () => {
        const { buildExportStl } = await import("@/lib/geometry/export-geometry");
        const result = await buildExportStl("left", { exportMode: "preview" });

        expect(mockEnsureKernelReady).not.toHaveBeenCalled();
        expect(mockExportManufacturingStlFromLiveMesh).not.toHaveBeenCalled();
        expect(result.byteLength).toBeGreaterThan(84);
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

        expect(mockExportManufacturingStlFromLiveMesh).toHaveBeenCalledTimes(1);
        expect(result.byteLength).toBeGreaterThan(84);
    });

    test("exportManufacturingStlAttempt returns STL from OCCT sewing path", async () => {
        viewerGeometry = makeTestGeometry();
        const { exportManufacturingStlAttempt } = await import("@/lib/geometry/export-geometry");
        const result = await exportManufacturingStlAttempt(mockDesign, "left");
        expect(mockExportManufacturingStlFromLiveMesh).toHaveBeenCalledTimes(1);
        expect(result).not.toBeNull();
        expect(result!.byteLength).toBeGreaterThan(84);
    });

    test("throws ExportOcctSewFailedError when OCCT sewing returns null", async () => {
        mockExportManufacturingStlFromLiveMesh.mockReturnValue(null);
        const { buildExportStl, ExportOcctSewFailedError } = await import("@/lib/geometry/export-geometry");
        await expect(buildExportStl("left", { exportMode: "manufacturing" })).rejects.toBeInstanceOf(
            ExportOcctSewFailedError,
        );
    });
});
