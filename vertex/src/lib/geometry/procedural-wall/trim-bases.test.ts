// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { analyzeManifold } from "@/lib/geometry/manifold";
import { extractMergedGeometry, loadGlbFromBuffer, reorientToFootprintFrame } from "@/lib/library/loaders";
import { applyDistalSkive, skiveFeatherAt } from "./distal-skive";
import {
    SKIVE_FEATHER_MM,
    skiveLengthMm,
    skiveSlopeLimitRad,
    skiveThicknessMm,
    TRIM_GLB_LOCK,
} from "./trim-curve";
import { clipPatternFlushToCut, distalPatternAreaMm2 } from "./trim-pattern";

describe("shorter distal skive", () => {
    test("3/4 is 10 mm, or 3t above 4 mm, capped at 15", () => {
        expect(skiveLengthMm("34", 2)).toBe(10);
        expect(skiveLengthMm("34", 4)).toBe(10);
        expect(skiveLengthMm("34", 4.2)).toBeCloseTo(12.6);
        expect(skiveLengthMm("34", 8)).toBe(15);
        expect(skiveLengthMm("sulcus", 9)).toBe(6);
    });

    test("a met pad is gone before the taper starts", () => {
        const field = {
            kind: "34" as const,
            cut: [
                { x: 0, y: -20, tx: 0, ty: 1, nx: -1, ny: 0 },
                { x: 0, y: 20, tx: 0, ty: 1, nx: -1, ny: 0 },
            ],
            lengthMm: [10, 10],
            t0Mm: [5, 5],
        };
        const onStart = skiveFeatherAt(field, -10, 0);
        const fourProximal = skiveFeatherAt(field, -14, 0);
        const metFourProximal = skiveFeatherAt(field, -14, 0, SKIVE_FEATHER_MM);
        const metClear = skiveFeatherAt(field, -10 - 2 * SKIVE_FEATHER_MM, 0, SKIVE_FEATHER_MM);
        expect(onStart).toBe(0);
        expect(fourProximal).toBeGreaterThan(0);
        expect(fourProximal).toBeLessThan(1);
        expect(metFourProximal).toBe(0);
        expect(metClear).toBeCloseTo(1);
    });

    test("smoothstep ends at 0.5 and is flat at the start", () => {
        expect(skiveThicknessMm(5, 0, 10)).toBeCloseTo(5);
        expect(skiveThicknessMm(5, 10, 10)).toBeCloseTo(0.5);
        const mid = skiveThicknessMm(5, 5, 10);
        expect(mid).toBeGreaterThan(0.5);
        expect(mid).toBeLessThan(5);
        const slope = Math.atan((skiveThicknessMm(5, 0, 10) - skiveThicknessMm(5, 1, 10)) / 1);
        expect(slope).toBeLessThan(skiveSlopeLimitRad(5, 10));
    });

    test("a met-side edge crossing the start does not step", () => {
        const pos = new Float32Array([0, 0, 4, 10, 0, 4, 0, 10, 4, 10, 10, 4, 20, 0, 4, 20, 10, 4]);
        const idx = new Uint32Array([0, 1, 2, 1, 3, 2, 1, 4, 3, 4, 5, 3]);
        const rim = [0, 1, 4, 5, 3, 2];
        const skived = applyDistalSkive(pos, idx, rim, "sulcus");
        let maxStep = 0;
        for (let i = 0; i < skived.pos.length / 3; i++) {
            const z = skived.pos[i * 3 + 2]!;
            if (z > 4.05) maxStep = Math.max(maxStep, z - 4);
        }
        expect(maxStep).toBeLessThanOrEqual(0.05);
    });
});

describe("trimmed top GLBs", () => {
    for (const file of ["SAMPLE_Top_34.glb", "SAMPLE_Top_sulcus.glb"]) {
        test(`${file} is one top boundary`, async () => {
            const buf = readFileSync(resolve("vertex/public/Templates", file));
            const group = await loadGlbFromBuffer(
                buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
            );
            const merged = extractMergedGeometry(group);
            expect(merged).toBeTruthy();
            const geo = reorientToFootprintFrame(merged!.geometry, {
                preserveAuthorZ: true,
                lock: TRIM_GLB_LOCK,
            });
            const report = analyzeManifold(geo);
            expect(report.nonManifoldEdges).toBe(0);
            expect(report.openEdges).toBeGreaterThan(100);
            expect(report.isWatertight).toBe(false);
        });
    }
});

describe("pattern flush with the cut", () => {
    test("nothing remains distal of the cut", () => {
        const cut = [
            { x: 0, y: -40, tx: 0, ty: 1, nx: -1, ny: 0 },
            { x: 0, y: 0, tx: 0, ty: 1, nx: -1, ny: 0 },
            { x: 0, y: 40, tx: 0, ty: 1, nx: -1, ny: 0 },
        ];
        const pattern = [
            { x: -80, y: -30, z: 0 },
            { x: 20, y: -30, z: 0 },
            { x: 20, y: 30, z: 0 },
            { x: -80, y: 30, z: 0 },
        ];
        const clipped = clipPatternFlushToCut(pattern, {
            kind: "sulcus",
            cut,
            lengthMm: [6, 6, 6],
            t0Mm: [2, 2, 2],
        });
        expect(distalPatternAreaMm2(clipped, cut)).toBeLessThan(1);
        const distal = clipped.filter((p) => p.x > 0.2);
        expect(distal.length).toBe(0);
    });
});
