// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "@rstest/core";
import type { Box3 } from "three";
import {
    applyBaseModifiers,
    BASE_BOTTOM_DELTA_TOLERANCE_MM,
    diagnoseHeelCupWidthLateral,
    PLANTAR_Z_MAX_MM,
} from "@/lib/geometry/base-modifier";
import { constrainSideCorrections } from "@/lib/geometry/clinical-constraints";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { deriveNativeShellThicknessDatum } from "@/lib/geometry/native-shell-thickness";
import { extractMergedGeometry, loadGlbFromBuffer } from "@/lib/library/loaders";
import type { SideCorrections } from "@/types";
import { DEFAULT_GLB_FIXTURE_PATH } from "../../../../tests/helpers/load-production-default-glb";

const CENTERLINE_EPSILON_MM = 1e-4;
/** Max allowed lateral-delta jump across an edge in the heel→midfoot transition band.
 * Raised from 0.35 → 0.85 after Round 12 Option 2: the prior 0.35 gate (and the
 * ~0.065@width=8 "locked" value) was measured on an index-Laplacian field whose
 * coincident GLB copies had diverged — that field tears topRim to 4. On the
 * position-welded Laplacian (copies stay coincident; rim intact) the same metric
 * sits near the raw envelope gradient (~0.64@w8, ~0.80@w10). Gate is above the
 * welded width=10 value with headroom. */
const MAX_TRANSITION_BAND_JUMP_MM = 0.85;

