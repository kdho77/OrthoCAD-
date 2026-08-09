// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Heel-narrow loft gate: flat plantar edge → top rim must stay a smooth cup
 * wall (no rim collar, no floor-edge shelf, no plantar face folds).
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

/** Rim collar: mid maxOff − rim maxOff; must stay ≤ 0 (natural flare). */
const MAX_RIM_COLLAR_MM = 0.75;
/** Plantar outline must not protrude past low wall (shelf). */
const MAX_PLANTAR_OVER_LOW_MM = 0.35;
/** Floor-band dihedral worsening (deg) — IDW regression was 180°. */
const MAX_FLOOR_DIHEDRAL_WORSE_DEG = 5;

describe("heel-narrow wall profile — smooth plantar→rim loft", () => {
    test("width −10: no shelf, no rim collar, floor unfolded", async () => {
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
        const index = raw.index!.array as Uint32Array | Uint16Array;

        const modified = applyBaseModifiers(raw, makeField(-10), 1);
        const modPos = modified.getAttribute("position")!.array as Float32Array;

        let midMaxOff = 0;
        let rimMaxOff = 0;
        let outlineMeanIn = 0;
        let outlineN = 0;
        let topMeanIn = 0;
        let topNPeriph = 0;
        let worstPlantarOverLow = -Infinity;

        const bins = 10;
        const heelU = 0.3;
        const plantarMax = new Float64Array(bins).fill(-Infinity);
        const lowMax = new Float64Array(bins).fill(-Infinity);

        for (let i = 0; i < modPos.length / 3; i++) {
            const u = (basePos[i * 3 + lengthAxis]! - lenMin) / lenSize;
            if (u < 0.05 || u > 0.22) continue;
            const baseOff = Math.abs(basePos[i * 3 + widthAxis]! - widCenter);
            const modOff = Math.abs(modPos[i * 3 + widthAxis]! - widCenter);
            const inward = baseOff - modOff;

            if (i < topN) {
                if (baseOff >= 20) {
                    topMeanIn += inward;
                    topNPeriph++;
                }
                continue;
            }

            const z = basePos[i * 3 + thickAxis]!;
            const b = Math.min(bins - 1, Math.floor(((u - 0.05) / 0.17) * bins));
            if (z <= PLANTAR_Z_MAX_MM) {
                plantarMax[b] = Math.max(plantarMax[b]!, modOff);
                if (baseOff > 22) {
                    outlineMeanIn += inward;
                    outlineN++;
                }
            } else if (z <= 4) {
                lowMax[b] = Math.max(lowMax[b]!, modOff);
            } else if (z > 5 && z <= 10) {
                if (baseOff > 20) midMaxOff = Math.max(midMaxOff, modOff);
            } else if (z > 14) {
                if (baseOff > 20) rimMaxOff = Math.max(rimMaxOff, modOff);
            }
        }
        for (let b = 0; b < bins; b++) {
            if (Number.isFinite(plantarMax[b]!) && Number.isFinite(lowMax[b]!)) {
                worstPlantarOverLow = Math.max(worstPlantarOverLow, plantarMax[b]! - lowMax[b]!);
            }
        }

        // Floor-band dihedral worsening on periphery heel edges
        const edgeFaces = new Map<string, number[]>();
        for (let f = 0; f < index.length; f += 3) {
            const a = index[f]!,
                b = index[f + 1]!,
                c = index[f + 2]!;
            if (a < topN || b < topN || c < topN) continue;
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
        let maxFloorWorse = 0;
        for (const [k, faces] of edgeFaces) {
            if (faces.length !== 2) continue;
            const [s1, s2] = k.split(",").map(Number) as [number, number];
            const z1 = basePos[s1 * 3 + thickAxis]!;
            const z2 = basePos[s2 * 3 + thickAxis]!;
            if ((z1 + z2) / 2 > 1.0) continue;
            const u1 = (basePos[s1 * 3 + lengthAxis]! - lenMin) / lenSize;
            if (u1 > 0.28) continue;
            const off1 = Math.abs(basePos[s1 * 3 + widthAxis]! - widCenter);
            if (off1 < 18) continue;
            const f1 = faces[0]!,
                f2 = faces[1]!;
            const bn1 = faceNormal(basePos, index[f1]!, index[f1 + 1]!, index[f1 + 2]!);
            const bn2 = faceNormal(basePos, index[f2]!, index[f2 + 1]!, index[f2 + 2]!);
            const mn1 = faceNormal(modPos, index[f1]!, index[f1 + 1]!, index[f1 + 2]!);
            const mn2 = faceNormal(modPos, index[f2]!, index[f2 + 1]!, index[f2 + 2]!);
            const baseA =
                (Math.acos(Math.max(-1, Math.min(1, bn1[0] * bn2[0] + bn1[1] * bn2[1] + bn1[2] * bn2[2]))) *
                    180) /
                Math.PI;
            const modA =
                (Math.acos(Math.max(-1, Math.min(1, mn1[0] * mn2[0] + mn1[1] * mn2[1] + mn1[2] * mn2[2]))) *
                    180) /
                Math.PI;
            maxFloorWorse = Math.max(maxFloorWorse, modA - baseA);
        }

        const rimCollar = midMaxOff - rimMaxOff;
        const outlineIn = outlineN ? outlineMeanIn / outlineN : 0;
        const topIn = topNPeriph ? topMeanIn / topNPeriph : 0;

        console.log("[HEEL-NARROW-PROFILE]", {
            outlineIn,
            topIn,
            midMaxOff,
            rimMaxOff,
            rimCollar,
            worstPlantarOverLow,
            maxFloorWorse,
        });

        expect(outlineIn).toBeGreaterThan(2.0);
        expect(rimCollar).toBeLessThan(MAX_RIM_COLLAR_MM);
        expect(worstPlantarOverLow).toBeLessThan(MAX_PLANTAR_OVER_LOW_MM);
        expect(maxFloorWorse).toBeLessThan(MAX_FLOOR_DIHEDRAL_WORSE_DEG);

        modified.dispose();
        raw.dispose();
    });
});
