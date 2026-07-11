// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, test } from "@rstest/core";
import type { Box3 } from "three";
import {
    applyBaseModifiers,
    BASE_BOTTOM_DELTA_TOLERANCE_MM,
    diagnoseHeelCupWidthLateral,
} from "@/lib/geometry/base-modifier";
import { constrainSideCorrections } from "@/lib/geometry/clinical-constraints";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { extractMergedGeometry, loadGlbFromBuffer } from "@/lib/library/loaders";
import type { SideCorrections } from "@/types";

const DEFAULT_GLB_URL =
    "https://wstneucimlemaokoyjwh.supabase.co/storage/v1/object/public/stock-bases/Templates/Default.glb";
const DEFAULT_GLB_CACHE = "/tmp/Default.glb";

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
    if (!existsSync(DEFAULT_GLB_CACHE)) {
        const res = await fetch(DEFAULT_GLB_URL);
        if (!res.ok) throw new Error(`Failed to download Default.glb (${res.status})`);
        writeFileSync(DEFAULT_GLB_CACHE, Buffer.from(await res.arrayBuffer()));
    }
    return readFileSync(DEFAULT_GLB_CACHE).buffer.slice(0);
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
    test("centerline invariance post-smoothing + lateral spread at width 8-10", async () => {
        const group = await loadGlbFromBuffer(await loadDefaultGlbBuffer());
        const merged = extractMergedGeometry(group);
        expect(merged).not.toBeNull();
        const raw = merged!.geometry;

        for (const widthMm of [8, 10]) {
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
        const field10 = widthField(10);
        const diag10 = diagnoseHeelCupWidthLateral(raw, field10);
        const modified = applyBaseModifiers(raw, field10, 0);
        const modPos = modified.getAttribute("position")!.array as Float32Array;

        let maxBottomThickDrift = 0;
        let maxTopThickDrift = 0;
        let maxWidthSpread = 0;
        for (let i = 0; i < modPos.length / 3; i++) {
            const dThick = Math.abs(
                modPos[i * 3 + thickAxis]! - basePos[i * 3 + thickAxis]!,
            );
            const dWidth = Math.abs(modPos[i * 3 + widthAxis]! - basePos[i * 3 + widthAxis]!);
            if (i >= topN) maxBottomThickDrift = Math.max(maxBottomThickDrift, dThick);
            else {
                maxTopThickDrift = Math.max(maxTopThickDrift, dThick);
                maxWidthSpread = Math.max(maxWidthSpread, dWidth);
            }
        }

        console.log("[HC-WIDTH] applyBaseModifiers width=10", {
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
});

describe("heel cup depth — constraint ceiling at thickness 2mm (instrumentation baseline)", () => {
    test("commit simulation: drag 5mm → release at default thickness 2mm", () => {
        const thicknessMm = 2;
        const requested = 5;
        const c = { ...neutralCorrections(), heelCupDepthMm: requested };
        const { constrained, violations } = constrainSideCorrections(c, thicknessMm);
        const ceiling = thicknessMm - 1.6; // MIN_WALL_MM

        console.log("[HC-DEPTH] constraint-sim@2mm", {
            thicknessMm,
            requested,
            applied: constrained.heelCupDepthMm,
            theoreticalCeiling: ceiling,
            violations,
        });

        // At t=2, any depth > 0.4 should clamp to 0.4; depth=5 → 0.4 (may display as ~0)
        expect(constrained.heelCupDepthMm).toBeCloseTo(0.4, 5);
        expect(constrained.heelCupDepthMm).toBeLessThan(0.5);
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
        expect(committedAfter).toBeCloseTo(0.4, 5);
        expect(mergedAfterRelease.heelCupDepthMm).toBeCloseTo(0.4, 5);
    });
});
