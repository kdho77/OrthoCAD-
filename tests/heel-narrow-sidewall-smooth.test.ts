// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Heel-cup narrowing sidewall smoothness (Default.glb).
 *
 * Defect: match-from-scan negative heelCupWidthMm applied lateral scale only on
 * the top sheet, then height-weighted rim-conformity sheared that inward pull
 * down the bottom wall — mid-wall under-displaced → vertical ridges / steps on
 * the medial heel sidewall.
 *
 * Fix: radial lateral scale on the full multi-mesh shell + rim-conformity uses
 * rigid per-column rim lateral (height weight divided out) for the width axis.
 *
 * Legacy mid/rim |Δwidth| ratio ≈ 0.03; fixed ≈ 1.0.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import {
    applyBaseModifiers,
    applyBaseModifiersWithSidewall,
    PLANTAR_Z_MAX_MM,
} from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { validateManifold } from "@/lib/geometry/mesh-close";
import { extractMergedGeometry, loadGlbFromBuffer } from "@/lib/library/loaders";
import type { SideCorrections } from "@/types";

const FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/Default.glb");

function neutralCorrections(): SideCorrections {
    return {
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
}

function correctionField(patch: Partial<SideCorrections>): HeightFieldParams {
    return {
        side: "left",
        lengthMm: 266,
        widthMm: 95,
        thicknessMm: 2,
        corrections: { ...neutralCorrections(), ...patch },
        elements: [],
        includeSkives: true,
        includeElements: true,
        trimline: null,
    };
}

interface Frame {
    lengthAxis: number;
    widthAxis: number;
    thickAxis: number;
    lenMin: number;
    lenSize: number;
    widCenter: number;
    topVertexCount: number;
    count: number;
}

function resolveFrame(geo: BufferGeometry): Frame {
    const pos = geo.getAttribute("position")!;
    const arr = pos.array as Float32Array;
    const count = pos.count;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) {
        for (let a = 0; a < 3; a++) {
            const c = arr[i * 3 + a]!;
            if (c < min[a]!) min[a] = c;
            if (c > max[a]!) max[a] = c;
        }
    }
    const sizes: [number, number][] = [
        [0, max[0]! - min[0]!],
        [1, max[1]! - min[1]!],
        [2, max[2]! - min[2]!],
    ];
    sizes.sort((a, b) => a[1] - b[1]);
    const thickAxis = sizes[0]![0];
    const widthAxis = sizes[1]![0];
    const lengthAxis = sizes[2]![0];
    const userData = geo.userData as { topVertexCount?: number };
    const topVertexCount =
        typeof userData.topVertexCount === "number" && userData.topVertexCount > 0
            ? userData.topVertexCount
            : count;
    return {
        lengthAxis,
        widthAxis,
        thickAxis,
        lenMin: min[lengthAxis]!,
        lenSize: max[lengthAxis]! - min[lengthAxis]! || 1,
        widCenter: (min[widthAxis]! + max[widthAxis]!) / 2,
        topVertexCount,
        count,
    };
}

/** Mid-wall vs rim |Δwidth| ratio in the heel — legacy height-shear ≈0.03; rigid ≈1. */
function midToRimLateralRatio(
    baseArr: Float32Array,
    modArr: Float32Array,
    frame: Frame,
): { rim: number; mid: number; ratio: number } {
    const { topVertexCount, count, lengthAxis, widthAxis, thickAxis, lenMin, lenSize } = frame;
    let rimSum = 0;
    let rimN = 0;
    let midSum = 0;
    let midN = 0;
    for (let i = topVertexCount; i < count; i++) {
        const z = baseArr[i * 3 + thickAxis]!;
        if (z <= PLANTAR_Z_MAX_MM) continue;
        const u = (baseArr[i * 3 + lengthAxis]! - lenMin) / (lenSize || 1);
        if (u > 0.3) continue;
        const dW = Math.abs(modArr[i * 3 + widthAxis]! - baseArr[i * 3 + widthAxis]!);
        if (dW < 0.05) continue;
        if (z >= 10) {
            rimSum += dW;
            rimN++;
        } else if (z >= 3 && z <= 6) {
            midSum += dW;
            midN++;
        }
    }
    const rim = rimN ? rimSum / rimN : 0;
    const mid = midN ? midSum / midN : 0;
    return { rim, mid, ratio: rim > 1e-6 ? mid / rim : 0 };
}

