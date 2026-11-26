// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { buildFinalizedFootFromSavedSettings } from "@/features/exports/saved-design-finalized-mesh";
import { defaultElementPose } from "@/lib/geometry/elements";
import { buildExportStl } from "@/lib/geometry/export-geometry";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { defaultTextMarking } from "@/lib/geometry/text-marking/constants";
import { primeTextFont } from "@/lib/geometry/text-marking/font";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import type { DesignState, PlacedElement, Side } from "@/types";
import { markingWithComposedText } from "../../../../shared/bottom-text-marking";
import { designSettingsEnvelope } from "../../../../shared/design-settings";
import {
    composedFootRim,
    meshOutlineIoU,
    plantarNameEngraved,
    stlPositions,
} from "./manufacturing-foot-guard";
import {
    primeSampleTopGeometry,
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "./sample-top-preview";
import { SKEW_INSET_RATIO } from "./station-gates";

const SAMPLE_TOP = resolve(process.cwd(), "vertex/public/Templates/SAMPLE_Top.glb");
const FONT = resolve(process.cwd(), "vertex/public/fonts/Inter-Bold.ttf");
const NAME = "TEST";

/**
 * Corrections already on the reported design in width-change.test.ts.
 * US M6 is the Gentry size (design 2e781189). US M9 is the same patch at
 * the size whose right foot finished a few hundredths of a millimetre over
 * the existing 0.5 inset cap. Magnitudes are not new.
 */
const REPORTED = {
    heelCupDepthMm: 12,
    heelCupHeightMm: 9,
    heelCupWidthMm: 0,
    heelLiftMm: 4,
    medialFlangeMm: 3,
    lateralFlangeMm: 2,
    rearfootWedge: {
        side: "medial" as const,
        value: 4,
        unit: "deg" as const,
        degreeMode: "station" as const,
    },
    forefootWedge: {
        side: "lateral" as const,
        value: 3,
        unit: "deg" as const,
        degreeMode: "station" as const,
    },
};

function reportedDesign(usMenSize: number): DesignState {
    const design = createDesignWithStockPlaceholder();
    design.method = "printing_solid";
    design.usMenSize = usMenSize;
    design.shoeWidth = "narrow";
    design.shoeWidthBySide = { left: "narrow", right: "narrow" };
    design.corrections = {
        ...design.corrections,
        linked: true,
        left: { ...design.corrections.left, ...REPORTED },
        right: { ...design.corrections.right, ...REPORTED },
    };
    const layout = insoleLayoutFromDesign(design);
    const elements: PlacedElement[] = [];
    for (const side of ["left", "right"] as const) {
        for (const kind of ["met_pad", "mortons_extension"] as const) {
            const pose = defaultElementPose(kind, side, layout.lengthMm, layout.widthMm);
            elements.push({
                id: `${kind}-${side}`,
                kind,
                side,
                position: pose.position,
                rotationDeg: pose.rotationDeg,
                scale: pose.scale,
                heightMm: pose.heightMm,
                ...(pose.placementMode ? { placementMode: pose.placementMode } : {}),
            });
        }
    }
    design.elements = elements;
    return design;
}

function install(design: DesignState): void {
    useBottomPatternStore.getState().clear();
    useMeshEditStore.setState({ trimlineEdit: null, bottomPatternEdit: null });
    const viewer = useDesignStore.getState().viewer;
    useDesignStore.setState({ design, viewer: { ...viewer, wallModel: "procedural" } });
}

function outlineFrom(positions: Float64Array): Array<{ x: number; y: number }> {
    const out = [];
    for (let i = 0; i + 2 < positions.length; i += 3) {
        out.push({ x: positions[i] ?? 0, y: positions[i + 1] ?? 0 });
    }
    return out;
}

describe("headless canonical preloft", () => {
    test("skew cap stays the existing half-inset ratio", () => {
        expect(SKEW_INSET_RATIO).toBe(0.5);
    });

    test("Gentry-like and reported narrow designs loft the same mesh headless and in the UI", async () => {
        resetSampleTopGeometryCache();
        const bytes = readFileSync(SAMPLE_TOP);
        const sampleTop = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        primeSampleTopGeometry(await sampleTopFromArrayBuffer(sampleTop.slice(0)));
        const font = readFileSync(FONT);
        const fontBytes = font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength);
        primeTextFont(fontBytes.slice(0));
        const elementsBaseDir = resolve(process.cwd(), "vertex/public/elements");

        for (const usMenSize of [6, 9] as const) {
            const design = reportedDesign(usMenSize);
            for (const side of ["left", "right"] as const satisfies readonly Side[]) {
                const composed = markingWithComposedText(
                    { ...defaultTextMarking("bottom"), text: "", addPatientName: true, feet: "both" },
                    side,
                    NAME,
                );
                const saved = { ...design, textMarking: composed };
                install(saved);
                const ui = await buildExportStl(side, { exportMode: "manufacturing", beltPrint: true });
                const head = await buildFinalizedFootFromSavedSettings({
                    settingsJson: designSettingsEnvelope(saved as unknown as Record<string, unknown>),
                    side,
                    sampleTopBytes: sampleTop,
                    includeLeader: true,
                    fontBytes,
                    elementsBaseDir,
                });
                const uiPos = stlPositions(ui);
                const headPos = stlPositions(head.stl);
                const uiTris = new DataView(ui).getUint32(80, true);
                expect(head.solidTriangles, `US M${usMenSize} ${side} solid`).toBe(uiTris);
                expect(
                    meshOutlineIoU(headPos, outlineFrom(uiPos)),
                    `US M${usMenSize} ${side} vs UI`,
                ).toBeGreaterThanOrEqual(0.98);
                const fresh = await sampleTopFromArrayBuffer(sampleTop.slice(0));
                const foot = await composedFootRim(fresh, saved, side);
                fresh.dispose();
                expect(plantarNameEngraved(headPos, foot), `US M${usMenSize} ${side} name`).toBe(true);
                expect(plantarNameEngraved(uiPos, foot), `US M${usMenSize} ${side} UI name`).toBe(true);
            }
        }
    }, 900_000);
});
