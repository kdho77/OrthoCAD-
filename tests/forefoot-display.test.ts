// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import { forefootWidthLongitudinalEnvelope, type HeightFieldParams } from "@/lib/geometry/height-field";
import {
    applyForefootPlanShift,
    forefootPlanBoundsOfPositions,
    shiftClosedLoopForefoot,
} from "@/lib/geometry/procedural-wall/modifiers";
import { composePrintSolidTop } from "@/lib/geometry/procedural-wall/print-solid-compose";
import { reconstructProceduralPreview } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import { extractMeshOutline } from "@/lib/geometry/trimline";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { SideCorrections } from "@/types";
import { loadSampleTopGlb } from "./helpers/load-sample-top-glb";

function neutral(): SideCorrections {
    return {
        forefootPostingDeg: 0,
        rearfootPostingDeg: 0,
        medialSkiveMm: 0,
        lateralSkiveMm: 0,
        archFillMm: 0,
        archHeightMm: 0,
        archEaseMm: 0,
        heelCupDepthMm: 0,
        heelCupHeightMm: 0,
        heelCupWidthMm: 0,
        forefootWidthMm: 0,
        heelLiftMm: 0,
        apexMoveMm: 0,
        medialFlangeMm: 0,
        lateralFlangeMm: 0,
    };
}

function field(mm: number): HeightFieldParams {
    const layout = insoleLayoutForUsMenSize(9);
    return {
        side: "right",
        lengthMm: layout.lengthMm,
        widthMm: layout.widthMm,
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        corrections: { ...neutral(), forefootWidthMm: mm },
        elements: [],
        includeSkives: false,
        includeElements: false,
        trimline: null,
    };
}

function ySpan(geo: BufferGeometry, u0: number, u1: number, countLimit?: number) {
    const pos = geo.getAttribute("position");
    if (!pos) return null;
    const arr = pos.array as Float32Array;
    const n = countLimit ?? pos.count;
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < n; i++) {
        const x = arr[i * 3]!;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
    }
    const len = Math.max(1e-6, maxX - minX);
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
        const u = (arr[i * 3]! - minX) / len;
        if (u < u0 || u > u1) continue;
        const y = arr[i * 3 + 1]!;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    return { minY, maxY, width: maxY - minY };
}

function shiftDisplay(
    base: BufferGeometry,
    mm: number,
    outline?: ReadonlyArray<{ x: number; y: number }>,
): BufferGeometry {
    const geo = base.clone();
    if (mm === 0) return geo;
    const pos = geo.getAttribute("position");
    if (!pos) return geo;
    const bounds = forefootPlanBoundsOfPositions(pos.array as Float32Array);
    applyForefootPlanShift(pos.array as Float32Array, bounds, mm, undefined, outline);
    pos.needsUpdate = true;
    return geo;
}

