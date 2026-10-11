// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { FAIRED_CONTROL_DEFAULT, fairedPattern, samplePeriodicCubic } from "./faired-pattern";

describe("fairedPattern", () => {
    test("approximates a circle with 20 controls and stays inside the hull", () => {
        const n = 48;
        const targets = Array.from({ length: n }, (_, i) => {
            const a = (i / n) * Math.PI * 2;
            return { x: 40 * Math.cos(a), y: 40 * Math.sin(a), z: 0 };
        });
        const fit = fairedPattern({
            targets,
            controlCount: FAIRED_CONTROL_DEFAULT,
            wFit: 1,
            wFair: 0.4,
            sampleCount: 96,
        });
        expect(fit.controls).toHaveLength(FAIRED_CONTROL_DEFAULT);
        expect(fit.samples.length).toBeGreaterThanOrEqual(80);
        let maxR = 0;
        let minR = Infinity;
        for (const p of fit.samples) {
            const r = Math.hypot(p.x, p.y);
            maxR = Math.max(maxR, r);
            minR = Math.min(minR, r);
        }
        expect(maxR).toBeLessThan(42);
        expect(minR).toBeGreaterThan(36);
        const mid = fit.evaluate(0.25);
        const direct = samplePeriodicCubic(fit.controls, 0.25);
        expect(mid.x).toBeCloseTo(direct.x, 9);
        expect(mid.y).toBeCloseTo(direct.y, 9);
    });

    test("high-weight drag targets pull the spline without leaving the API", () => {
        const n = 32;
        const targets = Array.from({ length: n }, (_, i) => {
            const a = (i / n) * Math.PI * 2;
            return { point: { x: 20 * Math.cos(a), y: 12 * Math.sin(a), z: 0 }, weight: 1 };
        });
        const drag = { point: { x: 0, y: 22, z: 0 }, weight: 40, s01: 0.25 };
        const fit = fairedPattern({
            targets: [...targets, drag],
            controlCount: 18,
            wFit: 1,
            wFair: 0.2,
            sampleCount: 80,
        });
        const p = fit.evaluate(0.25);
        expect(p.y).toBeGreaterThan(12);
    });
});
