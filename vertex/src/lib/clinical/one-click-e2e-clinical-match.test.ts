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
        const scan = buildDefaultGlbRegisteredScan(SOURCE);
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

        if (!out.ok) {
            expect(out.failedStep).toMatch(/arch_fit|registration|landmarks/);
            expect(out.reason.length).toBeGreaterThan(10);
            scan.geometry.dispose();
            return;
        }

        expect(out.perFoot[0]?.archSource).toMatch(/marker|gap/);
        expect(out.design.corrections.left.archHeightMm).toBeDefined();
        scan.geometry.dispose();
    });
});
