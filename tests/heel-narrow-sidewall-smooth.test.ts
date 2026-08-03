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

/** Min BASELINE triangle altitude (mm) for the crease census (excludes slivers). */
const MIN_ALTITUDE_MM = 0.1;
const CREASE_BASE_MAX_DEG = 8;
const CREASE_JUMP_MIN_DEG = 12;

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
        thicknessMm: 3,
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

function faceNormalOf(arr: Float32Array, idx: ArrayLike<number>, f: number): [number, number, number] {
    const a = idx[f * 3]!;
    const b = idx[f * 3 + 1]!;
    const c = idx[f * 3 + 2]!;
    const abx = arr[b * 3]! - arr[a * 3]!;
    const aby = arr[b * 3 + 1]! - arr[a * 3 + 1]!;
    const abz = arr[b * 3 + 2]! - arr[a * 3 + 2]!;
    const acx = arr[c * 3]! - arr[a * 3]!;
    const acy = arr[c * 3 + 1]! - arr[a * 3 + 1]!;
    const acz = arr[c * 3 + 2]! - arr[a * 3 + 2]!;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    return [nx / len, ny / len, nz / len];
}

function angleDeg(n0: [number, number, number], n1: [number, number, number]): number {
    const dot = Math.max(-1, Math.min(1, n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2]));
    return (Math.acos(dot) * 180) / Math.PI;
}

/**
 * New hard creases on the BOTTOM heel sidewall (u ≤ 0.38, z > plantar).
 * Mirrors the arch-dome crease census but scoped to the narrowed heel wall.
 */
function countNewHeelWallCreases(geoMod: BufferGeometry, baseArr: Float32Array, frame: Frame): number {
    const idx = geoMod.index!.array as ArrayLike<number>;
    const modArr = geoMod.getAttribute("position")!.array as Float32Array;
    const { topVertexCount, count, lengthAxis, thickAxis, lenMin, lenSize } = frame;

    const inHeelWall = (vi: number): boolean => {
        if (vi < topVertexCount || vi >= count) return false;
        if (baseArr[vi * 3 + thickAxis]! <= PLANTAR_Z_MAX_MM) return false;
        const u = (baseArr[vi * 3 + lengthAxis]! - lenMin) / (lenSize || 1);
        return u <= 0.38;
    };

    const groupOf = new Int32Array(count).fill(-1);
    const keyToGroup = new Map<string, number>();
    let groupCount = 0;
    for (let i = topVertexCount; i < count; i++) {
        if (!inHeelWall(i)) continue;
        const key = `${baseArr[i * 3]},${baseArr[i * 3 + 1]},${baseArr[i * 3 + 2]}`;
        let g = keyToGroup.get(key);
        if (g === undefined) {
            g = groupCount++;
            keyToGroup.set(key, g);
        }
        groupOf[i] = g;
    }

    const wellFormed = (f: number): boolean => {
        const a = idx[f * 3]!;
        const b = idx[f * 3 + 1]!;
        const c = idx[f * 3 + 2]!;
        if (!inHeelWall(a) || !inHeelWall(b) || !inHeelWall(c)) return false;
        const e = (p: number, q: number) =>
            Math.hypot(
                baseArr[q * 3]! - baseArr[p * 3]!,
                baseArr[q * 3 + 1]! - baseArr[p * 3 + 1]!,
                baseArr[q * 3 + 2]! - baseArr[p * 3 + 2]!,
            );
        const abx = baseArr[b * 3]! - baseArr[a * 3]!;
        const aby = baseArr[b * 3 + 1]! - baseArr[a * 3 + 1]!;
        const abz = baseArr[b * 3 + 2]! - baseArr[a * 3 + 2]!;
        const acx = baseArr[c * 3]! - baseArr[a * 3]!;
        const acy = baseArr[c * 3 + 1]! - baseArr[a * 3 + 1]!;
        const acz = baseArr[c * 3 + 2]! - baseArr[a * 3 + 2]!;
        const nx = aby * acz - abz * acy;
        const ny = abz * acx - abx * acz;
        const nz = abx * acy - aby * acx;
        const area2 = Math.sqrt(nx * nx + ny * ny + nz * nz);
        const longest = Math.max(e(a, b), e(b, c), e(c, a));
        return longest > 0 && area2 / longest >= MIN_ALTITUDE_MM;
    };

    const faceCount = idx.length / 3;
    const edgeToFace = new Map<string, number>();
    let creases = 0;
    for (let f = 0; f < faceCount; f++) {
        const a0 = idx[f * 3]!;
        if (a0 < topVertexCount) continue;
        for (let e = 0; e < 3; e++) {
            const v0 = idx[f * 3 + e]!;
            const v1 = idx[f * 3 + ((e + 1) % 3)]!;
            if (!inHeelWall(v0) || !inHeelWall(v1)) continue;
            const g0 = groupOf[v0]!;
            const g1 = groupOf[v1]!;
            if (g0 < 0 || g1 < 0 || g0 === g1) continue;
            const key = g0 < g1 ? `${g0},${g1}` : `${g1},${g0}`;
            const other = edgeToFace.get(key);
            if (other === undefined) {
                edgeToFace.set(key, f);
                continue;
            }
            if (!wellFormed(f) || !wellFormed(other)) continue;
            const baseDeg = angleDeg(faceNormalOf(baseArr, idx, other), faceNormalOf(baseArr, idx, f));
            const modDeg = angleDeg(faceNormalOf(modArr, idx, other), faceNormalOf(modArr, idx, f));
            if (baseDeg < CREASE_BASE_MAX_DEG && modDeg > baseDeg + CREASE_JUMP_MIN_DEG) creases++;
        }
    }
    return creases;
}

