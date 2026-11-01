// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { isCombinedStockGeometry, reconstructProceduralPreview } from "@/lib/geometry/procedural-wall";
import { wantsProceduralExportSolid } from "@/lib/geometry/procedural-wall/preview-loft-ui";
import { loadProductionDefaultGlb } from "./helpers/load-production-default-glb";

describe("procedural mode rejects combined/stock GLB", () => {
    test("Default.glb is combined stock and cannot enter reconstructProceduralPreview", async () => {
        const geo = await loadProductionDefaultGlb({ slot: "left" });
        expect(isCombinedStockGeometry(geo)).toBe(true);
        await expect(reconstructProceduralPreview(geo)).rejects.toThrow(
            /\[S1-PROCEDURAL\] combined\/stock GLB is not a procedural input/,
        );
        expect(
            wantsProceduralExportSolid({ assetId: "stock-default", glbPath: "Templates/Default.glb" }),
        ).toBe(false);
        expect(
            wantsProceduralExportSolid({ assetId: "sample-top", glbPath: "Templates/SAMPLE_Top.glb" }),
        ).toBe(true);
        geo.dispose();
    }, 60_000);
});
