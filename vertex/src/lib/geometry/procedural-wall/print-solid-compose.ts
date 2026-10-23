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
import { insoleFootprintAnchorFromBounds } from "./pattern-hygiene";

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

/**
 * One XY size map shared by the TopSheet, the pattern, export, and the viewer.
 * `sx` / `sy` are computed once. Pass this object; compose does not divide length again.
 * The coefficients match #204's {@link applyInsoleFootprintScale}.
 */
export interface SharedInsoleSizeTransform {
    x0: number;
    yMid: number;
    sx: number;
    sy: number;
    lengthMm: number;
    widthMm: number;
    nativeLengthMm: number;
    nativeWidthMm: number;
}

export interface ComposePrintSolidInput {
    /** Full viewer field: elements + rim feather, shapeFinish, Kirby after F. */
    sourceField: HeightFieldParams;
    shoeWidth?: PrintSolidShoeWidth | null;
    /** Clip before rim extraction. Falls back to sourceField.trimline. */
    trimline?: TrimlineCurve | null;
    /**
     * #204 size map. Applied once, by this reference, before modifiers.
     * Compose does not recompute it.
     */
    sizeTransform?: SharedInsoleSizeTransform | null;
}

/** One transform from the mesh bbox. Callers pass this object; compose does not rebuild it. */
export function sharedInsoleSizeTransformFromGeometry(
    geometry: BufferGeometry,
    lengthMm: number,
    widthMm: number,
): SharedInsoleSizeTransform {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box) throw new Error("[SIZE] SAMPLE_Top has no bounds");
    const anchor = insoleFootprintAnchorFromBounds({
        minX: box.min.x,
        maxX: box.max.x,
        minY: box.min.y,
        maxY: box.max.y,
    });
    return {
        x0: anchor.x0,
        yMid: anchor.yMid,
        nativeLengthMm: anchor.nativeLengthMm,
        nativeWidthMm: anchor.nativeWidthMm,
        lengthMm,
        widthMm,
        sx: lengthMm / anchor.nativeLengthMm,
        sy: widthMm / anchor.nativeWidthMm,
    };
}

/** Identity scales do not shift, matching #204's pattern transform. */
export function applySharedSizeXY(
    x: number,
    y: number,
    t: SharedInsoleSizeTransform,
): { x: number; y: number } {
    if (Math.abs(t.sx - 1) < 1e-12 && Math.abs(t.sy - 1) < 1e-12) return { x, y };
    return { x: (x - t.x0) * t.sx, y: (y - t.yMid) * t.sy };
}

/**
 * CAD-approved Print top: one composed mesh, then loft.
 *
 * 1. shared size transform (the caller's object — not recomputed)
 * 2. width affine (same as applyShoeWidthToPoints)
 * 3. applyBaseModifiers (wedge/posting/arch — elements stripped from F)
 * 4. applyElementsToTopMeshLast (GLB height-field flow / noFlow + procedural fallback)
 * 5. trimline clip — before rim extraction
 */
export async function composeViewerPrintSolidTop(input: {
    raw: BufferGeometry;
    sourceField: HeightFieldParams;
    shoeWidth?: PrintSolidShoeWidth | null;
    trimline?: TrimlineCurve | null;
    sizeTransform?: SharedInsoleSizeTransform | null;
}): Promise<BufferGeometry> {
    return composePrintSolidTop(input.raw, {
        sourceField: input.sourceField,
        shoeWidth: input.shoeWidth,
        trimline: input.trimline,
        sizeTransform: input.sizeTransform,
    });
}

