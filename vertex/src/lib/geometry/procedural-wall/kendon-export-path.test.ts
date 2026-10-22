// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import { exportObjectToGlb, meshFromGeometry } from "@/lib/geometry/glb-export";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import { binaryStlToGeometry, geometryToBinarySTL } from "@/lib/geometry/stl";
import { applyTextMarkingToPrintSolid } from "@/lib/geometry/text-marking/apply";
import {
    defaultTextMarking,
    sanitizeText,
    TEXT_QEM_HAUSDORFF_MM,
    TEXT_SI_REGION_PAD_MM,
    TEXT_WELD_MM,
} from "@/lib/geometry/text-marking/constants";
import { measureTextRegionQuality } from "@/lib/geometry/text-marking/quality";
import {
    countSoupSelfIntersectionsInRegion,
    soupRegionAabbFromOutlineWorld,
} from "@/lib/geometry/text-marking/soup-intersect";
import type { TextApplyMeta } from "@/lib/geometry/text-marking/types";
import { parseBinaryStl } from "@/lib/hardness/mesh";
import { exportHardness3mf } from "@/lib/hardness/pipeline";
import { useDesignStore } from "@/stores/design-store";
import type { PlacedElement, Side, SideCorrections } from "@/types";
import { composePrintSolidTop } from "./print-solid-compose";
import {
    buildProceduralViewerPattern,
    reconstructProceduralPreview,
    sampleTopFromArrayBuffer,
} from "./sample-top-preview";

const SAMPLE_TOP_PATH = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");

