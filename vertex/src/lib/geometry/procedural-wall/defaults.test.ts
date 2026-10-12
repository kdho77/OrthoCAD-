// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import {
    applyMeasuredUnclamped,
    blendedFlareDeg,
    CUP_BOWL,
    FILLET_BOUNDS,
    FLARE_BOUNDS,
    resolveWallDefaults,
    wallHeightScale,
} from "./defaults";
import { evaluateHeelCupGate } from "./hermite";

describe("biomechanics wall defaults", () => {
    test("stock flare defaults match measured Default.glb with widened bounds", () => {
        expect(FLARE_BOUNDS.heelPosterior).toEqual({ recommended: 23.9, min: 10, max: 35 });
        expect(FLARE_BOUNDS.heelMedial).toEqual({ recommended: 27.7, min: 10, max: 35 });
        expect(FLARE_BOUNDS.heelLateral).toEqual({ recommended: 27.8, min: 10, max: 35 });
        expect(FLARE_BOUNDS.medialArch).toEqual({ recommended: 23.0, min: 10, max: 35 });
        expect(FLARE_BOUNDS.lateralMidfoot).toEqual({ recommended: 41.0, min: 15, max: 50 });
        expect(FILLET_BOUNDS.topRimMm).toEqual({ recommended: 0.5, min: 0, max: 3 });
        expect(FILLET_BOUNDS.bottomJoinMm).toEqual({ recommended: 0, min: 0, max: 5 });
    });

    test("does not clamp measured flare; reports when it sits outside the bound", () => {
        expect(applyMeasuredUnclamped(41.0, FLARE_BOUNDS.lateralMidfoot)).toEqual({
            value: 41.0,
            clamped: false,
        });
        expect(applyMeasuredUnclamped(8, FLARE_BOUNDS.heelPosterior)).toEqual({
            value: 8,
            clamped: true,
        });
        expect(applyMeasuredUnclamped(null, FLARE_BOUNDS.medialArch)).toEqual({
            value: 23.0,
            clamped: false,
        });
    });

    test("functional and accommodative share the same stock defaults", () => {
        const measured = {
            flareDeg: {
                heelPosterior: 23.9,
                heelMedial: 27.7,
                heelLateral: 27.8,
                medialArch: 23.0,
                lateralMidfoot: 41.0,
            },
            filletTopMm: 0.067,
            filletBottomMm: 0.067,
        };
        const functional = resolveWallDefaults(measured);
        const acc = resolveWallDefaults(measured, "accommodative");
        expect(functional.flareDeg).toEqual(acc.flareDeg);
        expect(functional.wallFilletTopMm).toBe(0.5);
        expect(acc.wallFilletTopMm).toBe(0.5);
        expect(functional.wallFilletBottomMm).toBeCloseTo(0.067, 5);
        expect(acc.wallFilletBottomMm).toBeCloseTo(0.067, 5);
        expect(functional.report.some((r) => r.region === "accommodative overlay")).toBe(false);
        expect(functional.flareDeg.lateralMidfoot).toBe(41.0);
        expect(functional.flareDeg.heelPosterior).toBe(23.9);
        expect(functional.flareDeg.heelMedial).toBe(27.7);
    });

    test("flare blend has no step and forefoot height tapers to the trim", () => {
        const flare = resolveWallDefaults({
            flareDeg: {
                heelPosterior: 23.9,
                heelMedial: 27.7,
                heelLateral: 27.8,
                medialArch: 23.0,
                lateralMidfoot: 41.0,
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
