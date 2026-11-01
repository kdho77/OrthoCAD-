// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { apexWarpShiftMm, apexWarpWindow } from "@/lib/geometry/apex-move-warp";
import { applyBaseModifiers, BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { analyzeManifold } from "@/lib/geometry/manifold";
import { reconstructProceduralPreview } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import type { SideCorrections } from "@/types";
import { loadSampleTopGlb } from "./helpers/load-sample-top-glb";

function corrections(patch: Partial<SideCorrections>): SideCorrections {
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
        ...patch,
    };
}

function field(patch: Partial<SideCorrections>): HeightFieldParams {
    const layout = insoleLayoutForUsMenSize(9);
    return {
        side: "left",
        lengthMm: layout.lengthMm,
        widthMm: layout.widthMm,
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        corrections: corrections(patch),
        elements: [],
        includeElements: false,
        includeSkives: false,
        trimline: null,
    };
}

function crest(pos: ArrayLike<number>): { x: number; y: number; z: number } {
    let x = 0;
    let y = 0;
    let z = -Infinity;
    const n = pos.length / 3;
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < n; i++) {
        const xi = pos[i * 3]!;
        if (xi < minX) minX = xi;
        if (xi > maxX) maxX = xi;
    }
    const span = Math.max(1e-6, maxX - minX);
    for (let i = 0; i < n; i++) {
        const xi = pos[i * 3]!;
        const yi = pos[i * 3 + 1]!;
        const zi = pos[i * 3 + 2]!;
        const u = (xi - minX) / span;
        if (u < 0.22 || u > 0.55) continue;
        if (Math.abs(yi) < 15) continue;
        if (zi > z) {
            x = xi;
            y = yi;
            z = zi;
        }
    }
    return { x, y, z };
}

describe("apex warp shift", () => {
    test("arch delta 0 keeps the full apex move; a non-zero delta keeps none", () => {
        expect(apexWarpShiftMm({ archHeightMm: 0, apexMoveMm: 4 })).toBe(4);
        expect(apexWarpShiftMm({ archHeightMm: -3.5, apexMoveMm: 4 })).toBe(0);
        expect(apexWarpShiftMm({ archHeightMm: 3, apexMoveMm: 4 })).toBe(0);
        expect(apexWarpShiftMm({ archHeightMm: 0, apexMoveMm: 0 })).toBe(0);
        expect(apexWarpWindow(0.1)).toBe(0);
        expect(apexWarpWindow(0.7)).toBe(0);
        expect(apexWarpWindow(0.36)).toBe(1);
    });

    test("Standard + apex 4 mm slides the stock crest and leaves heel and forefoot", async () => {
        const base = await loadSampleTopGlb();
        const parked = applyBaseModifiers(base, field({}), 0);
        const moved = applyBaseModifiers(base, field({ apexMoveMm: 4 }), 0);
        const low = applyBaseModifiers(base, field({ archHeightMm: -3.5, apexMoveMm: 4 }), 0);
        const lowParked = applyBaseModifiers(base, field({ archHeightMm: -3.5, apexMoveMm: 4 }), 0);
        const a = parked.getAttribute("position")!.array as Float32Array;
        const b = moved.getAttribute("position")!.array as Float32Array;
        const c = low.getAttribute("position")!.array as Float32Array;
        const d = lowParked.getAttribute("position")!.array as Float32Array;

        const peakA = crest(a);
        const peakB = crest(b);
        expect(peakB.x - peakA.x).toBeGreaterThan(3.8);
        expect(peakB.x - peakA.x).toBeLessThan(4.2);
        expect(Math.abs(peakB.z - peakA.z)).toBeLessThan(0.05);

        let minX = Infinity;
        let maxX = -Infinity;
        for (let i = 0; i < a.length; i += 3) {
            if (a[i]! < minX) minX = a[i]!;
            if (a[i]! > maxX) maxX = a[i]!;
        }
        const span = maxX - minX;
        let heel = 0;
        let fore = 0;
        let xy = 0;
        for (let i = 0; i < a.length; i += 3) {
            const u = (a[i]! - minX) / span;
            const dz = Math.abs(b[i + 2]! - a[i + 2]!);
            if (u < 0.15) heel = Math.max(heel, dz);
            if (u > 0.6) fore = Math.max(fore, dz);
            xy = Math.max(xy, Math.abs(b[i]! - a[i]!), Math.abs(b[i + 1]! - a[i + 1]!));
        }
        expect(heel).toBeLessThan(0.02);
        expect(fore).toBeLessThan(0.02);
        expect(xy).toBe(0);

        // Low + Flexible does not take the stock slide, so a repeat is identical.
        expect(
            Buffer.from(c.buffer, c.byteOffset, c.byteLength).equals(
                Buffer.from(d.buffer, d.byteOffset, d.byteLength),
            ),
        ).toBe(true);

        parked.dispose();
        moved.dispose();
        low.dispose();
        lowParked.dispose();
        base.dispose();
    });
});

