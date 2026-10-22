// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import { exportObjectToGlb, meshFromGeometry } from "@/lib/geometry/glb-export";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { reconstructionManifold } from "@/lib/geometry/procedural-wall/metrics";
import { composePrintSolidTop } from "@/lib/geometry/procedural-wall/print-solid-compose";
import {
    buildProceduralViewerPattern,
    reconstructProceduralPreview,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import { binaryStlToGeometry, geometryToBinarySTL } from "@/lib/geometry/stl";
import { parseBinaryStl } from "@/lib/hardness/mesh";
import { exportHardness3mf } from "@/lib/hardness/pipeline";
import { useDesignStore } from "@/stores/design-store";
import type { PlacedElement, Side, SideCorrections } from "@/types";
import { applyTextMarkingToPrintSolid } from "./apply";
import {
    defaultTextMarking,
    sanitizeText,
    TEXT_QEM_HAUSDORFF_MM,
    TEXT_SI_REGION_PAD_MM,
    TEXT_WELD_MM,
} from "./constants";
import { measureTextRegionQuality } from "./quality";
import { countSoupSelfIntersectionsInRegion, soupRegionAabbFromOutlineWorld } from "./soup-intersect";
import type { TextApplyMeta } from "./types";

const SAMPLE = resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb");
/** Self-intersection reported on hybrid lateral text before the seam clamp. */
const HIT = { x: 135.9, y: -42.4 };

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

function elementsFor(side: Side): PlacedElement[] {
    const ySign = side === "left" ? 1 : -1;
    return [
        {
            id: "met-lateral",
            kind: "met_pad",
            side,
            position: { x: 198, y: -14 * ySign },
            rotationDeg: 8,
            scale: { x: 1.1, y: 1 },
            heightMm: 4.5,
        },
        {
            id: "met-medial",
            kind: "met_pad",
            side,
            position: { x: 78, y: 12 * ySign },
            rotationDeg: 0,
            scale: { x: 1.05, y: 0.95 },
            heightMm: 3.5,
        },
    ];
}

async function loadSide(side: Side): Promise<BufferGeometry> {
    const buf = readFileSync(SAMPLE);
    const raw = await sampleTopFromArrayBuffer(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    );
    if (side === "right") return raw;
    const { mirrorGeometry } = await import("@/lib/library/loaders");
    const mirrored = mirrorGeometry(raw);
    raw.dispose();
    return mirrored;
}

describe("hybrid seam text", () => {
    for (const side of ["left", "right"] as const) {
        test(`stored B + 2 elements + lateral text on hybrid ${side} is watertight`, async () => {
            const layout = insoleLayoutForUsMenSize(8.5);
            const elements = elementsFor(side);
            const sourceField: HeightFieldParams = {
                side,
                lengthMm: layout.lengthMm,
                widthMm: layout.widthMm,
                thicknessMm: BASE_REFERENCE_THICKNESS_MM,
                corrections: zero(),
                elements,
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
            const raw = await loadSide(side);
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
                side,
                wallStyle: "hybrid",
                footprintLengthMm: layout.lengthMm,
                footprintWidthMm: layout.widthMm,
                sizeLabel: "US M8.5",
                corrections: zero(),
                shoeWidth,
            });
            const host = loft.geometry.clone();
            const marking = {
                ...defaultTextMarking("wall"),
                text: sanitizeText("A"),
                capHeightMm: 6,
                depthMm: 0.6,
                placementU: 0.55,
            };
            const marked = await applyTextMarkingToPrintSolid(loft.geometry, marking, { side });
            const meta = (marked.userData as { textMarking?: TextApplyMeta }).textMarking;
            expect(meta?.outlineWorld?.length).toBeGreaterThan(0);
            const man = reconstructionManifold(marked);
            expect(man.watertight).toBe(true);
            expect(man.openEdges).toBe(0);
            const q = measureTextRegionQuality(marked, host, meta!);
            expect(q.outsideVertMaxMm).toBeLessThanOrEqual(TEXT_QEM_HAUSDORFF_MM);
            const pos = marked.getAttribute("position");
            let minZ = Infinity;
            let onSole = 0;
            for (let i = 0; i < pos.count; i++) {
                const z = pos.getZ(i);
                if (z < minZ) minZ = z;
                if (Math.abs(z) <= 0.02) onSole++;
            }
            expect(minZ).toBeGreaterThanOrEqual(-1e-3);
            expect(onSole).toBeGreaterThan(50);
            const stl = geometryToBinarySTL(marked);
            const glb = await exportObjectToGlb(meshFromGeometry(marked));
            const shell = parseBinaryStl(stl);
            const design = {
                ...useDesignStore.getInitialState().design,
                elements,
                textMarking: marking,
                pattern: "full_contact" as const,
            };
            const packed = await exportHardness3mf({ design, side, shell });
            expect(stl.byteLength).toBeGreaterThan(10_000);
            expect(glb.arrayBuffer.byteLength).toBeGreaterThan(10_000);
            expect(packed.bytes.byteLength).toBeGreaterThan(2000);
            const soup = binaryStlToGeometry(stl);
            const region = soupRegionAabbFromOutlineWorld(meta!.outlineWorld!, TEXT_SI_REGION_PAD_MM);
            expect(region).not.toBeNull();
            const si = countSoupSelfIntersectionsInRegion(soup!, region!, TEXT_WELD_MM);
            const ySign = side === "left" ? 1 : -1;
            const hitSi = countSoupSelfIntersectionsInRegion(
                soup!,
                {
                    minX: HIT.x - 6,
                    maxX: HIT.x + 6,
                    minY: HIT.y * ySign - 6,
                    maxY: HIT.y * ySign + 6,
                    minZ: -1,
                    maxZ: 20,
                },
                TEXT_WELD_MM,
            );
            soup?.dispose();
            expect(si.real).toBe(0);
            expect(hitSi.real).toBe(0);
            host.dispose();
            if (marked !== loft.geometry) marked.dispose();
            loft.geometry.dispose();
            raw.dispose();
        }, 300_000);
    }
});
