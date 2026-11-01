// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { generateOrthoticFromScanAndRx } from "@/lib/clinical/generateOrthoticFromScanAndRx";
import * as baseAsset from "@/lib/geometry/base-asset";
import { buildInsoleGeometry } from "@/lib/geometry/insole";
import { analyzeManifold } from "@/lib/geometry/manifold";
import * as meshClose from "@/lib/geometry/mesh-close";
import { SAMPLE_TOP_PUBLIC_PATH } from "@/lib/geometry/procedural-wall/sample-top-id";
import { resetSampleTopGeometryCache } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { buildScanDisplayInfo } from "@/lib/geometry/scan-display";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { createDesignWithStockPlaceholder, defaultDesign, useDesignStore } from "@/stores/design-store";
import { archHeightScan } from "./helpers/arch-height-scan";
import { DEFAULT_GLB_FIXTURE_PATH, loadProductionDefaultGlb } from "./helpers/load-production-default-glb";
import { encodePng, renderMesh } from "./helpers/render-png";
import { checkStlArchApexMedial, stlBoundingBox } from "./helpers/stl-foot-checks";

const SAMPLE_TOP_FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");
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

describe("one-click export artifacts (real export path)", () => {
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

    test("Standard + Flexible exports a crest 4 mm toward the toe", async () => {
        const { buildExportStl } = await import("@/lib/geometry/export-geometry");
        const { binaryStlToGeometry } = await import("@/lib/geometry/stl");

        const install = (design: ReturnType<typeof defaultDesign>) => {
            useDesignStore.getState().loadDesign(design);
            useDesignStore.setState({
                viewer: {
                    ...useDesignStore.getState().viewer,
                    wallModel: "procedural",
                    wallStyle: "straight",
                },
            });
        };

        install(createDesignWithStockPlaceholder(defaultDesign()));
        const defaultLeft = await buildExportStl("left", { exportMode: "manufacturing" });
        const defaultRight = await buildExportStl("right", { exportMode: "manufacturing" });
        const defaultLeftHash = createHash("sha256").update(Buffer.from(defaultLeft)).digest("hex");
        const defaultRightHash = createHash("sha256").update(Buffer.from(defaultRight)).digest("hex");
        const defaultLeftApex = checkStlArchApexMedial(defaultLeft, "left");
        const defaultRightApex = checkStlArchApexMedial(defaultRight, "right");

        expect(defaultLeftHash).toBe("6c67e279aa33ea15bd6ffb0c9ba8feecee907d73dfdc5eacadda24e09052df14");
        expect(defaultRightHash).toBe("cd57887c45189bce39b0ead2fbcc959e1bdfebe12a11256f05751ff670d76c99");

        const leftScan = archHeightScan(24, "left");
        const rightScan = archHeightScan(24, "right");
        const gen = generateOrthoticFromScanAndRx({
            baselineDesign: createDesignWithStockPlaceholder(defaultDesign()),
            scans: [
                {
                    side: "left",
                    geometry: leftScan,
                    display: buildScanDisplayInfo(leftScan),
                    keepSetApproved: true,
                },
                {
                    side: "right",
                    geometry: rightScan,
                    display: buildScanDisplayInfo(rightScan),
                    keepSetApproved: true,
                },
            ],
            shoeSize: { system: "us", value: 9 },
            flexibleBySide: { left: true, right: true },
        });
        expect(gen.ok).toBe(true);
        if (!gen.ok) throw new Error(gen.reason);

        const leftCorr = gen.design.corrections.left;
        const rightCorr = gen.design.corrections.right;
        expect(leftCorr.archHeightMm).toBe(0);
        expect(leftCorr.apexMoveMm).toBe(4);
        expect(rightCorr.archHeightMm).toBe(0);
        expect(rightCorr.apexMoveMm).toBe(4);
        expect(gen.design.usMenSize).toBe(9);

        install(gen.design);
        const leftStl = await buildExportStl("left", { exportMode: "manufacturing" });
        const rightStl = await buildExportStl("right", { exportMode: "manufacturing" });
        writeArtifact("generated-left.stl", Buffer.from(leftStl));
        writeArtifact("generated-right.stl", Buffer.from(rightStl));

        const leftHash = createHash("sha256").update(Buffer.from(leftStl)).digest("hex");
        const rightHash = createHash("sha256").update(Buffer.from(rightStl)).digest("hex");
        expect(leftHash).not.toBe(defaultLeftHash);
        expect(rightHash).not.toBe(defaultRightHash);

        const leftMedial = checkStlArchApexMedial(leftStl, "left");
        const rightMedial = checkStlArchApexMedial(rightStl, "right");
        expect(leftMedial.ok, leftMedial.reason).toBe(true);
        expect(rightMedial.ok, rightMedial.reason).toBe(true);
        expect(leftMedial.medialSign).toBe(-1);
        expect(rightMedial.medialSign).toBe(1);
        expect(defaultLeftApex.ok, defaultLeftApex.reason).toBe(true);
        expect(defaultRightApex.ok, defaultRightApex.reason).toBe(true);
        expect(leftMedial.apexX - defaultLeftApex.apexX).toBeGreaterThan(3.8);
        expect(leftMedial.apexX - defaultLeftApex.apexX).toBeLessThan(4.2);
        expect(Math.abs(leftMedial.apexZ - defaultLeftApex.apexZ)).toBeLessThan(0.05);
        expect(rightMedial.apexX - defaultRightApex.apexX).toBeGreaterThan(3.8);
        expect(rightMedial.apexX - defaultRightApex.apexX).toBeLessThan(4.2);
        expect(Math.abs(rightMedial.apexZ - defaultRightApex.apexZ)).toBeLessThan(0.05);

        const leftBox = stlBoundingBox(leftStl);
        const rightBox = stlBoundingBox(rightStl);
        const layout = insoleLayoutFromDesign(gen.design);
        const metrics = {
            sample: "Standard + Flexible, both feet, US men's 9",
            layoutLengthMm: layout.lengthMm,
            layoutWidthMm: layout.widthMm,
            leftArchHeightMm: leftCorr.archHeightMm,
            leftApexMoveMm: leftCorr.apexMoveMm,
            rightArchHeightMm: rightCorr.archHeightMm,
            rightApexMoveMm: rightCorr.apexMoveMm,
            generatedUsMenSize: gen.design.usMenSize,
            exportedDesignIsGenDesign: true,
            leftHash,
            rightHash,
            defaultLeftHash,
            defaultRightHash,
            rightMatchesDefault: false,
            leftDiffersFromDefault: true,
            exportedLeftBboxMm: leftBox,
            exportedRightBboxMm: rightBox,
            leftArchApexMedialCheck: leftMedial,
            rightArchApexMedialCheck: rightMedial,
            defaultLeftApex,
            defaultRightApex,
            leftPeakDxMm: leftMedial.apexX - defaultLeftApex.apexX,
            leftPeakDzMm: leftMedial.apexZ - defaultLeftApex.apexZ,
            rightPeakDxMm: rightMedial.apexX - defaultRightApex.apexX,
            rightPeakDzMm: rightMedial.apexZ - defaultRightApex.apexZ,
        };
        writeArtifact("validation-metrics.json", Buffer.from(JSON.stringify(metrics, null, 2)));

        const paint = (
            stl: ArrayBuffer,
            view: {
                right: [number, number, number];
                up: [number, number, number];
                light: [number, number, number];
            },
        ) => {
            const geo = binaryStlToGeometry(stl);
            const pos = geo.getAttribute("position").array as Float32Array;
            const existing = geo.getIndex()?.array;
            const index = existing ?? Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
            const rgb = renderMesh(pos, index, view, 960, 720);
            geo.dispose();
            let painted = 0;
            const pixels = rgb.length / 3;
            for (let i = 0; i < rgb.length; i += 3) {
                if (rgb[i] !== 140 || rgb[i + 1] !== 140 || rgb[i + 2] !== 140) painted++;
            }
            // Top view fills much of the frame; a medial side view is a thin profile.
            expect(painted / pixels).toBeGreaterThan(0.03);
            return encodePng(960, 720, rgb);
        };
        const light: [number, number, number] = [0.2, 0.3, 0.9];
        writeArtifact("generated-left-top.png", paint(leftStl, { right: [1, 0, 0], up: [0, 1, 0], light }));
        writeArtifact("generated-right-top.png", paint(rightStl, { right: [1, 0, 0], up: [0, 1, 0], light }));
        // Medial side: left looks along −Y, right along +Y.
        writeArtifact(
            "generated-left-medial.png",
            paint(leftStl, { right: [1, 0, 0], up: [0, 0, 1], light: [0.2, -0.6, 0.4] }),
        );
        writeArtifact(
            "generated-right-medial.png",
            paint(rightStl, { right: [-1, 0, 0], up: [0, 0, 1], light: [0.2, 0.6, 0.4] }),
        );

        leftScan.dispose();
        rightScan.dispose();
    }, 420000);
});
