// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * PR1 lock parity: export STL bytes must stay stable on the mesh-close path and
 * must not touch deferred OCCT init (`ensureKernelReady` / occt-loader).
 *
 * Baseline hashes for PRs 2–5 of the Chili3D removal plan.
 *
 * Harness at pin 8d19ca47: spies `assertClosedSolidAcceptable` so SAMPLE_Top export
 * completes; Default stock uses `loadProductionDefaultGlb` and preview `buildFromBase`
 * clones the scaled mesh for mesh-close parity in CI.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import * as baseAsset from "@/lib/geometry/base-asset";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import { buildInsoleGeometry } from "@/lib/geometry/insole";
import { INSOLE_LENGTH_MM, INSOLE_WIDTH_MM } from "@/lib/geometry/layout";
import { analyzeManifold } from "@/lib/geometry/manifold";
import * as meshClose from "@/lib/geometry/mesh-close";
import { SAMPLE_TOP_PUBLIC_PATH } from "@/lib/geometry/procedural-wall/sample-top-id";
import { resetSampleTopGeometryCache } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { createDesignWithStockPlaceholder, defaultDesign, useDesignStore } from "@/stores/design-store";
import type { DesignBase, DesignState, Side } from "@/types";
import {
    DEFAULT_GLB_FIXTURE_PATH,
    loadProductionDefaultGlb,
} from "../../tests/helpers/load-production-default-glb";

const SAMPLE_TOP_FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");

/** Pinned on chili3d-removal @ 8d19ca47 — update only when export geometry intentionally changes. */
const STL_SHA256 = {
    defaultLeft: "28fdbe3eac13d4615f95606e2270760c8201602d422955601939662cd398d9b9",
    defaultRight: "e63506f7ae4d7b305228269144465aa9b629f8ffda8ad37843ceaaf8dc2c76ca",
    sampleTopLeft: "6c67e279aa33ea15bd6ffb0c9ba8feecee907d73dfdc5eacadda24e09052df14",
    sampleTopRight: "cd57887c45189bce39b0ead2fbcc959e1bdfebe12a11256f05751ff670d76c99",
} as const;

const mockEnsureKernelReady = rs.fn<() => Promise<boolean>>();
const originalLoadBaseGeometry = baseAsset.loadBaseGeometry;

const previewKernel = {
    name: "three-procedural",
    ready: true,
    tier: "preview" as const,
    buildInsole: buildInsoleGeometry,
    buildInsoleSolid(params: Parameters<typeof buildInsoleGeometry>[0]) {
        const geometry = buildInsoleGeometry(params);
        const mesh = analyzeManifold(geometry);
        return {
            geometry,
            manifold: { ...mesh, occtClosed: false, isWatertight: mesh.isWatertight },
        };
    },
    buildFromBase(base: BufferGeometry) {
        const geometry = base.clone();
        const mesh = analyzeManifold(geometry);
        return {
            geometry,
            manifold: { ...mesh, occtClosed: false, isWatertight: mesh.isWatertight },
        };
    },
    exportSTL(geometry: BufferGeometry) {
        return geometryToBinarySTL(geometry);
    },
};

rs.mock("@/lib/chili3d/kernel", () => ({
    getKernel: () => previewKernel,
    isAuthoritativeKernel: () => false,
    isKernelInitFailed: () => false,
    ensureKernelReady: () => mockEnsureKernelReady(),
}));

let ensureKernelReadyCalls = 0;

function sha256Stl(buffer: ArrayBuffer): string {
    return createHash("sha256").update(Buffer.from(buffer)).digest("hex");
}

/** Stock slot that loads committed Default.glb bytes through the export stock path (reorient + mirror). */
function defaultStockBase(side: Side, mirrored: boolean): DesignBase {
    return {
        assetId: "parity-default-stock",
        name: `Default Fixture (${side === "left" ? "Left" : "Right"})`,
        source: "stock",
        glbPath: "Templates/Default-parity.glb",
        url: "/Templates/Default-parity.glb",
        primarySide: "left",
        offlinePlaceholder: true,
        resolutionFallback: true,
        ...(mirrored ? { mirrored: true, mirroredFrom: "parity-default-stock" } : {}),
    };
}

function pairedDesign(leftBase: DesignBase, rightBase: DesignBase): DesignState {
    const template = defaultDesign();
    return {
        ...template,
        method: "printing_solid",
        usMenSize: 9,
        sizeSystem: "us",
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        paired: {
            leftBase,
            rightBase,
            leftThicknessMm: BASE_REFERENCE_THICKNESS_MM,
            rightThicknessMm: BASE_REFERENCE_THICKNESS_MM,
            leftMethod: "printing_solid",
            rightMethod: "printing_solid",
            linked: true,
        },
        base: leftBase,
        customPrefabId: leftBase.assetId,
        customPrefabName: leftBase.name,
    };
}

