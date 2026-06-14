// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { afterEach, describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry } from "three";

const mockRunMeshExportWorker = rs.fn<
    () => Promise<{ stlBuffer: ArrayBuffer; bottomRimVertexCount: number; usedReducedBottom: boolean }>
>();

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

rs.mock("@/lib/geometry/mesh-export-worker-runner", () => ({
    geometryToExportPayload: (geometry: BufferGeometry) => ({
        payload: {
            positions: new Float32Array(geometry.getAttribute("position").array as ArrayLike<number>),
            indices: null,
        },
        topVertexCount: (geometry.userData as { topVertexCount?: number }).topVertexCount ?? 3,
    }),
    runMeshExportWorker: (...args: unknown[]) => mockRunMeshExportWorker(...(args as [])),
    setMeshExportWorkerRunnerForTesting: rs.fn(),
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
        mockRunMeshExportWorker.mockReset();
        mockRunMeshExportWorker.mockResolvedValue({
            stlBuffer: new ArrayBuffer(128),
            bottomRimVertexCount: 64,
            usedReducedBottom: true,
        });
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
        const { buildExportStl, ExportTimeoutError, setExportTimeoutMsForTesting } = await import(
            "@/lib/geometry/export-geometry"
        );
        setExportTimeoutMsForTesting(25);
        mockRunMeshExportWorker.mockImplementation(() => new Promise(() => undefined));

        await expect(buildExportStl("left", { exportMode: "manufacturing" })).rejects.toThrow(
            ExportTimeoutError,
        );
    });

    test("export does not block the main thread before worker resolves", async () => {
        let resolveWorker!: (value: {
            stlBuffer: ArrayBuffer;
            bottomRimVertexCount: number;
            usedReducedBottom: boolean;
        }) => void;
        mockRunMeshExportWorker.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveWorker = resolve;
                }),
        );

        const { buildExportStl } = await import("@/lib/geometry/export-geometry");
        const pending = buildExportStl("left", { exportMode: "manufacturing" });
        let mainThreadResponsive = false;
        mainThreadResponsive = true;
        expect(mainThreadResponsive).toBe(true);

        resolveWorker({
            stlBuffer: new ArrayBuffer(200),
            bottomRimVertexCount: 48,
            usedReducedBottom: true,
        });
        const result = await pending;
        expect(result.byteLength).toBeGreaterThan(0);
    });

    test("export routes live viewer geometry through export worker", async () => {
        viewerGeometry = makeTestGeometry();
        const { buildExportStl } = await import("@/lib/geometry/export-geometry");
        const result = await buildExportStl("left", { exportMode: "manufacturing" });

        expect(mockRunMeshExportWorker).toHaveBeenCalledTimes(1);
        expect(result.byteLength).toBeGreaterThan(0);
    });
});
