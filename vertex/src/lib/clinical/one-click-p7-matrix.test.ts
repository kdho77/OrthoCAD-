// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import * as THREE from "three";
import { generateOrthoticFromScanAndRx } from "@/lib/clinical/generateOrthoticFromScanAndRx";
import { buildScanDisplayInfo } from "@/lib/geometry/scan-display";
import { createDesignWithStockPlaceholder, defaultDesign } from "@/stores/design-store";
import { archHeightScan } from "../../../../tests/helpers/arch-height-scan";

function bundle(heightMm: number, side: "left" | "right" = "left", displayScale?: number) {
    const geometry = archHeightScan(heightMm, side);
    const display = buildScanDisplayInfo(geometry);
    return {
        side,
        geometry,
        display: displayScale === undefined ? display : { ...display, displayScale },
        keepSetApproved: true,
    };
}

const shoe = { system: "us" as const, value: 9 };

describe("one-click recipe matrix", () => {
    test("pathology words do not set arch height or a wedge", () => {
        const foot = bundle(24);
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: createDesignWithStockPlaceholder(defaultDesign()),
            scans: [foot],
            shoeSize: shoe,
            prescriptionText: "Left high arch pes cavus",
        });
        if (!out.ok) throw new Error(out.reason);
        expect(out.pathology?.status).toBe("needs_design");
        expect(out.design.corrections.left.archHeightMm).toBe(0);
        expect(out.design.corrections.left.rearfootWedge).toBeUndefined();
        foot.geometry.dispose();
    });

    test("a named diagnosis beside an explicit correction is not guessed further", () => {
        const foot = bundle(20);
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: createDesignWithStockPlaceholder(defaultDesign()),
            scans: [foot],
            shoeSize: shoe,
            prescriptionText: "Left plantar fasciitis. Left medial skive 2 mm",
        });
        if (!out.ok) throw new Error(out.reason);
        expect(out.pathology).toBeNull();
        expect(out.design.corrections.left.medialSkiveMm).toBe(2);
        expect(out.design.corrections.left.archHeightMm).toBe(-3.5);
        expect(out.design.corrections.left.rearfootWedge).toBeUndefined();
        expect(out.warnings.some((w) => w.includes("Only explicit"))).toBe(true);
        foot.geometry.dispose();
    });

    test("US shoe sizes 8, 9 and 10 come from the required input", () => {
        for (const us of [8, 9, 10]) {
            const foot = bundle(23);
            const out = generateOrthoticFromScanAndRx({
                baselineDesign: createDesignWithStockPlaceholder({ ...defaultDesign(), usMenSize: 13 }),
                scans: [foot],
                shoeSize: { system: "us", value: us },
            });
            if (!out.ok) throw new Error(out.reason);
            expect(out.design.usMenSize).toBe(us);
            expect(out.design.corrections.left.archHeightMm).toBe(0);
            foot.geometry.dispose();
        }
    });

    test("display scale converts a metre-unit arch into millimetres", () => {
        const geometry = archHeightScan(20, "left");
        geometry.scale(0.001, 0.001, 0.001);
        const display = buildScanDisplayInfo(geometry);
        expect(display.displayScale).toBe(1000);
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: createDesignWithStockPlaceholder(defaultDesign()),
            scans: [{ side: "left", geometry, display, keepSetApproved: true }],
            shoeSize: shoe,
        });
        if (!out.ok) throw new Error(out.reason);
        expect(out.perFoot[0]?.archHeightMeasuredMm).toBeCloseTo(20, 0);
        expect(out.design.corrections.left.archHeightMm).toBe(-3.5);
        geometry.dispose();
    });

    test("a scan that is too small to measure fails at arch height", () => {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: createDesignWithStockPlaceholder(defaultDesign()),
            scans: [
                {
                    side: "left",
                    geometry,
                    display: buildScanDisplayInfo(geometry),
                    keepSetApproved: true,
                },
            ],
            shoeSize: shoe,
        });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.failedStep).toBe("arch_height");
        geometry.dispose();
    });

    test("an unapproved keep-set blocks generation", () => {
        const foot = bundle(24);
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: createDesignWithStockPlaceholder(defaultDesign()),
            scans: [{ ...foot, keepSetApproved: false }],
            shoeSize: shoe,
        });
        expect(out.ok).toBe(false);
        if (!out.ok) expect(out.failedStep).toBe("scan_cleanup");
        foot.geometry.dispose();
    });

    test("explicit apex overrides the flexible checkbox", () => {
        const foot = bundle(28, "right");
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: createDesignWithStockPlaceholder(defaultDesign()),
            scans: [foot],
            shoeSize: shoe,
            flexibleBySide: { right: true },
            prescriptionText: "Right apex 1 mm",
        });
        if (!out.ok) throw new Error(out.reason);
        expect(out.design.corrections.right.archHeightMm).toBe(3);
        expect(out.design.corrections.right.apexMoveMm).toBe(1);
        expect(out.design.corrections.left.apexMoveMm).toBe(0);
        foot.geometry.dispose();
    });

    test("bilateral explicit corrections stay on the named feet", () => {
        const left = bundle(20, "left");
        const right = bundle(28, "right");
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: createDesignWithStockPlaceholder(defaultDesign()),
            scans: [left, right],
            shoeSize: shoe,
            prescriptionText: "Left medial skive 4 mm. Right lateral skive 3 mm",
        });
        if (!out.ok) throw new Error(out.reason);
        expect(out.design.corrections.left.medialSkiveMm).toBe(4);
        expect(out.design.corrections.left.lateralSkiveMm).toBe(0);
        expect(out.design.corrections.left.archHeightMm).toBe(-3.5);
        expect(out.design.corrections.right.lateralSkiveMm).toBe(3);
        expect(out.design.corrections.right.medialSkiveMm).toBe(0);
        expect(out.design.corrections.right.archHeightMm).toBe(3);
        left.geometry.dispose();
        right.geometry.dispose();
    });

    test("an unnamed correction is not copied when both feet are present", () => {
        const left = bundle(24, "left");
        const right = bundle(24, "right");
        const out = generateOrthoticFromScanAndRx({
            baselineDesign: createDesignWithStockPlaceholder(defaultDesign()),
            scans: [left, right],
            shoeSize: shoe,
            prescriptionText: "medial skive 4mm",
        });
        if (!out.ok) throw new Error(out.reason);
        expect(out.design.corrections.left.medialSkiveMm).toBe(0);
        expect(out.design.corrections.right.medialSkiveMm).toBe(0);
        expect(out.warnings.some((w) => w.includes("Ambiguous"))).toBe(true);
        left.geometry.dispose();
        right.geometry.dispose();
    });
});
