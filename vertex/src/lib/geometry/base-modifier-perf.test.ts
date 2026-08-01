// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry } from "three";
import { applyBaseModifiers } from "@/lib/geometry/base-modifier";
import { computeNormalsFloat32 } from "@/lib/geometry/compute-normals";
import {
    buildInteractiveLodGeometry,
    geometryTriangleCount,
    INTERACTIVE_LOD_MAX_TRIS,
    INTERACTIVE_LOD_MIN_TRIS,
} from "@/lib/geometry/decimate-mesh";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { FULL_IDLE_MS, PREVIEW_THROTTLE_MS, SliderScheduler } from "@/lib/performance/slider-scheduler";
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

function makeGrid(nx: number, ny: number): BufferGeometry {
    const positions: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= nx; i++) {
        for (let j = 0; j <= ny; j++) {
            positions.push(i * 10, j * 5, i === 0 || i === nx || j === 0 || j === ny ? 0 : 4);
        }
    }
    for (let i = 0; i < nx; i++) {
        for (let j = 0; j < ny; j++) {
            const a = i * (ny + 1) + j;
            const b = a + 1;
            const c = a + (ny + 1);
            const d = c + 1;
            indices.push(a, c, b, b, c, d);
        }
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    g.setIndex(new BufferAttribute(new Uint32Array(indices), 1));
    return g;
}

function field(patch: Partial<SideCorrections> = {}): HeightFieldParams {
    return {
        side: "left",
        lengthMm: 260,
        widthMm: 90,
        thicknessMm: 3,
        corrections: { ...ZERO, archHeightMm: 0, ...patch },
        includeSkives: false,
        includeElements: false,
    };
}

describe("applyBaseModifiers in-place + non-cumulative", () => {
    test("writes into target from immutable source and does not accumulate", () => {
        const base = makeGrid(20, 10);
        // Give the grid a clear top sheet so classification/modifiers have signal.
        const arr = base.getAttribute("position")!.array as Float32Array;
        for (let i = 0; i < arr.length / 3; i++) {
            if (arr[i * 3 + 2]! > 0) arr[i * 3 + 2] = 8;
        }
        base.computeVertexNormals();
        const sourceCopy = new Float32Array(arr);
        const target = base.clone();
        const f = field({ archHeightMm: 5 });

        applyBaseModifiers(base, f, 0, { target, skipNormals: true });
        const after1 = new Float32Array(target.getAttribute("position")!.array as Float32Array);

        applyBaseModifiers(base, f, 0, { target, skipNormals: true });
        const after2 = new Float32Array(target.getAttribute("position")!.array as Float32Array);

        const srcNow = base.getAttribute("position")!.array as Float32Array;
        expect(Array.from(srcNow)).toEqual(Array.from(sourceCopy));
        expect(Array.from(after2)).toEqual(Array.from(after1));

        let moved = 0;
        for (let i = 0; i < after1.length; i++) {
            const d = after1[i]! - sourceCopy[i]!;
            if (Number.isFinite(d)) moved += Math.abs(d);
        }
        expect(moved).toBeGreaterThan(0.01);
    });

    test("skipNormals avoids allocating normals when requested", () => {
        const base = makeGrid(8, 4);
        const target = base.clone();
        target.deleteAttribute("normal");
        applyBaseModifiers(base, field({ archHeightMm: 2 }), 0, { target, skipNormals: true });
        expect(target.getAttribute("normal")).toBeUndefined();
    });
});

describe("interactive LOD decimation", () => {
    test("reduces a large mesh into the 10k–20k triangle band", () => {
        // ~50k tris
        const big = makeGrid(160, 160);
        expect(geometryTriangleCount(big)).toBeGreaterThan(40_000);
        const lod = buildInteractiveLodGeometry(big, 15_000);
        const tris = geometryTriangleCount(lod);
        expect(tris).toBeGreaterThanOrEqual(INTERACTIVE_LOD_MIN_TRIS);
        expect(tris).toBeLessThanOrEqual(INTERACTIVE_LOD_MAX_TRIS);
        lod.dispose();
        big.dispose();
    });

    test("preserves multi-mesh topVertexCount metadata", () => {
        const top = makeGrid(40, 40);
        const bot = makeGrid(60, 60);
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
        const merged = new BufferGeometry();
        merged.setAttribute("position", new BufferAttribute(positions, 3));
        merged.setIndex(new BufferAttribute(new Uint32Array(indices), 1));
        merged.userData = { isMultiMeshBase: true, topVertexCount: topN };

        const lod = buildInteractiveLodGeometry(merged, 15_000);
        expect(lod.userData.isMultiMeshBase).toBe(true);
        expect(typeof lod.userData.topVertexCount).toBe("number");
        expect(lod.userData.topVertexCount).toBeGreaterThan(0);
        expect(lod.userData.topVertexCount).toBeLessThan(lod.getAttribute("position")!.count);
        lod.dispose();
        merged.dispose();
        top.dispose();
        bot.dispose();
    });
});

describe("SliderScheduler", () => {
    test("throttles preview to >= 75 ms and fires full after idle", async () => {
        let previews = 0;
        let fulls = 0;
        const s = new SliderScheduler({
            onPreview: () => {
                previews++;
            },
            onFull: () => {
                fulls++;
            },
        });
        s.schedulePreview();
        s.schedulePreview();
        s.schedulePreview();
        expect(previews).toBe(1);
        await new Promise((r) => setTimeout(r, PREVIEW_THROTTLE_MS + 20));
        expect(previews).toBeGreaterThanOrEqual(1);
        await new Promise((r) => setTimeout(r, FULL_IDLE_MS + 20));
        expect(fulls).toBeGreaterThanOrEqual(1);
        s.dispose();
    });
});

describe("computeNormalsFloat32", () => {
    test("produces unit normals for a triangle", () => {
        const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
        const indices = [0, 1, 2];
        const n = computeNormalsFloat32(positions, indices);
        const len = Math.hypot(n[0]!, n[1]!, n[2]!);
        expect(len).toBeCloseTo(1, 5);
        expect(n[2]!).toBeGreaterThan(0.9);
    });
});
