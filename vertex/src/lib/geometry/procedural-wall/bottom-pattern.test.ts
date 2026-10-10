// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import {
    PATTERN_ARCH_INSET_MM,
    PATTERN_FOREFOOT_INSET_MM,
    PATTERN_HEEL_LATERAL_INSET_MM,
    parseBottomPattern,
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
        const pattern = hygieneBottomPattern(raw, { rimPlan: outline, requireInsideRim: true }).loop;
        expect(pattern.length).toBeGreaterThan(80);
        expect(Math.abs(turning(pattern) - 1)).toBeLessThan(0.05);
        let minC = Infinity;
        let maxC = 0;
        let medial = 0;
        const length = bounds.maxX - bounds.minX;
        for (const p of pattern) {
            expect(pointInPoly(p.x, p.y, outline)).toBe(true);
            const c = minDistToLoopXY(p.x, p.y, outline);
            minC = Math.min(minC, c);
            maxC = Math.max(maxC, c);
            const u = (p.x - bounds.minX) / length;
            if (p.y > 8 && u > 0.22 && u < 0.55) medial = Math.max(medial, c);
        }
        expect(minC).toBeGreaterThan(PATTERN_FOREFOOT_INSET_MM * 0.45);
        expect(maxC).toBeGreaterThan(PATTERN_HEEL_LATERAL_INSET_MM + 1.5);
        expect(medial).toBeGreaterThan(PATTERN_ARCH_INSET_MM * 0.45);
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
