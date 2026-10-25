// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import { applyBaseModifiers } from "@/lib/geometry/base-modifier";
import {
    applyElementsToTopMeshLast,
    fieldWithoutElementsForModifiers,
} from "@/lib/geometry/element-assets/apply-elements";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { applyShoeWidthToGeometry, type ShoeWidthId, shoeWidthAffineActive } from "@/lib/geometry/shoe-width";
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
 * 4. trimline clip — before rim extraction
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
 * The loft must see the unsunk sheet. T and S are a z-only pass after the
 * wall exists, so a sink cannot move the outline or add vertices.
 */
function fieldWithoutSinks(field: HeightFieldParams): HeightFieldParams {
    if (!field.sinks && field.sinkStyloidThicken == null && !field.sinkMarkers) return field;
    return { ...field, sinks: undefined, sinkStyloidThicken: undefined, sinkMarkers: undefined };
}

/** Modifier path without GLB element placement (sync; used when no elements). */
export function composePrintSolidTopSync(raw: BufferGeometry, input: ComposePrintSolidInput): BufferGeometry {
    const { geometry, referenceBase, ownedWidth } = composePrintSolidTopCore(raw, input);
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
    // Elements stay on the sheet. Sinks do not — they would re-loft the wall.
    await applyElementsToTopMeshLast(geometry, referenceBase, fieldWithoutSinks(input.sourceField));
    if (ownedWidth && referenceBase !== raw && referenceBase !== geometry) referenceBase.dispose();
    const trim = input.trimline ?? input.sourceField.trimline ?? null;
    if (trim && trim.points.length >= 4) {
        const clipped = clipGeometryToOutline(geometry, trim);
        if (geometry !== raw) geometry.dispose();
        return clipped;
    }
    return geometry;
}