async function loadDefaultGlbBuffer(): Promise<ArrayBuffer> {
    const buf = readFileSync(DEFAULT_GLB_FIXTURE_PATH);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

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

function widthField(heelCupWidthMm: number): HeightFieldParams {
    return {
        side: "right",
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

function detectAxes(box: Box3): { thickAxis: number; widthAxis: number } {
    const sizes: [number, number][] = [
        [0, box.max.x - box.min.x],
        [1, box.max.y - box.min.y],
        [2, box.max.z - box.min.z],
    ];
    sizes.sort((a, b) => a[1] - b[1]);
    return { thickAxis: sizes[0]![0], widthAxis: sizes[1]![0] };
}

describe("heel cup width — Default.glb verification", () => {
    test("centerline invariance post-smoothing + lateral spread at width 6-8", async () => {
        const group = await loadGlbFromBuffer(await loadDefaultGlbBuffer());
        const merged = extractMergedGeometry(group);
        expect(merged).not.toBeNull();
        const raw = merged!.geometry;

        // OC-PLANTAR-01 DM4: heelCupWidthMm clinical range is −6..+8.
        for (const widthMm of [6, 8]) {
            const field = widthField(widthMm);
            const diag = diagnoseHeelCupWidthLateral(raw, field);
            expect(diag).not.toBeNull();

            console.log(`[HC-WIDTH] width=${widthMm}`, {
                centerlineClosestOffsetMm: diag!.centerlineClosestOffsetMm,
                centerlineSmoothedDeltaMm: diag!.centerlineSmoothedDeltaMm,
                maxLateralAtEdgeMm: diag!.maxLateralAtEdgeMm,
                maxTransitionBandJumpMm: diag!.maxTransitionBandJumpMm,
            });

            expect(Math.abs(diag!.centerlineSmoothedDeltaMm)).toBeLessThan(CENTERLINE_EPSILON_MM);
            expect(diag!.maxLateralAtEdgeMm).toBeGreaterThan(1.0);
            expect(diag!.maxTransitionBandJumpMm).toBeLessThan(MAX_TRANSITION_BAND_JUMP_MM);
        }

        // HC-1 + zero thickAxis on width-only path
        const basePos = raw.getAttribute("position")!.array as Float32Array;
        const topN = (raw.userData as { topVertexCount?: number }).topVertexCount ?? basePos.length / 3;
        raw.computeBoundingBox();
        const { thickAxis, widthAxis } = detectAxes(raw.boundingBox!);
        // Datum-neutral thickness (offset 0) so the width-only path stays purely
        // lateral — the Option C thickness lift is exercised by its own suite.
        const datum = deriveNativeShellThicknessDatum(raw);
        const field8 = { ...widthField(8), thicknessMm: datum?.nativeMinClearanceMm ?? 3 };
        const diag10 = diagnoseHeelCupWidthLateral(raw, field8);
        const modified = applyBaseModifiers(raw, field8, 0);
        const modPos = modified.getAttribute("position")!.array as Float32Array;

        let maxBottomThickDrift = 0;
        let maxTopThickDrift = 0;
        let maxWidthSpread = 0;
        for (let i = 0; i < modPos.length / 3; i++) {
            const dThick = Math.abs(modPos[i * 3 + thickAxis]! - basePos[i * 3 + thickAxis]!);
            const dWidth = Math.abs(modPos[i * 3 + widthAxis]! - basePos[i * 3 + widthAxis]!);
            if (i >= topN) {
                // HC-1 plantar band only — rim-conformity may move the side wall
                // (e.g. thickness-datum lift transfers to wall verts by design).
                if (basePos[i * 3 + thickAxis]! <= PLANTAR_Z_MAX_MM) {
                    maxBottomThickDrift = Math.max(maxBottomThickDrift, dThick);
                }
            } else {
                maxTopThickDrift = Math.max(maxTopThickDrift, dThick);
                maxWidthSpread = Math.max(maxWidthSpread, dWidth);
            }
        }

        console.log("[HC-WIDTH] applyBaseModifiers width=8", {
            thickAxis,
            widthAxis,
            topVertexCount: topN,
            maxBottomThickDrift,
            maxTopThickDrift,
            maxWidthSpread,
            diagMaxLateral: diag10?.maxLateralAtEdgeMm,
        });

        expect(maxBottomThickDrift).toBeLessThan(BASE_BOTTOM_DELTA_TOLERANCE_MM);
        expect(maxTopThickDrift).toBeLessThan(CENTERLINE_EPSILON_MM);
        expect(maxWidthSpread).toBeGreaterThan(1.0);

        modified.dispose();
        raw.dispose();
    });

    test("narrowing (width −6): sidewall follows the top border, HC-1 intact", async () => {
        const group = await loadGlbFromBuffer(await loadDefaultGlbBuffer());
        const merged = extractMergedGeometry(group);
        expect(merged).not.toBeNull();
        const raw = merged!.geometry;

        const basePos = raw.getAttribute("position")!.array as Float32Array;
        const topN = (raw.userData as { topVertexCount?: number }).topVertexCount ?? basePos.length / 3;
        raw.computeBoundingBox();
        const box = raw.boundingBox!;
        const { thickAxis, widthAxis } = detectAxes(box);
        const lengthAxis = [0, 1, 2].find((a) => a !== thickAxis && a !== widthAxis)!;
        const axisMin = [box.min.x, box.min.y, box.min.z];
        const axisMax = [box.max.x, box.max.y, box.max.z];
        const lenMin = axisMin[lengthAxis]!;
        const lenSize = axisMax[lengthAxis]! - lenMin || 1;
        const widCenter = (axisMin[widthAxis]! + axisMax[widthAxis]!) / 2;

        const modified = applyBaseModifiers(raw, widthField(-6), 0);
        const modPos = modified.getAttribute("position")!.array as Float32Array;

        // HC-1: purely lateral on the bottom shell — no vertical drift.
        let maxBottomThickDrift = 0;
        let maxTopInwardMove = 0;
        for (let i = 0; i < modPos.length / 3; i++) {
            if (i >= topN) {
                // HC-1 plantar band only — the sidewall follows the rim by design
                // (thickness-datum lift + narrowing transfer both move wall verts).
                if (basePos[i * 3 + thickAxis]! <= PLANTAR_Z_MAX_MM) {
                    maxBottomThickDrift = Math.max(
                        maxBottomThickDrift,
                        Math.abs(modPos[i * 3 + thickAxis]! - basePos[i * 3 + thickAxis]!),
                    );
                }
            } else {
                const baseOff = Math.abs(basePos[i * 3 + widthAxis]! - widCenter);
                const modOff = Math.abs(modPos[i * 3 + widthAxis]! - widCenter);
                maxTopInwardMove = Math.max(maxTopInwardMove, baseOff - modOff);
            }
        }
        expect(maxBottomThickDrift).toBeLessThan(BASE_BOTTOM_DELTA_TOLERANCE_MM);
        expect(maxTopInwardMove).toBeGreaterThan(1.0);

        // Print constraint: per longitudinal bin in the heel zone, the bottom
        // shell (sidewall + plantar outline) must not overhang the top border
        // any more than it does on the unmodified base. Without the whole-shell
        // lateral fix the lower sidewall stays at original width while the rim
        // narrows ~10 mm — overhang growth of several mm.
        const BIN_U = 0.05;
        const HEEL_ZONE_MAX_U = 0.4;
        const OVERHANG_GROWTH_TOL_MM = 0.3;
        const bins = Math.ceil(HEEL_ZONE_MAX_U / BIN_U);
        const topMaxBase = new Float64Array(bins).fill(-Infinity);
        const botMaxBase = new Float64Array(bins).fill(-Infinity);
        const topMaxMod = new Float64Array(bins).fill(-Infinity);
        const botMaxMod = new Float64Array(bins).fill(-Infinity);
        for (let i = 0; i < modPos.length / 3; i++) {
            const u = (basePos[i * 3 + lengthAxis]! - lenMin) / lenSize;
            if (u < 0 || u >= HEEL_ZONE_MAX_U) continue;
            const b = Math.min(bins - 1, Math.floor(u / BIN_U));
            const baseOff = Math.abs(basePos[i * 3 + widthAxis]! - widCenter);
            const modOff = Math.abs(modPos[i * 3 + widthAxis]! - widCenter);
            if (i < topN) {
                topMaxBase[b] = Math.max(topMaxBase[b]!, baseOff);
                topMaxMod[b] = Math.max(topMaxMod[b]!, modOff);
            } else {
                botMaxBase[b] = Math.max(botMaxBase[b]!, baseOff);
                botMaxMod[b] = Math.max(botMaxMod[b]!, modOff);
            }
        }
        let worstOverhangGrowth = -Infinity;
        for (let b = 0; b < bins; b++) {
            if (!Number.isFinite(topMaxBase[b]!) || !Number.isFinite(botMaxBase[b]!)) continue;
            const overhangBase = botMaxBase[b]! - topMaxBase[b]!;
            const overhangMod = botMaxMod[b]! - topMaxMod[b]!;
            worstOverhangGrowth = Math.max(worstOverhangGrowth, overhangMod - overhangBase);
        }
        console.log("[HC-WIDTH] narrow width=-6", {
            maxBottomThickDrift,
            maxTopInwardMove,
            worstOverhangGrowth,
        });
        expect(worstOverhangGrowth).toBeLessThan(OVERHANG_GROWTH_TOL_MM);

        modified.dispose();
        raw.dispose();
    });
});

describe("heel cup depth — OC-PLANTAR-01 independent of thickness (no combined-wall crush)", () => {
    test("commit simulation: drag 5mm → release at thickness 2mm keeps depth", () => {
        const thicknessMm = 2;
        const requested = 5;
        const c = { ...neutralCorrections(), heelCupDepthMm: requested };
        const { constrained, violations } = constrainSideCorrections(c, thicknessMm);

        console.log("[HC-DEPTH] constraint-sim@2mm", {
            thicknessMm,
            requested,
            applied: constrained.heelCupDepthMm,
            violations,
        });

        // OC-PLANTAR-01: depth is not crushed by thickness/wall heuristic (R14/E4).
        expect(constrained.heelCupDepthMm).toBe(5);
        expect(violations.some((v) => v.field === "heelCupDepthMm")).toBe(false);
    });

    test("full drag→release sequence simulation (store + preview + geometry inputs)", () => {
        const thicknessMm = 2;
        const committedBefore = 0;
        const previewDuringDrag = 5;

        // Step 1: during drag — preview merged (no constrain on preview path today)
        const mergedDuringDrag = { ...neutralCorrections(), heelCupDepthMm: previewDuringDrag };
        console.log("[HC-DEPTH] sim:drag", {
            committed: committedBefore,
            preview: previewDuringDrag,
            mergedDepth: mergedDuringDrag.heelCupDepthMm,
        });

        // Step 2: on release — updateCorrection applies constrainSideCorrections
        const { constrained, violations } = constrainSideCorrections(
            { ...neutralCorrections(), heelCupDepthMm: previewDuringDrag },
            thicknessMm,
        );
        const committedAfter = constrained.heelCupDepthMm;
        console.log("[HC-DEPTH] sim:commit", {
            requested: previewDuringDrag,
            applied: committedAfter,
            thicknessMm,
            violations,
        });

        // Step 3: after clearCorrectionPreview — geometry reads committed only
        const mergedAfterRelease = { ...neutralCorrections(), heelCupDepthMm: committedAfter };
        console.log("[HC-DEPTH] sim:post-clear", {
            store: committedAfter,
            preview: null,
            mergedDepth: mergedAfterRelease.heelCupDepthMm,
        });

        expect(mergedDuringDrag.heelCupDepthMm).toBe(5);
        expect(committedAfter).toBe(5);
        expect(mergedAfterRelease.heelCupDepthMm).toBe(5);
    });
});