function zero(): SideCorrections {
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

async function loadLeftSampleTop(): Promise<BufferGeometry> {
    const buf = readFileSync(SAMPLE_TOP_PATH);
    const { mirrorGeometry } = await import("@/lib/library/loaders");
    const raw = await sampleTopFromArrayBuffer(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    );
    const mirrored = mirrorGeometry(raw);
    raw.dispose();
    return mirrored;
}

function fieldM9(side: Side): HeightFieldParams {
    const layout = insoleLayoutForUsMenSize(9);
    return {
        side,
        lengthMm: layout.lengthMm,
        widthMm: layout.widthMm,
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        corrections: zero(),
        elements: [],
        includeSkives: false,
        includeElements: true,
        trimline: null,
        shapeFinish: {
            topCoverAccommodateMm: 1.25,
            trimmableForefoot: true,
            trimmableForefootExtraMm: 5,
            archGrindDepthMm: 0,
            archSkiveMm: 0,
            archSkiveSide: "medial",
        },
    };
}

describe("Kendon PR #204 preview path", () => {
    test("US M9 Full Contact + stored pattern exports STL and GLB (Kendon preview path)", async () => {
        const raw = await loadLeftSampleTop();
        const layout = insoleLayoutForUsMenSize(9);
        const sourceField = fieldM9("left");
        const pattern = buildProceduralViewerPattern(raw, "full_contact");
        const started = performance.now();
        const preview = await reconstructProceduralPreview(raw, {
            scanPattern: "full_contact",
            sourceField,
            composedTop: true,
            footprintLengthMm: layout.lengthMm,
            footprintWidthMm: layout.widthMm,
            sizeLabel: "US M9",
            userBottomPattern: true,
            bottomPattern: pattern,
            wallStyle: "hybrid",
            side: "left",
        });
        const stl = geometryToBinarySTL(preview.geometry);
        expect(stl.byteLength).toBeGreaterThan(10_000);
        const glb = await exportObjectToGlb(meshFromGeometry(preview.geometry));
        expect(glb.arrayBuffer.byteLength).toBeGreaterThan(10_000);
        const ms = performance.now() - started;
        console.log(
            "[KENDON-EXPORT]",
            JSON.stringify({ stlBytes: stl.byteLength, glbBytes: glb.arrayBuffer.byteLength, ms }),
        );
        expect((preview.geometry.userData as { inwardWallFaces?: number }).inwardWallFaces ?? 0).toBe(0);
        preview.geometry.dispose();
        raw.dispose();
    }, 240_000);

    test("lateral wall text on composed loft finishes under 60 s per foot", async () => {
        const raw = await loadLeftSampleTop();
        const sourceField = fieldM9("left");
        const composed = await composePrintSolidTop(raw, { sourceField });
        const loft = await reconstructProceduralPreview(raw, {
            sourceField,
            composedTop: true,
            scanPattern: "full_contact",
            wallStyle: "straight",
            side: "left",
        });
        composed.dispose();
        const hostBefore = loft.geometry.clone();
        const marking = {
            ...defaultTextMarking("wall"),
            text: sanitizeText("A"),
            capHeightMm: 6,
            depthMm: 0.6,
            placementU: 0.55,
        };
        const started = performance.now();
        const marked = await applyTextMarkingToPrintSolid(loft.geometry, marking, { side: "left" });
        const ms = performance.now() - started;
        console.log(
            "[KENDON-TEXT]",
            JSON.stringify({ ms, verts: marked.getAttribute("position")?.count ?? 0 }),
        );
        expect(ms).toBeLessThan(60_000);
        expect(marked.getAttribute("position")?.count ?? 0).toBeGreaterThan(1000);
        const meta = (marked.userData as { textMarking?: TextApplyMeta }).textMarking;
        expect(meta?.outlineWorld?.length).toBeGreaterThan(0);
        const q = measureTextRegionQuality(marked, hostBefore, meta!);
        expect(q.outline.hausdorffMm).toBeLessThanOrEqual(TEXT_QEM_HAUSDORFF_MM);
        const stl = geometryToBinarySTL(marked);
        const soup = binaryStlToGeometry(stl);
        const region = soupRegionAabbFromOutlineWorld(meta!.outlineWorld, TEXT_SI_REGION_PAD_MM);
        expect(region).not.toBeNull();
        const siStarted = performance.now();
        const si = countSoupSelfIntersectionsInRegion(soup!, region!, TEXT_WELD_MM);
        const siMs = performance.now() - siStarted;
        soup.dispose();
        console.log("[KENDON-TEXT-SI]", JSON.stringify({ siMs, real: si.real, tris: stl.byteLength }));
        expect(siMs).toBeLessThan(5000);
        expect(si.real).toBe(0);
        hostBefore.dispose();
        if (marked !== loft.geometry) marked.dispose();
        loft.geometry.dispose();
        raw.dispose();
    }, 120_000);

    test("stored user pattern + 2 elements export STL, GLB, and 3MF (Kendon rim gate)", async () => {
        const layout = insoleLayoutForUsMenSize(9);
        const elements: PlacedElement[] = [
            {
                id: "met-lateral",
                kind: "met_pad",
                side: "left",
                position: { x: 198, y: -14 },
                rotationDeg: 8,
                scale: { x: 1.1, y: 1 },
                heightMm: 4.5,
            },
            {
                id: "met-medial",
                kind: "met_pad",
                side: "left",
                position: { x: 78, y: 12 },
                rotationDeg: 0,
                scale: { x: 1.05, y: 0.95 },
                heightMm: 3.5,
            },
        ];
        const sourceField: HeightFieldParams = { ...fieldM9("left"), elements };
        const raw = await loadLeftSampleTop();
        const shoeWidth = {
            width: "medium" as const,
            ballWidthMm: layout.widthMm,
            heelWidthMm: layout.widthMm * 0.62,
            heelOverrideMm: 0,
        };
        const patternTop = await composePrintSolidTop(raw, { sourceField, shoeWidth });
        const storedPattern = buildProceduralViewerPattern(patternTop, "full_contact", zero());
        patternTop.dispose();
        const loft = await reconstructProceduralPreview(raw, {
            sourceField,
            composedTop: true,
            scanPattern: "full_contact",
            userBottomPattern: true,
            bottomPattern: storedPattern,
            side: "left",
            wallStyle: "straight",
            footprintLengthMm: layout.lengthMm,
            footprintWidthMm: layout.widthMm,
            sizeLabel: "US M9",
            corrections: zero(),
            shoeWidth,
        });
        const stl = geometryToBinarySTL(loft.geometry);
        expect(stl.byteLength).toBeGreaterThan(10_000);
        const glb = await exportObjectToGlb(meshFromGeometry(loft.geometry));
        expect(glb.arrayBuffer.byteLength).toBeGreaterThan(10_000);
        const shell = parseBinaryStl(stl);
        const design = {
            ...useDesignStore.getInitialState().design,
            elements,
            pattern: "full_contact" as const,
        };
        const packed = await exportHardness3mf({ design, side: "left", shell });
        expect(packed.bytes.byteLength).toBeGreaterThan(2000);
        console.log(
            "[KENDON-FULL-EXPORT]",
            JSON.stringify({
                stlBytes: stl.byteLength,
                glbBytes: glb.arrayBuffer.byteLength,
                mfBytes: packed.bytes.byteLength,
            }),
        );
        loft.geometry.dispose();
        raw.dispose();
    }, 300_000);

    test("Kendon-like export with 2 elements + lateral wall text exports STL, GLB, and 3MF", async () => {
        const layout = insoleLayoutForUsMenSize(9);
        const elements: PlacedElement[] = [
            {
                id: "met-lateral",
                kind: "met_pad",
                side: "left",
                position: { x: 198, y: -14 },
                rotationDeg: 8,
                scale: { x: 1.1, y: 1 },
                heightMm: 4.5,
            },
            {
                id: "met-medial",
                kind: "met_pad",
                side: "left",
                position: { x: 78, y: 12 },
                rotationDeg: 0,
                scale: { x: 1.05, y: 0.95 },
                heightMm: 3.5,
            },
        ];
        const sourceField: HeightFieldParams = { ...fieldM9("left"), elements };
        const raw = await loadLeftSampleTop();
        const shoeWidth = {
            width: "medium" as const,
            ballWidthMm: layout.widthMm,
            heelWidthMm: layout.widthMm * 0.62,
            heelOverrideMm: 0,
        };
        const textMarking = {
            ...defaultTextMarking("wall"),
            text: sanitizeText("A"),
            capHeightMm: 6,
            depthMm: 0.6,
            placementU: 0.55,
        };
        const loft = await reconstructProceduralPreview(raw, {
            sourceField,
            composedTop: true,
            scanPattern: "full_contact",
            side: "left",
            wallStyle: "straight",
            footprintLengthMm: layout.lengthMm,
            footprintWidthMm: layout.widthMm,
            sizeLabel: "US M9",
            corrections: zero(),
            shoeWidth,
        });
        const marked = await applyTextMarkingToPrintSolid(loft.geometry, textMarking, { side: "left" });
        const stl = geometryToBinarySTL(marked);
        const glb = await exportObjectToGlb(meshFromGeometry(marked));
        const shell = parseBinaryStl(stl);
        const design = {
            ...useDesignStore.getInitialState().design,
            elements,
            textMarking,
            pattern: "full_contact" as const,
        };
        const packed = await exportHardness3mf({ design, side: "left", shell });
        expect(stl.byteLength).toBeGreaterThan(10_000);
        expect(glb.arrayBuffer.byteLength).toBeGreaterThan(10_000);
        expect(packed.bytes.byteLength).toBeGreaterThan(2000);
        if (marked !== loft.geometry) marked.dispose();
        loft.geometry.dispose();
        raw.dispose();
    }, 300_000);
});
