// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Arch↔heel blend gate: the medial sidewall at the re-loft handoff
 * (u ∈ [0.24, 0.40]) must not grow a hard crease when arch raise and heel
 * narrowing compose. Guards the Gaussian rim-delta blend + C2 quintic α(u).
 */
import { describe, expect, test } from "@rstest/core";
import {
    ARCH_WALL_RELOFT_U0,
    ARCH_WALL_RELOFT_U1,
    applyBaseModifiers,
    archWallReloftAlpha,
    RIM_DELTA_SIGMA_BASE_MM,
    RIM_DELTA_SIGMA_TOP_MM,
    rimDeltaBlendSigmaMm,
} from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import type { SideCorrections } from "@/types";
import { loadProductionDefaultGlb } from "./helpers/load-production-default-glb";

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

function makeField(c: Partial<SideCorrections>): HeightFieldParams {
    return {
        side: "left",
        lengthMm: 266,
        widthMm: 95,
        thicknessMm: 2,
        corrections: { ...neutralCorrections(), ...c },
        elements: [],
        includeSkives: true,
        includeElements: true,
        trimline: null,
    };
}

function faceNormal(pos: Float32Array, a: number, b: number, c: number): [number, number, number] {
    const ax = pos[a * 3]!,
        ay = pos[a * 3 + 1]!,
        az = pos[a * 3 + 2]!;
    const ux = pos[b * 3]! - ax,
        uy = pos[b * 3 + 1]! - ay,
        uz = pos[b * 3 + 2]! - az;
    const vx = pos[c * 3]! - ax,
        vy = pos[c * 3 + 1]! - ay,
        vz = pos[c * 3 + 2]! - az;
    const nx = uy * vz - uz * vy,
        ny = uz * vx - ux * vz,
        nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    return [nx / len, ny / len, nz / len];
}

function dihedralDeg(n1: [number, number, number], n2: [number, number, number]): number {
    return (
        (Math.acos(Math.max(-1, Math.min(1, n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]))) * 180) / Math.PI
    );
}

/** Max edges in the arch↔heel band allowed to worsen ≥5°. */
const MAX_BLEND_BANDED = 6;
const BAND_WORSENING_DEG = 5;
/** Transition band around the re-loft handoff (slightly wider than U0–U1). */
const BLEND_U0 = 0.2;
const BLEND_U1 = 0.42;

