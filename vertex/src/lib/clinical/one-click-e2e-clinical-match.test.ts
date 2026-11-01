// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

/**
 * One-click no longer registers the scan or gap-fits the arch.
 * This checks the shipped path: shoe size, arch class, flexible apex, explicit Rx.
 */

import { describe, expect, test } from "@rstest/core";
import { generateOrthoticFromScanAndRx } from "@/lib/clinical/generateOrthoticFromScanAndRx";
import { buildScanDisplayInfo } from "@/lib/geometry/scan-display";
import { createDesignWithStockPlaceholder, defaultDesign } from "@/stores/design-store";
import { archHeightScan } from "../../../../tests/helpers/arch-height-scan";

describe("one-click E2E — arch class and explicit Rx, no scan fit", () => {
    test("Low flexible left and Standard right", () => {
        const leftGeo = archHeightScan(20, "left");
        const rightGeo = archHeightScan(24, "right");
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: createDesignWithStockPlaceholder(defaultDesign()),
            scans: [
                {
                    side: "left",
                    geometry: leftGeo,
                    display: buildScanDisplayInfo(leftGeo),
                    keepSetApproved: true,
                },
                {
                    side: "right",
                    geometry: rightGeo,
                    display: buildScanDisplayInfo(rightGeo),
                    keepSetApproved: true,
                },
            ],
            shoeSize: { system: "us", value: 9 },
            flexibleBySide: { left: true },
            prescriptionText: "Left medial heel skive 4mm rearfoot 4 deg varus",
        });
        if (!out.ok) throw new Error(`${out.failedStep}: ${out.reason}`);
        expect(out.design.sizeSystem).toBe("us");
        expect(out.design.usMenSize).toBe(9);
        expect(out.design.corrections.linked).toBe(false);
        expect(out.perFoot.find((f) => f.side === "left")).toMatchObject({
            archBand: "low",
            archHeightMm: -3.5,
            apexMoveMm: 4,
            flexible: true,
        });
        expect(out.perFoot.find((f) => f.side === "right")).toMatchObject({
            archBand: "standard",
            archHeightMm: 0,
            apexMoveMm: 0,
            flexible: false,
        });
        expect(out.design.corrections.left.medialSkiveMm).toBe(4);
        expect(out.design.corrections.left.rearfootWedge).toEqual({ side: "medial", value: 4, unit: "deg" });
        expect(out.design.corrections.right.medialSkiveMm).toBe(0);
        expect(out.design.corrections.right.rearfootWedge).toBeUndefined();
        expect(out.pathology).toBeNull();
        leftGeo.dispose();
        rightGeo.dispose();
    });
});
