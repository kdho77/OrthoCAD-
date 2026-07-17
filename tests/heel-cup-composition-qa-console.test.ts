// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Manual-QA console harness for heel cup depth+width composition.
 * Simulates CorrectionsPanel commit sequences against Zustand stores
 * and applyBaseModifiers on Default.glb — mirrors viewer rebuild logging.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { applyBaseModifiers } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { extractMergedGeometry, loadGlbFromBuffer } from "@/lib/library/loaders";
import { useDesignStore } from "@/stores/design-store";
import { usePerformanceStore } from "@/stores/performance-store";
import type { Side, SideCorrections } from "@/types";

const FIXTURE = resolve(process.cwd(), "tests/fixtures/Default.glb");
const SIDE: Side = "right";
const DEPTH = 4;
const WIDTH = 5;

const captured: string[] = [];

function captureLog(tag: string, payload: Record<string, unknown>): void {
    const line = `${tag} ${JSON.stringify(payload)}`;
    captured.push(line);
    console.log(line);
}

function neutral(): SideCorrections {
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

function fieldFromStore(): HeightFieldParams {
    const design = useDesignStore.getState().design;
    const preview = usePerformanceStore.getState().correctionPreview[SIDE];
    const corrections = preview ? { ...design.corrections[SIDE], ...preview } : design.corrections[SIDE];
    return {
        side: SIDE,
        lengthMm: 266,
        widthMm: 95,
        thicknessMm: useDesignStore.getState().design.thicknessMm,
        corrections,
        elements: [],
        includeSkives: true,
        includeElements: true,
        trimline: null,
    };
}

function commitSlider(key: keyof SideCorrections, value: number): void {
    const preview = usePerformanceStore.getState().correctionPreview[SIDE] ?? {};
    useDesignStore
        .getState()
        .updateCorrection(SIDE, { ...preview, [key]: value } as Partial<SideCorrections>);
    usePerformanceStore.getState().clearCorrectionPreview();
}

function previewSlider(key: keyof SideCorrections, value: number): void {
    usePerformanceStore.getState().setCorrectionPreview(SIDE, { [key]: value });
}

function rebuildLabel(tag: string, base: BufferGeometry): void {
    const f = fieldFromStore();
    const modified = applyBaseModifiers(base, f, 0);
    const rawPos = base.getAttribute("position")!.array as Float32Array;
    const modPos = modified.getAttribute("position")!.array as Float32Array;
    const topN = (base.userData as { topVertexCount?: number }).topVertexCount ?? rawPos.length / 3;
    let maxHeelZDelta = 0;
    let maxHeelWidthDelta = 0;
    for (let i = 0; i < topN; i++) {
        if (rawPos[i * 3 + 2]! < 5) continue;
        maxHeelZDelta = Math.max(maxHeelZDelta, Math.abs(modPos[i * 3 + 2]! - rawPos[i * 3 + 2]!));
        maxHeelWidthDelta = Math.max(maxHeelWidthDelta, Math.abs(modPos[i * 3 + 1]! - rawPos[i * 3 + 1]!));
    }
    captureLog("[HC-DEPTH] rebuild", {
        tag,
        committedDepth: useDesignStore.getState().design.corrections[SIDE].heelCupDepthMm,
        committedWidth: useDesignStore.getState().design.corrections[SIDE].heelCupWidthMm,
        preview: usePerformanceStore.getState().correctionPreview[SIDE] ?? null,
        mergedDepth: f.corrections.heelCupDepthMm,
        mergedWidth: f.corrections.heelCupWidthMm,
        maxHeelZDelta,
        maxHeelWidthDelta,
    });
    modified.dispose();
}

let base: BufferGeometry;

beforeAll(async () => {
    const group = await loadGlbFromBuffer(readFileSync(FIXTURE).buffer.slice(0) as ArrayBuffer);
    base = extractMergedGeometry(group)!.geometry;
});

describe("heel cup composition — live viewer console simulation", () => {
    test("sequences A/B/C with raw console capture", () => {
        captured.length = 0;
        usePerformanceStore.setState({ correctionPreview: {}, interacting: false });
        useDesignStore.setState((s) => ({
            design: { ...s.design, thicknessMm: 8 },
        }));
        useDesignStore.getState().updateCorrection(SIDE, neutral());

        captureLog("[HC-QA]", { sequence: "A depth-preview → width-commit (depth→width)" });
        previewSlider("heelCupDepthMm", DEPTH);
        rebuildLabel("A1-after-depth-preview", base);
        commitSlider("heelCupWidthMm", WIDTH);
        rebuildLabel("A2-after-width-commit", base);
        const afterA = useDesignStore.getState().design.corrections[SIDE];
        captureLog("[HC-QA] A-final-read", {
            heelCupDepthMm: afterA.heelCupDepthMm,
            heelCupWidthMm: afterA.heelCupWidthMm,
        });
        expect(afterA.heelCupDepthMm).toBe(DEPTH);
        expect(afterA.heelCupWidthMm).toBe(WIDTH);

        useDesignStore.getState().updateCorrection(SIDE, neutral());
        usePerformanceStore.getState().clearCorrectionPreview();

        captureLog("[HC-QA]", { sequence: "B width-preview → depth-commit (width→depth)" });
        previewSlider("heelCupWidthMm", WIDTH);
        rebuildLabel("B1-after-width-preview", base);
        commitSlider("heelCupDepthMm", DEPTH);
        rebuildLabel("B2-after-depth-commit", base);
        const afterB = useDesignStore.getState().design.corrections[SIDE];
        captureLog("[HC-QA] B-final-read", {
            heelCupDepthMm: afterB.heelCupDepthMm,
            heelCupWidthMm: afterB.heelCupWidthMm,
        });
        expect(afterB.heelCupDepthMm).toBe(DEPTH);
        expect(afterB.heelCupWidthMm).toBe(WIDTH);

        useDesignStore.getState().updateCorrection(SIDE, neutral());
        usePerformanceStore.getState().clearCorrectionPreview();

        captureLog("[HC-QA]", { sequence: "C width-commit → depth-commit → read both" });
        commitSlider("heelCupWidthMm", WIDTH);
        rebuildLabel("C1-after-width-commit", base);
        commitSlider("heelCupDepthMm", DEPTH);
        rebuildLabel("C2-after-depth-commit", base);
        const afterC = useDesignStore.getState().design.corrections[SIDE];
        captureLog("[HC-QA] C-final-read", {
            heelCupDepthMm: afterC.heelCupDepthMm,
            heelCupWidthMm: afterC.heelCupWidthMm,
        });
        expect(afterC.heelCupDepthMm).toBe(DEPTH);
        expect(afterC.heelCupWidthMm).toBe(WIDTH);

        console.log("[HC-QA] === RAW CONSOLE CAPTURE BEGIN ===");
        for (const line of captured) console.log(line);
        console.log("[HC-QA] === RAW CONSOLE CAPTURE END ===");
    });
});
