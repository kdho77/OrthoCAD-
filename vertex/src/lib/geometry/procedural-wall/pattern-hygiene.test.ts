// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { INSOLE_LENGTH_MM, INSOLE_WIDTH_MM } from "@/lib/geometry/layout";
import { insoleLayoutForUsMenSize, scaleGeometryToInsoleSize } from "@/lib/geometry/shoe-size";
import { minDistToLoopXY, pointInPoly } from "./cdt-band";
import { extractTopOnlyModel } from "./extract";
import {
    applyInsoleFootprintScale,
    clipPatternInsideRim,
    clipperRoundInset,
    clipperUnion,
    insoleFootprintAnchorFromBounds,
    maxOutsideRimViolationMm,
    maxStationToPolylineMm,
    PATTERN_RIM_CLEARANCE_MM,
    signedRimInsetMmPattern,
    symmetricDifferenceAreaMm2,
    turningNumber,
} from "./pattern-hygiene";
import { SAMPLE_TOP_ASSET_ID, SAMPLE_TOP_NAME } from "./sample-top-id";
import { buildProceduralViewerPattern, sampleTopFromArrayBuffer } from "./sample-top-preview";
import { minInsetForLeanMm } from "./station-gates";

function ellipse(n: number, rx: number, ry: number): Array<{ x: number; y: number; z: number }> {
    return Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2;
        return { x: rx * Math.cos(a), y: ry * Math.sin(a), z: 0 };
    });
}

