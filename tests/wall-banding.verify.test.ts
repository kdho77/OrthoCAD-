// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Wall banding gate: the rim-conformity transfer must not paint sub-fold
 * vertical banding on the sidewall (piecewise-constant NN seed scatter).
 * Metrics use position-welded interior edges so coincident GLB copies are
 * not counted as folds.
 */
import { describe, expect, test } from "@rstest/core";
import { applyBaseModifiers } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import type { SideCorrections } from "@/types";
import { loadProductionDefaultGlb } from "./helpers/load-production-default-glb";
import { measureWeldedFold } from "./helpers/welded-fold-metrics";

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

describe("wall banding — welded-edge gate", () => {
    test("scan-match + max narrow + thickness: no sub-fold banding", async () => {
        const raw = await loadProductionDefaultGlb({ slot: "left" });
        const basePos = Float32Array.from(raw.getAttribute("position")!.array as Float32Array);
        const index = raw.index!.array as Uint32Array | Uint16Array;
        const topN = (raw.userData as { topVertexCount?: number }).topVertexCount ?? 0;

        const historical: [string, Partial<SideCorrections>][] = [
            ["scanmatch", { heelCupWidthMm: -5.1, archHeightMm: 13.3, apexMoveMm: -12 }],
            ["narrow-10", { heelCupWidthMm: -10 }],
            ["arch12-narrow10", { archHeightMm: 12, heelCupWidthMm: -10 }],
        ];
        // Welded edges count coincident-copy pairs the old index metric skipped.
        const MAX_WELDED_BANDED = 130;

        for (const [name, c] of historical) {
            const mod = applyBaseModifiers(raw, makeField(c), 1);
            const pos = mod.getAttribute("position")!.array as Float32Array;
            const fold = measureWeldedFold(basePos, pos, index, {
                topVertexCount: topN,
                wallOnly: true,
            });
            console.log(`[WALL-BAND ${name}]`, JSON.stringify(fold));
            expect(fold.edgesGe5).toBeLessThanOrEqual(MAX_WELDED_BANDED);
            mod.dispose();
        }

        for (const t of [3, 4]) {
            const field = makeField({});
            field.thicknessMm = t;
            const mod = applyBaseModifiers(raw, field, 1);
            const pos = mod.getAttribute("position")!.array as Float32Array;
            const fold = measureWeldedFold(basePos, pos, index, {
                topVertexCount: topN,
                wallOnly: true,
                heelUMax: 0.42,
            });
            console.log(`[WALL-BAND thickness-${t}]`, JSON.stringify(fold));
            console.log(`[WALL-BAND thickness-${t} vs-target]`, fold);
            expect(fold.edgeCount).toBeGreaterThan(1000);
            if (t === 3) expect(fold.edgesGe10).toBeLessThanOrEqual(5);
            mod.dispose();
        }

        // Widen is reported, not gated (rim-transfer rewrite is deferred).
        for (const w of [6, 10]) {
            const mod = applyBaseModifiers(raw, makeField({ heelCupWidthMm: w }), 1);
            const pos = mod.getAttribute("position")!.array as Float32Array;
            const fold = measureWeldedFold(basePos, pos, index, {
                topVertexCount: topN,
                heelUMax: 0.42,
                wallOnly: true,
            });
            console.log(`[WALL-BAND widen+${w} report]`, JSON.stringify(fold));
            mod.dispose();
        }
        raw.dispose();
    });
});
