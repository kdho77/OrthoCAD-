// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { afterEach, describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry } from "three";

const mockExportManufacturingStlFromLiveMesh = rs.fn<(geometry: BufferGeometry) => ArrayBuffer | null>();
const mockEnsureKernelReady = rs.fn<() => Promise<boolean>>();

let viewerGeometry: BufferGeometry | null = null;
let viewerBuilding = false;

function makeStlBuffer(byteLength = 256): ArrayBuffer {
    const buffer = new ArrayBuffer(byteLength);
    const view = new Uint8Array(buffer);
    view[80] = 1;
    return buffer;
}

rs.mock("@/stores/design-store", () => ({
    useDesignStore: {
        getState: () => ({
            design: {
                method: "printing_solid",
                thicknessMm: 3,
                corrections: { left: [], right: [] },
                elements: [],
                bases: {
                    left: { assetId: "stock-default", source: "stock", glbPath: "Templates/Default.glb" },
                },
            },
        }),
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
    isAuthoritativeKernel: () => true,
}));

rs.mock("@/lib/geometry/base-asset", () => ({
    getDesignBase: () => ({ assetId: "stock-default" }),
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

describe("export-geometry timeout and OCCT guards", () => {
    afterEach(() => {
        void import("@/lib/geometry/export-geometry").then((m) => m.setExportTimeoutMsForTesting(null));
    });

    beforeEach(() => {
        viewerGeometry = makeTestGeometry();
        viewerBuilding = false;
        mockEnsureKernelReady.mockReset();
        mockEnsureKernelReady.mockResolvedValue(true);
        mockExportManufacturingStlFromLiveMesh.mockReset();
        mockExportManufacturingStlFromLiveMesh.mockReturnValue(makeStlBuffer());
    });

    test("manufacturing export never calls buildInsoleSolid or buildFromBase", async () => {
        const kernel = await import("@/lib/chili3d/kernel");
        const buildInsoleSolid = rs.fn();
        const buildFromBase = rs.fn();
        rs.spyOn(kernel, "getKernel").mockReturnValue({
            buildInsole: rs.fn(),
            buildInsoleSolid,
            buildFromBase,
            exportSTL: rs.fn(),
            exportManufacturingStlFromLiveMesh: (geometry: BufferGeometry) =>
                mockExportManufacturingStlFromLiveMesh(geometry),
        } as ReturnType<typeof kernel.getKernel>);

        const { buildExportStl } = await import("@/lib/geometry/export-geometry");
        await buildExportStl("left", { exportMode: "manufacturing" });

        expect(buildInsoleSolid).not.toHaveBeenCalled();
        expect(buildFromBase).not.toHaveBeenCalled();
    });

    test("export times out gracefully when kernel init hangs", async () => {
        const { buildExportStl, ExportTimeoutError, setExportTimeoutMsForTesting } = await import(
            "@/lib/geometry/export-geometry"
        );
        setExportTimeoutMsForTesting(25);
        mockEnsureKernelReady.mockImplementation(() => new Promise(() => undefined));

        await expect(buildExportStl("left", { exportMode: "manufacturing" })).rejects.toThrow(
            ExportTimeoutError,
        );
    });

    test("manufacturing export resolves when OCCT sewing returns STL bytes", async () => {
        const { buildExportStl } = await import("@/lib/geometry/export-geometry");
        const result = await buildExportStl("left", { exportMode: "manufacturing" });
        expect(mockExportManufacturingStlFromLiveMesh).toHaveBeenCalledTimes(1);
        expect(result.byteLength).toBeGreaterThan(84);
    });

    test("export routes live viewer geometry through OCCT sewing", async () => {
        viewerGeometry = makeTestGeometry();
        const { buildExportStl } = await import("@/lib/geometry/export-geometry");
        const result = await buildExportStl("left", { exportMode: "manufacturing" });

        expect(mockExportManufacturingStlFromLiveMesh).toHaveBeenCalledTimes(1);
        expect(result.byteLength).toBeGreaterThan(84);
    });
});