describe("pattern hygiene", () => {
    test("Clipper2 union makes a simple +1 outline", () => {
        const loop = ellipse(48, 40, 18);
        const unioned = clipperUnion(loop);
        expect(Math.abs(turningNumber(unioned) - 1)).toBeLessThan(0.05);
        const inset = clipperRoundInset(unioned, 3);
        expect(inset.length).toBeGreaterThan(8);
        expect(Math.abs(turningNumber(inset) - 1)).toBeLessThan(0.05);
    });

    test("1 mm outside rim clips with warning; 5 mm outside throws", () => {
        const rim = ellipse(32, 20, 12);
        const mild = ellipse(24, 21, 13);
        expect(maxOutsideRimViolationMm(mild, rim)).toBeGreaterThan(0.5);
        expect(maxOutsideRimViolationMm(mild, rim)).toBeLessThan(2);
        const { loop: clipped, case: mildCase } = clipPatternInsideRim(mild, rim, 0.5, 64, {
            sizeLabel: "test",
        });
        expect(mildCase).toBe("clip_warn");
        expect(clipped.length).toBeGreaterThan(8);
        for (const p of clipped) {
            expect(pointInPoly(p.x, p.y, rim) || minDistToLoopXY(p.x, p.y, rim) < 1e-3).toBe(true);
        }

        const severe = ellipse(24, 26, 16);
        expect(maxOutsideRimViolationMm(severe, rim)).toBeGreaterThan(4);
        expect(() => clipPatternInsideRim(severe, rim, 0.5, 64)).toThrow(/outside the TopSheet rim/);
    });

    test("inside outline passes through bit-identical", () => {
        const rim = ellipse(32, 20, 12);
        const pattern = ellipse(24, 16, 9);
        const {
            loop,
            case: clipCase,
            displacementMm,
            symmetricDifferenceMm2,
        } = clipPatternInsideRim(pattern, rim, 2.5, 64);
        expect(maxOutsideRimViolationMm(pattern, rim)).toBe(0);
        expect(clipCase).toBe("inside");
        expect(displacementMm).toBe(0);
        expect(symmetricDifferenceMm2).toBe(0);
        expect(loop).toEqual(pattern);
        for (let i = 0; i < pattern.length; i++) {
            expect(loop[i]!.x).toBe(pattern[i]!.x);
            expect(loop[i]!.y).toBe(pattern[i]!.y);
            expect(loop[i]!.z).toBe(pattern[i]!.z);
        }
    });

    test("1 mm local violation moves only the clipped span plus one station", () => {
        const n = 80;
        const rim = ellipse(n, 100, 60);
        const pattern = ellipse(n, 90, 52);
        const bump = [18, 19, 20, 21, 22];
        for (const i of bump) {
            const ang = (i / n) * Math.PI * 2;
            const rimX = 100 * Math.cos(ang);
            const rimY = 60 * Math.sin(ang);
            const radial = Math.hypot(rimX, rimY);
            pattern[i] = { x: rimX + (rimX / radial) * 1, y: rimY + (rimY / radial) * 1, z: 0 };
        }
        const clearance = 0.5;
        const maxOut = maxOutsideRimViolationMm(pattern, rim);
        expect(maxOut).toBeGreaterThan(0.5);
        expect(maxOut).toBeLessThan(2);
        const violate = pattern.map((p) => signedRimInsetMmPattern(p, rim) < clearance - 1e-6);
        const resampled = violate.slice();
        for (let i = 0; i < n; i++) {
            if (!violate[i]) continue;
            resampled[(i - 1 + n) % n] = true;
            resampled[(i + 1) % n] = true;
        }
        expect(resampled.some((flag) => !flag)).toBe(true);
        const {
            loop,
            case: clipCase,
            displacementMm,
            symmetricDifferenceMm2,
        } = clipPatternInsideRim(pattern, rim, clearance, n);
        expect(clipCase).toBe("clip_warn");
        expect(loop.length).toBe(pattern.length);
        let moved = 0;
        for (let i = 0; i < n; i++) {
            if (!resampled[i]) {
                expect(loop[i]!.x).toBe(pattern[i]!.x);
                expect(loop[i]!.y).toBe(pattern[i]!.y);
                expect(loop[i]!.z).toBe(pattern[i]!.z);
            } else if (loop[i]!.x !== pattern[i]!.x || loop[i]!.y !== pattern[i]!.y) {
                moved++;
            }
        }
        expect(moved).toBeGreaterThan(0);
        for (const p of loop) {
            expect(pointInPoly(p.x, p.y, rim) || minDistToLoopXY(p.x, p.y, rim) < 1e-3).toBe(true);
        }
        expect(displacementMm).toBeGreaterThan(0);
        expect(displacementMm).toBeLessThan(4);
        expect(displacementMm).toBeCloseTo(maxStationToPolylineMm(pattern, loop), 6);
        expect(symmetricDifferenceMm2).toBeGreaterThan(0);
        expect(symmetricDifferenceMm2).toBeCloseTo(symmetricDifferenceAreaMm2(pattern, loop), 4);
    });

    test("footprint scale moves stations between sizes", () => {
        const bounds = { minX: 0, maxX: INSOLE_LENGTH_MM, minY: -47.5, maxY: 47.5 };
        const anchor = insoleFootprintAnchorFromBounds(bounds);
        const loop = ellipse(48, 100, 30).map((p) => ({ x: p.x + 20, y: p.y, z: 0 }));
        const m9 = insoleLayoutForUsMenSize(9);
        const m12 = insoleLayoutForUsMenSize(12);
        const at9 = applyInsoleFootprintScale(loop, anchor, m9.lengthMm, m9.widthMm);
        const at12 = applyInsoleFootprintScale(loop, anchor, m12.lengthMm, m12.widthMm);
        const toe9 = at9.reduce((best, p) => (p.x > best.x ? p : best), at9[0]!);
        const toe12 = at12.reduce((best, p) => (p.x > best.x ? p : best), at12[0]!);
        expect(toe12.x).toBeGreaterThan(toe9.x + 5);
    });

    test("size sweep keeps stations inside rim inset 0.5 mm", () => {
        const rimRef = ellipse(64, INSOLE_LENGTH_MM * 0.48, INSOLE_WIDTH_MM * 0.45).map((p) => ({
            x: p.x + INSOLE_LENGTH_MM * 0.5,
            y: p.y,
            z: 0,
        }));
        const bounds = {
            minX: 0,
            maxX: INSOLE_LENGTH_MM,
            minY: -INSOLE_WIDTH_MM / 2,
            maxY: INSOLE_WIDTH_MM / 2,
        };
        const anchor = insoleFootprintAnchorFromBounds(bounds);
        const basePattern = ellipse(80, INSOLE_LENGTH_MM * 0.42, INSOLE_WIDTH_MM * 0.38).map((p) => ({
            x: p.x + INSOLE_LENGTH_MM * 0.52,
            y: p.y * 0.85,
            z: 0,
        }));
        const sizes = [
            insoleLayoutForUsMenSize(1),
            insoleLayoutForUsMenSize(8.5),
            insoleLayoutForUsMenSize(16),
        ];
        const scaledLoops: Array<Array<{ x: number; y: number }>> = [];
        for (const layout of sizes) {
            const rim = applyInsoleFootprintScale(rimRef, anchor, layout.lengthMm, layout.widthMm);
            const pattern = applyInsoleFootprintScale(basePattern, anchor, layout.lengthMm, layout.widthMm);
            const { loop } = clipPatternInsideRim(pattern, rim, PATTERN_RIM_CLEARANCE_MM, 120, {
                sizeLabel: `US M${layout.usMenSize}`,
            });
            scaledLoops.push(loop);
            const rimGate = clipperRoundInset(rim, PATTERN_RIM_CLEARANCE_MM);
            for (const p of loop) {
                const inset = pointInPoly(p.x, p.y, rimGate)
                    ? minDistToLoopXY(p.x, p.y, rimGate)
                    : -minDistToLoopXY(p.x, p.y, rimGate);
                expect(inset).toBeGreaterThanOrEqual(PATTERN_RIM_CLEARANCE_MM - 0.01);
            }
        }
        expect(scaledLoops[0]![0]!.x).not.toBeCloseTo(scaledLoops[2]![0]!.x, 1);
    });

    test("US M8.5 Full Contact pattern clip metrics", async () => {
        const buf = readFileSync(resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb"));
        const geo = await sampleTopFromArrayBuffer(
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        const layout = insoleLayoutForUsMenSize(8.5);
        const scaled = scaleGeometryToInsoleSize(geo, layout.lengthMm, layout.widthMm);
        if (scaled !== geo) geo.dispose();
        const pattern = buildProceduralViewerPattern(scaled, "full_contact");
        const model = extractTopOnlyModel(scaled, { id: SAMPLE_TOP_ASSET_ID, name: SAMPLE_TOP_NAME });
        const pos = model.top.meshPositions;
        const rimIdx = model.top.rimLocal ?? [];
        expect(pos && rimIdx.length >= 3).toBe(true);
        const rimPlan = rimIdx.map((i) => ({
            x: pos![i * 3]!,
            y: pos![i * 3 + 1]!,
            z: 0,
        }));
        const maxPreClipMm = maxOutsideRimViolationMm(pattern, rimPlan);
        const clearance = Math.max(0.5, minInsetForLeanMm(0.5, 2, 0));
        const n = Math.max(160, pattern.length);
        const {
            loop,
            case: clipCase,
            clippedAreaMm2,
            displacementMm,
            symmetricDifferenceMm2,
        } = clipPatternInsideRim(pattern, rimPlan, clearance, n, {
            sizeLabel: "US M8.5",
        });
        const clipWarn = clippedAreaMm2 > 0.5;
        console.log(
            "[M85-CLIP-METRICS]",
            JSON.stringify({
                maxPreClipMm,
                clippedAreaMm2,
                displacementMm,
                symmetricDifferenceMm2,
                clipCase,
                clipWarn,
            }),
        );
        expect(maxPreClipMm).toBeLessThanOrEqual(0.5);
        expect(clippedAreaMm2).toBe(0);
        expect(displacementMm).toBe(0);
        expect(symmetricDifferenceMm2).toBe(0);
        expect(clipCase).toBe("inside");
        expect(loop.length).toBe(pattern.length);
        for (let i = 0; i < pattern.length; i++) {
            expect(loop[i]!.x).toBe(pattern[i]!.x);
            expect(loop[i]!.y).toBe(pattern[i]!.y);
            expect(loop[i]!.z).toBe(pattern[i]!.z);
        }
        scaled.dispose();
    }, 60_000);
});
