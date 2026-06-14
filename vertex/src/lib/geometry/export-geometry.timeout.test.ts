// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { afterEach, describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry } from "three";
import type { DesignState } from "@/types";

const mockEnsureKernelReady = rs.fn<() => Promise<boolean>>();
const mockLoadBaseGeometry = rs.fn<() => Promise<BufferGeometry | null>>();
const mockBuildFromBase = rs.fn<
    () => { geometry: BufferGeometry; manifold: { isWatertight: boolean; occtClosed?: boolean } }
>();
const mockGetDesignBase = rs.fn<() => unknown>();
const mockBaseModifierField = rs.fn<() => object>();
const mockSealInternalSlits = rs.fn<(geometry: BufferGeometry) => BufferGeometry>();

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
        exportSTL: () => new ArrayBuffer(84),
        buildInsole: rs.fn(),
        buildInsoleSolid: rs.fn(),
        buildFromBase: mockBuildFromBase,
    }),
    isAuthoritativeKernel: () => true,
    isKernelInitFailed: () => false,
    ensureKernelReady: () => mockEnsureKernelReady(),
}));

rs.mock("@/lib/geometry/mesh-close", () => ({
    ensureWatertightForExport: (geometry: BufferGeometry) => geometry,
    MeshNotWatertightError: class MeshNotWatertightError extends Error {},
}));

rs.mock("@/lib/geometry/bottom-mesh-clean", () => ({
    sealInternalSlits: (geometry: BufferGeometry) => mockSealInternalSlits(geometry),
    sealInternalSlitsSafe: async (geometry: BufferGeometry) => mockSealInternalSlits(geometry),
    SEAL_MAIN_THREAD_VERTEX_LIMIT: 50_000,
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
        mockEnsureKernelReady.mockReset();
        mockLoadBaseGeometry.mockReset();
        mockBuildFromBase.mockReset();
        mockGetDesignBase.mockReset();
        mockBaseModifierField.mockReset();
        mockSealInternalSlits.mockReset();

        mockEnsureKernelReady.mockResolvedValue(true);
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
        mockBuildFromBase.mockImplementation(() => ({
            geometry: makeTestGeometry(),
            manifold: { isWatertight: false, occtClosed: false },
        }));
        mockSealInternalSlits.mockImplementation((geometry) => geometry);
    });

    test("manufacturing export never requests sealBottomSlits or calls sealInternalSlits", async () => {
        const { buildExportStl } = await import("@/lib/geometry/export-geometry");
        await buildExportStl("left", { exportMode: "manufacturing" });

        const loadCalls = mockLoadBaseGeometry.mock.calls as Array<[unknown, { sealBottomSlits?: boolean }?]>;
        expect(loadCalls.length).toBeGreaterThan(0);
        expect(loadCalls.every(([, opts]) => opts?.sealBottomSlits !== true)).toBe(true);
        expect(mockSealInternalSlits).not.toHaveBeenCalled();
    });

    test("export times out gracefully with user-facing message", async () => {
        const { buildExportStl, ExportTimeoutError, setExportTimeoutMsForTesting } = await import(
            "@/lib/geometry/export-geometry"
        );
        setExportTimeoutMsForTesting(25);
        mockLoadBaseGeometry.mockImplementation(() => new Promise(() => undefined));

        await expect(buildExportStl("left", { exportMode: "manufacturing" })).rejects.toThrow(
            ExportTimeoutError,
        );
    });
});
