// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { generateOrthoticFromScanAndRx } from "@/lib/clinical/generateOrthoticFromScanAndRx";
import { interpretOneClickRx } from "@/lib/clinical/one-click-rx";
import { stubPathologyDesigner } from "@/lib/clinical/pathology-designer";
import { buildScanDisplayInfo } from "@/lib/geometry/scan-display";
import { createDesignWithStockPlaceholder, defaultDesign } from "@/stores/design-store";
import type { Side } from "@/types";
import { archHeightScan } from "../../../../tests/helpers/arch-height-scan";

function scan(heightMm: number, side: Side) {
    const geometry = archHeightScan(heightMm, side);
    return {
        side,
        geometry,
        display: buildScanDisplayInfo(geometry),
        keepSetApproved: true,
    };
}

const shoe = { system: "us" as const, value: 9 };

describe("one-click recipe", () => {
    test("shoe size is required", () => {
        const foot = scan(24, "left");
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: createDesignWithStockPlaceholder(defaultDesign()),
            scans: [foot],
            shoeSize: null,
        });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.failedStep).toBe("shoe_size");
        foot.geometry.dispose();
    });

    test("does not change shoe size from scan length", () => {
        const foot = scan(24, "left");
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: createDesignWithStockPlaceholder({ ...defaultDesign(), usMenSize: 13 }),
            scans: [foot],
            shoeSize: { system: "us", value: 8 },
        });
        if (!out.ok) throw new Error(out.reason);
        expect(out.design.usMenSize).toBe(8);
        expect(out.design.sizeSystem).toBe("us");
        foot.geometry.dispose();
    });

    test("Low, Standard, and High set −3.5, 0, and +3", () => {
        const cases: [number, number][] = [
            [20, -3.5],
            [23, 0],
            [26, 0],
            [28, 3],
        ];
        for (const [measured, arch] of cases) {
            const foot = scan(measured, "left");
            const out = generateOrthoticFromScanAndRx({
                baselineDesign: createDesignWithStockPlaceholder(defaultDesign()),
                scans: [foot],
                shoeSize: shoe,
            });
            if (!out.ok) throw new Error(`${measured}: ${out.reason}`);
            expect(out.design.corrections.left.archHeightMm).toBe(arch);
            expect(out.design.corrections.left.apexMoveMm).toBe(0);
            foot.geometry.dispose();
        }
    });

    test("below 18 mm is Low and flagged", () => {
        const foot = scan(17.9, "left");
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: createDesignWithStockPlaceholder(defaultDesign()),
            scans: [foot],
            shoeSize: shoe,
        });
        if (!out.ok) throw new Error(out.reason);
        expect(out.design.corrections.left.archHeightMm).toBe(-3.5);
        expect(out.perFoot[0]?.archReviewBelow18).toBe(true);
        expect(out.reviewItems.some((r) => r.includes("below 18"))).toBe(true);
        foot.geometry.dispose();
    });

    test("flexible foot moves the apex 4 mm anterior", () => {
        const foot = scan(20, "left");
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: createDesignWithStockPlaceholder(defaultDesign()),
            scans: [foot],
            shoeSize: shoe,
            flexibleBySide: { left: true },
        });
        if (!out.ok) throw new Error(out.reason);
        expect(out.design.corrections.left.apexMoveMm).toBe(4);
        expect(out.design.corrections.right.apexMoveMm).toBe(0);
        foot.geometry.dispose();
    });

    test("left and right stay independent", () => {
        const left = scan(20, "left");
        const right = scan(24, "right");
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: createDesignWithStockPlaceholder({
                ...defaultDesign(),
                corrections: { ...defaultDesign().corrections, linked: true },
            }),
            scans: [left, right],
            shoeSize: shoe,
            flexibleBySide: { left: true, right: false },
            prescriptionText: "Left medial heel skive 4mm rearfoot 4 deg varus",
        });
        if (!out.ok) throw new Error(out.reason);
        expect(out.design.corrections.linked).toBe(false);
        expect(out.design.corrections.left.archHeightMm).toBe(-3.5);
        expect(out.design.corrections.left.apexMoveMm).toBe(4);
        expect(out.design.corrections.left.medialSkiveMm).toBe(4);
        expect(out.design.corrections.left.rearfootWedge).toEqual({ side: "medial", value: 4, unit: "deg" });
        expect(out.design.corrections.right.archHeightMm).toBe(0);
        expect(out.design.corrections.right.apexMoveMm).toBe(0);
        expect(out.design.corrections.right.medialSkiveMm).toBe(0);
        expect(out.design.corrections.right.rearfootWedge).toBeUndefined();
        left.geometry.dispose();
        right.geometry.dispose();
    });

    test("explicit arch millimetres override the scan class", () => {
        const foot = scan(20, "left");
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: createDesignWithStockPlaceholder(defaultDesign()),
            scans: [foot],
            shoeSize: shoe,
            prescriptionText: "Left arch 2 mm",
        });
        if (!out.ok) throw new Error(out.reason);
        expect(out.design.corrections.left.archHeightMm).toBe(2);
        expect(out.perFoot[0]?.archBand).toBe("low");
        expect(out.perFoot[0]?.rxArchOverride).toBe(true);
        foot.geometry.dispose();
    });

    test("pathology-only Rx is flagged and does not guess a correction", () => {
        const foot = scan(24, "left");
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: createDesignWithStockPlaceholder(defaultDesign()),
            scans: [foot],
            shoeSize: shoe,
            prescriptionText: "Left plantar fasciitis",
            pathologyDesigner: stubPathologyDesigner,
        });
        if (!out.ok) throw new Error(out.reason);
        expect(out.pathology?.status).toBe("needs_design");
        expect(out.design.corrections.left.archHeightMm).toBe(0);
        expect(out.design.corrections.left.rearfootWedge).toBeUndefined();
        expect(out.design.corrections.left.medialSkiveMm).toBe(0);
        foot.geometry.dispose();
    });

    test("an unnamed side is not copied onto both feet", () => {
        const parsed = interpretOneClickRx("medial skive 4mm", ["left", "right"]);
        expect(parsed.correctionsBySide.left).toBeUndefined();
        expect(parsed.correctionsBySide.right).toBeUndefined();
        expect(parsed.warnings.some((w) => w.includes("Ambiguous"))).toBe(true);
    });

    test("met pad and 1st MPJ sink land on the named foot", () => {
        const foot = scan(24, "left");
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: createDesignWithStockPlaceholder(defaultDesign()),
            scans: [foot],
            shoeSize: shoe,
            prescriptionText: "Left met pad. Left 1st MPJ 2 mm",
        });
        if (!out.ok) throw new Error(out.reason);
        expect(out.design.elements.some((e) => e.kind === "met_pad" && e.side === "left")).toBe(true);
        expect(out.design.sinks?.left?.some((s) => s.kind === "mpj1" && s.depthMm === 2)).toBe(true);
        expect(out.design.sinks?.right?.length ?? 0).toBe(0);
        foot.geometry.dispose();
    });
});
