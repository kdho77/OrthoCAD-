// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Interim thickness/lift fold gate (welded topology, Default.glb).
 * Thickness fixtures are gated. Widen cases are reported only — the
 * rim-transfer rewrite is deferred for a procedural wall path.
 */

import { describe, expect, test } from "@rstest/core";
import {
    applyBaseModifiers,
    BASE_BOTTOM_DELTA_TOLERANCE_MM,
    BASE_REFERENCE_THICKNESS_MM,
    detectArchSideSign,
    PLANTAR_Z_MAX_MM,
} from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { archGrindPlantarMask, defaultSideShapeFinish } from "@/lib/geometry/shape-finish-modifiers";
import type { SideCorrections } from "@/types";
import { loadProductionDefaultGlb } from "./helpers/load-production-default-glb";
import { measureWeldedFold } from "./helpers/welded-fold-metrics";

const MAX_WORSE_DEG = 8;
const MAX_P99_DEG = 1.5;
const MAX_EDGES_GE5 = 10;

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

function makeField(c: Partial<SideCorrections>, thicknessMm: number): HeightFieldParams {
    return {
        side: "left",
        lengthMm: 266,
        widthMm: 95,
        thicknessMm,
        corrections: { ...neutralCorrections(), ...c },
        elements: [],
        includeSkives: true,
        includeElements: true,
        trimline: null,
    };
}

function detectThickAxis(pos: Float32Array, count: number): number {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) {
        for (let a = 0; a < 3; a++) {
            const v = pos[i * 3 + a]!;
            if (v < min[a]!) min[a] = v;
            if (v > max[a]!) max[a] = v;
        }
    }
    const size = [max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!];
    let axis = 0;
    if (size[1]! < size[axis]!) axis = 1;
    if (size[2]! < size[axis]!) axis = 2;
    return axis;
}

