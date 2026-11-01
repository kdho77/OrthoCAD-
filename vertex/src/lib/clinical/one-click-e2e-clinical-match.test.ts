// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

/**
 * E2E: Default.glb base + landmark-aligned scan through real matchClinicalParamsFromRegisteredScanAuto
 * (no injected matchClinical seam). Documents failure modes plainly when registration/arch-fit breaks.
 */

import { beforeAll, describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { generateOrthoticFromScanAndRx } from "@/lib/clinical/generateOrthoticFromScanAndRx";
import { clearMarkerFrameRegistry } from "@/lib/geometry/marker-frame";
import { createDesignWithStockPlaceholder, defaultDesign } from "@/stores/design-store";
import {
    buildDefaultGlbRegisteredScan,
    registerDefaultGlbBaseAsync,
} from "../../../../tests/helpers/clinical-scan-fixtures";

const SOURCE = "e2e-default-glb";
let rawBase: BufferGeometry;

describe("one-click E2E — real clinical match on Default.glb fixture", () => {
    beforeAll(async () => {
        clearMarkerFrameRegistry();
        rawBase = await registerDefaultGlbBaseAsync(SOURCE);
    });

    test("Default.glb registered scan + explicit markers completes or reports arch-fit reason", () => {
        const scan = buildDefaultGlbRegisteredScan(SOURCE, rawBase);
        expect(scan).not.toBeNull();
        if (!scan) return;

        const out = generateOrthoticFromScanAndRx({
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
            prescription: null,
        });

        if (!out.ok) throw new Error(`${out.failedStep}: ${out.reason}`);

        expect(out.perFoot[0]?.archSource).toBe("marker");
        // Stock shell scanned onto itself: additive arch stays within 1 mm of 0.
        expect(Math.abs(out.design.corrections.left.archHeightMm)).toBeLessThanOrEqual(1);
        // Apex residual is the rigid Kabsch fit onto the sized frame, not a dome raise.
        expect(Math.abs(out.design.corrections.left.apexMoveMm)).toBeLessThanOrEqual(5);
        expect(out.design.corrections.left.heelCupWidthMm).toBe(0);
        expect(out.design.corrections.right.archHeightMm).toBe(0);
        scan.geometry.dispose();
    });
});
