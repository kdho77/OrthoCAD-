// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type BufferGeometry, Vector3 } from "three";
import { applyBaseModifiers } from "@/lib/geometry/base-modifier";
import {
    applyElementsToTopMeshLast,
    fieldWithoutElementsForModifiers,
} from "@/lib/geometry/element-assets/apply-elements";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { extractOrderedBoundaryLoopWithIndices } from "@/lib/geometry/mesh-close";
import { applyShoeWidthToGeometry, type ShoeWidthId, shoeWidthAffineActive } from "@/lib/geometry/shoe-width";
import { clipGeometryToOutline, type TrimlineCurve } from "@/lib/geometry/trimline";
import {
    applySharedSizeXY,
    RIM_SUBSTITUTION_MAX_MM,
    referenceRimFromOutlineAndCut,
    type SharedInsoleSizeTransform,
} from "./pattern-hygiene";
import {
    cutPolyline,
    footprintFrameFromRim,
    TRIM_CHORD_MM,
    TRIM_EXTEND_MM,
    TRIM_SEED_CONTROLS,
    type Uv,
} from "./trim-curve";

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

export type DistalCutKind = "sulcus" | "34" | "met_head";

/**
 * Clinical met-head landmark (v = 0.66). #206 ships sulcus and 3/4 seeds only;
 * this cut uses that same cutter, extend, and chord, with no extra shaping.
 */
const MET_HEAD_CUT: readonly Uv[] = [
    { u: 0, v: 0.66 },
    { u: 1, v: 0.66 },
];

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
    /** #206 cut. The clipped outline keeps its points; the cut is inserted as-is. */
    distalCut?: DistalCutKind | null;
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
    sizeTransform?: SharedInsoleSizeTransform | null;
    distalCut?: DistalCutKind | null;
}): Promise<BufferGeometry> {
    return composePrintSolidTop(input.raw, {
        sourceField: input.sourceField,
        shoeWidth: input.shoeWidth,
        trimline: input.trimline,
        sizeTransform: input.sizeTransform,
        distalCut: input.distalCut,
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

function clipToSharedCut(geometry: BufferGeometry, kind: DistalCutKind): BufferGeometry {
    const boundary = extractOrderedBoundaryLoopWithIndices(geometry);
    const outline = boundary.positions.map((p) => ({ x: p.x, y: p.y, z: 0 }));
    if (outline.length < 8) return geometry;
    const frame = footprintFrameFromRim(outline);
    const controls = kind === "met_head" ? MET_HEAD_CUT : TRIM_SEED_CONTROLS[kind];
    const cut = cutPolyline(frame, controls, TRIM_EXTEND_MM, TRIM_CHORD_MM);
    const ref = referenceRimFromOutlineAndCut(outline, cut);
    if (ref.maxSubstitutionMm > RIM_SUBSTITUTION_MAX_MM || ref.rim.length < 4) return geometry;
    const trim: TrimlineCurve = {
        points: ref.rim.map((p) => new Vector3(p.x, p.y, 0)),
    };
    const clipped = clipGeometryToOutline(geometry, trim, 0);
    clipped.userData = {
        ...geometry.userData,
        referenceRim: ref.rim,
        referenceOutline: outline,
        distalCut: cut,
    };
    return clipped;
}

/** The clip's reference rim, when compose built one. Same array the viewer passes on. */
export function sharedComposedRim(geometry: BufferGeometry): { x: number; y: number; z: number }[] | null {
    const rim = (geometry.userData as { referenceRim?: { x: number; y: number; z: number }[] }).referenceRim;
    return rim && rim.length >= 4 ? rim : null;
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
    if (input.distalCut) {
        const clipped = clipToSharedCut(geometry, input.distalCut);
        stampSize(clipped, input.sizeTransform);
        if (clipped !== geometry && geometry !== raw) geometry.dispose();
        return clipped;
    }
    const trim = input.trimline ?? input.sourceField.trimline ?? null;
    if (trim && trim.points.length >= 4) {
        const clipped = clipGeometryToOutline(geometry, trim);
        stampSize(clipped, input.sizeTransform);
        if (geometry !== raw) geometry.dispose();
        return clipped;
    }
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
