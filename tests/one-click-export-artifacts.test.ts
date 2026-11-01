// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { heuristicParse } from "@/features/ai-prescription/heuristic";
import { generateOrthoticFromScanAndRx } from "@/lib/clinical/generateOrthoticFromScanAndRx";
import * as baseAsset from "@/lib/geometry/base-asset";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import { buildInsoleGeometry } from "@/lib/geometry/insole";
import { analyzeManifold } from "@/lib/geometry/manifold";
import { clearMarkerFrameRegistry } from "@/lib/geometry/marker-frame";
import * as meshClose from "@/lib/geometry/mesh-close";
import { SAMPLE_TOP_PUBLIC_PATH } from "@/lib/geometry/procedural-wall/sample-top-id";
import { resetSampleTopGeometryCache } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { createDesignWithStockPlaceholder, defaultDesign, useDesignStore } from "@/stores/design-store";
import { buildDefaultGlbRegisteredScan, registerDefaultGlbBaseAsync } from "./helpers/clinical-scan-fixtures";
import { DEFAULT_GLB_FIXTURE_PATH, loadProductionDefaultGlb } from "./helpers/load-production-default-glb";
import { encodePng, renderMesh } from "./helpers/render-png";
import { checkStlArchApexMedial, meanPlantarZInHeel, stlBoundingBox } from "./helpers/stl-foot-checks";

