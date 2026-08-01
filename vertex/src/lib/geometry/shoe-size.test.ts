// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import * as THREE from "three";
import { INSOLE_LENGTH_MM, INSOLE_WIDTH_MM } from "@/lib/geometry/layout";
import {
    DEFAULT_US_MEN_SIZE,
    formatUsShoeSizeLabel,
    insoleLayoutForUsMenSize,
    insoleLayoutFromDesign,
    normalizeUsMenSize,
    REFERENCE_US_MEN_SIZE,
    scaleGeometryToInsoleSize,
    usMenFootLengthMm,
    usShoeSizeOptions,
    usWomenFromMen,
} from "@/lib/geometry/shoe-size";

describe("US shoe size chart", () => {
    test("Men's 9 is the reference template size", () => {
        expect(DEFAULT_US_MEN_SIZE).toBe(9);
        expect(REFERENCE_US_MEN_SIZE).toBe(9);
        const layout = insoleLayoutForUsMenSize(9);
        expect(layout.lengthMm).toBeCloseTo(INSOLE_LENGTH_MM, 6);
        expect(layout.widthMm).toBeCloseTo(INSOLE_WIDTH_MM, 6);
        expect(layout.scale).toBeCloseTo(1, 6);
    });

    test("Women's label is men's + 1.5", () => {
        expect(usWomenFromMen(12)).toBe(13.5);
        expect(usWomenFromMen(5.5)).toBe(7);
        expect(formatUsShoeSizeLabel(12)).toBe("M 12 / W 13.5");
        expect(formatUsShoeSizeLabel(5.5)).toBe("M 5.5 / W 7 / Youth 5.5");
    });

    test("Youth appears only for men's sizes ≤ 7", () => {
        expect(formatUsShoeSizeLabel(7)).toContain("Youth 7");
        expect(formatUsShoeSizeLabel(7.5)).not.toContain("Youth");
        expect(formatUsShoeSizeLabel(1)).toBe("M 1 / W 2.5 / Youth 1");
    });

    test("Brannock foot length increases one barleycorn per half size", () => {
        const step = usMenFootLengthMm(10) - usMenFootLengthMm(9.5);
        expect(step).toBeCloseTo(25.4 / 6, 6);
    });

    test("larger sizes scale length and width uniformly", () => {
        const m12 = insoleLayoutForUsMenSize(12);
        const m9 = insoleLayoutForUsMenSize(9);
        expect(m12.lengthMm).toBeGreaterThan(m9.lengthMm);
        expect(m12.widthMm / m9.widthMm).toBeCloseTo(m12.lengthMm / m9.lengthMm, 6);
        expect(m12.scale).toBeCloseTo(usMenFootLengthMm(12) / usMenFootLengthMm(9), 6);
    });

    test("dropdown options cover half sizes and use combined labels", () => {
        const opts = usShoeSizeOptions();
        expect(opts[0]?.menSize).toBe(1);
        expect(opts.at(-1)?.menSize).toBe(16);
        expect(opts.find((o) => o.menSize === 12)?.label).toBe("M 12 / W 13.5");
        expect(opts.find((o) => o.menSize === 5.5)?.label).toBe("M 5.5 / W 7 / Youth 5.5");
    });

    test("normalize clamps and snaps to half sizes", () => {
        expect(normalizeUsMenSize(9.25)).toBe(9.5);
        expect(normalizeUsMenSize(0)).toBe(1);
        expect(normalizeUsMenSize(99)).toBe(16);
        expect(normalizeUsMenSize(Number.NaN)).toBe(DEFAULT_US_MEN_SIZE);
    });

    test("missing design size falls back to Men's 9", () => {
        expect(insoleLayoutFromDesign(null).usMenSize).toBe(9);
        expect(insoleLayoutFromDesign({}).lengthMm).toBeCloseTo(INSOLE_LENGTH_MM, 6);
    });

    test("scaleGeometryToInsoleSize maps footprint bbox to target mm", () => {
        const geo = new THREE.BoxGeometry(200, 80, 10);
        geo.translate(100, 0, 5); // heel at x=0, width centered
        const sized = scaleGeometryToInsoleSize(geo, 260, 95);
        sized.computeBoundingBox();
        const box = sized.boundingBox!;
        expect(box.max.x - box.min.x).toBeCloseTo(260, 4);
        expect(box.max.y - box.min.y).toBeCloseTo(95, 4);
        expect(box.min.x).toBeCloseTo(0, 4);
        expect((box.min.y + box.max.y) / 2).toBeCloseTo(0, 4);
        geo.dispose();
        sized.dispose();
    });
});
