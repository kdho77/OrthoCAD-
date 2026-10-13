// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import { applyBaseModifiers } from "@/lib/geometry/base-modifier";
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
 * Order matches the viewer height-field / applyBaseModifiers path:
 * 1. width affine (same as applyShoeWidthToPoints)
 * 2. applyBaseModifiers (thickness datum, F, elements+feather, shapeFinish, Kirby R11)
 * 3. trimline clip — before rim extraction
 */
export function composeViewerPrintSolidTop(input: {
    raw: BufferGeometry;
    sourceField: HeightFieldParams;
    shoeWidth?: PrintSolidShoeWidth | null;
    trimline?: TrimlineCurve | null;
}): BufferGeometry {
    return composePrintSolidTop(input.raw, {
        sourceField: input.sourceField,
        shoeWidth: input.shoeWidth,
        trimline: input.trimline,
    });
}

export function composePrintSolidTop(raw: BufferGeometry, input: ComposePrintSolidInput): BufferGeometry {
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
    const modified = applyBaseModifiers(current, input.sourceField, 0, {
        skipBottomSync: true,
    });
    if (owned && current !== raw && current !== modified) current.dispose();
    const trim = input.trimline ?? input.sourceField.trimline ?? null;
    if (trim && trim.points.length >= 4) {
        const clipped = clipGeometryToOutline(modified, trim);
        if (modified !== raw) modified.dispose();
        return clipped;
    }
    return modified;
}