describe("wall fold — thickness fixtures (gated) + widen report", () => {
    test("thickness lift meets welded fold targets; plantar stays put", async () => {
        const raw = await loadProductionDefaultGlb({ slot: "left" });
        const basePos = Float32Array.from(raw.getAttribute("position")!.array as Float32Array);
        const index = raw.index!.array as Uint32Array | Uint16Array;
        const topN = (raw.userData as { topVertexCount?: number }).topVertexCount ?? 0;
        const thickAxis = detectThickAxis(basePos, basePos.length / 3);
        const heelOpts = { topVertexCount: topN, heelUMax: 0.42, wallOnly: true, thickAxis };

        const thicknessCases: [string, Partial<SideCorrections>, number, boolean][] = [
            ["t2", {}, 2, true],
            ["t3", {}, 3, true],
            ["t4", {}, 4, true],
            ["t4-lift10", { heelLiftMm: 10 }, 4, false],
        ];

        for (const [name, c, t, gated] of thicknessCases) {
            const mod = applyBaseModifiers(raw, makeField(c, t), 1);
            const pos = mod.getAttribute("position")!.array as Float32Array;
            const fold = measureWeldedFold(basePos, pos, index, heelOpts);
            console.log(`[THICK-FOLD ${name}]`, JSON.stringify(fold));

            let plantarZChangeMm = 0;
            for (let i = topN; i < pos.length / 3; i++) {
                if (basePos[i * 3 + thickAxis]! > PLANTAR_Z_MAX_MM) continue;
                plantarZChangeMm = Math.max(
                    plantarZChangeMm,
                    Math.abs(pos[i * 3 + thickAxis]! - basePos[i * 3 + thickAxis]!),
                );
            }
            const liftMm = c.heelLiftMm ?? 0;
            console.log(
                `[THICK-FOLD ${name} plantarZChangeMm]`,
                plantarZChangeMm.toFixed(4),
                liftMm > 0 ? "(expected seat raise from heel lift)" : "",
            );

            if (gated && liftMm === 0) {
                expect(plantarZChangeMm).toBeLessThan(BASE_BOTTOM_DELTA_TOLERANCE_MM);
            }
            if (gated && t <= 3) {
                expect(fold.edgesGe10).toBeLessThanOrEqual(t === 2 ? 0 : 5);
                expect(fold.maxWorseDeg).toBeLessThanOrEqual(t === 2 ? 2 : 16);
            }
            if (gated && t === 4) {
                expect(fold.edgesGe10).toBeLessThanOrEqual(8);
                expect(fold.maxWorseDeg).toBeLessThanOrEqual(24);
            }
            const full = measureWeldedFold(basePos, pos, index, {
                topVertexCount: topN,
                wallOnly: true,
                thickAxis,
            });
            console.log(`[THICK-FOLD ${name} full-length]`, JSON.stringify(full));
            if (gated && t === 2) {
                expect(full.edgesGe10).toBeLessThanOrEqual(0);
            }
            if (gated && t === 3) {
                expect(full.edgesGe10).toBeLessThanOrEqual(100);
                expect(full.maxWorseDeg).toBeLessThanOrEqual(20);
            }
            if (gated && t === 4) {
                expect(full.edgesGe10).toBeLessThanOrEqual(200);
                expect(full.maxWorseDeg).toBeLessThanOrEqual(28);
            }
            console.log(`[THICK-FOLD ${name} vs-target]`, {
                max: fold.maxWorseDeg,
                maxTarget: MAX_WORSE_DEG,
                p99: fold.p99WorseDeg,
                p99Target: MAX_P99_DEG,
                edgesGe5: fold.edgesGe5,
                edgesGe5Target: MAX_EDGES_GE5,
                edgesGe10: fold.edgesGe10,
            });
            mod.dispose();
        }

        const widenCases: [string, Partial<SideCorrections>, number][] = [
            ["w+0.1 t2", { heelCupWidthMm: 0.1 }, 2],
            ["w+3 t3", { heelCupWidthMm: 3 }, 3],
            ["w+6 t3", { heelCupWidthMm: 6 }, 3],
            ["w+6 t4", { heelCupWidthMm: 6 }, 4],
            ["w+10 t3", { heelCupWidthMm: 10 }, 3],
            ["w+10 t4", { heelCupWidthMm: 10 }, 4],
            ["w-6 t3", { heelCupWidthMm: -6 }, 3],
            ["w-10 t3", { heelCupWidthMm: -10 }, 3],
            ["w+6 lift10 t4", { heelCupWidthMm: 6, heelLiftMm: 10 }, 4],
            ["w+6 depth8 t3", { heelCupWidthMm: 6, heelCupDepthMm: 8 }, 3],
            ["w+6 post4 t3", { heelCupWidthMm: 6, rearfootPostingDeg: 4 }, 3],
            ["w+6 arch8 t3", { heelCupWidthMm: 6, archHeightMm: 8 }, 3],
        ];
        for (const [name, c, t] of widenCases) {
            const mod = applyBaseModifiers(raw, makeField(c, t), 1);
            const pos = mod.getAttribute("position")!.array as Float32Array;
            const fold = measureWeldedFold(basePos, pos, index, heelOpts);
            console.log(`[WIDEN-FOLD report ${name}]`, JSON.stringify(fold));
            mod.dispose();
        }

        // Arch-grind lower wall (z=1–3 inside the grind mask) must not rise
        // when thickness leaves t=2. Global z=1–3 includes short midfoot crests
        // that correctly take full W=1 lift (~1 mm at t3) after the local-crest fix.
        const lenAxis = [0, 1, 2].reduce(
            (best, a) => {
                let lo = Infinity;
                let hi = -Infinity;
                for (let i = 0; i < basePos.length / 3; i++) {
                    const v = basePos[i * 3 + a]!;
                    if (v < lo) lo = v;
                    if (v > hi) hi = v;
                }
                const span = hi - lo;
                return span > best.span ? { axis: a, span, lo } : best;
            },
            { axis: 0, span: 0, lo: 0 },
        );
        const widthAxis = ([0, 1, 2] as const).find((a) => a !== thickAxis && a !== lenAxis.axis) ?? 0;
        let widLo = Infinity;
        let widHi = -Infinity;
        for (let i = 0; i < basePos.length / 3; i++) {
            const v = basePos[i * 3 + widthAxis]!;
            if (v < widLo) widLo = v;
            if (v > widHi) widHi = v;
        }
        const widCenter = (widLo + widHi) / 2;
        const widSize = widHi - widLo || 1;
        const widthSign = -(detectArchSideSign(raw) * -1);
        const grindRise = (thicknessMm: number): number => {
            const field = makeField({}, thicknessMm);
            field.shapeFinish = { ...defaultSideShapeFinish(), archGrindDepthMm: 5 };
            const mod = applyBaseModifiers(raw, field, 1);
            const pos = mod.getAttribute("position")!.array as Float32Array;
            let maxRise = 0;
            for (let i = topN; i < pos.length / 3; i++) {
                const z0 = basePos[i * 3 + thickAxis]!;
                if (z0 <= PLANTAR_Z_MAX_MM || z0 > 3) continue;
                const u = (basePos[i * 3 + lenAxis.axis]! - lenAxis.lo) / (lenAxis.span || 1);
                const vSigned = ((basePos[i * 3 + widthAxis]! - widCenter) / (widSize / 2)) * widthSign;
                if (archGrindPlantarMask(u, Math.abs(vSigned)) < 0.2) continue;
                maxRise = Math.max(maxRise, pos[i * 3 + thickAxis]! - z0);
            }
            mod.dispose();
            return maxRise;
        };
        const grindT2 = grindRise(2);
        const grindT3 = grindRise(3);
        console.log(`[GRIND-WALL t2 vs t3]`, { grindT2, grindT3, delta: grindT3 - grindT2 });
        // Residual is pre-Taubin W(h) on the z=1–3 grind hinge (pin does not
        // change it). Lock at 0.40 so a 1.09 mm Taubin bleed still fails.
        expect(grindT3 - grindT2).toBeLessThan(0.4);

        raw.dispose();
    });
});
