// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import type { BufferGeometry } from "three";
import { applyBaseModifiers, getBaseFootprintFrame } from "@/lib/geometry/base-modifier";
import {
    applyElementsToTopMeshLast,
    fieldWithoutElementsForModifiers,
} from "@/lib/geometry/element-assets/apply-elements";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
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

function composePrintSolidTopCore(
    raw: BufferGeometry,
    input: ComposePrintSolidInput,
): { geometry: BufferGeometry; referenceBase: BufferGeometry; ownedWidth: boolean } {
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
    const modifierField = fieldWithoutElementsForModifiers(input.sourceField);
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
