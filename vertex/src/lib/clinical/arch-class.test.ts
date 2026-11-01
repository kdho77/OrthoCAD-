// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { classifyArchHeightMm, FLEXIBLE_APEX_ANTERIOR_MM } from "@/lib/clinical/arch-class";
import { measureScanArchHeightMm } from "@/lib/clinical/measure-scan-arch";
import { type HeightFieldParams, heightAt } from "@/lib/geometry/height-field";
import { buildScanDisplayInfo } from "@/lib/geometry/scan-display";
import type { SideCorrections } from "@/types";
import { archHeightScan } from "../../../../tests/helpers/arch-height-scan";

function corrections(archHeightMm: number, apexMoveMm: number): SideCorrections {
    return {
        forefootPostingDeg: 0,
        rearfootPostingDeg: 0,
        medialSkiveMm: 0,
        lateralSkiveMm: 0,
        archFillMm: 0,
        archHeightMm,
        archEaseMm: 0,
        heelCupDepthMm: 0,
        heelCupHeightMm: 0,
        heelCupWidthMm: 0,
        forefootWidthMm: 0,
        heelLiftMm: 0,
        apexMoveMm,
        medialFlangeMm: 0,
        lateralFlangeMm: 0,
    };
}

function field(archHeightMm: number, apexMoveMm = 0): HeightFieldParams {
    return {
        side: "left",
        lengthMm: 260,
        widthMm: 95,
        thicknessMm: 3,
        corrections: corrections(archHeightMm, apexMoveMm),
        includeElements: false,
        includeSkives: false,
    };
}

describe("arch classification", () => {
    test("boundaries 17.9, 18, 22.9, 23, 26, 26.1", () => {
        const rows: [number, "low" | "standard" | "high", boolean, number][] = [
            [17.9, "low", true, -3.5],
            [18, "low", false, -3.5],
            [22.9, "low", false, -3.5],
            [23, "standard", false, 0],
            [26, "standard", false, 0],
            [26.1, "high", false, 3],
        ];
        for (const [mm, band, review, delta] of rows) {
            const c = classifyArchHeightMm(mm);
            expect(c.band, String(mm)).toBe(band);
            expect(c.reviewBelow18, String(mm)).toBe(review);
            expect(c.archHeightMm, String(mm)).toBe(delta);
        }
    });

    test("Low and High differ from the default by −3.5 and +3 mm at the apex", () => {
        const u = 0.42;
        // Inside the feather (av ≤ 0.86) and on the medial dome.
        const v = 0.86;
        const base = heightAt(u, v, field(0));
        expect(heightAt(u, v, field(-3.5)) - base).toBeCloseTo(-3.5, 1);
        expect(heightAt(u, v, field(3)) - base).toBeCloseTo(3, 1);
    });

    test("flexible apex is 4 mm anterior of the default apex", () => {
        const length = 260;
        const u0 = 0.42;
        const u1 = 0.42 + FLEXIBLE_APEX_ANTERIOR_MM / length;
        const v = 0.86;
        const delta = (u: number, apex: number) =>
            heightAt(u, v, field(-3.5, apex)) - heightAt(u, v, field(0, 0));
        const atNew = delta(u1, FLEXIBLE_APEX_ANTERIOR_MM);
        const atOld = delta(u0, FLEXIBLE_APEX_ANTERIOR_MM);
        expect(u1 * length - u0 * length).toBeCloseTo(4, 5);
        expect(atNew).toBeCloseTo(-3.5, 1);
        expect(atOld).toBeGreaterThan(atNew);
    });
});

describe("measureScanArchHeightMm", () => {
    test("reads the medial arch height and ignores shoe length", () => {
        for (const mm of [17.9, 18, 22.9, 23, 26, 26.1]) {
            const geo = archHeightScan(mm, "left");
            const display = buildScanDisplayInfo(geo);
            const measured = measureScanArchHeightMm(geo, "left", display.displayScale);
            expect(measured, String(mm)).not.toBeNull();
            expect(measured!.heightMm).toBeCloseTo(mm, 1);
            geo.dispose();
        }
    });

    test("right foot uses the medial half", () => {
        const geo = archHeightScan(30, "right");
        const measured = measureScanArchHeightMm(geo, "right", 1);
        expect(measured?.heightMm).toBeCloseTo(30, 1);
        geo.dispose();
    });
});
