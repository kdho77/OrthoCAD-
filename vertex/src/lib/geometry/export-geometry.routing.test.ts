// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { beforeEach, describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry } from "three";
import type { DesignState } from "@/types";

const mockExportManufacturingStlFromBase = rs.fn<() => ArrayBuffer | null>();
const mockCloseGlbInsoleToSolid = rs.fn<(geometry: BufferGeometry) => BufferGeometry>();
const mockGeometryToBinarySTL = rs.fn<(geometry: BufferGeometry) => ArrayBuffer>();
const mockLoadBaseGeometry = rs.fn<() => Promise<BufferGeometry | null>>();
const mockBuildInsoleSolid = rs.fn<() => never>();
const mockBuildFromBase = rs.fn<() => { geometry: BufferGeometry; manifold: { isWatertight: boolean } }>();
const mockGetDesignBase = rs.fn<() => unknown>();
const mockBaseModifierField = rs.fn<() => object>();

const mockAssertClosed = rs.fn();
const mockProcedural = rs.fn<() => boolean>();
const mockProceduralBuild = rs.fn<(options: unknown) => Promise<{ geometry: BufferGeometry }>>();
const mockDraftPattern = rs.fn();
const mockStoredPattern = rs.fn();
const mockDraftTrim = rs.fn();

rs.mock("@/lib/geometry/procedural-wall/preview-loft-ui", () => ({
    wantsProceduralExportSolid: () => mockProcedural(),
}));
rs.mock("@/lib/geometry/procedural-wall/sample-top-preview", () => ({
    buildProceduralExportSolid: (options: unknown) => mockProceduralBuild(options),
}));
rs.mock("@/stores/mesh-edit-store", () => ({
    useMeshEditStore: {
        getState: () => ({
            getActiveDraftBottomPattern: mockDraftPattern,
            getActiveDraftTrimline: mockDraftTrim,
        }),
    },
}));
rs.mock("@/stores/bottom-pattern-store", () => ({
    useBottomPatternStore: { getState: () => ({ getPattern: mockStoredPattern }) },
    curveToPolyPoints: (curve: { points: unknown[] }) => curve.points,
}));

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

rs.mock("@/lib/geometry/geometry-kernel", () => ({
    getKernel: () => ({
        name: "three-procedural",
        tier: "preview",
        ready: true,
        exportManufacturingStlFromBase: mockExportManufacturingStlFromBase,
        exportSTL: () => new ArrayBuffer(84),
        buildInsole: rs.fn(),
        buildInsoleSolid: mockBuildInsoleSolid,
        buildFromBase: mockBuildFromBase,
    }),
    isAuthoritativeKernel: () => false,
}));

rs.mock("@/lib/geometry/mesh-close", () => ({
    closeGlbInsoleToSolid: (geometry: BufferGeometry) => mockCloseGlbInsoleToSolid(geometry),
    assertClosedSolidAcceptable: (...args: unknown[]) => mockAssertClosed(...args),
    DEFAULT_GLB_CLOSED_BASELINE: { eulerCharacteristic: 3, heelBridgeSelfIntersections: 0 },
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
    geometry.setAttribute("position", new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
    geometry.setIndex([0, 1, 2]);
    geometry.userData = { isMultiMeshBase: true, topVertexCount: 3 };
    return geometry;
}

describe("export-geometry routing", () => {
    beforeEach(() => {
        mockAssertClosed.mockReset();
        mockProcedural.mockReturnValue(false);
        mockProceduralBuild.mockImplementation(async () => ({ geometry: makeTestGeometry() }));
        mockDraftPattern.mockReturnValue(null);
        mockStoredPattern.mockReturnValue(null);
        mockDraftTrim.mockReturnValue(null);
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
            manifold: { isWatertight: false, solidClosed: false },
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

    test("manufacturing STL uses GLB rim-close and does not call a B-rep sew export", async () => {
        const closedGeo = makeTestGeometry();
        mockCloseGlbInsoleToSolid.mockReturnValue(closedGeo);
        const stlBytes = new ArrayBuffer(96);
        mockGeometryToBinarySTL.mockReturnValue(stlBytes);

        const { buildExportStl } = await import("@/lib/geometry/export-geometry");
        const result = await buildExportStl("left", { exportMode: "manufacturing" });

        expect(mockExportManufacturingStlFromBase).not.toHaveBeenCalled();
        expect(mockCloseGlbInsoleToSolid).toHaveBeenCalledTimes(1);
        expect(mockGeometryToBinarySTL).toHaveBeenCalledWith(closedGeo);
        expect(result).toBe(stlBytes);
    });

    test("procedural export composes the complete field and prefers live edit outlines", async () => {
        mockProcedural.mockReturnValue(true);
        const pattern = {
            points: [
                { x: 0, y: 0, z: 0 },
                { x: 2, y: 0, z: 0 },
                { x: 0, y: 2, z: 0 },
            ],
        };
        const trimline = { points: pattern.points };
        mockDraftPattern.mockReturnValue(pattern);
        mockStoredPattern.mockReturnValue({ points: [] });
        mockDraftTrim.mockReturnValue(trimline);
        const { buildExportStl } = await import("@/lib/geometry/export-geometry");
        await buildExportStl("left");
        expect(mockProceduralBuild).toHaveBeenCalledWith(
            expect.objectContaining({
                sourceField: expect.objectContaining({ includeElements: true, includeSkives: true }),
                composedTop: true,
                shoeWidth: expect.objectContaining({ width: "medium" }),
                trimline,
                bottomPattern: pattern.points,
                lateralFlange: { heightMm: 0, lengthMm: 40, angleDeg: 10 },
                side: "left",
            }),
        );
    });

    test("validation and STL both reject the real procedural build failure", async () => {
        mockProcedural.mockReturnValue(true);
        mockProceduralBuild.mockRejectedValue(new Error("[S1-PATTERN] outside the TopSheet rim"));
        const { buildExportStl, buildValidatedExportGeometry } = await import(
            "@/lib/geometry/export-geometry"
        );
        await expect(buildValidatedExportGeometry("left")).rejects.toThrow("outside the TopSheet rim");
        await expect(buildExportStl("left")).rejects.toThrow("outside the TopSheet rim");
        expect(mockGeometryToBinarySTL).not.toHaveBeenCalled();
    });

    test("procedural top metadata uses Euler 2 while legacy Default retains Euler 3", async () => {
        const { buildExportStl } = await import("@/lib/geometry/export-geometry");
        const procedural = makeTestGeometry();
        procedural.userData.wallModel = "procedural";
        mockCloseGlbInsoleToSolid.mockReturnValue(procedural);
        await buildExportStl("left");
        expect(mockAssertClosed).toHaveBeenLastCalledWith(procedural, 3, {
            eulerCharacteristic: 2,
            heelBridgeSelfIntersections: 0,
        });
        const legacy = makeTestGeometry();
        mockCloseGlbInsoleToSolid.mockReturnValue(legacy);
        await buildExportStl("left");
        expect(mockAssertClosed).toHaveBeenLastCalledWith(legacy, 3, {
            eulerCharacteristic: 3,
            heelBridgeSelfIntersections: 0,
        });
    });

    test("GLB download path does not call closeGlbInsoleToSolid", async () => {
        const { buildExportGlb } = await import("@/lib/geometry/export-geometry");
        await buildExportGlb("left");
        expect(mockCloseGlbInsoleToSolid).not.toHaveBeenCalled();
    });
});