function installDesign(design: DesignState, wallModel: "legacy" | "procedural"): void {
    useDesignStore.setState({
        design,
        viewer: {
            wallModel,
            wallStyle: "straight",
            deviceType: "desktop",
        },
        stockBaseLoading: false,
        stockBaseResolutionState: "resolved",
    });
}

async function exportStl(side: Side): Promise<ArrayBuffer> {
    const { buildExportStl } = await import("@/lib/geometry/export-geometry");
    return buildExportStl(side, { exportMode: "manufacturing" });
}

async function fetchFixture(url: string): Promise<Response> {
    if (url.includes("Default-parity") || url.includes("Default.glb")) {
        const buf = readFileSync(DEFAULT_GLB_FIXTURE_PATH);
        return new Response(buf, { status: 200, headers: { "Content-Type": "model/gltf-binary" } });
    }
    if (url.includes("SAMPLE_Top") || url === SAMPLE_TOP_PUBLIC_PATH) {
        const buf = readFileSync(SAMPLE_TOP_FIXTURE_PATH);
        return new Response(buf, { status: 200, headers: { "Content-Type": "model/gltf-binary" } });
    }
    throw new Error(`Unexpected fetch in occt-dormant test: ${url}`);
}

describe("occt-dormant export parity (PR1 lock)", () => {
    beforeEach(() => {
        mockEnsureKernelReady.mockReset();
        mockEnsureKernelReady.mockImplementation(async () => {
            ensureKernelReadyCalls += 1;
            return false;
        });
        ensureKernelReadyCalls = 0;
        resetSampleTopGeometryCache();

        rs.spyOn(meshClose, "assertClosedSolidAcceptable").mockImplementation(() => undefined);

        rs.spyOn(baseAsset, "loadBaseGeometry").mockImplementation(async (base, options) => {
            const path = (base.glbPath ?? "").replace(/^\/+/, "");
            if (/(?:^|\/)Default-parity\.glb$/i.test(path)) {
                const slot = base.mirrored ? "right" : "left";
                return loadProductionDefaultGlb({ slot });
            }
            return originalLoadBaseGeometry.call(baseAsset, base, options);
        });

        globalThis.fetch = rs.fn(async (input: RequestInfo | URL) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            return fetchFixture(url);
        }) as typeof fetch;
    });

    afterEach(() => {
        rs.restoreAllMocks();
    });

    test("buildExportStl never calls ensureKernelReady or loads OCCT", async () => {
        installDesign(createDesignWithStockPlaceholder(), "procedural");
        await exportStl("left");
        expect(mockEnsureKernelReady).toHaveBeenCalledTimes(0);
        expect(ensureKernelReadyCalls).toBe(0);
    });

    test("fixed template size 260×95 mm", () => {
        expect(INSOLE_LENGTH_MM).toBe(260);
        expect(INSOLE_WIDTH_MM).toBe(95);
    });

    test("Default.glb STL hashes (left / right)", async () => {
        const left = defaultStockBase("left", false);
        const right = defaultStockBase("right", true);
        installDesign(pairedDesign(left, right), "legacy");

        const leftBuf = await exportStl("left");
        const rightBuf = await exportStl("right");
        expect(ensureKernelReadyCalls).toBe(0);
        expect(mockEnsureKernelReady).toHaveBeenCalledTimes(0);

        const leftHash = sha256Stl(leftBuf);
        const rightHash = sha256Stl(rightBuf);
        expect(leftHash).toBe(STL_SHA256.defaultLeft);
        expect(rightHash).toBe(STL_SHA256.defaultRight);

        expect(leftHash).toBe(sha256Stl(leftBuf));
        expect(rightHash).toBe(sha256Stl(rightBuf));
    });

    test("SAMPLE_Top procedural STL hashes (left / right)", async () => {
        installDesign(createDesignWithStockPlaceholder(), "procedural");

        const leftBuf = await exportStl("left");
        const rightBuf = await exportStl("right");
        expect(ensureKernelReadyCalls).toBe(0);
        expect(mockEnsureKernelReady).toHaveBeenCalledTimes(0);

        const leftHash = sha256Stl(leftBuf);
        const rightHash = sha256Stl(rightBuf);
        expect(leftHash).toBe(STL_SHA256.sampleTopLeft);
        expect(rightHash).toBe(STL_SHA256.sampleTopRight);

        expect(leftHash).toBe(sha256Stl(leftBuf));
        expect(rightHash).toBe(sha256Stl(rightBuf));
    });

    test("Default.glb fixture path is the committed production template", () => {
        expect(DEFAULT_GLB_FIXTURE_PATH).toMatch(/tests\/fixtures\/Default\.glb$/);
    });
});
