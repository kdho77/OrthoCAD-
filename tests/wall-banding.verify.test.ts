// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Wall banding gate: the rim-conformity transfer must not paint sub-fold
 * vertical banding on the sidewall (piecewise-constant NN seed scatter).
 * The print gate (sidewall-smoothness, 20°) misses these — banding renders
 * at 3-8° per edge. Guards the Gaussian rim-delta blend.
 */
import { describe, expect, test } from "@rstest/core";
import { applyBaseModifiers } from "@/lib/geometry/base-modifier";
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

/**
 * Max edges allowed to worsen ≥5°. The base carries 4 marginal edges at the
 * posterior heel (u≈0.05) that flare under max narrowing; allow headroom of 8.
 * Pre-blend (NN seed scatter) measured 100+ banded edges under scan-match.
 */
const MAX_BANDED_EDGE_COUNT = 8;
const BAND_WORSENING_DEG = 5;

describe("wall banding — Gaussian rim-delta blend gate", () => {
    test("scan-match + max narrow: no sub-fold banding on the full mesh", async () => {
        const raw = await loadProductionDefaultGlb({ slot: "left" });
        const basePos = Float32Array.from(raw.getAttribute("position")!.array as Float32Array);
        const index = raw.index!.array as Uint32Array | Uint16Array;

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
            ["scanmatch", { heelCupWidthMm: -5.1, archHeightMm: 13.3, apexMoveMm: -12 }],
            ["narrow-10", { heelCupWidthMm: -10 }],
            ["arch12-narrow10", { archHeightMm: 12, heelCupWidthMm: -10 }],
        ];

        for (const [name, c] of scenarios) {
            const mod = applyBaseModifiers(raw, makeField(c), 1);
            const pos = mod.getAttribute("position")!.array as Float32Array;

            let banded = 0;
            let maxWorse = 0;
            for (const faces of edgeFaces.values()) {
                if (faces.length !== 2) continue;
                const f1 = faces[0]!,
                    f2 = faces[1]!;
                const bn1 = faceNormal(basePos, index[f1]!, index[f1 + 1]!, index[f1 + 2]!);
                const bn2 = faceNormal(basePos, index[f2]!, index[f2 + 1]!, index[f2 + 2]!);
                const mn1 = faceNormal(pos, index[f1]!, index[f1 + 1]!, index[f1 + 2]!);
                const mn2 = faceNormal(pos, index[f2]!, index[f2 + 1]!, index[f2 + 2]!);
                const baseA =
                    (Math.acos(
                        Math.max(-1, Math.min(1, bn1[0] * bn2[0] + bn1[1] * bn2[1] + bn1[2] * bn2[2])),
                    ) *
                        180) /
                    Math.PI;
                const modA =
                    (Math.acos(
                        Math.max(-1, Math.min(1, mn1[0] * mn2[0] + mn1[1] * mn2[1] + mn1[2] * mn2[2])),
                    ) *
                        180) /
                    Math.PI;
                const worse = modA - baseA;
                if (worse > maxWorse) maxWorse = worse;
                if (worse >= BAND_WORSENING_DEG) banded++;
            }
            console.log(`[WALL-BAND ${name}]`, JSON.stringify({ banded, maxWorse }));
            expect(banded).toBeLessThanOrEqual(MAX_BANDED_EDGE_COUNT);
            mod.dispose();
        }
        raw.dispose();
    });
});
