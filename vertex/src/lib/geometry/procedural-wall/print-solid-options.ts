// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { shoeWidthForSide } from "@/lib/geometry/shoe-width";
import type { TrimlineCurve } from "@/lib/geometry/trimline";
import type { ViewerSettings } from "@/stores/design-store";
import type { DesignState, Side } from "@/types";
import type { PolyPoint } from "./curves";
import type { ProceduralPreviewOptions } from "./sample-top-preview";

/** One input contract for the Print worker and manufacturing exports. */
export function printSolidOptions(input: {
    design: DesignState;
    side: Side;
    field: HeightFieldParams;
    viewer: Partial<ViewerSettings>;
    trimline: TrimlineCurve | null;
    bottomPattern: PolyPoint[] | null;
}): ProceduralPreviewOptions {
    const { design, side, field, viewer, trimline, bottomPattern } = input;
    const layout = insoleLayoutFromDesign(design);
    return {
        corrections: field.corrections,
        thicknessMm: field.thicknessMm,
        stockThicknessMm: BASE_REFERENCE_THICKNESS_MM,
        deviceType: viewer.deviceType ?? "functional",
        lateralFlange: {
            heightMm: viewer.lateralFlangeHeightMm ?? 0,
            lengthMm: viewer.lateralFlangeLengthMm ?? 40,
            angleDeg: viewer.lateralFlangeAngleDeg ?? 10,
        },
        archGrindDepthMm: 0,
        wallStyle: viewer.wallStyle ?? "straight",
        scanPattern: design.pattern,
        sourceField: field,
        composedTop: true,
        shoeWidth: {
            width: shoeWidthForSide(design, side),
            ballWidthMm: layout.widthMm,
            heelWidthMm: layout.widthMm * 0.62,
            heelOverrideMm: field.corrections?.heelCupWidthMm ?? 0,
        },
        trimline,
        textMarking: design.textMarking,
        side,
        ...(bottomPattern ? { bottomPattern } : {}),
    };
}