/** Max |Δwidth| on plantar heel band — must move when narrowing (not leave a wide shelf). */
function maxPlantarHeelWidthDelta(baseArr: Float32Array, modArr: Float32Array, frame: Frame): number {
    const { topVertexCount, count, lengthAxis, widthAxis, thickAxis, lenMin, lenSize, widCenter } = frame;
    let max = 0;
    for (let i = topVertexCount; i < count; i++) {
        if (baseArr[i * 3 + thickAxis]! > PLANTAR_Z_MAX_MM) continue;
        const u = (baseArr[i * 3 + lengthAxis]! - lenMin) / (lenSize || 1);
        if (u > 0.38) continue;
        const d = Math.abs(modArr[i * 3 + widthAxis]! - baseArr[i * 3 + widthAxis]!);
        // Prefer edge plantar (large |offset|) — centerline barely moves.
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
    test("negative heelCupWidthMm leaves zero new hard creases on the heel wall", () => {
        const scenarios: Array<[string, Partial<SideCorrections>]> = [
            ["narrow-5", { heelCupWidthMm: -5 }],
            ["narrow-10", { heelCupWidthMm: -10 }],
            ["narrow-8+depth", { heelCupWidthMm: -8, heelCupDepthMm: 5 }],
        ];
        for (const [name, patch] of scenarios) {
            const modified = applyBaseModifiers(baseGeometry, correctionField(patch), 0);
            const creases = countNewHeelWallCreases(modified, baseArr, frame);
            console.log(`[HEEL-NARROW] ${name}: newHardCreases=${creases}`);
            expect(creases).toBe(0);
            modified.dispose();
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

    test("widen still smooth + solid (no regression)", () => {
        for (const w of [5, 10]) {
            const mod = applyBaseModifiers(baseGeometry, correctionField({ heelCupWidthMm: w }), 0);
            expect(countNewHeelWallCreases(mod, baseArr, frame)).toBe(0);
            const solid = applyBaseModifiersWithSidewall(
                baseGeometry,
                correctionField({ heelCupWidthMm: w }),
                0,
            );
            const report = validateManifold(solid);
            expect(report.openEdges).toBe(0);
            solid.dispose();
            mod.dispose();
        }
    });

    test("narrow solid closes with openEdges=0", () => {
        const solid = applyBaseModifiersWithSidewall(
            baseGeometry,
            correctionField({ heelCupWidthMm: -8 }),
            0,
        );
        const report = validateManifold(solid);
        console.log(`[HEEL-NARROW] solid openEdges=${report.openEdges}`);
        expect(report.openEdges).toBe(0);
        solid.dispose();
    });
});
