// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import {
    assertCutInOnHighRimSide,
    countClosedInflections,
    INFLECTION_K_EPS,
    INFLECTION_MIN_ARC_MM,
    medialYSignFromTopRim,
    PATTERN_ARCH_INSET_MM,
    PATTERN_HEEL_INSET_MM,
    PATTERN_MAX_DKDS,
    parseBottomPattern,
    patternCurvatureReport,
    syntheticBottomPattern,
} from "./bottom-pattern";
import { minDistToLoopXY, pointInPoly } from "./cdt-band";
import { hygieneBottomPattern } from "./pattern-hygiene";

function turning(loop: Array<{ x: number; y: number }>): number {
    let sum = 0;
    const n = loop.length;
    for (let i = 0; i < n; i++) {
        const a = loop[(i + n - 1) % n]!;
        const b = loop[i]!;
        const c = loop[(i + 1) % n]!;
        sum += Math.atan2(
            (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x),
            (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y),
        );
    }
    return sum / (Math.PI * 2);
}

describe("synthetic bottom pattern", () => {
    test("is a simple C2 inset with a deeper medial-arch cut-in", () => {
        const n = 80;
        const outline = Array.from({ length: n }, (_, i) => {
            const a = (i / n) * Math.PI * 2;
            return { x: 120 + 110 * Math.cos(a), y: 42 * Math.sin(a), z: 0 };
        });
        const bounds = { minX: 10, maxX: 230 };
        const raw = syntheticBottomPattern(outline, bounds);
        const pattern = hygieneBottomPattern(raw, {
            rimPlan: outline,
            requireInsideRim: true,
            clearanceMm: 0,
            keepFair: true,
        }).loop;
        expect(pattern.length).toBeGreaterThan(80);
        expect(Math.abs(turning(pattern) - 1)).toBeLessThan(0.05);
        let minC = Infinity;
        let maxC = 0;
        let medial = 0;
        let heelC = 0;
        let foreC = Infinity;
        const length = bounds.maxX - bounds.minX;
        for (const p of pattern) {
            expect(pointInPoly(p.x, p.y, outline) || minDistToLoopXY(p.x, p.y, outline) < 1e-3).toBe(true);
            const c = minDistToLoopXY(p.x, p.y, outline);
            minC = Math.min(minC, c);
            maxC = Math.max(maxC, c);
            const u = (p.x - bounds.minX) / length;
            if (p.y > 8 && u > 0.22 && u < 0.55) medial = Math.max(medial, c);
            if (u < 0.12) heelC = Math.max(heelC, c);
            if (u > 0.82) foreC = Math.min(foreC, c);
        }
        expect(foreC).toBeLessThan(1.5);
        expect(minC).toBeLessThan(1.5);
        expect(heelC).toBeGreaterThan(PATTERN_HEEL_INSET_MM * 0.7);
        expect(maxC).toBeGreaterThan(PATTERN_HEEL_INSET_MM * 0.7);
        expect(medial).toBeGreaterThan(PATTERN_ARCH_INSET_MM * 0.45);
        const curv = patternCurvatureReport(pattern, bounds, 1);
        expect(curv.inflections).toBe(2);
        expect(curv.lateralMinK).toBeGreaterThanOrEqual(0);
        expect(curv.maxAbsDkDs).toBeLessThanOrEqual(PATTERN_MAX_DKDS);
        expect(minC).toBeGreaterThanOrEqual(1 - 1e-3);
        const latBins = new Map<number, number[]>();
        for (const p of pattern) {
            const u = (p.x - bounds.minX) / length;
            if (p.y > 0) continue;
            const bin = Math.round(u * 20);
            const list = latBins.get(bin) ?? [];
            list.push(minDistToLoopXY(p.x, p.y, outline));
            latBins.set(bin, list);
        }
        const latMean: number[] = [];
        for (let b = 0; b <= 20; b++) {
            const list = latBins.get(b);
            if (!list?.length) continue;
            latMean.push(list.reduce((s, v) => s + v, 0) / list.length);
        }
        for (let i = 1; i < latMean.length - 1; i++) {
            const bump = latMean[i]! - 0.5 * (latMean[i - 1]! + latMean[i + 1]!);
            expect(bump).toBeLessThan(1.2);
        }
    });

    test("cut-in follows the high midfoot rim, not +Y", () => {
        const n = 80;
        const outline = Array.from({ length: n }, (_, i) => {
            const a = (i / n) * Math.PI * 2;
            const y = 42 * Math.sin(a);
            const x = 120 + 110 * Math.cos(a);
            const u = (x - 10) / 220;
            const z = u > 0.28 && u < 0.48 && y < 0 ? 18 : 6;
            return { x, y, z };
        });
        const bounds = { minX: 10, maxX: 230 };
        expect(medialYSignFromTopRim(outline, bounds)).toBe(-1);
        const raw = syntheticBottomPattern(outline, bounds, outline);
        const pattern = hygieneBottomPattern(raw, {
            rimPlan: outline,
            requireInsideRim: true,
            clearanceMm: 0,
            keepFair: true,
        }).loop;
        assertCutInOnHighRimSide(pattern, outline, bounds, -1);
        const length = bounds.maxX - bounds.minX;
        let medialNeg = 0;
        let lateralPos = 0;
        for (const p of pattern) {
            const c = minDistToLoopXY(p.x, p.y, outline);
            const u = (p.x - bounds.minX) / length;
            if (u > 0.22 && u < 0.55) {
                if (p.y < -8) medialNeg = Math.max(medialNeg, c);
                if (p.y > 8) lateralPos = Math.max(lateralPos, c);
            }
        }
        expect(medialNeg).toBeGreaterThan(PATTERN_ARCH_INSET_MM * 0.45);
        expect(lateralPos).toBeLessThan(PATTERN_ARCH_INSET_MM * 0.35);
    });

    test("inflection hysteresis ignores |k| flicker shorter than 3 mm", () => {
        const n = 40;
        const k = new Array<number>(n).fill(0.01);
        const s = k.map((_, i) => i);
        k[10] = -0.01;
        k[11] = -0.01;
        expect(s[12]! - s[10]!).toBeLessThan(INFLECTION_MIN_ARC_MM);
        expect(countClosedInflections(k, s, INFLECTION_K_EPS, INFLECTION_MIN_ARC_MM)).toBe(0);
        for (let i = 8; i <= 14; i++) k[i] = -0.01;
        expect(s[15]! - s[8]!).toBeGreaterThan(INFLECTION_MIN_ARC_MM);
        expect(countClosedInflections(k, s, INFLECTION_K_EPS, INFLECTION_MIN_ARC_MM)).toBe(2);
    });

    test("parses SVG polyline and JSON points", () => {
        const svg = parseBottomPattern('<polyline points="0,0 10,0 10,6 0,6"/>');
        expect(svg).toHaveLength(4);
        expect(svg[2]).toEqual({ x: 10, y: 6, z: 0 });
        const json = parseBottomPattern(
            JSON.stringify([
                { x: 1, y: 2 },
                { x: 3, y: 4 },
            ]),
        );
        expect(json).toEqual([
            { x: 1, y: 2, z: 0 },
            { x: 3, y: 4, z: 0 },
        ]);
    });
});
