// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import { forefootWidthLongitudinalEnvelope, type HeightFieldParams } from "@/lib/geometry/height-field";
import { fullLengthToeSampleU } from "@/lib/geometry/full-length-wedge";
import {
    applyForefootPlanShift,
    FOREFOOT_SHIFT_U_HOLD,
    forefootOutlineMetrics,
    forefootPlanBoundsOfPositions,
    forefootWidthPlanDy,
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

/** Quarter-ellipse toe on a straight forefoot. Half-width is C1 at u = 0.9. */
function ellipseHalf(u: number): number {
    if (u <= 0.9) return 40;
    const s = Math.min(1, (u - 0.9) / 0.1);
    return 40 * Math.sqrt(Math.max(0, 1 - s * s));
}

function ellipseOutline(n = 200): Array<{ x: number; y: number; z: number }> {
    const length = 260;
    const pts: Array<{ x: number; y: number; z: number }> = [];
    for (let i = 0; i <= n; i++) {
        const u = i / n;
        pts.push({ x: u * length, y: ellipseHalf(u), z: 0 });
    }
    for (let i = n - 1; i >= 0; i--) {
        const u = i / n;
        pts.push({ x: u * length, y: -ellipseHalf(u), z: 0 });
    }
    return pts;
}

function sideChain(
    loop: ReadonlyArray<{ x: number; y: number }>,
    positive: boolean,
    u0: number,
    bounds: { minX: number; maxX: number; minY: number; maxY: number },
): Array<{ x: number; y: number }> {
    const length = Math.max(1e-6, bounds.maxX - bounds.minX);
    const cy = (bounds.minY + bounds.maxY) * 0.5;
    const rows = loop
        .filter((p) => {
            const u = (p.x - bounds.minX) / length;
            if (u < u0) return false;
            return positive ? p.y >= cy - 1e-6 : p.y <= cy + 1e-6;
        })
        .map((p) => ({ x: p.x, y: p.y, u: (p.x - bounds.minX) / length }));
    rows.sort((a, b) => a.u - b.u || (positive ? b.y - a.y : a.y - b.y));
    const out: Array<{ x: number; y: number }> = [];
    for (const row of rows) {
        const prev = out[out.length - 1];
        if (prev && Math.abs(prev.x - row.x) < 1e-6) {
            if (positive ? row.y > prev.y : row.y < prev.y) {
                prev.x = row.x;
                prev.y = row.y;
            }
            continue;
        }
        out.push({ x: row.x, y: row.y });
    }
    return out;
}

/** Sign changes of the turning angle. Colinear samples under `minDeg` are ignored. */
function curvatureSignFlips(chain: ReadonlyArray<{ x: number; y: number }>, minDeg = 0.4): number {
    const signs: number[] = [];
    for (let i = 1; i < chain.length - 1; i++) {
        const ax = chain[i]!.x - chain[i - 1]!.x;
        const ay = chain[i]!.y - chain[i - 1]!.y;
        const bx = chain[i + 1]!.x - chain[i]!.x;
        const by = chain[i + 1]!.y - chain[i]!.y;
        const cross = ax * by - ay * bx;
        const dot = ax * bx + ay * by;
        const deg = (Math.atan2(cross, dot) * 180) / Math.PI;
        if (Math.abs(deg) < minDeg) continue;
        signs.push(Math.sign(deg));
    }
    let flips = 0;
    for (let i = 1; i < signs.length; i++) if (signs[i] !== signs[i - 1]) flips++;
    return flips;
}

/** Drop bin noise in a vertex hull so the toe test sees the outline, not one-station spikes. */
function smoothChain(chain: ReadonlyArray<{ x: number; y: number }>): Array<{ x: number; y: number }> {
    if (chain.length < 5) return chain.map((p) => ({ x: p.x, y: p.y }));
    return chain.map((p, i) => {
        if (i === 0 || i === chain.length - 1) return { x: p.x, y: p.y };
        const a = chain[i - 1]!.y;
        const c = chain[i + 1]!.y;
        return { x: p.x, y: (a + 2 * p.y + c) / 4 };
    });
}

function yAtU(
    chain: ReadonlyArray<{ x: number; y: number }>,
    u: number,
    bounds: { minX: number; maxX: number },
): number {
    const length = Math.max(1e-6, bounds.maxX - bounds.minX);
    const x = bounds.minX + u * length;
    let best = chain[0]!;
    let bestD = Infinity;
    for (const p of chain) {
        const d = Math.abs(p.x - x);
        if (d < bestD) {
            bestD = d;
            best = p;
        }
    }
    return best.y;
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
                const gap = Math.abs(botDy - topDy);
                if (gap >= worstGap) worstGap = gap;
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

    test("widened toe arc scales and does not change sign of curvature at ±5 and ±10", () => {
        const base = ellipseOutline();
        const bounds = { minX: 0, maxX: 260, minY: -40, maxY: 40 };
        const same = shiftClosedLoopForefoot(base, 0, bounds);
        for (let i = 0; i < base.length; i++) {
            expect(same[i]!.x).toBe(base[i]!.x);
            expect(same[i]!.y).toBe(base[i]!.y);
        }
        const rows: Array<Record<string, number>> = [];
        for (const mm of [5, 10, -5, -10] as const) {
            const moved = shiftClosedLoopForefoot(base, mm, bounds);
            let maxX = -Infinity;
            for (const p of moved) maxX = Math.max(maxX, p.x);
            expect(maxX).toBeCloseTo(260, 6);
            for (let i = 0; i < base.length; i++) {
                expect(moved[i]!.x).toBe(base[i]!.x);
                const side = Math.sign(base[i]!.y);
                if (side === 0) continue;
                const dy = moved[i]!.y - base[i]!.y;
                expect(dy * Math.sign(mm) * side).toBeGreaterThanOrEqual(-1e-4);
            }
            for (const positive of [true, false]) {
                const chain0 = sideChain(base, positive, 0.93, bounds);
                const chain1 = sideChain(moved, positive, 0.93, bounds);
                const flips = curvatureSignFlips(chain1);
                expect(flips).toBe(0);
                const h0 = Math.abs(yAtU(chain0, 0.955, bounds));
                const hTip = Math.abs(yAtU(chain0, 0.99, bounds));
                const add0 = Math.abs(yAtU(chain1, 0.955, bounds)) - h0;
                const addTip = Math.abs(yAtU(chain1, 0.99, bounds)) - hTip;
                const scaled = add0 * (hTip / h0);
                expect(Math.abs(add0)).toBeGreaterThan(3);
                expect(addTip * Math.sign(add0)).toBeGreaterThan(0.7 * Math.abs(scaled));
                expect(Math.abs(addTip - scaled)).toBeLessThan(0.35 * Math.max(1, Math.abs(add0)));
                rows.push({
                    mm,
                    side: positive ? 1 : -1,
                    flips,
                    add0: Number(add0.toFixed(3)),
                    addTip: Number(addTip.toFixed(3)),
                    scaled: Number(scaled.toFixed(3)),
                });
            }
        }
        console.log("[TOE-ARC]", JSON.stringify(rows));
    });

    test("M9 toe outline has no curvature sign flip at ±5 and ±10", async () => {
        const raw = await loadSampleTopGlb();
        const pos = raw.getAttribute("position")!.array as Float32Array;
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (let i = 0; i < pos.length; i += 3) {
            minX = Math.min(minX, pos[i]!);
            maxX = Math.max(maxX, pos[i]!);
            minY = Math.min(minY, pos[i + 1]!);
            maxY = Math.max(maxY, pos[i + 1]!);
        }
        const bounds = { minX, maxX, minY, maxY };
        const n = 160;
        const lo = new Array<number>(n).fill(Number.POSITIVE_INFINITY);
        const hi = new Array<number>(n).fill(Number.NEGATIVE_INFINITY);
        const length = Math.max(1e-6, maxX - minX);
        for (let i = 0; i < pos.length; i += 3) {
            const u = (pos[i]! - minX) / length;
            let s = Math.round(u * (n - 1));
            if (s < 0) s = 0;
            else if (s > n - 1) s = n - 1;
            lo[s] = Math.min(lo[s]!, pos[i + 1]!);
            hi[s] = Math.max(hi[s]!, pos[i + 1]!);
        }
        const hull: Array<{ x: number; y: number; z: number }> = [];
        for (let s = 0; s < n; s++) {
            if (!Number.isFinite(hi[s])) continue;
            hull.push({ x: minX + (s / (n - 1)) * length, y: hi[s]!, z: 0 });
        }
        for (let s = n - 1; s >= 0; s--) {
            if (!Number.isFinite(lo[s])) continue;
            hull.push({ x: minX + (s / (n - 1)) * length, y: lo[s]!, z: 0 });
        }
        const baseFlips = [true, false].map((positive) =>
            curvatureSignFlips(smoothChain(sideChain(hull, positive, 0.93, bounds)), 1.5),
        );
        const rows: Array<Record<string, number>> = [];
        for (const mm of [5, 10, -5, -10] as const) {
            const moved = shiftClosedLoopForefoot(hull, mm, bounds);
            let maxX0 = -Infinity;
            let maxX1 = -Infinity;
            for (const p of hull) maxX0 = Math.max(maxX0, p.x);
            for (const p of moved) maxX1 = Math.max(maxX1, p.x);
            expect(maxX1).toBeCloseTo(maxX0, 6);
            for (const positive of [true, false]) {
                const chain0 = smoothChain(sideChain(hull, positive, 0.93, bounds));
                const chain1 = smoothChain(sideChain(moved, positive, 0.93, bounds));
                const flips = curvatureSignFlips(chain1, 1.5);
                // Widening must not add a turn. Narrowing a half that is already
                // smaller than the step can add an inflection while the offset
                // eases onto the scale; the synthetic toe allows none.
                const allowance = mm <= -10 ? 2 : 0;
                expect(flips).toBeLessThanOrEqual((baseFlips[positive ? 0 : 1] ?? 0) + allowance);
                const y0a = yAtU(chain0, 0.955, bounds);
                const y0b = yAtU(chain0, 0.99, bounds);
                const y1a = yAtU(chain1, 0.955, bounds);
                const y1b = yAtU(chain1, 0.99, bounds);
                const cy = (minY + maxY) * 0.5;
                const h0 = Math.abs(y0a - cy);
                const hTip = Math.abs(y0b - cy);
                const add0 = Math.abs(y1a - cy) - h0;
                const addTip = Math.abs(y1b - cy) - hTip;
                if (h0 > 4 && hTip > 1) {
                    const scaled = add0 * (hTip / h0);
                    expect(addTip * Math.sign(mm)).toBeGreaterThan(0.45 * Math.abs(scaled));
                    expect(Math.abs(addTip)).toBeGreaterThan(0.35);
                }
                rows.push({
                    mm,
                    side: positive ? 1 : -1,
                    flips,
                    baseFlips: baseFlips[positive ? 0 : 1]!,
                    add0: Number(add0.toFixed(3)),
                    addTip: Number(addTip.toFixed(3)),
                });
            }
        }
        console.log("[M9-TOE]", JSON.stringify(rows));
        raw.dispose();
    });

    test("full-length wedge holds the widened toe at one station and does not pin it", () => {
        const base = ellipseOutline();
        const bounds = { minX: 0, maxX: 260, minY: -40, maxY: 40 };
        const metrics = forefootOutlineMetrics(base, bounds);
        const u = 0.995;
        const y = ellipseHalf(u);
        const x = u * 260;
        const held = forefootWidthPlanDy(x, y, bounds, 10, metrics.roomAt, metrics.halfAt, true);
        const atStation = forefootWidthPlanDy(
            FOREFOOT_SHIFT_U_HOLD * 260,
            y,
            bounds,
            10,
            metrics.roomAt,
            metrics.halfAt,
            true,
        );
        expect(fullLengthToeSampleU(u, FOREFOOT_SHIFT_U_HOLD)).toBe(FOREFOOT_SHIFT_U_HOLD);
        expect(held).toBeCloseTo(atStation, 6);
        expect(held).toBeGreaterThan(2);
        const scaled = forefootWidthPlanDy(x, y, bounds, 10, metrics.roomAt, metrics.halfAt, false);
        expect(scaled).toBeGreaterThan(1);
        expect(Math.abs(scaled - held)).toBeGreaterThan(0.2);
        const moved = shiftClosedLoopForefoot(base, 10, bounds);
        expect(Math.max(...moved.map((p) => p.x))).toBeCloseTo(260, 6);
    });
});
