// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Heel-narrow wall-profile gate.
 *
 * Confirms the reported "ridge when heel is narrowed" is not an unmoved flat
 * base: the plantar outline must pull in with the top, and the sidewall must
 * not grow a rim collar (maxOff at wall-top falling below mid-wall) from
 * height-sheared lateral transfer.
 */
import { describe, expect, test } from "@rstest/core";
import { applyBaseModifiers, PLANTAR_Z_MAX_MM } from "@/lib/geometry/base-modifier";
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

function makeField(heelCupWidthMm: number): HeightFieldParams {
    return {
        side: "left",
        lengthMm: 266,
        widthMm: 95,
        thicknessMm: 3,
        corrections: { ...neutralCorrections(), heelCupWidthMm },
        elements: [],
        includeSkives: true,
        includeElements: true,
        trimline: null,
    };
}

/**
 * Rim collar: mid-wall maxOff − rim maxOff. On main this went positive (~2–4 mm)
 * when height-sheared transfer inverted the natural flare. After the fix the rim
 * must remain ≥ mid-wall (collar ≤ 0) within tolerance for sampling noise.
 */
const MAX_RIM_COLLAR_MM = 0.75;
/** Plantar outline mean inward must stay within this of top periphery (mm). */
const MAX_PLANTAR_TOP_INWARD_GAP_MM = 2.5;

describe("heel-narrow wall profile — no rim collar / flat-base lockstep", () => {
    test("width −10: plantar pulls in; wallTop shear and rim collar bounded", async () => {
        const raw = await loadProductionDefaultGlb({ slot: "left" });
        const basePos = Float32Array.from(raw.getAttribute("position")!.array as Float32Array);
        const topN = (raw.userData as { topVertexCount?: number }).topVertexCount ?? basePos.length / 3;
        raw.computeBoundingBox();
        const box = raw.boundingBox!;
        const sizes: [number, number][] = [
            [0, box.max.x - box.min.x],
            [1, box.max.y - box.min.y],
            [2, box.max.z - box.min.z],
        ];
        sizes.sort((a, b) => a[1] - b[1]);
        const thickAxis = sizes[0]![0]!;
        const widthAxis = sizes[1]![0]!;
        const lengthAxis = ([0, 1, 2] as const).find((a) => a !== thickAxis && a !== widthAxis)!;
        const lenMin = [box.min.x, box.min.y, box.min.z][lengthAxis]!;
        const lenSize = [box.max.x, box.max.y, box.max.z][lengthAxis]! - lenMin || 1;
        const widCenter =
            ([box.min.x, box.min.y, box.min.z][widthAxis]! + [box.max.x, box.max.y, box.max.z][widthAxis]!) /
            2;

        const modified = applyBaseModifiers(raw, makeField(-10), 0);
        const modPos = modified.getAttribute("position")!.array as Float32Array;

        let plantarIn = 0;
        let plantarN = 0;
        let wallTopIn = 0;
        let wallTopN = 0;
        let midMaxOff = 0;
        let rimMaxOff = 0;
        let plantarOutlineIn = 0;
        let plantarOutlineN = 0;
        let topPeriphIn = 0;
        let topPeriphN = 0;

        for (let i = 0; i < modPos.length / 3; i++) {
            const u = (basePos[i * 3 + lengthAxis]! - lenMin) / lenSize;
            if (u < 0.05 || u > 0.22) continue;
            const baseOff = Math.abs(basePos[i * 3 + widthAxis]! - widCenter);
            const modOff = Math.abs(modPos[i * 3 + widthAxis]! - widCenter);
            const inward = baseOff - modOff;

            if (i < topN) {
                if (baseOff < 20) continue;
                topPeriphIn += inward;
                topPeriphN++;
                continue;
            }

            const z = basePos[i * 3 + thickAxis]!;
            if (z <= PLANTAR_Z_MAX_MM) {
                if (baseOff > 20) {
                    plantarIn += inward;
                    plantarN++;
                }
                if (baseOff > 22) {
                    plantarOutlineIn += inward;
                    plantarOutlineN++;
                }
            } else if (z > 5 && z <= 10) {
                if (baseOff > 20) midMaxOff = Math.max(midMaxOff, modOff);
            } else if (z > 14) {
                if (baseOff > 20) {
                    wallTopIn += inward;
                    wallTopN++;
                    rimMaxOff = Math.max(rimMaxOff, modOff);
                }
            }
        }

        const plantarMeanIn = plantarN ? plantarIn / plantarN : 0;
        const wallTopMeanIn = wallTopN ? wallTopIn / wallTopN : 0;
        const topMeanIn = topPeriphN ? topPeriphIn / topPeriphN : 0;
        const outlineMeanIn = plantarOutlineN ? plantarOutlineIn / plantarOutlineN : 0;
        const rimCollar = midMaxOff - rimMaxOff;

        console.log("[HEEL-NARROW-PROFILE]", {
            plantarMeanIn,
            outlineMeanIn,
            topMeanIn,
            wallTopMeanIn,
            midMaxOff,
            rimMaxOff,
            rimCollar,
            plantarN,
            wallTopN,
        });

        // Flat base pulls in with the top (user's suspected missing piece — required,
        // but not sufficient alone; the ridge was the rim collar below).
        expect(outlineMeanIn).toBeGreaterThan(2.0);
        expect(Math.abs(outlineMeanIn - topMeanIn)).toBeLessThan(MAX_PLANTAR_TOP_INWARD_GAP_MM);

        // No rim collar: height-sheared transfer on main inverted flare so rim
        // maxOff fell below mid-wall — the visible sidewall ridge.
        expect(rimCollar).toBeLessThan(MAX_RIM_COLLAR_MM);

        modified.dispose();
        raw.dispose();
    });
});
