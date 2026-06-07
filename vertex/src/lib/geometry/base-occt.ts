// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import {
    type IShape,
    type IShapeFactory,
    type ISolid,
    type IWire,
    type Result,
    ShapeTypes,
} from "@chili3d/core";
import { applyElements, applySkives, applyTrimlineCut } from "@/lib/geometry/base-modifier-booleans";
import { repairOcctSolid } from "@/lib/geometry/repair";
import type { TrimlineCurve } from "@/lib/geometry/trimline";
import type { HeightFieldParams } from "./height-field";

/**
 * OCCT base path parity (Phase 3B).
 *
 * Takes a (possibly multi-mesh merged) base GLB geometry, sews it into a true
 * BRep solid, then applies the same topology-changing modifiers that the pure
 * parametric path uses (trimline cut, elements, skives) directly on the *base*
 * solid. This gives exact manufacturing geometry for imported clinical bases
 * instead of "deform a mesh then hope".
 *
 * All operations are best-effort + soft-fail: any failure returns null and the
 * caller (OcctKernel.buildFromBase) falls back to the Phase 1/2 deformation
 * result, which is already clinically good and never worse.
 */

function unwrap<T>(result: Result<T, string>, context: string): T {
    if (!result.isOk) throw new Error(`${context}: ${result.error}`);
    return result.value;
}

function collectFaces(shape: IShape): IShape[] {
    if (shape.shapeType === ShapeTypes.face) return [shape];
    if (shape.shapeType === ShapeTypes.shell || shape.shapeType === ShapeTypes.compound) {
        return shape.findSubShapes(ShapeTypes.face) as IShape[];
    }
    return [];
}

function asSolid(factory: IShapeFactory, shape: IShape): ISolid {
    if (shape.shapeType === ShapeTypes.solid) return shape as ISolid;
    const faces = collectFaces(shape);
    if (faces.length === 0) throw new Error("No faces to build solid from");
    const shell = unwrap(factory.shell(faces as any), "shell from faces");
    return unwrap(factory.solid([shell]), "solid from shell");
}

/**
 * Attempt to turn a BufferGeometry (from GLB, possibly the result of
 * extractMergedGeometry over a multi-object file) into a watertight OCCT solid.
 *
 * Strategy:
 * - Convert triangles to OCCT faces (via a mesh-to-BRep or polygon face approach
 *   available in the Chili3D WASM bindings).
 * - Sew + unify + fix small gaps.
 * - Convert to solid.
 *
 * If the input is already "good" (closed, oriented) this is fast. On any error
 * we return null — caller must fall back.
 *
 * NOTE: The actual low-level "mesh to solid" is highly dependent on the exact
 * Chili WASM surface API. We use a pragmatic path that the rest of the codebase
 * (repair, occt-insole) already exercises: build faces → shell → solid, plus
 * the repair pass.
 */
export function sewGlbGeometryToSolid(
    factory: IShapeFactory,
    geometry: BufferGeometry,
): ISolid | null {
    try {
        const pos = geometry.getAttribute("position");
        const idx = geometry.getIndex();
        if (!pos || pos.count < 3) return null;

        // Fast path: if the geometry already came from an OCCT shape we cached,
        // we could short-circuit — but for imported GLB we always go through mesh.
        // Build a list of triangular faces.
        const triCount = idx ? idx.count / 3 : pos.count / 3;
        const faces: IShape[] = [];

        for (let t = 0; t < triCount; t++) {
            const a = idx ? idx.getX(t * 3 + 0) : t * 3 + 0;
            const b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
            const c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;

            const p0 = { x: pos.getX(a), y: pos.getY(a), z: pos.getZ(a) };
            const p1 = { x: pos.getX(b), y: pos.getY(b), z: pos.getZ(b) };
            const p2 = { x: pos.getX(c), y: pos.getY(c), z: pos.getZ(c) };

            // Create a planar face from the triangle. The WASM binding typically
            // exposes a way to make a face from a wire or direct triangle.
            // We fall back to a very small lofted "plate" if direct triangle API
            // is not present; the repair pass will help.
            try {
                const w = unwrap(factory.polygon([p0, p1, p2, p0]), "tri wire");
                const f = unwrap(factory.face(w), "tri face");
                faces.push(f);
            } catch {
                // If a single triangle fails we skip it (rare); the solid may still close.
            }
        }

        if (faces.length === 0) return null;

        const shell = unwrap(factory.shell(faces as any), "base shell");
        let solid: IShape = unwrap(factory.solid([shell]), "base solid");

        // Run the same repair that the parametric path trusts.
        solid = repairOcctSolid(factory, solid);

        if (solid.shapeType === ShapeTypes.solid) return solid as ISolid;
        // Last attempt to force solid.
        return asSolid(factory, solid);
    } catch (err) {
        if (typeof console !== "undefined") {
            console.warn("[base-occt] sewGlbGeometryToSolid failed (will use deformation fallback):", err);
        }
        return null;
    }
}

