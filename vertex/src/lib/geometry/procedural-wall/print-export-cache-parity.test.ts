// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, test } from "@rstest/core";
import { baseModifierFieldAuthoritative } from "@/lib/geometry/base-asset";
import { buildExportStl } from "@/lib/geometry/export-geometry";
import {
    manufacturingLoftStats,
    manufacturingSolidFingerprint,
    publishPreviewManufacturingSolid,
    resetManufacturingSolidCache,
} from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import { manufacturingCacheContext } from "@/lib/geometry/procedural-wall/manufacturing-solid-context";
import { printSolidOptions } from "@/lib/geometry/procedural-wall/print-solid-options";
import {
    buildProceduralExportSolid,
    primeSampleTopGeometry,
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import { usePreviewLoftStatusStore } from "@/stores/preview-loft-status-store";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "vertex/public/Templates/SAMPLE_Top.glb");

function sha256(buf: ArrayBuffer): string {
    return createHash("sha256").update(Buffer.from(buf)).digest("hex");
}

beforeEach(() => {
    resetManufacturingSolidCache();
    resetSampleTopGeometryCache();
    usePreviewLoftStatusStore.getState().reset();
});

describe("print preview cache → export", () => {
    test("warm export reuses preview solid and STL matches a cold export", async () => {
        const bytes = readFileSync(SAMPLE_TOP_PATH);
        const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        primeSampleTopGeometry(await sampleTopFromArrayBuffer(buf));

        useDesignStore.setState({
            design: { ...createDesignWithStockPlaceholder(), method: "printing_solid" },
            viewer: { wallModel: "procedural", wallStyle: "round", deviceType: "functional" },
            stockBaseLoading: false,
            stockBaseResolutionState: "resolved",
        });
        const design = useDesignStore.getState().design;
        const field = baseModifierFieldAuthoritative(design, "left", design.thicknessMm);
        const solidOptions = printSolidOptions({
            design,
            side: "left",
            field,
            viewer: useDesignStore.getState().viewer ?? {},
            trimline: null,
            bottomPattern: undefined,
        });
        const cache = manufacturingCacheContext({
            design,
            side: "left",
            baseAssetId: design.base?.assetId ?? "sample-top",
            mirrored: false,
        });

        resetManufacturingSolidCache();
        const coldStl = await buildExportStl("left", { exportMode: "manufacturing" });
        const coldHash = sha256(coldStl);

        resetManufacturingSolidCache();
        const builtBeforePrint = manufacturingLoftStats().built;
        const preview = await buildProceduralExportSolid(solidOptions, cache);
        publishPreviewManufacturingSolid(solidOptions, cache, preview.geometry);
        expect(manufacturingLoftStats().published).toBe(1);
        expect(manufacturingLoftStats().built - builtBeforePrint).toBe(1);

        const warmBuilt = await buildProceduralExportSolid(solidOptions, cache);
        expect(warmBuilt.geometry.userData.fromManufacturingCache).toBe(true);
        expect(manufacturingLoftStats().reused).toBeGreaterThanOrEqual(1);

        const warmStl = await buildExportStl("left", { exportMode: "manufacturing" });
        expect(sha256(warmStl)).toBe(coldHash);
        expect(manufacturingLoftStats().built - builtBeforePrint).toBe(1);
        expect(manufacturingSolidFingerprint(solidOptions, cache)).toBeTruthy();
        preview.geometry.dispose();
        warmBuilt.geometry.dispose();
    }, 600_000);
});
