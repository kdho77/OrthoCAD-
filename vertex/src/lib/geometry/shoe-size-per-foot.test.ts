// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { templateDesignFromChart } from "@/lib/clinical/chart-design";
import { baseModifierField } from "@/lib/geometry/base-asset";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import { composedFootRim } from "@/lib/geometry/procedural-wall/manufacturing-foot-guard";
import { printSolidOptions } from "@/lib/geometry/procedural-wall/print-solid-options";
import {
    insoleLayoutForUsMenSize,
    insoleLayoutFromDesign,
    proceduralViewerSheetScale,
    scaleSourceShapeToFootprint,
} from "@/lib/geometry/shoe-size";
import { createDesignWithStockPlaceholder, defaultDesign } from "@/stores/design-store";
import type { DesignState, Side } from "@/types";
import { loadSampleTopGlb } from "../../../../tests/helpers/load-sample-top-glb";
import { shoeChartFromInput } from "../../../shared/client-files";

function xSpan(geometry: {
    computeBoundingBox: () => void;
    boundingBox: { min: { x: number }; max: { x: number } } | null;
}): number {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box) throw new Error("missing bbox");
    return box.max.x - box.min.x;
}

function rimSpan(rim: Array<{ x: number }>): number {
    const xs = rim.map((p) => p.x);
    return Math.max(...xs) - Math.min(...xs);
}

function splitDesign(): DesignState {
    return templateDesignFromChart(
        shoeChartFromInput({
            shoeSizesSplit: true,
            shoeSizeLeftUs: 12,
            shoeSizeRightUs: 6.5,
            shoeWidth: "medium",
        }),
    );
}

describe("independent shoe sizes build each foot", () => {
    test("a shared size feeds both feet the same scale as the unsided layout", () => {
        const design = createDesignWithStockPlaceholder({
            ...defaultDesign(),
            usMenSize: 12,
            sizeSystem: "us",
        });
        const shared = insoleLayoutFromDesign(design);
        expect(shared.usMenSize).toBe(12);
        expect(proceduralViewerSheetScale(design, "left")).toBe(1);
        expect(proceduralViewerSheetScale(design, "right")).toBe(1);
        for (const side of ["left", "right"] as const) {
            const layout = insoleLayoutFromDesign(design, side);
            expect(layout).toEqual(shared);
            const options = printSolidOptions({
                design,
                side,
                field: baseModifierField(design, side, design.thicknessMm),
                viewer: {},
                trimline: null,
                bottomPattern: null,
            });
            expect(options.footprintScale).toBeCloseTo(insoleLayoutForUsMenSize(12).scale, 8);
        }
    });

    test("L 12 / R 6.5 Medium builds the left at US 12 and the right at US 6.5 in view and export", async () => {
        const design = splitDesign();
        expect(design.shoeWidth).toBe("medium");
        const native = await loadSampleTopGlb();
        const nativeLen = xSpan(native);
        const lengths: Record<Side, { view: number; loft: number; export: number }> = {
            left: { view: 0, loft: 0, export: 0 },
            right: { view: 0, loft: 0, export: 0 },
        };

        for (const side of ["left", "right"] as const) {
            const men = side === "left" ? 12 : 6.5;
            const layout = insoleLayoutFromDesign(design, side);
            expect(layout.usMenSize).toBe(men);
            expect(layout.lengthMm).toBeCloseTo(insoleLayoutForUsMenSize(men).lengthMm, 6);

            const view = native.clone();
            scaleSourceShapeToFootprint(
                view,
                proceduralViewerSheetScale(design, side),
                BASE_REFERENCE_THICKNESS_MM,
            );
            lengths[side].view = xSpan(view);
            view.dispose();
            expect(lengths[side].view).toBeCloseTo(nativeLen * layout.scale, 3);

            const options = printSolidOptions({
                design,
                side,
                field: baseModifierField(design, side, design.thicknessMm),
                viewer: {},
                trimline: null,
                bottomPattern: null,
            });
            expect(options.footprintScale).toBeCloseTo(layout.scale, 8);
            const loft = native.clone();
            scaleSourceShapeToFootprint(loft, options.footprintScale ?? 1, BASE_REFERENCE_THICKNESS_MM);
            lengths[side].loft = xSpan(loft);
            loft.dispose();
            expect(lengths[side].loft).toBeCloseTo(nativeLen * insoleLayoutForUsMenSize(men).scale, 3);

            const rim = await composedFootRim(native, design, side);
            lengths[side].export = rimSpan(rim);
        }

        native.dispose();
        expect(lengths.left.view).toBeGreaterThan(lengths.right.view);
        expect(lengths.left.loft).toBeGreaterThan(lengths.right.loft);
        expect(lengths.left.export).toBeGreaterThan(lengths.right.export);
        const expectedRatio = insoleLayoutForUsMenSize(12).lengthMm / insoleLayoutForUsMenSize(6.5).lengthMm;
        expect(lengths.left.view / lengths.right.view).toBeCloseTo(expectedRatio, 3);
        expect(lengths.left.loft / lengths.right.loft).toBeCloseTo(expectedRatio, 3);
        expect(lengths.left.export / lengths.right.export).toBeCloseTo(expectedRatio, 2);
    });
});
