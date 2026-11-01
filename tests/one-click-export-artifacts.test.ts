// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { createHash } from "node:crypto";
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
import { checkStlArchApexMedial, meanTopHeelZ, stlBoundingBox } from "./helpers/stl-foot-checks";

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

    test("Default.glb scan + Rx exports gen.design (no template fallback)", async () => {
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
        const defaultRightHash = createHash("sha256").update(Buffer.from(defaultRight)).digest("hex");
        const defaultLeftMedial = meanTopHeelZ(defaultLeft, true, "left");
        const defaultLeftLateral = meanTopHeelZ(defaultLeft, false, "left");

        const scan = buildDefaultGlbRegisteredScan(SOURCE, rawBase);
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

        const leftCorr = gen.design.corrections.left;
        const rightCorr = gen.design.corrections.right;
        expect(Math.abs(leftCorr.archHeightMm)).toBeLessThanOrEqual(1);
        expect(Math.abs(leftCorr.apexMoveMm)).toBeLessThanOrEqual(5);
        expect(leftCorr.heelCupWidthMm).toBe(0);
        expect(leftCorr.medialSkiveMm).toBe(4);
        expect(leftCorr.rearfootWedge).toEqual({ side: "medial", value: 4, unit: "deg" });
        expect(rightCorr.medialSkiveMm).toBe(0);
        expect(rightCorr.archHeightMm).toBe(0);
        expect(rightCorr.rearfootWedge).toBeUndefined();

        install(gen.design);
        const leftStl = await buildExportStl("left", { exportMode: "manufacturing" });
        const rightStl = await buildExportStl("right", { exportMode: "manufacturing" });
        writeArtifact("generated-left.stl", Buffer.from(leftStl));
        writeArtifact("generated-right.stl", Buffer.from(rightStl));

        const leftMedial = checkStlArchApexMedial(leftStl, "left");
        const rightMedial = checkStlArchApexMedial(rightStl, "right");
        expect(leftMedial.ok, leftMedial.reason).toBe(true);
        expect(rightMedial.ok, rightMedial.reason).toBe(true);
        expect(leftMedial.medialSign).toBe(-1);
        expect(rightMedial.medialSign).toBe(1);

        const medHeelZ = meanTopHeelZ(leftStl, true, "left");
        const latHeelZ = meanTopHeelZ(leftStl, false, "left");
        const medialRaise = medHeelZ - defaultLeftMedial;
        const lateralRaise = latHeelZ - defaultLeftLateral;
        // 4 mm medial skive plus a 4° medial (varus) wedge, at the medial heel.
        expect(medialRaise).toBeGreaterThan(3);
        expect(medialRaise).toBeLessThan(12);
        expect(lateralRaise).toBeLessThan(medialRaise - 2);

        const rightHash = createHash("sha256").update(Buffer.from(rightStl)).digest("hex");
        expect(rightHash).toBe(defaultRightHash);

        // Same Rx on the right shell. medialSign is +Y; the left shell stays the unilateral case above.
        const defaultRightMedial = meanTopHeelZ(defaultRight, true, "right");
        const defaultRightLateral = meanTopHeelZ(defaultRight, false, "right");
        const rightDesign = {
            ...gen.design,
            corrections: {
                ...gen.design.corrections,
                linked: false,
                right: {
                    ...gen.design.corrections.right,
                    medialSkiveMm: 4,
                    rearfootWedge: { side: "medial" as const, value: 4, unit: "deg" as const },
                },
            },
        };
        resetSampleTopGeometryCache();
        install(rightDesign);
        const rightSkived = await buildExportStl("right", { exportMode: "manufacturing" });
        const rightSkiveMedial = checkStlArchApexMedial(rightSkived, "right");
        expect(rightSkiveMedial.ok, rightSkiveMedial.reason).toBe(true);
        expect(rightSkiveMedial.medialSign).toBe(1);
        const rightMedialRaise = meanTopHeelZ(rightSkived, true, "right") - defaultRightMedial;
        const rightLateralRaise = meanTopHeelZ(rightSkived, false, "right") - defaultRightLateral;
        expect(rightMedialRaise).toBeGreaterThan(3);
        expect(rightMedialRaise).toBeLessThan(12);
        expect(rightLateralRaise).toBeLessThan(rightMedialRaise - 2);

        const leftBox = stlBoundingBox(leftStl);
        const rightBox = stlBoundingBox(rightStl);
        const layout = insoleLayoutFromDesign(gen.design);
        const metrics = {
            layoutLengthMm: layout.lengthMm,
            layoutWidthMm: layout.widthMm,
            leftArchHeightMm: leftCorr.archHeightMm,
            leftApexMoveMm: leftCorr.apexMoveMm,
            leftMedialSkiveMm: leftCorr.medialSkiveMm,
            leftRearfootWedge: leftCorr.rearfootWedge,
            rightMedialSkiveMm: rightCorr.medialSkiveMm,
            generatedUsMenSize: gen.design.usMenSize,
            exportedDesignIsGenDesign: true,
            baselineDefaultArchHeightMm: 0,
            exportedLeftBboxMm: leftBox,
            exportedRightBboxMm: rightBox,
            leftArchApexMedialCheck: leftMedial,
            rightArchApexMedialCheck: rightMedial,
            medialHeelZ: medHeelZ,
            lateralHeelZ: latHeelZ,
            defaultMedialHeelZ: defaultLeftMedial,
            defaultLateralHeelZ: defaultLeftLateral,
            medialHeelRaiseMm: medialRaise,
            lateralHeelRaiseMm: lateralRaise,
            rightMatchesDefault: true,
            rightPrescribedMedialHeelRaiseMm: rightMedialRaise,
            rightPrescribedLateralHeelRaiseMm: rightLateralRaise,
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

        scan.geometry.dispose();
    }, 420000);
});
