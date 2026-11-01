// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import * as baseAsset from "@/lib/geometry/base-asset";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import { buildInsoleGeometry } from "@/lib/geometry/insole";
import { analyzeManifold } from "@/lib/geometry/manifold";
import * as meshClose from "@/lib/geometry/mesh-close";
import { SAMPLE_TOP_PUBLIC_PATH } from "@/lib/geometry/procedural-wall/sample-top-id";
import { resetSampleTopGeometryCache } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import { createDesignWithStockPlaceholder, defaultDesign, useDesignStore } from "@/stores/design-store";
import type { DesignState, Side } from "@/types";
import { DEFAULT_GLB_FIXTURE_PATH, loadProductionDefaultGlb } from "./helpers/load-production-default-glb";

const SAMPLE_TOP_FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");
const HASH_FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/baseline-default-export-hashes.json");

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
            manifold: { ...mesh, solidClosed: false, isWatertight: mesh.isWatertight },
        };
    },
    buildFromBase(base: BufferGeometry) {
        const geometry = base.clone();
        const mesh = analyzeManifold(geometry);
        return {
            geometry,
            manifold: { ...mesh, solidClosed: false, isWatertight: mesh.isWatertight },
        };
    },
    async exportSTL(geometry: BufferGeometry) {
        const { geometryToBinarySTL } = await import("@/lib/geometry/stl");
        return geometryToBinarySTL(geometry);
    },
};

rs.mock("@/lib/geometry/geometry-kernel", () => ({
    getKernel: () => previewKernel,
    isAuthoritativeKernel: () => false,
    isKernelInitFailed: () => false,
    ensureKernelReady: () => mockEnsureKernelReady(),
}));

function sha256Stl(buffer: ArrayBuffer): string {
    return createHash("sha256").update(Buffer.from(buffer)).digest("hex");
}

function designAtUsMenSize(usMen: number): DesignState {
    const layout = insoleLayoutForUsMenSize(usMen);
    return createDesignWithStockPlaceholder({
        ...defaultDesign(),
        method: "printing_solid",
        sizeSystem: "us",
        usMenSize: layout.usMenSize,
        footLengthMm: layout.footLengthMm,
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
    });
}

function installDesign(design: DesignState): void {
    useDesignStore.setState({
        design,
        viewer: {
            wallModel: "procedural",
            wallStyle: "straight",
            deviceType: "desktop",
            transparent: false,
            heightmap: false,
            showLeft: true,
            showRight: true,
            showScans: true,
            view: "iso",
        },
        stockBaseLoading: false,
        stockBaseResolutionState: "resolved",
    });
}

async function exportStl(side: Side): Promise<ArrayBuffer> {
    const { buildExportStl } = await import("@/lib/geometry/export-geometry");
    return buildExportStl(side, { exportMode: "manufacturing" });
}

type HashFixture = {
    gitMainRef: string;
    sizesUsMen: Record<string, { left: string; right: string }>;
};

describe("one-click baseline STL parity (default design, no generation)", () => {
    test("documents main pin commit", () => {
        const pinned = JSON.parse(readFileSync(HASH_FIXTURE_PATH, "utf8")) as HashFixture;
        expect(pinned.gitMainRef).toMatch(/^[0-9a-f]{7,40}$/);
    });

    beforeEach(() => {
        mockEnsureKernelReady.mockReset();
        mockEnsureKernelReady.mockResolvedValue(false);
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
            if (url.includes("Default-parity") || url.includes("Default.glb")) {
                const buf = readFileSync(DEFAULT_GLB_FIXTURE_PATH);
                return new Response(buf, { status: 200, headers: { "Content-Type": "model/gltf-binary" } });
            }
            if (url.includes("SAMPLE_Top") || url === SAMPLE_TOP_PUBLIC_PATH) {
                const buf = readFileSync(SAMPLE_TOP_FIXTURE_PATH);
                return new Response(buf, { status: 200, headers: { "Content-Type": "model/gltf-binary" } });
            }
            throw new Error(`Unexpected fetch: ${url}`);
        }) as typeof fetch;
    });

    afterEach(() => {
        rs.restoreAllMocks();
    });

    test("branch export matches main-pinned hashes (US 8–11, L+R)", async () => {
        const pinned = JSON.parse(readFileSync(HASH_FIXTURE_PATH, "utf8")) as HashFixture;
        const sizes = [8, 9, 10, 11] as const;
        const computed: HashFixture["sizesUsMen"] = {};

        for (const us of sizes) {
            installDesign(designAtUsMenSize(us));
            const leftBuf = await exportStl("left");
            const rightBuf = await exportStl("right");
            computed[String(us)] = {
                left: sha256Stl(leftBuf),
                right: sha256Stl(rightBuf),
            };
        }

        if (process.env.UPDATE_BASELINE === "1") {
            writeFileSync(
                HASH_FIXTURE_PATH,
                `${JSON.stringify({ gitMainRef: "53ebd8e5", wallModel: "procedural", wallStyle: "straight", sizesUsMen: computed }, null, 4)}\n`,
            );
        }

        for (const us of sizes) {
            const key = String(us);
            const expectRow = pinned.sizesUsMen[key];
            expect(expectRow, `missing pins for US ${key}`).toBeTruthy();
            if (!expectRow) continue;
            for (const side of ["left", "right"] as const) {
                const pin = expectRow[side];
                if (pin === "PLACEHOLDER") continue;
                expect(computed[key]![side]).toBe(pin);
            }
        }
    });
});
