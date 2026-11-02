// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, rs, test } from "@rstest/core";
import JSZip from "jszip";
import { buildExportStl } from "@/lib/geometry/export-geometry";
import {
    assertClosedSolidAcceptable,
    DEFAULT_GLB_CLOSED_BASELINE,
    validateManifold,
} from "@/lib/geometry/mesh-close";
import { binaryStlToGeometry } from "@/lib/geometry/stl";
import { parseBinaryStl } from "@/lib/hardness/mesh";
import { exportHardness3mf } from "@/lib/hardness/pipeline";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import { resetSampleTopGeometryCache } from "./sample-top-preview";

const originalFetch = globalThis.fetch;
afterEach(() => {
    globalThis.fetch = originalFetch;
    resetSampleTopGeometryCache();
});

describe("SAMPLE_Top manufacturing exports with real topology guards", () => {
    for (const side of ["left", "right"] as const) {
        test(`${side}: default M9 medium exports a closed STL and matching 3MF shell`, async () => {
            const bytes = readFileSync(resolve("tests/fixtures/SAMPLE_Top.glb"));
            globalThis.fetch = rs.fn(async () => new Response(bytes));
            resetSampleTopGeometryCache();
            useBottomPatternStore.getState().clear();
            const design = createDesignWithStockPlaceholder();
            useDesignStore.setState({ design });
            const stl = await buildExportStl(side);
            const geometry = binaryStlToGeometry(stl);
            try {
                const report = validateManifold(geometry);
                expect(report.isWatertight).toBe(true);
                expect(report.eulerCharacteristic).toBe(2);
                // This is the incorrect legacy contract that rejected the user's valid loft.
                expect(() => assertClosedSolidAcceptable(geometry, 0, DEFAULT_GLB_CLOSED_BASELINE)).toThrow(
                    "baseline 3",
                );
                const shell = parseBinaryStl(stl);
                const packed = await exportHardness3mf({ design, side, shell });
                expect(packed.report.ok).toBe(true);
                const zip = await JSZip.loadAsync(packed.bytes);
                const model = await zip.file("3D/3dmodel.model")?.async("string");
                expect(model).toBeDefined();
                expect(model?.match(/<triangle /g)?.length).toBe(report.triangleCount);
            } finally {
                geometry.dispose();
            }
        }, 240_000);
    }
});
