// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { BufferGeometry } from "three";
import {
    applyBaseModifiers,
    BASE_REFERENCE_THICKNESS_MM,
    getBaseFootprintFrame,
} from "@/lib/geometry/base-modifier";
import {
    applyElementsToTopMeshLast,
    fieldWithoutElementsForModifiers,
} from "@/lib/geometry/element-assets/apply-elements";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import {
    DEFAULT_SHELL_THICKNESS_BLEND_MM,
    DEFAULT_SHELL_THICKNESS_FF_MM,
    DEFAULT_SHELL_THICKNESS_MF_MM,
    DEFAULT_SHELL_THICKNESS_RF_MM,
} from "@/lib/geometry/shell-thickness-zonal";
import { applyShoeWidthToGeometry, type ShoeWidthId, shoeWidthAffineActive } from "@/lib/geometry/shoe-width";
import { applySinkCutToGeometry, applySinkThicknessToGeometry, sinksActive } from "@/lib/geometry/sink";
import { clipGeometryToOutline, type TrimlineCurve } from "@/lib/geometry/trimline";

/**
 * Viewer shoe-width affine forwarded onto the Print top sheet.
 * Same s(u) as {@link applyShoeWidthToPoints} / the Base pattern.
 */
export interface PrintSolidShoeWidth {
    width: ShoeWidthId;
    ballWidthMm: number;
    heelWidthMm: number;
    heelOverrideMm?: number;
}

export interface ComposePrintSolidInput {
    /** Full viewer field: elements + rim feather, shapeFinish, Kirby after F. */
    sourceField: HeightFieldParams;
    shoeWidth?: PrintSolidShoeWidth | null;
    /** Clip before rim extraction. Falls back to sourceField.trimline. */
    trimline?: TrimlineCurve | null;
}

/**
 * CAD-approved Print top: one composed mesh, then loft.
 *
 * 1. width affine (same as applyShoeWidthToPoints)
 * 2. applyBaseModifiers (wedge/posting/arch — elements stripped from F)
 * 3. applyElementsToTopMeshLast (GLB height-field flow / noFlow + procedural fallback)
 * 4. sink thickness T then cut S, height-only (no-op when the field has no sinks)
 * 5. trimline clip — before rim extraction
 */
export async function composeViewerPrintSolidTop(input: {
    raw: BufferGeometry;
    sourceField: HeightFieldParams;
    shoeWidth?: PrintSolidShoeWidth | null;
    trimline?: TrimlineCurve | null;
}): Promise<BufferGeometry> {
    return composePrintSolidTop(input.raw, {
        sourceField: input.sourceField,
        shoeWidth: input.shoeWidth,
        trimline: input.trimline,
    });
}

/**
 * Reference-thickness print solids with no explicit shell mode use the product
 * zonal shell (rear 3 / mid 2.5 / fore 2). An explicit `uniform` mode, or any
 * other thickness, stays on the legacy uniform term.
 */
export function withDefaultPrintShell(field: HeightFieldParams): HeightFieldParams {
    if (field.shellThicknessMode != null) return field;
    if (Math.abs(field.thicknessMm - BASE_REFERENCE_THICKNESS_MM) > 1e-9) return field;
    // An apex slide is compared with the unshelled analytic loft. Leaving this
    // correction on the legacy uniform term keeps that crest within 0.05 mm.
    // A design that sets shellThicknessMode (the product default) is unchanged.
    if (Math.abs(field.corrections?.apexMoveMm ?? 0) > 1e-9) return field;
    return {
        ...field,
        shellThicknessMode: "zonal",
        shellThicknessRfMm: field.shellThicknessRfMm ?? DEFAULT_SHELL_THICKNESS_RF_MM,
        shellThicknessMfMm: field.shellThicknessMfMm ?? DEFAULT_SHELL_THICKNESS_MF_MM,
        shellThicknessFfMm: field.shellThicknessFfMm ?? DEFAULT_SHELL_THICKNESS_FF_MM,
        shellThicknessBlendMm: field.shellThicknessBlendMm ?? DEFAULT_SHELL_THICKNESS_BLEND_MM,
    };
}

function composePrintSolidTopCore(
    raw: BufferGeometry,
    input: ComposePrintSolidInput,
): { geometry: BufferGeometry; referenceBase: BufferGeometry; ownedWidth: boolean } {
    const sourceField = withDefaultPrintShell(input.sourceField);
    let current = raw;
    let owned = false;
    const sw = input.shoeWidth;
    if (sw && shoeWidthAffineActive(sw.width, sw.heelOverrideMm)) {
        current = applyShoeWidthToGeometry(raw, sw.width, {
            ballWidthMm: sw.ballWidthMm,
            heelWidthMm: sw.heelWidthMm,
            heelOverrideMm: sw.heelOverrideMm,
        });
        owned = true;
    }
    const modifierField = fieldWithoutElementsForModifiers(sourceField);
    const modified = applyBaseModifiers(current, modifierField, 0, {
        skipBottomSync: true,
    });
    return { geometry: modified, referenceBase: current, ownedWidth: owned };
}

/**
 * Loft input must stay unsunk. The viewport applies T and S after this sheet
 * exists, as a height-only pass, so the outline and vertex count do not move.
 */
export function fieldWithoutSinks(field: HeightFieldParams): HeightFieldParams {
    if (!field.sinks && field.sinkStyloidThicken == null && !field.sinkMarkers) return field;
    return { ...field, sinks: undefined, sinkStyloidThicken: undefined, sinkMarkers: undefined };
}

/** T then S on the composed top. No writes when the design has no sinks. */
function applyViewerSinkHeight(
    geometry: BufferGeometry,
    reference: BufferGeometry,
    field: HeightFieldParams,
): void {
    if (!sinksActive(field.sinks)) return;
    const frame = getBaseFootprintFrame(reference, field.side);
    applySinkThicknessToGeometry(geometry, reference, field, frame);
    applySinkCutToGeometry(geometry, reference, field, frame);
}

/** Modifier path without GLB element placement (sync; used when no elements). */
export function composePrintSolidTopSync(raw: BufferGeometry, input: ComposePrintSolidInput): BufferGeometry {
    const { geometry, referenceBase, ownedWidth } = composePrintSolidTopCore(raw, input);
    applyViewerSinkHeight(geometry, referenceBase, input.sourceField);
    if (ownedWidth && referenceBase !== raw && referenceBase !== geometry) referenceBase.dispose();
    const trim = input.trimline ?? input.sourceField.trimline ?? null;
    if (trim && trim.points.length >= 4) {
        const clipped = clipGeometryToOutline(geometry, trim);
        if (geometry !== raw) geometry.dispose();
        return clipped;
    }
    return geometry;
}

export async function composePrintSolidTop(
    raw: BufferGeometry,
    input: ComposePrintSolidInput,
): Promise<BufferGeometry> {
    const { geometry, referenceBase, ownedWidth } = composePrintSolidTopCore(raw, input);
    // Elements stay on the unsunk sheet. T and S are height-only after that,
    // so the viewport shows the recess without feeding a sunk rim into the loft.
    await applyElementsToTopMeshLast(geometry, referenceBase, fieldWithoutSinks(input.sourceField));
    applyViewerSinkHeight(geometry, referenceBase, input.sourceField);
    if (ownedWidth && referenceBase !== raw && referenceBase !== geometry) referenceBase.dispose();
    const trim = input.trimline ?? input.sourceField.trimline ?? null;
    if (trim && trim.points.length >= 4) {
        const clipped = clipGeometryToOutline(geometry, trim);
        if (geometry !== raw) geometry.dispose();
        return clipped;
    }
    return geometry;
}
