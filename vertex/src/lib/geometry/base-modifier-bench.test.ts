// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Before/after microbench for slider-path applyBaseModifiers.
 * Run: npx rstest vertex/src/lib/geometry/base-modifier-bench.test.ts
 */

import { describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry } from "three";
import { applyBaseModifiers } from "@/lib/geometry/base-modifier";
import { buildInteractiveLodGeometry, geometryTriangleCount } from "@/lib/geometry/decimate-mesh";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { PREVIEW_THROTTLE_MS } from "@/lib/performance/slider-scheduler";
import type { SideCorrections } from "@/types";

const ZERO: SideCorrections = {
    forefootPostingDeg: 0,
    rearfootPostingDeg: 0,
    medialSkiveMm: 0,
    lateralSkiveMm: 0,
    archFillMm: 0,
    archHeightMm: 0,
    heelCupDepthMm: 0,
    heelCupHeightMm: 0,
    heelCupWidthMm: 0,
    heelLiftMm: 0,
    apexMoveMm: 0,
    medialFlangeMm: 0,
    lateralFlangeMm: 0,
};

/** Build a multi-mesh-like stock base approximating Default.glb density (~86k tris). */
function makeDenseMultiMesh(): BufferGeometry {
    // Top ~15k tris, bottom ~70k tris via grids
    const top = makeGrid(70, 55, 8);
    const bot = makeGrid(150, 120, 0);
    const topPos = top.getAttribute("position")!.array as Float32Array;
    const botPos = bot.getAttribute("position")!.array as Float32Array;
    const positions = new Float32Array(topPos.length + botPos.length);
    positions.set(topPos, 0);
    positions.set(botPos, topPos.length);
    const topIdx = top.getIndex()!.array as ArrayLike<number>;
    const botIdx = bot.getIndex()!.array as ArrayLike<number>;
    const indices: number[] = [];
    for (let i = 0; i < topIdx.length; i++) indices.push(topIdx[i]!);
    const topN = topPos.length / 3;
    for (let i = 0; i < botIdx.length; i++) indices.push(botIdx[i]! + topN);
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(positions, 3));
    g.setIndex(new BufferAttribute(new Uint32Array(indices), 1));
    g.userData = { isMultiMeshBase: true, topVertexCount: topN };
    g.computeVertexNormals();
    top.dispose();
    bot.dispose();
    return g;
}

function makeGrid(nx: number, ny: number, zInterior: number): BufferGeometry {
    const positions: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= nx; i++) {
        for (let j = 0; j <= ny; j++) {
            const edge = i === 0 || i === nx || j === 0 || j === ny;
            positions.push(i * (250 / nx), (j - ny / 2) * (90 / ny), edge ? 0 : zInterior);
        }
    }
    for (let i = 0; i < nx; i++) {
        for (let j = 0; j < ny; j++) {
            const a = i * (ny + 1) + j;
            indices.push(a, a + ny + 1, a + 1, a + 1, a + ny + 1, a + ny + 2);
        }
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    g.setIndex(new BufferAttribute(new Uint32Array(indices), 1));
    return g;
}

function field(arch = 4): HeightFieldParams {
    return {
        side: "left",
        lengthMm: 250,
        widthMm: 90,
        thicknessMm: 3,
        corrections: { ...ZERO, archHeightMm: arch },
        includeSkives: false,
        includeElements: false,
    };
}

describe("slider-path before/after microbench", () => {
    test("in-place skipNormals LOD stays within preview throttle; full mesh reports timings", () => {
        const full = makeDenseMultiMesh();
        const fullTris = geometryTriangleCount(full);
        expect(fullTris).toBeGreaterThan(40_000);

        const lod = buildInteractiveLodGeometry(full, 15_000);
        const lodTris = geometryTriangleCount(lod);
        expect(lodTris).toBeLessThanOrEqual(20_000);
        expect(lodTris).toBeGreaterThanOrEqual(10_000);

        const displayLod = lod.clone();
        const displayFull = full.clone();
        const f = field(5);

        // Warm-up
        applyBaseModifiers(lod, f, 0, { target: displayLod, skipNormals: true });

        const samples: number[] = [];
        for (let i = 0; i < 8; i++) {
            const t0 = performance.now();
            applyBaseModifiers(lod, f, 0, { target: displayLod, skipNormals: true });
            samples.push(performance.now() - t0);
        }
        samples.sort((a, b) => a - b);
        const p50 = samples[Math.floor(samples.length / 2)]!;

        const tFull0 = performance.now();
        applyBaseModifiers(full, f, 0, { target: displayFull, skipNormals: false });
        const fullMs = performance.now() - tFull0;

        // Non-cumulative: two applies match
        const a = new Float32Array(displayLod.getAttribute("position")!.array as Float32Array);
        applyBaseModifiers(lod, f, 0, { target: displayLod, skipNormals: true });
        const b = new Float32Array(displayLod.getAttribute("position")!.array as Float32Array);
        expect(Array.from(a)).toEqual(Array.from(b));

        console.log("[BENCH] slider-path", {
            fullTris,
            lodTris,
            lodPreviewP50ms: +p50.toFixed(2),
            fullApplyMs: +fullMs.toFixed(2),
            // Production path offloads apply to a worker; main thread only copies buffers.
            note: "Worker path keeps main-thread apply copy << 50ms; this measures sync LOD fallback.",
        });

        // Sync LOD fallback must stay within the preview throttle window on CI VMs.
        // Browser acceptance (worker): main-thread task < 50 ms via transferable copy only.
        expect(p50).toBeLessThan(PREVIEW_THROTTLE_MS);

        full.dispose();
        lod.dispose();
        displayLod.dispose();
        displayFull.dispose();
    });
});
