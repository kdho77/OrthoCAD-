// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import * as THREE from "three";
import {
    DEFAULT_STOCK_ARCH_APEX_HEIGHT_MM,
    fitArchParamsFromApexMarker,
    HEEL_CUP_WIDTH_CLEARANCE_MM,
    heelCupWidthParamForTarget,
} from "@/lib/geometry/fit-scan-clinical-params";
import { HEEL_CUP_WIDTH_MAX_LATERAL_SCALE } from "@/lib/geometry/height-field";

describe("fitArchParamsFromApexMarker", () => {
    test("additive arch height is gap above base surface at marker XY", () => {
        const heel = new THREE.Vector3(0, 0, 0);
        const baseSurfaceZ = 20;
        const arch = new THREE.Vector3(0.42 * 260, 15, baseSurfaceZ + 6);
        const fit = fitArchParamsFromApexMarker({
            archPointBase: arch,
            baseSurfaceZ,
            heelSeatBase: heel,
            lengthMm: 260,
            lengthMin: 0,
            lengthSize: 260,
            stockArchHeightMm: DEFAULT_STOCK_ARCH_APEX_HEIGHT_MM,
        });
        expect(fit.gapMm).toBeCloseTo(6, 5);
        expect(fit.archHeightMm).toBeCloseTo(6, 5);
        expect(fit.scanArchHeightMm).toBeCloseTo(26, 5);
        expect(Math.abs(fit.apexMoveMm)).toBeLessThan(1);
    });

    test("clamps negative gap to 0", () => {
        const fit = fitArchParamsFromApexMarker({
            archPointBase: new THREE.Vector3(100, 10, 18),
            baseSurfaceZ: 23.5,
            heelSeatBase: new THREE.Vector3(0, 0, 0),
            lengthMm: 260,
        });
        expect(fit.gapMm).toBeCloseTo(-5.5, 5);
        expect(fit.archHeightMm).toBe(0);
    });
});

describe("heelCupWidthParamForTarget", () => {
    test("targets scan heel + 5 mm clearance", () => {
        const fit = heelCupWidthParamForTarget({
            scanHeelWidthMm: 60,
            baseHeelWidthMm: 55,
            clearanceMm: HEEL_CUP_WIDTH_CLEARANCE_MM,
        });
        expect(fit.targetCupWidthMm).toBe(65);
        // scale = 65/55 ≈ 1.182 → param = 0.182/0.25 * 10 ≈ 7.3
        const expected = ((65 / 55 - 1) / HEEL_CUP_WIDTH_MAX_LATERAL_SCALE) * 10;
        expect(fit.heelCupWidthMm).toBeCloseTo(Math.round(expected * 10) / 10, 5);
    });

    test("narrows when scan+clearance < base", () => {
        const fit = heelCupWidthParamForTarget({
            scanHeelWidthMm: 50,
            baseHeelWidthMm: 60,
        });
        expect(fit.targetCupWidthMm).toBe(55);
        // scale = 55/60 ≈ 0.917 → param = (0.917-1)/0.25 * 10 ≈ −3.3
        const expected = ((55 / 60 - 1) / HEEL_CUP_WIDTH_MAX_LATERAL_SCALE) * 10;
        expect(fit.heelCupWidthMm).toBeCloseTo(Math.round(expected * 10) / 10, 5);
        expect(fit.heelCupWidthMm).toBeLessThan(0);
    });
});
