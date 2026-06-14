// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test, beforeEach } from "@rstest/core";
import { BufferAttribute, BufferGeometry } from "three";
import type { DesignState } from "@/types";

const mockRunMeshExportWorker = rs.fn<
    () => Promise<{ stlBuffer: ArrayBuffer; bottomRimVertexCount: number; usedReducedBottom: boolean }>
>();

let viewerGeometry: BufferGeometry | null = null;
let viewerBuilding = false;

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

rs.mock("@/stores/viewer-geometry-store", () => ({
    getLiveViewerGeometry: () => viewerGeometry,
    isViewerGeometryBuilding: () => viewerBuilding,
}));

rs.mock("@/lib/geometry/mesh-export-worker-runner", () => ({
    geometryToExportPayload: (geometry: BufferGeometry) => ({
        payload: {
            positions: new Float32Array(geometry.getAttribute("position").array as ArrayLike<number>),
            indices: geometry.getIndex()
                ? new Uint32Array(geometry.getIndex()!.array as ArrayLike<number>)
                : null,
        },
        topVertexCount: (geometry.userData as { topVertexCount?: number }).topVertexCount ?? geometry.getAttribute("position").count,
    }),
    runMeshExportWorker: (...args: unknown[]) => mockRunMeshExportWorker(...(args as [])),
    setMeshExportWorkerRunnerForTesting: rs.fn(),
}));

rs.mock("@/lib/geometry/mesh-close", () => ({
    ensureWatertightForExport: (geometry: BufferGeometry) => geometry,
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
        mockRunMeshExportWorker.mockReset();
        mockRunMeshExportWorker.mockResolvedValue({
            stlBuffer: new ArrayBuffer(256),
            bottomRimVertexCount: 128,
            usedReducedBottom: true,
        });
    });

    test("exportModeFromMethod maps manufacturing methods", async () => {
        const { exportModeFromMethod } = await import("@/lib/geometry/export-geometry");
        expect(exportModeFromMethod("printing_solid")).toBe("manufacturing");
        expect(exportModeFromMethod("milling_3axis")).toBe("manufacturing");
        expect(exportModeFromMethod("printing_shell")).toBe("preview");
    });

    test("manufacturing export posts live viewer geometry to export worker", async () => {
        const live = makeTestGeometry();
        viewerGeometry = live;

        const { buildExportStl } = await import("@/lib/geometry/export-geometry");
        const result = await buildExportStl("left", { exportMode: "manufacturing" });

        expect(mockRunMeshExportWorker).toHaveBeenCalledTimes(1);
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

        expect(mockRunMeshExportWorker).toHaveBeenCalledTimes(1);
        expect(result.byteLength).toBeGreaterThan(0);
    });

    test("exportManufacturingStlAttempt returns STL from worker path", async () => {
        viewerGeometry = makeTestGeometry();
        const { exportManufacturingStlAttempt } = await import("@/lib/geometry/export-geometry");
        const result = await exportManufacturingStlAttempt(mockDesign, "left");
        expect(mockRunMeshExportWorker).toHaveBeenCalledTimes(1);
        expect(result).not.toBeNull();
        expect(result!.byteLength).toBeGreaterThan(0);
    });
});
