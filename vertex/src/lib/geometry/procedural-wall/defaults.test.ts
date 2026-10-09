// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import {
    blendedFlareDeg,
    CUP_BOWL,
    clampToBound,
    FILLET_BOUNDS,
    FLARE_BOUNDS,
    resolveWallDefaults,
    wallHeightScale,
} from "./defaults";
import { evaluateHeelCupGate } from "./hermite";

describe("biomechanics wall defaults", () => {
    test("keeps measured values inside the bound and clamps outside", () => {
        expect(clampToBound(10, FLARE_BOUNDS.heelPosterior)).toEqual({ value: 10, clamped: false });
        expect(clampToBound(4, FLARE_BOUNDS.heelPosterior)).toEqual({ value: 5, clamped: true });
        expect(clampToBound(22, FLARE_BOUNDS.lateralMidfoot)).toEqual({ value: 20, clamped: true });
        expect(clampToBound(1.91, FILLET_BOUNDS.topRimMm)).toEqual({ value: 1.91, clamped: false });
        expect(clampToBound(3.43, FILLET_BOUNDS.bottomJoinMm)).toEqual({ value: 3.43, clamped: false });
        expect(clampToBound(0.4, FILLET_BOUNDS.topRimMm)).toEqual({ value: 1, clamped: true });
    });

    test("functional uses clamped measurements; accommodative overlays heel+5 / arch 25 / top 3.0", () => {
        const functional = resolveWallDefaults({
            flareDeg: { heelPosterior: 4, heelMedial: 8, heelLateral: 8, medialArch: 18, lateralMidfoot: 22 },
            filletTopMm: 1.91,
            filletBottomMm: 3.43,
        });
        expect(functional.flareDeg.heelPosterior).toBe(5);
        expect(functional.flareDeg.medialArch).toBe(18);
        expect(functional.flareDeg.lateralMidfoot).toBe(20);
        expect(functional.wallFilletTopMm).toBe(1.91);
        expect(functional.wallFilletBottomMm).toBe(3.43);

        const acc = resolveWallDefaults(
            {
                flareDeg: {
                    heelPosterior: 4,
                    heelMedial: 8,
                    heelLateral: 8,
                    medialArch: 18,
                    lateralMidfoot: 22,
                },
                filletTopMm: 1.91,
                filletBottomMm: 3.43,
            },
            "accommodative",
        );
        expect(acc.flareDeg.heelPosterior).toBe(10);
        expect(acc.flareDeg.heelMedial).toBe(13);
        expect(acc.flareDeg.medialArch).toBe(25);
        expect(acc.wallFilletTopMm).toBe(3);
    });

    test("flare blend has no step and forefoot height tapers to the trim", () => {
        const flare = resolveWallDefaults({
            flareDeg: {
                heelPosterior: 10,
                heelMedial: 8,
                heelLateral: 8,
                medialArch: 20,
                lateralMidfoot: 12,
            },
        }).flareDeg;
        const a = blendedFlareDeg(0.21, 8, flare);
        const b = blendedFlareDeg(0.23, 8, flare);
        expect(Math.abs(a - b)).toBeLessThan(4);
        expect(wallHeightScale(0.1)).toBeGreaterThan(0.95);
        expect(wallHeightScale(0.95)).toBeLessThan(0.05);
    });

    test("heel cup 12/15/18: no vertical run > 3 mm and no curvature break", () => {
        for (const h of CUP_BOWL.gateHeightsMm) {
            const g = evaluateHeelCupGate(h);
            if (!g.ok) {
                throw new Error(
                    `cup ${h}: vert=${g.maxVerticalRunMm.toFixed(3)} breaks=${g.curvatureBreaks} drop=${g.maxCupDropMm.toFixed(3)}`,
                );
            }
        }
    });
});