/** Max |Δwidth| on plantar heel band — must move when narrowing (no wide shelf). */
function maxPlantarHeelWidthDelta(baseArr: Float32Array, modArr: Float32Array, frame: Frame): number {
    const { topVertexCount, count, lengthAxis, widthAxis, thickAxis, lenMin, lenSize, widCenter } = frame;
    let max = 0;
    for (let i = topVertexCount; i < count; i++) {
        if (baseArr[i * 3 + thickAxis]! > PLANTAR_Z_MAX_MM) continue;
        const u = (baseArr[i * 3 + lengthAxis]! - lenMin) / (lenSize || 1);
        if (u > 0.38) continue;
        const d = Math.abs(modArr[i * 3 + widthAxis]! - baseArr[i * 3 + widthAxis]!);
        if (Math.abs(baseArr[i * 3 + widthAxis]! - widCenter) < 8) continue;
        if (d > max) max = d;
    }
    return max;
}

let baseGeometry: BufferGeometry;
let frame: Frame;
let baseArr: Float32Array;

beforeAll(async () => {
    expect(existsSync(FIXTURE_PATH)).toBe(true);
    const buffer = readFileSync(FIXTURE_PATH).buffer.slice(0) as ArrayBuffer;
    const group = await loadGlbFromBuffer(buffer);
    const merged = extractMergedGeometry(group);
    expect(merged).not.toBeNull();
    baseGeometry = merged!.geometry;
    frame = resolveFrame(baseGeometry);
    baseArr = (baseGeometry.getAttribute("position")!.array as Float32Array).slice();
});

describe("heel narrowing sidewall smoothness — Default.glb", () => {
    test("narrowing keeps mid-wall lateral near rim (no height shear)", () => {
        for (const w of [-5, -10]) {
            const mod = applyBaseModifiers(baseGeometry, correctionField({ heelCupWidthMm: w }), 0);
            const modArr = mod.getAttribute("position")!.array as Float32Array;
            const { rim, mid, ratio } = midToRimLateralRatio(baseArr, modArr, frame);
            console.log(
                `[HEEL-NARROW] width=${w}: rim=${rim.toFixed(3)} mid=${mid.toFixed(3)} ratio=${ratio.toFixed(3)}`,
            );
            expect(rim).toBeGreaterThan(1.0);
            expect(ratio).toBeGreaterThan(0.85);
            expect(ratio).toBeLessThan(1.2);
            mod.dispose();
        }
    });

    test("narrowing moves plantar heel edge inward (no wide shelf under rim)", () => {
        const mod = applyBaseModifiers(baseGeometry, correctionField({ heelCupWidthMm: -8 }), 0);
        const modArr = mod.getAttribute("position")!.array as Float32Array;
        const d = maxPlantarHeelWidthDelta(baseArr, modArr, frame);
        console.log(`[HEEL-NARROW] plantarHeelEdge|Δwidth|=${d.toFixed(3)}mm`);
        expect(d).toBeGreaterThan(1.0);
        mod.dispose();
    });

    test("widen mid-wall lateral also near rim (no regression)", () => {
        for (const w of [5, 10]) {
            const mod = applyBaseModifiers(baseGeometry, correctionField({ heelCupWidthMm: w }), 0);
            const modArr = mod.getAttribute("position")!.array as Float32Array;
            const { rim, mid, ratio } = midToRimLateralRatio(baseArr, modArr, frame);
            console.log(
                `[HEEL-NARROW] widen=${w}: rim=${rim.toFixed(3)} mid=${mid.toFixed(3)} ratio=${ratio.toFixed(3)}`,
            );
            expect(rim).toBeGreaterThan(1.0);
            expect(ratio).toBeGreaterThan(0.85);
            expect(ratio).toBeLessThan(1.2);
            mod.dispose();
        }
    });

    test("narrow and widen solids close with openEdges=0", () => {
        for (const w of [-8, 8]) {
            const solid = applyBaseModifiersWithSidewall(
                baseGeometry,
                correctionField({ heelCupWidthMm: w }),
                0,
            );
            const report = validateManifold(solid);
            console.log(`[HEEL-NARROW] width=${w} solid openEdges=${report.openEdges}`);
            expect(report.openEdges).toBe(0);
            solid.dispose();
        }
    });
});