/** One application of the shared size map. Throws if the sheet is still the native bbox. */
export function applySharedInsoleSizeToGeometry(
    raw: BufferGeometry,
    t: SharedInsoleSizeTransform,
): BufferGeometry {
    const sized = raw.clone();
    const pos = sized.getAttribute("position");
    if (!pos) {
        sized.dispose();
        throw new Error("[SIZE] compose consumed an unscaled SAMPLE_Top (no positions)");
    }
    for (let i = 0; i < pos.count; i++) {
        const q = applySharedSizeXY(pos.getX(i), pos.getY(i), t);
        pos.setX(i, q.x);
        pos.setY(i, q.y);
    }
    pos.needsUpdate = true;
    sized.computeBoundingBox();
    sized.computeBoundingSphere();
    const box = sized.boundingBox;
    const length = box ? box.max.x - box.min.x : 0;
    const width = box ? box.max.y - box.min.y : 0;
    if (Math.abs(length - t.lengthMm) > 0.2 || Math.abs(width - t.widthMm) > 0.2) {
        sized.dispose();
        throw new Error(
            `[SIZE] compose consumed an unscaled SAMPLE_Top ` +
                `(${length.toFixed(3)}×${width.toFixed(3)} mm, target ${t.lengthMm.toFixed(3)}×${t.widthMm.toFixed(3)})`,
        );
    }
    sized.userData = { ...raw.userData, sizeTransform: t };
    return sized;
}

function stampSize(geometry: BufferGeometry, t: SharedInsoleSizeTransform | null | undefined): void {
    if (!t) return;
    geometry.userData = { ...geometry.userData, sizeTransform: t };
}

function composePrintSolidTopCore(
    raw: BufferGeometry,
    input: ComposePrintSolidInput,
): { geometry: BufferGeometry; referenceBase: BufferGeometry; ownedWidth: boolean } {
    let current = raw;
    let owned = false;
    const t = input.sizeTransform;
    if (t) {
        current = applySharedInsoleSizeToGeometry(raw, t);
        owned = true;
    }
    const sw = input.shoeWidth;
    if (sw && shoeWidthAffineActive(sw.width, sw.heelOverrideMm)) {
        const widened = applyShoeWidthToGeometry(current, sw.width, {
            ballWidthMm: sw.ballWidthMm,
            heelWidthMm: sw.heelWidthMm,
            heelOverrideMm: sw.heelOverrideMm,
        });
        if (owned && current !== raw && current !== widened) current.dispose();
        current = widened;
        owned = true;
        stampSize(current, t);
    }
    const modifierField = fieldWithoutElementsForModifiers(input.sourceField);
    const modified = applyBaseModifiers(current, modifierField, 0, {
        skipBottomSync: true,
    });
    stampSize(modified, t);
    return { geometry: modified, referenceBase: current, ownedWidth: owned };
}

function clipComposed(
    geometry: BufferGeometry,
    raw: BufferGeometry,
    input: ComposePrintSolidInput,
): BufferGeometry {
    const trim = input.trimline ?? input.sourceField.trimline ?? null;
    if (trim && trim.points.length >= 4) {
        const clipped = clipGeometryToOutline(geometry, trim);
        stampSize(clipped, input.sizeTransform);
        if (geometry !== raw) geometry.dispose();
        return clipped;
    }
    stampSize(geometry, input.sizeTransform);
    return geometry;
}

/** Modifier path without GLB element placement (sync; used when no elements). */
export function composePrintSolidTopSync(raw: BufferGeometry, input: ComposePrintSolidInput): BufferGeometry {
    const { geometry, referenceBase, ownedWidth } = composePrintSolidTopCore(raw, input);
    if (ownedWidth && referenceBase !== raw && referenceBase !== geometry) referenceBase.dispose();
    return clipComposed(geometry, raw, input);
}

export async function composePrintSolidTop(
    raw: BufferGeometry,
    input: ComposePrintSolidInput,
): Promise<BufferGeometry> {
    const { geometry, referenceBase, ownedWidth } = composePrintSolidTopCore(raw, input);
    await applyElementsToTopMeshLast(geometry, referenceBase, input.sourceField);
    if (ownedWidth && referenceBase !== raw && referenceBase !== geometry) referenceBase.dispose();
    return clipComposed(geometry, raw, input);
}
