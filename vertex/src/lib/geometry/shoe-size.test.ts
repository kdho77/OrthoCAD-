// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import * as THREE from "three";
import { INSOLE_LENGTH_MM, INSOLE_WIDTH_MM } from "@/lib/geometry/layout";
import {
    convertSizingToSystem,
    DEFAULT_US_MEN_SIZE,
    displaySizeForUsMen,
    euShoeSizeOptions,
    euToUsMen,
    footLengthMmOptions,
    formatEuShoeSizeLabel,
    formatUkShoeSizeLabel,
    formatUsShoeSizeLabel,
    insoleLayoutForFootLengthMm,
    insoleLayoutForUkSize,
    insoleLayoutForUsMenSize,
    insoleLayoutFromDesign,
    normalizeFootLengthMm,
    normalizeUsMenSize,
    REFERENCE_US_MEN_SIZE,
    scaleGeometryToInsoleSize,
    scaleSourceShapeToFootprint,
    shoeSizePickerOptions,
    ukFootLengthMm,
    ukShoeSizeOptions,
    usMenFootLengthMm,
    usMenSizeFromDisplayUnit,
    usMenToEu,
    usMenToUk,
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
        expect(insoleLayoutFromDesign({}).sizeSystem).toBe("us");
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

describe("UK and mm sizing systems", () => {
    test("UK ≈ US men − 1 at the same foot length", () => {
        expect(usMenToUk(9)).toBe(8);
        expect(formatUkShoeSizeLabel(8)).toBe("UK 8");
        const us = insoleLayoutForUsMenSize(9);
        const uk = insoleLayoutForUkSize(8);
        expect(uk.footLengthMm).toBeCloseTo(us.footLengthMm, 6);
        expect(uk.lengthMm).toBeCloseTo(us.lengthMm, 6);
    });

    test("UK dropdown options exist", () => {
        const opts = ukShoeSizeOptions();
        expect(opts[0]?.ukSize).toBe(1);
        expect(opts.find((o) => o.ukSize === 8)?.label).toBe("UK 8");
    });

    test("mm options are 5 mm Mondopoint steps", () => {
        const opts = footLengthMmOptions();
        expect(opts[0]?.footLengthMm).toBe(210);
        expect(opts.at(-1)?.footLengthMm).toBe(320);
        expect(opts[1]!.footLengthMm - opts[0]!.footLengthMm).toBe(5);
    });

    test("mm length scales template proportionally", () => {
        const ref = usMenFootLengthMm(9);
        const layout = insoleLayoutForFootLengthMm(ref, "mm");
        expect(layout.lengthMm).toBeCloseTo(INSOLE_LENGTH_MM, 4);
        const longer = insoleLayoutForFootLengthMm(ref + 20, "mm");
        expect(longer.lengthMm).toBeGreaterThan(layout.lengthMm);
    });

    test("switching systems preserves foot length", () => {
        const fromUs = convertSizingToSystem({ sizeSystem: "us", usMenSize: 12 }, "uk");
        expect(fromUs.sizeSystem).toBe("uk");
        expect(fromUs.ukSize).toBe(11);
        expect(ukFootLengthMm(fromUs.ukSize)).toBeCloseTo(usMenFootLengthMm(12), 6);

        const toMm = convertSizingToSystem(fromUs, "mm");
        expect(toMm.sizeSystem).toBe("mm");
        expect(toMm.footLengthMm % 5).toBe(0);

        const backUs = convertSizingToSystem(toMm, "us");
        expect(backUs.sizeSystem).toBe("us");
        // Nearest half-size after 5 mm snap — within one size of original.
        expect(Math.abs(backUs.usMenSize - 12)).toBeLessThanOrEqual(1);
    });

    test("insoleLayoutFromDesign respects sizeSystem", () => {
        const uk = insoleLayoutFromDesign({ sizeSystem: "uk", ukSize: 8 });
        expect(uk.sizeSystem).toBe("uk");
        expect(uk.ukSize).toBe(8);

        const mm = insoleLayoutFromDesign({ sizeSystem: "mm", footLengthMm: 270 });
        expect(mm.sizeSystem).toBe("mm");
        expect(mm.footLengthMm).toBe(270);
    });
});

describe("EU sizing and client picker", () => {
    test("EU labels and US men's 9 maps to EU 42", () => {
        expect(usMenToEu(9)).toBe(42);
        expect(formatEuShoeSizeLabel(42)).toBe("EU 42");
        expect(euToUsMen(42)).toBe(9);
    });

    test("picker labels keep M/W/Youth on one line", () => {
        const us = shoeSizePickerOptions("us");
        expect(us.find((o) => o.value === 12)?.label).toBe("M 12 / W 13.5");
        expect(us.find((o) => o.value === 5.5)?.label).toBe("M 5.5 / W 7 / Youth 5.5");
    });

    test("US, UK, EU and mm selections map to the same canonical men's 9", () => {
        const layout9 = insoleLayoutForUsMenSize(9);
        expect(usMenSizeFromDisplayUnit("us", 9)).toBe(9);
        expect(usMenSizeFromDisplayUnit("uk", usMenToUk(9))).toBe(9);
        expect(usMenSizeFromDisplayUnit("eu", usMenToEu(9))).toBe(9);
        const mmNine = displaySizeForUsMen("mm", 9);
        expect(mmNine).toBe(260);
        expect(Math.abs(usMenSizeFromDisplayUnit("mm", mmNine) - 9)).toBeLessThanOrEqual(1);
        expect(layout9.lengthMm).toBeCloseTo(INSOLE_LENGTH_MM, 6);

        const euOpts = euShoeSizeOptions();
        const eu42 = euOpts.find((o) => o.euSize === 42);
        expect(eu42?.usMenSize).toBe(9);
        expect(eu42?.footLengthMm).toBeCloseTo(usMenFootLengthMm(9), 6);
    });

    test("round-trip saved US men's size shows the correct option in each unit", () => {
        const saved = 10.5;
        expect(displaySizeForUsMen("us", saved)).toBe(10.5);
        expect(displaySizeForUsMen("uk", saved)).toBe(usMenToUk(10.5));
        expect(displaySizeForUsMen("eu", saved)).toBe(usMenToEu(10.5));
        expect(displaySizeForUsMen("mm", saved)).toBe(normalizeFootLengthMm(usMenFootLengthMm(saved)));

        const usLabel = shoeSizePickerOptions("us").find((o) => o.value === saved)?.label;
        expect(usLabel).toBe(formatUsShoeSizeLabel(saved));

        expect(usMenSizeFromDisplayUnit("eu", displaySizeForUsMen("eu", saved))).toBe(saved);
        expect(usMenSizeFromDisplayUnit("uk", displaySizeForUsMen("uk", saved))).toBe(saved);
        expect(usMenSizeFromDisplayUnit("us", displaySizeForUsMen("us", saved))).toBe(saved);
    });

    test("mm options expose canonical men's size for export", () => {
        const mm260 = footLengthMmOptions().find((o) => o.footLengthMm === 260);
        expect(mm260?.usMenSize).toBe(usMenSizeFromDisplayUnit("mm", 260));
    });
});

describe("scaleSourceShapeToFootprint", () => {
    test("scale 1 does not write, and only relief above the 2 mm floor scales", () => {
        const geometry = new THREE.BufferGeometry();
        const src = new Float32Array([0, -10, 2, 100, 10, 2, 50, 0, 22]);
        geometry.setAttribute("position", new THREE.BufferAttribute(src.slice(), 3));
        const before = Array.from(src);
        scaleSourceShapeToFootprint(geometry, 1, 2);
        const stayed = geometry.getAttribute("position").array as Float32Array;
        expect(Array.from(stayed)).toEqual(before);

        const s = 23 / 31;
        scaleSourceShapeToFootprint(geometry, s, 2);
        const pos = geometry.getAttribute("position");
        const cx = 50;
        const cy = 0;
        expect(pos.getX(0)).toBeCloseTo(cx + (0 - cx) * s, 5);
        expect(pos.getY(0)).toBeCloseTo(cy + (-10 - cy) * s, 5);
        expect(pos.getZ(0)).toBeCloseTo(2, 6);
        expect(pos.getZ(1)).toBeCloseTo(2, 6);
        expect(pos.getX(2)).toBeCloseTo(cx, 6);
        expect(pos.getZ(2)).toBeCloseTo(2 + (22 - 2) * s, 5);
    });
});