describe("forefoot viewport display", () => {
    test("closed loop uses the export field and 0 mm is a no-op", () => {
        const loop = [
            { x: 0, y: 0, z: 0 },
            { x: 130, y: 40, z: 0 },
            { x: 260, y: 0, z: 0 },
            { x: 130, y: -40, z: 0 },
        ];
        const bounds = { minX: 0, maxX: 260, minY: -40, maxY: 40 };
        const same = shiftClosedLoopForefoot(loop, 0, bounds);
        expect(same.map((p) => p.y)).toEqual(loop.map((p) => p.y));
        const wide = shiftClosedLoopForefoot(loop, 10, bounds);
        const mid = wide[1]!;
        const heel = wide[0]!;
        expect(mid.x).toBe(130);
        expect(mid.y).toBeCloseTo(40 + 10 * forefootWidthLongitudinalEnvelope(130 / 260), 3);
        expect(heel.y).toBeCloseTo(0, 5);
        const narrow = shiftClosedLoopForefoot(loop, -10, bounds);
        expect(narrow[1]!.y).toBeCloseTo(40 - 10 * forefootWidthLongitudinalEnvelope(0.5), 3);
        expect(narrow[3]!.y).toBeCloseTo(-40 + 10 * forefootWidthLongitudinalEnvelope(0.5), 3);
    });

    test("ramp onset derivative stays near 16 degrees, not 35", () => {
        expect(forefootWidthLongitudinalEnvelope(0.45)).toBe(0);
        expect(forefootWidthLongitudinalEnvelope(0.449)).toBe(0);
        expect(forefootWidthLongitudinalEnvelope(0.65)).toBeCloseTo(1, 6);
        const length = insoleLayoutForUsMenSize(9).lengthMm;
        let maxDeg = 0;
        let at = 0;
        for (let u = 0.45; u <= 0.65; u += 0.002) {
            const dEnv =
                forefootWidthLongitudinalEnvelope(u + 0.001) - forefootWidthLongitudinalEnvelope(u - 0.001);
            const slope = (dEnv / 0.002) * (10 / length);
            const deg = (Math.atan(Math.abs(slope)) * 180) / Math.PI;
            if (deg > maxDeg) {
                maxDeg = deg;
                at = u;
            }
        }
        console.log(
            "[RAMP-DEG]",
            JSON.stringify({ maxDeg: Number(maxDeg.toFixed(2)), at: Number(at.toFixed(3)) }),
        );
        expect(maxDeg).toBeGreaterThan(8);
        expect(maxDeg).toBeLessThan(20);
    });

    test("display top matches the export rim at ±10 and the toe gap stays under 1 mm", async () => {
        const raw = await loadSampleTopGlb();
        const base = await composePrintSolidTop(raw, { sourceField: field(0) });
        const before = (base.getAttribute("position")!.array as Float32Array).slice();
        const outline = extractMeshOutline(base)?.points.map((p) => ({ x: p.x, y: p.y }));
        const zero = shiftDisplay(base, 0, outline);
        const zeroPos = zero.getAttribute("position")!.array as Float32Array;
        for (let i = 0; i < before.length; i++) expect(zeroPos[i]).toBe(before[i]);
        zero.dispose();

        const plus = shiftDisplay(base, 10, outline);
        const minus = shiftDisplay(base, -10, outline);
        const mirrored = mirrorGeometry(base);
        const leftOutline = extractMeshOutline(mirrored)?.points.map((p) => ({ x: p.x, y: p.y }));
        const plusLeft = shiftDisplay(mirrored, 10, leftOutline);
        for (const [label, geo, src, mm] of [
            ["right+10", plus, base, 10],
            ["right-10", minus, base, -10],
            ["left+10", plusLeft, mirrored, 10],
        ] as const) {
            const heel = ySpan(src, 0.2, 0.22)!;
            const heelW = ySpan(geo, 0.2, 0.22)!;
            const mid = ySpan(src, 0.7, 0.72)!;
            const midW = ySpan(geo, 0.7, 0.72)!;
            const toe = ySpan(src, 0.9, 0.92)!;
            const toeW = ySpan(geo, 0.9, 0.92)!;
            console.log(
                "[DISPLAY]",
                label,
                JSON.stringify({
                    heel: Number((heelW.width - heel.width).toFixed(3)),
                    u07: Number((midW.width - mid.width).toFixed(3)),
                    u09: Number((toeW.width - toe.width).toFixed(3)),
                }),
            );
            expect(Math.abs(heelW.width - heel.width)).toBeLessThan(0.05);
            expect(midW.width - mid.width).toBeCloseTo(mm * 2, 1);
            expect(toeW.width - toe.width).toBeCloseTo(mm * 2, 1);
        }

        const exp0 = await reconstructProceduralPreview(raw, {
            sourceField: field(0),
            composedTop: true,
            wallStyle: "straight",
        });
        const exp10 = await reconstructProceduralPreview(raw.clone(), {
            sourceField: field(10),
            composedTop: true,
            wallStyle: "straight",
        });
        raw.dispose();
        const topN =
            (exp10.geometry.userData as { topVertexCount?: number }).topVertexCount ??
            exp10.geometry.getAttribute("position")!.count;
        for (const [u0, u1] of [
            [0.7, 0.72],
            [0.9, 0.92],
        ] as const) {
            const shown = ySpan(plus, u0, u1)!;
            const exported = ySpan(exp10.geometry, u0, u1, topN)!;
            console.log(
                "[STL-MATCH]",
                u0,
                JSON.stringify({
                    display: Number(shown.width.toFixed(3)),
                    export: Number(exported.width.toFixed(3)),
                }),
            );
            expect(Math.abs(shown.width - exported.width)).toBeLessThan(0.2);
            expect(Math.abs(shown.minY - exported.minY)).toBeLessThan(0.2);
            expect(Math.abs(shown.maxY - exported.maxY)).toBeLessThan(0.2);
        }

        const framesOf = (geo: BufferGeometry) =>
            (geo.userData as { wallFrames?: Array<{ u: number; leanDeg: number }> }).wallFrames ?? [];
        const f0 = framesOf(exp0.geometry);
        const f1 = framesOf(exp10.geometry);
        let maxFrame = 0;
        const n = Math.min(f0.length, f1.length);
        for (let i = 0; i < n; i++) {
            const u = f0[i]!.u;
            if (u < 0.43 || u > 0.52) continue;
            maxFrame = Math.max(maxFrame, Math.abs(f1[i]!.leanDeg - f0[i]!.leanDeg));
        }
        console.log("[FRAME-DLEAD]", JSON.stringify({ n, maxFrame: Number(maxFrame.toFixed(3)) }));
        expect(maxFrame).toBeLessThan(0.05);

        const ring0 =
            (exp0.geometry.userData as { outlineRing?: Array<{ x: number; y: number; z?: number }> })
                .outlineRing ?? [];
        const ring1 =
            (exp10.geometry.userData as { outlineRing?: Array<{ x: number; y: number; z?: number }> })
                .outlineRing ?? [];
        const p0 = exp0.geometry.getAttribute("position")!.array as Float32Array;
        const p1 = exp10.geometry.getAttribute("position")!.array as Float32Array;
        let minX = Infinity;
        let maxX = -Infinity;
        for (let i = 0; i < topN; i++) {
            minX = Math.min(minX, p0[i * 3]!);
            maxX = Math.max(maxX, p0[i * 3]!);
        }
        const len = Math.max(1e-6, maxX - minX);
        let worstGap = 0;
        let worstOnset = 0;
        let nToe = 0;
        for (let i = 0; i < ring0.length; i++) {
            const a = ring0[i]!;
            const b = ring1[i]!;
            const u = (a.x - minX) / len;
            let best = Infinity;
            let jBest = -1;
            for (let j = 0; j < topN; j++) {
                const dx = p0[j * 3]! - a.x;
                const dy = p0[j * 3 + 1]! - a.y;
                const d = dx * dx + dy * dy;
                if (d < best) {
                    best = d;
                    jBest = j;
                }
            }
            if (jBest < 0 || best > 2.25) continue;
            const botDy = b.y - a.y;
            const topDy = p1[jBest * 3 + 1]! - p0[jBest * 3 + 1]!;
            if (u > 0.98) {
                nToe++;
                worstGap = Math.max(worstGap, Math.abs(botDy - topDy));
            }
            if (u >= 0.43 && u <= 0.5) {
                const hy0 = Math.hypot(p0[jBest * 3]! - a.x, p0[jBest * 3 + 1]! - a.y);
                const hz0 = Math.abs((p0[jBest * 3 + 2] ?? 0) - (a.z ?? 0));
                const hy1 = Math.hypot(p1[jBest * 3]! - b.x, p1[jBest * 3 + 1]! - b.y);
                const hz1 = Math.abs((p1[jBest * 3 + 2] ?? 0) - (b.z ?? 0));
                const l0 = (Math.atan2(hy0, Math.max(1e-6, hz0)) * 180) / Math.PI;
                const l1 = (Math.atan2(hy1, Math.max(1e-6, hz1)) * 180) / Math.PI;
                worstOnset = Math.max(worstOnset, Math.abs(l1 - l0));
            }
        }
        console.log(
            "[TOE-ONSET]",
            JSON.stringify({
                nToe,
                worstGapMm: Number(worstGap.toFixed(3)),
                onsetDLeanDeg: Number(worstOnset.toFixed(3)),
            }),
        );
        expect(nToe).toBeGreaterThan(0);
        expect(worstGap).toBeLessThan(1);
        expect(worstOnset).toBeLessThan(3);

        plus.dispose();
        minus.dispose();
        plusLeft.dispose();
        mirrored.dispose();
        base.dispose();
        exp0.geometry.dispose();
        exp10.geometry.dispose();
    });
});