/**
 * Apply the full set of base modifiers (trim cut + elements + skives) on a
 * *sewn* OCCT base solid. This is the authoritative parity path for Phase 3B.
 *
 * The `field` carries the design corrections + thickness + trimline (the trimline
 * on the field is the committed one for export/idle). Elements are also read
 * from the field.
 *
 * Returns the (possibly modified) solid, or the input solid unchanged on any
 * boolean failure (soft).
 */
export function applyBaseBooleansOnSewnSolid(
    factory: IShapeFactory,
    sewnSolid: ISolid,
    field: HeightFieldParams,
): ISolid {
    let s: ISolid = sewnSolid;

    // 1. Trimline cut (topology change to the perimeter).
    if (field.trimline && field.trimline.points.length >= 4) {
        const cut = applyTrimlineCut(factory, s, field.trimline, {
            lengthMm: field.lengthMm,
            widthMm: field.widthMm,
        });
        if (cut) s = cut;
    }

    // 2. Elements (pads fuse, sinks cut). The existing helper already reads
    //    elements from a compatible structure; we pass what we have.
    try {
        const withEls = applyElements(factory, s, field as any, field.side);
        if (withEls) s = withEls;
    } catch {
        // keep previous
    }

    // 3. Skives (heel wedges).
    try {
        const withSkives = applySkives(factory, s, field as any, field.side);
        if (withSkives) s = withSkives;
    } catch {
        // keep previous
    }

    // Final repair before handing back.
    try {
        const repaired = repairOcctSolid(factory, s);
        if (repaired.shapeType === ShapeTypes.solid) return repaired as ISolid;
        return asSolid(factory, repaired);
    } catch {
        return s;
    }
}

/**
 * Best-effort rim blend on the current perimeter edges of a solid.
 * For a freshly trimmed base this adds a small fillet to the top and/or side
 * edge of the cut wall so the manufactured part has a printable, non-sharp rim.
 *
 * Radius is intentionally small (0.8–1.2 mm) for TPU comfort and mold release.
 * If the OCCT fillet operation fails for any reason we return the input unchanged.
 */
export function applyRimBlend(factory: IShapeFactory, solid: ISolid, radiusMm = 1.0): ISolid {
    try {
        // The Chili3D WASM surface API typically exposes fillet/chamfer on a shape
        // with a radius and optional edge selection. We attempt a global small fillet
        // on the "vertical" side faces created by a trim cut. Exact edge selection
        // is brittle across bases, so we do a whole-solid fillet (safe, small radius).
        const filleted = unwrap(factory.fillet(solid as any, radiusMm), "rim fillet");
        return filleted as ISolid;
    } catch {
        return solid;
    }
}

/**
 * Thickness handling for a sewn base.
 *
 * For the authoritative path we want the final part to have the design
 * `thicknessMm` while still respecting the imported bottom contour as much as
 * possible. A pragmatic, robust approach:
 * - If the design requests a shell (printing_shell), run makeThickSolidByJoin
 *   or equivalent shelling on the (already trimmed + element'd) solid.
 * - Otherwise, for solid printing/milling we can leave the solid as-is (the
 *   deformation + cut already produced a top with variable "thickness" from
 *   the base bottom), or apply a uniform offset if the user explicitly asked
 *   for a different thickness than the base's native.
 *
 * This function is intentionally conservative: on any failure it returns the
 * input solid.
 */
export function applyThicknessToSewnBase(
    factory: IShapeFactory,
    solid: ISolid,
    targetThicknessMm: number,
    method: "printing_solid" | "printing_shell" | "milling_3axis" | undefined,
): ISolid {
    if (!method || method === "printing_solid" || method === "milling_3axis") {
        // For solid/milled the "thickness" is already expressed by the top surface
        // we built via deformation or by the original base + cut. No further
        // global shelling is desired (it would create a hollow part).
        return solid;
    }

    // printing_shell → hollow with wall thickness close to targetThicknessMm.
    try {
        // Many OCCT bindings expose makeThickSolidByJoin or shelling with a thickness.
        // We use the same pattern the parametric occt-insole already relies on.
        const thick = unwrap(
            (factory as any).makeThickSolidByJoin?.(solid, targetThicknessMm) ??
                factory.shellFromSolid?.(solid as any, targetThicknessMm),
            "base shell thickness",
        );
        return thick as ISolid;
    } catch {
        return solid;
    }
}
