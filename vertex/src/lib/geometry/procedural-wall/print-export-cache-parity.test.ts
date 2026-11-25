// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, test } from "@rstest/core";
import { baseModifierFieldAuthoritative, getDesignBase } from "@/lib/geometry/base-asset";
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
import type { Side } from "@/types";

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
        for (const side of ["left", "right"] as const satisfies readonly Side[]) {
            const thickness = design.paired
                ? side === "left"
                    ? design.paired.leftThicknessMm
                    : design.paired.rightThicknessMm
                : design.thicknessMm;
            const base = getDesignBase(design, side);
            const mirrored = Boolean(base?.mirrored);
            const field = baseModifierFieldAuthoritative(design, side, thickness);
            const solidOptions = {
                ...printSolidOptions({
                    design,
                    side,
                    field,
                    viewer: useDesignStore.getState().viewer ?? {},
                    trimline: null,
                    bottomPattern: undefined,
                }),
                mirrored,
            };
            const cache = manufacturingCacheContext({
                design,
                side,
                baseAssetId: base?.assetId ?? "sample-top",
                mirrored,
            });

            resetManufacturingSolidCache();
            const coldStl = await buildExportStl(side, { exportMode: "manufacturing" });
            const coldHash = sha256(coldStl);
            const coldTris = (coldStl.byteLength - 84) / 50;

            resetManufacturingSolidCache();
            const builtBeforePrint = manufacturingLoftStats().built;
            const preview = await buildProceduralExportSolid(solidOptions, cache);
            publishPreviewManufacturingSolid(solidOptions, cache, preview.geometry);
            expect(manufacturingLoftStats().published).toBe(1);
            expect(manufacturingLoftStats().built - builtBeforePrint).toBe(1);

            const warmBuilt = await buildProceduralExportSolid(solidOptions, cache);
            expect(warmBuilt.geometry.userData.fromManufacturingCache).toBe(true);
            expect(manufacturingLoftStats().reused).toBeGreaterThanOrEqual(1);

            const warmStl = await buildExportStl(side, { exportMode: "manufacturing" });
            const warmTris = (warmStl.byteLength - 84) / 50;
            expect(sha256(warmStl)).toBe(coldHash);
            expect(warmTris).toBe(coldTris);
            expect(manufacturingLoftStats().built - builtBeforePrint).toBe(1);
            expect(manufacturingSolidFingerprint(solidOptions, cache)).toBeTruthy();
            preview.geometry.dispose();
            warmBuilt.geometry.dispose();
        }
    }, 600_000);
});
