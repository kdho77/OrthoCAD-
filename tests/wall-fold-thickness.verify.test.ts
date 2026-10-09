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
    PLANTAR_Z_MAX_MM,
} from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
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

            let plantarDrift = 0;
            for (let i = topN; i < pos.length / 3; i++) {
                if (basePos[i * 3 + thickAxis]! > PLANTAR_Z_MAX_MM) continue;
                plantarDrift = Math.max(
                    plantarDrift,
                    Math.abs(pos[i * 3 + thickAxis]! - basePos[i * 3 + thickAxis]!),
                );
            }
            console.log(`[THICK-FOLD ${name} plantarDrift]`, plantarDrift.toFixed(4));

            if (gated && (c.heelLiftMm ?? 0) === 0) {
                expect(plantarDrift).toBeLessThan(BASE_BOTTOM_DELTA_TOLERANCE_MM);
            }
            if (gated && t <= 3) {
                expect(fold.edgesGe10).toBeLessThanOrEqual(t === 2 ? 0 : 5);
                expect(fold.maxWorseDeg).toBeLessThanOrEqual(t === 2 ? 2 : 16);
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
        raw.dispose();
    });
});