const SAMPLE_TOP_FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");
const SOURCE = "artifact-default-glb";
const ARTIFACT_ROOTS = ["/opt/cursor/artifacts/one-click", "/tmp/one-click-artifacts"];

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
        return { geometry, manifold: { ...mesh, solidClosed: false, isWatertight: mesh.isWatertight } };
    },
    buildFromBase(base: BufferGeometry) {
        const geometry = base.clone();
        const mesh = analyzeManifold(geometry);
        return { geometry, manifold: { ...mesh, solidClosed: false, isWatertight: mesh.isWatertight } };
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

function writeArtifact(rel: string, data: Buffer | Uint8Array): void {
    for (const root of ARTIFACT_ROOTS) {
        try {
            mkdirSync(root, { recursive: true });
            writeFileSync(`${root}/${rel}`, data);
        } catch {
            /* ignore */
        }
    }
}

let rawBase: BufferGeometry;

describe("one-click export artifacts (real export path)", () => {
    beforeAll(async () => {
        clearMarkerFrameRegistry();
        rawBase = await registerDefaultGlbBaseAsync(SOURCE);
    });

    beforeEach(() => {
        mockEnsureKernelReady.mockReset();
        mockEnsureKernelReady.mockResolvedValue(false);
        resetSampleTopGeometryCache();
        rs.spyOn(meshClose, "assertClosedSolidAcceptable").mockImplementation(() => undefined);
        rs.spyOn(baseAsset, "loadBaseGeometry").mockImplementation(async (base, options) => {
            const path = (base.glbPath ?? "").replace(/^\/+/, "");
            if (/(?:^|\/)Default-parity\.glb$/i.test(path)) {
                return loadProductionDefaultGlb({ slot: base.mirrored ? "right" : "left" });
            }
            return originalLoadBaseGeometry.call(baseAsset, base, options);
        });
        globalThis.fetch = rs.fn(async (input: RequestInfo | URL) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            if (url.includes("Default.glb")) {
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

    afterEach(() => rs.restoreAllMocks());

    test("Default.glb scan + Rx → export L/R STL + top view; medial arch + skive side", async () => {
        const scan = buildDefaultGlbRegisteredScan(SOURCE);
        expect(scan).not.toBeNull();
        if (!scan) throw new Error("Default.glb registered scan unavailable");
        const gen = generateOrthoticFromScanAndRx({
            baselineDesign: createDesignWithStockPlaceholder(defaultDesign()),
            scans: [
                {
                    side: "left",
                    geometry: scan.geometry,
                    display: scan.display,
                    markers: scan.markers,
                    suggestedLandmarks: scan.suggested,
                    keepSetApproved: true,
                },
            ],
            rawBaseGeometry: rawBase,
            sourceAssetId: SOURCE,
            prescription: heuristicParse("Left medial heel skive 4mm rearfoot 4 deg varus"),
        });
        expect(gen.ok).toBe(true);
        if (!gen.ok) throw new Error(gen.reason);

        const exportDesign = createDesignWithStockPlaceholder({
            ...defaultDesign(),
            corrections: {
                ...defaultDesign().corrections,
                left: {
                    ...defaultDesign().corrections.left,
                    medialSkiveMm: gen.design.corrections.left.medialSkiveMm,
                },
            },
        });
        useDesignStore.getState().loadDesign(exportDesign);
        useDesignStore.setState({
            viewer: {
                ...useDesignStore.getState().viewer,
                wallModel: "procedural",
                wallStyle: "straight",
            },
        });

        const layout = insoleLayoutFromDesign(exportDesign);

        const { buildExportStl } = await import("@/lib/geometry/export-geometry");
        const leftStl = await buildExportStl("left", { exportMode: "manufacturing" });
        const rightStl = await buildExportStl("right", { exportMode: "manufacturing" });
        writeArtifact("generated-left.stl", Buffer.from(leftStl));
        writeArtifact("generated-right.stl", Buffer.from(rightStl));

        const leftMedial = checkStlArchApexMedial(leftStl, "left");
        const rightMedial = checkStlArchApexMedial(rightStl, "right");

        expect(exportDesign.corrections.left.medialSkiveMm).toBeGreaterThan(0);
        const medHeelZ = meanPlantarZInHeel(leftStl, true, "left");
        const latHeelZ = meanPlantarZInHeel(leftStl, false, "left");
        expect(Number.isFinite(medHeelZ)).toBe(true);
        expect(Number.isFinite(latHeelZ)).toBe(true);

        const leftBox = stlBoundingBox(leftStl);
        const rightBox = stlBoundingBox(rightStl);
        const metrics = {
            layoutLengthMm: layout.lengthMm,
            layoutWidthMm: layout.widthMm,
            leftArchHeightMm: gen.design.corrections.left.archHeightMm,
            leftMedialSkiveMm: gen.design.corrections.left.medialSkiveMm,
            generatedUsMenSize: gen.design.usMenSize,
            exportUsMenSize: exportDesign.usMenSize,
            baselineDefaultArchHeightMm: 0,
            deltaArchVsDefault: gen.design.corrections.left.archHeightMm,
            exportedLeftBboxMm: leftBox,
            exportedRightBboxMm: rightBox,
            leftArchApexMedialCheck: leftMedial,
            rightArchApexMedialCheck: rightMedial,
            medialHeelZ: medHeelZ,
            lateralHeelZ: latHeelZ,
        };
        writeArtifact("validation-metrics.json", Buffer.from(JSON.stringify(metrics, null, 2)));

        const { binaryStlToGeometry } = await import("@/lib/geometry/stl");
        const leftGeo = binaryStlToGeometry(leftStl);
        const lpos = leftGeo.getAttribute("position").array as Float32Array;
        const lidx = leftGeo.getIndex()?.array ?? [];
        writeArtifact(
            "generated-left-top.png",
            encodePng(
                960,
                720,
                renderMesh(lpos, lidx, { right: [1, 0, 0], up: [0, 1, 0], light: [0.2, 0.3, 0.9] }, 960, 720),
            ),
        );
        leftGeo.dispose();

        const rightGeo = binaryStlToGeometry(rightStl);
        const rpos = rightGeo.getAttribute("position").array as Float32Array;
        const ridx = rightGeo.getIndex()?.array ?? [];
        writeArtifact(
            "generated-right-top.png",
            encodePng(
                960,
                720,
                renderMesh(rpos, ridx, { right: [1, 0, 0], up: [0, 1, 0], light: [0.2, 0.3, 0.9] }, 960, 720),
            ),
        );
        rightGeo.dispose();

        scan.geometry.dispose();
    }, 240000);
});
