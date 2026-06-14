// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test, beforeEach } from "@rstest/core";
import { BufferAttribute, BufferGeometry } from "three";
import type { DesignState } from "@/types";

const mockEnsureKernelReady = rs.fn<() => Promise<boolean>>();
const mockExportSTL = rs.fn<() => ArrayBuffer>();
const mockExportManufacturingStlFromBase = rs.fn<() => ArrayBuffer | null>();
const mockEnsureWatertight = rs.fn<(geometry: BufferGeometry) => BufferGeometry>();
const mockLoadBaseGeometry = rs.fn<() => Promise<BufferGeometry | null>>();
const mockBuildInsoleSolid = rs.fn<
    () => { geometry: BufferGeometry; manifold: { isWatertight: boolean; occtClosed?: boolean } }
>();
const mockBuildFromBase = rs.fn<
    () => { geometry: BufferGeometry; manifold: { isWatertight: boolean; occtClosed?: boolean } }
>();
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
        exportSTL: (geometry: BufferGeometry) => mockExportSTL(geometry),
        buildInsole: rs.fn(),
        buildInsoleSolid: mockBuildInsoleSolid,
        buildFromBase: mockBuildFromBase,
    }),
    isAuthoritativeKernel: () => true,
    isKernelInitFailed: () => false,
    ensureKernelReady: () => mockEnsureKernelReady(),
}));

rs.mock("@/lib/geometry/mesh-close", () => ({
    ensureWatertightForExport: (geometry: BufferGeometry) => mockEnsureWatertight(geometry),
    MeshNotWatertightError: class MeshNotWatertightError extends Error {},
}));

rs.mock("@/lib/geometry/base-asset", () => ({
    getDesignBase: () => mockGetDesignBase(),
    loadBaseGeometry: (...args: unknown[]) => mockLoadBaseGeometry(...(args as [])),
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

function mockWatertightSolid() {
    const geometry = makeTestGeometry();
    return {
        geometry,
        manifold: { isWatertight: true, occtClosed: true, triangleCount: 1975, openEdges: 0 },
    };
}

describe("export-geometry routing", () => {
    beforeEach(() => {
        mockEnsureKernelReady.mockReset();
        mockExportSTL.mockReset();
        mockExportManufacturingStlFromBase.mockReset();
        mockEnsureWatertight.mockReset();
        mockLoadBaseGeometry.mockReset();
        mockBuildInsoleSolid.mockReset();
        mockBuildFromBase.mockReset();
        mockGetDesignBase.mockReset();
        mockBaseModifierField.mockReset();

        mockEnsureKernelReady.mockResolvedValue(true);
        mockExportSTL.mockReturnValue(new ArrayBuffer(84));
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
        mockBuildInsoleSolid.mockImplementation(() => mockWatertightSolid());
        mockBuildFromBase.mockImplementation(() => ({
            geometry: makeTestGeometry(),
            manifold: { isWatertight: false, occtClosed: false },
        }));
        mockEnsureWatertight.mockImplementation((geometry) => geometry);
    });

    test("exportModeFromMethod maps manufacturing methods", async () => {
        const { exportModeFromMethod } = await import("@/lib/geometry/export-geometry");
        expect(exportModeFromMethod("printing_solid")).toBe("manufacturing");
        expect(exportModeFromMethod("milling_3axis")).toBe("manufacturing");
        expect(exportModeFromMethod("printing_shell")).toBe("preview");
    });

    test("Printing Solid export uses buildInsoleSolid and exportSTL without mesh-close", async () => {
        const solid = mockWatertightSolid();
        mockBuildInsoleSolid.mockImplementation(() => solid);

        const { buildExportStl } = await import("@/lib/geometry/export-geometry");
        const result = await buildExportStl("left", { exportMode: "manufacturing" });

        expect(mockBuildInsoleSolid).toHaveBeenCalledTimes(1);
        expect(mockBuildFromBase).not.toHaveBeenCalled();
        expect(mockLoadBaseGeometry).not.toHaveBeenCalled();
        expect(mockExportSTL).toHaveBeenCalledWith(solid.geometry);
        expect(mockExportManufacturingStlFromBase).not.toHaveBeenCalled();
        expect(mockEnsureWatertight).not.toHaveBeenCalled();
        expect(result.byteLength).toBeGreaterThan(0);
    });

    test("manufacturing export never loads GLB or enables sealBottomSlits", async () => {
        const { buildExportStl } = await import("@/lib/geometry/export-geometry");
        const result = await buildExportStl("left", { exportMode: "manufacturing" });

        expect(mockBuildInsoleSolid).toHaveBeenCalledTimes(1);
        expect(mockLoadBaseGeometry).not.toHaveBeenCalled();
        expect(mockBuildFromBase).not.toHaveBeenCalled();
        expect(mockEnsureWatertight).not.toHaveBeenCalled();
        expect(result.byteLength).toBeGreaterThan(0);
    });

    test("throws ExportKernelUnavailableError when buildInsoleSolid is not watertight", async () => {
        mockBuildInsoleSolid.mockImplementation(() => ({
            geometry: makeTestGeometry(),
            manifold: { isWatertight: false, occtClosed: false },
        }));

        const { buildExportStl, ExportKernelUnavailableError } = await import("@/lib/geometry/export-geometry");
        await expect(buildExportStl("left", { exportMode: "manufacturing" })).rejects.toBeInstanceOf(
            ExportKernelUnavailableError,
        );
    });

    test("throws ExportKernelUnavailableError when OCCT kernel init failed", async () => {
        const kernel = await import("@/lib/chili3d/kernel");
        const spy = rs.spyOn(kernel, "isKernelInitFailed").mockReturnValue(true);

        try {
            const { buildExportStl, ExportKernelUnavailableError } = await import("@/lib/geometry/export-geometry");
            await expect(buildExportStl("left", { exportMode: "manufacturing" })).rejects.toBeInstanceOf(
                ExportKernelUnavailableError,
            );
        } finally {
            spy.mockRestore();
        }
    });

    test("GLB download path does not call ensureWatertightForExport", async () => {
        const { buildExportGlb } = await import("@/lib/geometry/export-geometry");
        await buildExportGlb("left");
        expect(mockEnsureWatertight).not.toHaveBeenCalled();
    });

    test("exportManufacturingStlAttempt returns STL via buildInsoleSolid without requiring base GLB", async () => {
        mockGetDesignBase.mockReturnValue(null);
        const { exportManufacturingStlAttempt } = await import("@/lib/geometry/export-geometry");
        const result = await exportManufacturingStlAttempt(mockDesign, "left");
        expect(mockBuildInsoleSolid).toHaveBeenCalledTimes(1);
        expect(result).not.toBeNull();
        expect(result!.byteLength).toBeGreaterThan(0);
    });
});