/** Same argmax the STL gate uses: highest Z with x in 85..145. */
function stlApex(pos: ArrayLike<number>): { x: number; y: number; z: number } {
    let x = 0;
    let y = 0;
    let z = -Infinity;
    const n = pos.length / 3;
    for (let i = 0; i < n; i++) {
        const xi = pos[i * 3]!;
        const yi = pos[i * 3 + 1]!;
        const zi = pos[i * 3 + 2]!;
        if (xi < 85 || xi > 145) continue;
        if (zi > z) {
            x = xi;
            y = yi;
            z = zi;
        }
    }
    return { x, y, z };
}

describe("apex warp on the manufacturing loft", () => {
    test("Standard slides +4 on the export loft and matches the viewport loft; Low and High do not slide twice", async () => {
        const base = await loadSampleTopGlb();
        const loft = (patch: Partial<SideCorrections>, sourceField: boolean) =>
            reconstructProceduralPreview(base, {
                corrections: corrections(patch),
                thicknessMm: BASE_REFERENCE_THICKNESS_MM,
                stockThicknessMm: BASE_REFERENCE_THICKNESS_MM,
                wallStyle: "straight",
                side: "right",
                ...(sourceField ? { sourceField: field(patch), composedTop: true } : {}),
            });
        const neutral = await loft({}, false);
        const exported = await loft({ apexMoveMm: 4 }, false);
        const viewed = await loft({ apexMoveMm: 4 }, true);
        const lowParked = await loft({ archHeightMm: -3.5 }, false);
        const lowFlex = await loft({ archHeightMm: -3.5, apexMoveMm: 4 }, false);
        const highParked = await loft({ archHeightMm: 3 }, false);
        const highFlex = await loft({ archHeightMm: 3, apexMoveMm: 4 }, false);

        const pos = (g: { getAttribute: (n: string) => { array: ArrayLike<number> } }) =>
            g.getAttribute("position").array;
        const n = stlApex(pos(neutral.geometry));
        const e = stlApex(pos(exported.geometry));
        const v = stlApex(pos(viewed.geometry));
        expect(e.x - n.x).toBeGreaterThan(3.8);
        expect(e.x - n.x).toBeLessThan(4.2);
        expect(Math.abs(e.z - n.z)).toBeLessThan(0.05);
        expect(Math.abs(v.x - e.x)).toBeLessThan(0.05);
        expect(Math.abs(v.z - e.z)).toBeLessThan(0.05);

        const lowDx = stlApex(pos(lowFlex.geometry)).x - stlApex(pos(lowParked.geometry)).x;
        const highDx = stlApex(pos(highFlex.geometry)).x - stlApex(pos(highParked.geometry)).x;
        const lowCrest = crest(pos(lowFlex.geometry)).x - crest(pos(lowParked.geometry)).x;
        const highCrest = crest(pos(highFlex.geometry)).x - crest(pos(highParked.geometry)).x;
        // Arch delta is non-zero, so the stock slide is skipped. The solid's
        // highest vertex stays on the stock crest (the Low/High bump recenters
        // a lower or wider dome and does not add a second +4 mm).
        expect(Math.abs(lowDx)).toBeLessThan(0.2);
        expect(Math.abs(highDx)).toBeLessThan(0.2);
        expect(Math.abs(lowCrest)).toBeLessThan(0.2);
        expect(Math.abs(highCrest)).toBeLessThan(0.2);
        console.log(
            JSON.stringify({
                standardDx: e.x - n.x,
                standardDz: e.z - n.z,
                viewDx: v.x - e.x,
                lowDx,
                highDx,
                lowCrest,
                highCrest,
            }),
        );

        const a = pos(neutral.geometry);
        const b = pos(exported.geometry);
        const boxOf = (p: ArrayLike<number>) => {
            let minX = Infinity;
            let maxX = -Infinity;
            let minY = Infinity;
            let maxY = -Infinity;
            let minZ = Infinity;
            for (let i = 0; i < p.length; i += 3) {
                minX = Math.min(minX, p[i]!);
                maxX = Math.max(maxX, p[i]!);
                minY = Math.min(minY, p[i + 1]!);
                maxY = Math.max(maxY, p[i + 1]!);
                minZ = Math.min(minZ, p[i + 2]!);
            }
            return { minX, maxX, minY, maxY, minZ };
        };
        const boxA = boxOf(a);
        const boxB = boxOf(b);
        expect(Math.abs(boxB.minX - boxA.minX)).toBeLessThan(0.02);
        expect(Math.abs(boxB.maxX - boxA.maxX)).toBeLessThan(0.02);
        expect(Math.abs(boxB.minY - boxA.minY)).toBeLessThan(0.02);
        expect(Math.abs(boxB.maxY - boxA.maxY)).toBeLessThan(0.02);
        expect(boxB.minZ).toBeGreaterThan(-1e-4);
        expect(boxB.minZ).toBeLessThan(0.02);

        const topN = neutral.geometry.userData.topVertexCount as number;
        expect(exported.geometry.userData.topVertexCount).toBe(topN);
        expect(topN).toBeGreaterThan(100);
        let topMinX = Infinity;
        let topMaxX = -Infinity;
        for (let i = 0; i < topN; i++) {
            topMinX = Math.min(topMinX, a[i * 3]!);
            topMaxX = Math.max(topMaxX, a[i * 3]!);
        }
        const topSpan = Math.max(1e-6, topMaxX - topMinX);
        let heel = 0;
        let fore = 0;
        let xy = 0;
        let heelN = 0;
        let foreN = 0;
        for (let i = 0; i < topN; i++) {
            const u = (a[i * 3]! - topMinX) / topSpan;
            xy = Math.max(xy, Math.abs(b[i * 3]! - a[i * 3]!), Math.abs(b[i * 3 + 1]! - a[i * 3 + 1]!));
            const dz = Math.abs(b[i * 3 + 2]! - a[i * 3 + 2]!);
            if (u < 0.15) {
                heel = Math.max(heel, dz);
                heelN++;
            }
            if (u > 0.6) {
                fore = Math.max(fore, dz);
                foreN++;
            }
        }
        expect(heelN).toBeGreaterThan(20);
        expect(foreN).toBeGreaterThan(20);
        expect(xy).toBe(0);
        expect(heel).toBeLessThan(0.02);
        expect(fore).toBeLessThan(0.02);
        const manifold = analyzeManifold(exported.geometry);
        expect(manifold.isWatertight).toBe(true);
        expect(manifold.openEdges).toBe(0);

        for (const built of [neutral, exported, viewed, lowParked, lowFlex, highParked, highFlex]) {
            built.geometry.dispose();
        }
        base.dispose();
    }, 420000);
});