describe("arch↔heel blend — Gaussian rim-delta + C2 quintic", () => {
    test("helpers: σ depth grade + C2 α knees", () => {
        expect(rimDeltaBlendSigmaMm(0)).toBeCloseTo(RIM_DELTA_SIGMA_BASE_MM, 6);
        expect(rimDeltaBlendSigmaMm(1)).toBeCloseTo(RIM_DELTA_SIGMA_TOP_MM, 6);
        const mid = rimDeltaBlendSigmaMm(0.5);
        expect(mid).toBeGreaterThan(RIM_DELTA_SIGMA_TOP_MM);
        expect(mid).toBeLessThan(RIM_DELTA_SIGMA_BASE_MM);

        expect(archWallReloftAlpha(ARCH_WALL_RELOFT_U0)).toBeCloseTo(0, 6);
        expect(archWallReloftAlpha(ARCH_WALL_RELOFT_U1)).toBeCloseTo(1, 6);
        // Midpoint of a quintic is 0.5; C2 flatness ⇒ derivative≈0 near knees.
        expect(archWallReloftAlpha((ARCH_WALL_RELOFT_U0 + ARCH_WALL_RELOFT_U1) / 2)).toBeCloseTo(0.5, 3);
        const eps = 1e-4;
        const d0 =
            (archWallReloftAlpha(ARCH_WALL_RELOFT_U0 + eps) - archWallReloftAlpha(ARCH_WALL_RELOFT_U0)) / eps;
        const d1 =
            (archWallReloftAlpha(ARCH_WALL_RELOFT_U1) - archWallReloftAlpha(ARCH_WALL_RELOFT_U1 - eps)) / eps;
        expect(Math.abs(d0)).toBeLessThan(0.05);
        expect(Math.abs(d1)).toBeLessThan(0.05);
    });

    test("scan-match / arch-only: no hard crease in medial arch↔heel band", async () => {
        const raw = await loadProductionDefaultGlb({ slot: "left" });
        const basePos = Float32Array.from(raw.getAttribute("position")!.array as Float32Array);
        const index = raw.index!.array as Uint32Array | Uint16Array;
        raw.computeBoundingBox();
        const box = raw.boundingBox!;
        const sizes: [number, number][] = [
            [0, box.max.x - box.min.x],
            [1, box.max.y - box.min.y],
            [2, box.max.z - box.min.z],
        ];
        sizes.sort((a, b) => b[1]! - a[1]!);
        const lengthAxis = sizes[0]![0]!;
        const lenMin = box.min.getComponent(lengthAxis);
        const lenSize = sizes[0]![1]! || 1;

        const edgeFaces = new Map<string, number[]>();
        for (let f = 0; f < index.length; f += 3) {
            const a = index[f]!,
                b = index[f + 1]!,
                c = index[f + 2]!;
            for (const [i1, i2] of [
                [a, b],
                [b, c],
                [c, a],
            ] as const) {
                const lo = Math.min(i1, i2),
                    hi = Math.max(i1, i2);
                const k = `${lo},${hi}`;
                let arr = edgeFaces.get(k);
                if (!arr) {
                    arr = [];
                    edgeFaces.set(k, arr);
                }
                arr.push(f);
            }
        }

        const scenarios: [string, Partial<SideCorrections>][] = [
            // Matches the clinical screenshot: arch 18 + heel narrow ~−5.6
            ["arch18-narrow5.6", { archHeightMm: 18, heelCupWidthMm: -5.6, apexMoveMm: -12 }],
            ["scanmatch", { heelCupWidthMm: -5.1, archHeightMm: 13.3, apexMoveMm: -12 }],
            ["arch-only", { archHeightMm: 18 }],
        ];

        for (const [name, c] of scenarios) {
            const mod = applyBaseModifiers(raw, makeField(c), 1);
            const pos = mod.getAttribute("position")!.array as Float32Array;

            let banded = 0;
            let maxWorse = 0;
            let bandEdges = 0;
            for (const [key, faces] of edgeFaces) {
                if (faces.length !== 2) continue;
                const [loS, hiS] = key.split(",");
                const lo = Number(loS);
                const hi = Number(hiS);
                const uLo = (basePos[lo * 3 + lengthAxis]! - lenMin) / lenSize;
                const uHi = (basePos[hi * 3 + lengthAxis]! - lenMin) / lenSize;
                const u = 0.5 * (uLo + uHi);
                if (u < BLEND_U0 || u > BLEND_U1) continue;
                bandEdges++;

                const f1 = faces[0]!,
                    f2 = faces[1]!;
                const bn1 = faceNormal(basePos, index[f1]!, index[f1 + 1]!, index[f1 + 2]!);
                const bn2 = faceNormal(basePos, index[f2]!, index[f2 + 1]!, index[f2 + 2]!);
                const mn1 = faceNormal(pos, index[f1]!, index[f1 + 1]!, index[f1 + 2]!);
                const mn2 = faceNormal(pos, index[f2]!, index[f2 + 1]!, index[f2 + 2]!);
                const worse = dihedralDeg(mn1, mn2) - dihedralDeg(bn1, bn2);
                if (worse > maxWorse) maxWorse = worse;
                if (worse >= BAND_WORSENING_DEG) banded++;
            }
            console.log(
                `[ARCH-HEEL-BLEND ${name}]`,
                JSON.stringify({ bandEdges, banded, maxWorse: +maxWorse.toFixed(3) }),
            );
            expect(bandEdges).toBeGreaterThan(100);
            expect(banded).toBeLessThanOrEqual(MAX_BLEND_BANDED);
            mod.dispose();
        }
        raw.dispose();
    });
});
