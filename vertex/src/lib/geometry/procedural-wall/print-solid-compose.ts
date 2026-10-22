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
import { distalSkiveFieldFromMesh, skiveFeatherAt } from "./distal-skive";
import type { TrimKind } from "./trim-curve";

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
    /**
     * Present only for a trimmed base. Clips elements before the skive start.
     * `leadMm` pulls a met pad's clip further proximal of the taper.
     */
    skiveFeatherAt?: (x: number, y: number, leadMm?: number) => number;
    /** When set, elements are feathered from this trim's skive start. */
    distalTrim?: TrimKind;
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

function featherFromReference(
    referenceBase: BufferGeometry,
    kind: TrimKind,
): (x: number, y: number, leadMm?: number) => number {
    const pos = referenceBase.getAttribute("position");
    const index = referenceBase.getIndex();
    if (!pos || !index) return () => 1;
    const field = distalSkiveFieldFromMesh(pos.array as Float32Array, index.array as Uint32Array, kind);
    return (x, y, leadMm = 0) => skiveFeatherAt(field, x, y, leadMm);
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
    const skiveFeatherAtXY =
        input.skiveFeatherAt ??
        (input.distalTrim ? featherFromReference(referenceBase, input.distalTrim) : undefined);
    await applyElementsToTopMeshLast(geometry, referenceBase, input.sourceField, {
        skiveFeatherAt: skiveFeatherAtXY,
    });
    if (ownedWidth && referenceBase !== raw && referenceBase !== geometry) referenceBase.dispose();
    const trim = input.trimline ?? input.sourceField.trimline ?? null;
    if (trim && trim.points.length >= 4) {
        const clipped = clipGeometryToOutline(geometry, trim);
        if (geometry !== raw) geometry.dispose();
        return clipped;
    }
    return geometry;
}
