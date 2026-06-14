// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { afterEach, describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry } from "three";

const mockCloseLiveViewerMeshToSolid = rs.fn<(geometry: BufferGeometry) => BufferGeometry>();
const mockSerializeBinarySTL = rs.fn<() => ArrayBuffer>();

let viewerGeometry: BufferGeometry | null = null;
let viewerBuilding = false;

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

rs.mock("@/lib/geometry/mesh-export", () => ({
    closeLiveViewerMeshToSolid: (geometry: BufferGeometry) => mockCloseLiveViewerMeshToSolid(geometry),
    serializeBinarySTL: () => mockSerializeBinarySTL(),
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

rs.mock("@/lib/geometry/bottom-mesh-clean", () => ({
    sealInternalSlits: (geometry: BufferGeometry) => geometry,
    SEAL_MAIN_THREAD_VERTEX_LIMIT: 50_000,
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

describe("export-geometry timeout and seal guards", () => {
    afterEach(() => {
        void import("@/lib/geometry/export-geometry").then((m) => m.setExportTimeoutMsForTesting(null));
    });

    beforeEach(() => {
        viewerGeometry = makeTestGeometry();
        viewerBuilding = false;
        mockCloseLiveViewerMeshToSolid.mockReset();
        mockSerializeBinarySTL.mockReset();
        mockCloseLiveViewerMeshToSolid.mockImplementation((geometry) => geometry);
        mockSerializeBinarySTL.mockReturnValue(new ArrayBuffer(128));
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
        } as ReturnType<typeof kernel.getKernel>);

        const { buildExportStl } = await import("@/lib/geometry/export-geometry");
        await buildExportStl("left", { exportMode: "manufacturing" });

        expect(buildInsoleSolid).not.toHaveBeenCalled();
        expect(buildFromBase).not.toHaveBeenCalled();
    });

    test("export times out gracefully with user-facing message", async () => {
        viewerGeometry = null;
        const baseAsset = await import("@/lib/geometry/base-asset");
        rs.spyOn(baseAsset, "loadBaseGeometry").mockImplementation(() => new Promise(() => undefined));

        const { buildExportStl, ExportTimeoutError, setExportTimeoutMsForTesting } = await import(
            "@/lib/geometry/export-geometry"
        );
        setExportTimeoutMsForTesting(25);

        await expect(buildExportStl("left", { exportMode: "manufacturing" })).rejects.toThrow(
            ExportTimeoutError,
        );
    });

    test("export routes live viewer geometry through mesh-close and serializeBinarySTL", async () => {
        const live = makeTestGeometry();
        viewerGeometry = live;

        const { buildExportStl } = await import("@/lib/geometry/export-geometry");
        const result = await buildExportStl("left", { exportMode: "manufacturing" });

        expect(mockCloseLiveViewerMeshToSolid).toHaveBeenCalled();
        expect(mockSerializeBinarySTL).toHaveBeenCalled();
        expect(result.byteLength).toBeGreaterThan(0);
    });
});
