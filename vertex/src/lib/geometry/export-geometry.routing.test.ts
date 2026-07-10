// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test, beforeEach } from "@rstest/core";
import { BufferAttribute, BufferGeometry } from "three";
import type { DesignState } from "@/types";

const mockEnsureKernelReady = rs.fn<() => Promise<boolean>>();
const mockExportManufacturingStlFromBase = rs.fn<() => ArrayBuffer | null>();
const mockCloseGlbInsoleToSolid = rs.fn<(geometry: BufferGeometry) => BufferGeometry>();
const mockGeometryToBinarySTL = rs.fn<(geometry: BufferGeometry) => ArrayBuffer>();
const mockLoadBaseGeometry = rs.fn<() => Promise<BufferGeometry | null>>();
const mockBuildInsoleSolid = rs.fn<() => never>();
const mockBuildFromBase = rs.fn<() => { geometry: BufferGeometry; manifold: { isWatertight: boolean } }>();
const mockGetDesignBase = rs.fn<() => unknown>();
const mockBaseModifierField = rs.fn<() => object>();

const mockDesign: DesignState = {
    method: "printing_solid",
    thicknessMm: 3,
    corrections: { left: [], right: [] },
    elements: [],
    bases: {
        left: { assetId: "stock-default", source: "stock", glbPath: "Templates/Default.glb" },
    },
} as DesignState;

rs.mock("@/stores/design-store", () => ({
    useDesignStore: {
        getState: () => ({ design: mockDesign }),
    },
}));

rs.mock("@/lib/chili3d/kernel", () => ({
    getKernel: () => ({
        name: "opencascade-wasm",
        tier: "authoritative",
        ready: true,
        exportManufacturingStlFromBase: mockExportManufacturingStlFromBase,
        exportSTL: () => new ArrayBuffer(84),
        buildInsole: rs.fn(),
        buildInsoleSolid: mockBuildInsoleSolid,
        buildFromBase: mockBuildFromBase,
    }),
    isAuthoritativeKernel: () => true,
    isKernelInitFailed: () => false,
    ensureKernelReady: () => mockEnsureKernelReady(),
}));

rs.mock("@/lib/geometry/mesh-close", () => ({
    closeGlbInsoleToSolid: (geometry: BufferGeometry) => mockCloseGlbInsoleToSolid(geometry),
    assertClosedSolidAcceptable: () => undefined,
    DEFAULT_GLB_CLOSED_BASELINE: { eulerCharacteristic: 3, heelBridgeSelfIntersections: 249 },
    MeshNotWatertightError: class MeshNotWatertightError extends Error {},
}));

rs.mock("@/lib/geometry/stl", () => ({
    geometryToBinarySTL: (geometry: BufferGeometry) => mockGeometryToBinarySTL(geometry),
}));

rs.mock("@/lib/geometry/base-asset", () => ({
    getDesignBase: () => mockGetDesignBase(),
    loadBaseGeometry: () => mockLoadBaseGeometry(),
    baseModifierFieldAuthoritative: () => mockBaseModifierField(),
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
    isOcctKernelActive: () => true,
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
        mockEnsureKernelReady.mockReset();
        mockEnsureKernelReady.mockResolvedValue(true);
        mockExportManufacturingStlFromBase.mockReset();
        mockCloseGlbInsoleToSolid.mockReset();
        mockGeometryToBinarySTL.mockReset();
        mockLoadBaseGeometry.mockReset();
        mockBuildInsoleSolid.mockReset();
        mockBuildFromBase.mockReset();
        mockGetDesignBase.mockReset();
        mockBaseModifierField.mockReset();

        mockGetDesignBase.mockReturnValue(mockDesign.bases?.left ?? null);
        mockBaseModifierField.mockReturnValue({
            side: "left",
            lengthMm: 260,
            widthMm: 90,
            thicknessMm: 3,
            corrections: [],
            elements: [],
            includeSkives: true,
            includeElements: true,
            trimline: null,
        });
        mockLoadBaseGeometry.mockImplementation(async () => makeTestGeometry());
        mockBuildInsoleSolid.mockImplementation(() => {
            throw new Error("skip insole solid");
        });
        mockBuildFromBase.mockImplementation(() => ({
            geometry: makeTestGeometry(),
            manifold: { isWatertight: false, occtClosed: false },
        }));
        mockCloseGlbInsoleToSolid.mockImplementation((geometry) => geometry);
        mockGeometryToBinarySTL.mockImplementation(() => new ArrayBuffer(84));
    });

    test("exportModeFromMethod maps manufacturing methods", async () => {
        const { exportModeFromMethod } = await import("@/lib/geometry/export-geometry");
        expect(exportModeFromMethod("printing_solid")).toBe("manufacturing");
        expect(exportModeFromMethod("milling_3axis")).toBe("manufacturing");
        expect(exportModeFromMethod("printing_shell")).toBe("preview");
    });

    test("Printing Solid export uses OCCT path", async () => {
        const occtBytes = new ArrayBuffer(128);
        mockExportManufacturingStlFromBase.mockReturnValue(occtBytes);

        const { buildExportStl } = await import("@/lib/geometry/export-geometry");
        const result = await buildExportStl("left", { exportMode: "manufacturing" });

        expect(mockExportManufacturingStlFromBase).toHaveBeenCalledTimes(1);
        expect(mockCloseGlbInsoleToSolid).not.toHaveBeenCalled();
        expect(result).toBe(occtBytes);
    });

    test("OCCT path failure falls back to GLB rim-close", async () => {
        mockExportManufacturingStlFromBase.mockReturnValue(null);
        const closedGeo = makeTestGeometry();
        mockCloseGlbInsoleToSolid.mockReturnValue(closedGeo);
        const stlBytes = new ArrayBuffer(96);
        mockGeometryToBinarySTL.mockReturnValue(stlBytes);

        const { buildExportStl } = await import("@/lib/geometry/export-geometry");
        const result = await buildExportStl("left", { exportMode: "manufacturing" });

        expect(mockExportManufacturingStlFromBase).toHaveBeenCalledTimes(1);
        expect(mockCloseGlbInsoleToSolid).toHaveBeenCalledTimes(1);
        expect(mockGeometryToBinarySTL).toHaveBeenCalledWith(closedGeo);
        expect(result).toBe(stlBytes);
    });

    test("GLB download path does not call closeGlbInsoleToSolid", async () => {
        const { buildExportGlb } = await import("@/lib/geometry/export-geometry");
        await buildExportGlb("left");
        expect(mockCloseGlbInsoleToSolid).not.toHaveBeenCalled();
    });

    test("exportManufacturingStlAttempt returns null without a loaded base design", async () => {
        mockGetDesignBase.mockReturnValue(null);
        const { exportManufacturingStlAttempt } = await import("@/lib/geometry/export-geometry");
        const result = await exportManufacturingStlAttempt(mockDesign, "left");
        expect(result).toBeNull();
    });
});
