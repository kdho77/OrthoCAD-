// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "@rstest/core";
import { baseModifierFieldAuthoritative, getDesignBase } from "@/lib/geometry/base-asset";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import { resolveLiveBottomPattern } from "@/lib/geometry/procedural-wall/live-bottom-pattern";
import { autoPatternKey } from "@/lib/geometry/procedural-wall/preview-loft-ui";
import { composeViewerPrintSolidTop } from "@/lib/geometry/procedural-wall/print-solid-compose";
import {
    buildProceduralExportSolid,
    buildProceduralViewerPattern,
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { applyShoeWidthToPoints, shoeWidthForSide } from "@/lib/geometry/shoe-width";
import { getDesignTrimline } from "@/lib/geometry/trimline";
import { mirrorGeometry } from "@/lib/library/loaders";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { useDesignStore } from "@/stores/design-store";
import type { Side } from "@/types";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");
const sampleTopFixtureBytes = readFileSync(SAMPLE_TOP_PATH);
const nativeFetch = globalThis.fetch.bind(globalThis);

function installSampleTopFetchMock(): void {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("SAMPLE_Top.glb")) {
            return new Response(sampleTopFixtureBytes);
        }
        return nativeFetch(input, init);
    };
}

async function seedViewerBottomPattern(side: Side): Promise<void> {
    const design = useDesignStore.getState().design;
    const buf = readFileSync(SAMPLE_TOP_PATH);
    let raw = await sampleTopFromArrayBuffer(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    );
    const base = getDesignBase(design, side);
    if (base?.mirrored) {
        const mirrored = mirrorGeometry(raw);
        raw.dispose();
        raw = mirrored;
    }
    const effThickness = design.paired
        ? side === "left"
            ? design.paired.leftThicknessMm
            : design.paired.rightThicknessMm
        : design.thicknessMm;
    const field = baseModifierFieldAuthoritative(design, side, effThickness ?? BASE_REFERENCE_THICKNESS_MM);
    const layout = insoleLayoutFromDesign(design);
    const widthId = shoeWidthForSide(design, side);
    const heelW = field.corrections?.heelCupWidthMm ?? 0;
    const trimline = getDesignTrimline(design, side);
    const patternTop = composeViewerPrintSolidTop({
        raw,
        sourceField: field,
        shoeWidth: {
            width: widthId,
            ballWidthMm: layout.widthMm,
            heelWidthMm: layout.widthMm * 0.62,
            heelOverrideMm: heelW,
        },
        trimline,
    });
    const rawPattern = buildProceduralViewerPattern(patternTop, design.pattern, field.corrections);
    let minX = Infinity;
    let maxX = -Infinity;
    for (const p of rawPattern) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
    }
    const sizedPattern = applyShoeWidthToPoints(rawPattern, widthId, {
        ballWidthMm: layout.widthMm,
        heelWidthMm: layout.widthMm * 0.62,
        minX,
        lengthMm: Math.max(1e-3, maxX - minX),
        heelOverrideMm: heelW,
    });
    const patternKey = `${autoPatternKey(Boolean(base?.mirrored), design.pattern)}:hw${heelW.toFixed(2)}:w${widthId}`;
    useBottomPatternStore.getState().ensureGenerated(side, patternKey, sizedPattern);
    if (patternTop !== raw) patternTop.dispose();
    raw.dispose();
}

describe("SAMPLE_Top procedural export (Print / G-code)", () => {
    beforeAll(() => {
        installSampleTopFetchMock();
    });

    afterAll(() => {
        globalThis.fetch = nativeFetch;
        resetSampleTopGeometryCache();
    });

    beforeEach(() => {
        resetSampleTopGeometryCache();
        useBottomPatternStore.getState().clear();
        useDesignStore.setState({
            viewer: { ...useDesignStore.getState().viewer, wallModel: "procedural", wallStyle: "straight" },
        });
    });

    test("default US M9 print solid lofts left and right without S1-PATTERN errors", async () => {
        const design = useDesignStore.getState().design;
        const viewer = useDesignStore.getState().viewer;
        expect(design.usMenSize).toBe(9);
        expect(design.pattern).toBe("full_contact");
        for (const side of ["left", "right"] as Side[]) {
            await seedViewerBottomPattern(side);
            const base = getDesignBase(design, side);
            const effThickness = design.paired
                ? side === "left"
                    ? design.paired.leftThicknessMm
                    : design.paired.rightThicknessMm
                : design.thicknessMm;
            const field = baseModifierFieldAuthoritative(
                design,
                side,
                effThickness ?? BASE_REFERENCE_THICKNESS_MM,
            );
            const layout = insoleLayoutFromDesign(design);
            const widthId = shoeWidthForSide(design, side);
            const livePts = resolveLiveBottomPattern({
                stored: useBottomPatternStore.getState().getPattern(side),
            });
            const preview = await buildProceduralExportSolid({
                mirrored: Boolean(base?.mirrored),
                corrections: field.corrections,
                thicknessMm: effThickness,
                stockThicknessMm: BASE_REFERENCE_THICKNESS_MM,
                wallStyle: viewer.wallStyle ?? "straight",
                scanPattern: design.pattern,
                sourceField: field,
                composedTop: true,
                shoeWidth: {
                    width: widthId,
                    ballWidthMm: layout.widthMm,
                    heelWidthMm: layout.widthMm * 0.62,
                    heelOverrideMm: field.corrections?.heelCupWidthMm,
                },
                trimline: getDesignTrimline(design, side),
                ...(livePts ? { bottomPattern: livePts } : {}),
            });
            expect(preview.geometry.getAttribute("position")?.count ?? 0).toBeGreaterThan(1000);
            expect(preview.geometry.userData.inwardWallFaces ?? 0).toBe(0);
            preview.geometry.dispose();
        }
    }, 300_000);
});
