// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type IFace,
    type IShape,
    type IShapeFactory,
    type ISolid,
    type IWire,
    type Result,
    Plane,
    ShapeTypes,
    XYZ,
} from "@chili3d/core";
import { getCustomElementBounds } from "@/lib/geometry/custom-element-bounds";
import { ELEMENT_PROFILES } from "@/lib/geometry/elements";
import type { TrimlineCurve } from "@/lib/geometry/trimline";
import type { PlacedElement, Side, SideCorrections } from "@/types";

/**
 * Base + Modifier — OCCT boolean pipeline (Phase 2).
 *
 * Topology-changing modifiers that deformation cannot express cleanly are
 * applied here as OpenCascade booleans on top of a base solid:
 *   - **Trimline cutting** — clean perimeter cut driven by the user's trimline.
 *   - **Discrete elements** — additive pads/bars and subtractive sinks/wedges.
 *   - **Skives / posting wedges** — heel skive cuts.
 *
 * This work is reserved for Confirm / Export / idle (see geometry-engine
 * scheduling), so interactive editing keeps using the fast height-field
 * deformation in `base-modifier.ts`. Every pass fails *soft*: on any boolean
 * error the previous (valid) solid is kept, so the export never regresses below
 * the deformation-only result.
 */

function unwrap<T>(result: Result<T, string>, context: string): T {
    if (!result.isOk) throw new Error(`${context}: ${result.error}`);
    return result.value;
}

function collectFaces(shape: IShape): IFace[] {
    if (shape.shapeType === ShapeTypes.face) return [shape as IFace];
    if (shape.shapeType === ShapeTypes.shell || shape.shapeType === ShapeTypes.compound) {
        return shape.findSubShapes(ShapeTypes.face) as IFace[];
    }
    return [];
}

function asSolid(factory: IShapeFactory, shape: IShape): ISolid {
    if (shape.shapeType === ShapeTypes.solid) return shape as ISolid;
    const faces = collectFaces(shape);
    if (faces.length === 0) throw new Error("No faces to build solid from");
    const shell = unwrap(factory.shell(faces), "shell from faces");
    return unwrap(factory.solid([shell]), "solid from shell");
}

// --- Trimline boolean cutting ---------------------------------------------

/**
 * Build a vertical prism solid from the closed trimline curve, spanning the
 * full height range so it fully contains the base solid in Z. The prism's
 * footprint *is* the kept (inside-trimline) region.
 */
function buildTrimlinePrism(
    factory: IShapeFactory,
    trimline: TrimlineCurve,
    zMin: number,
    zMax: number,
): ISolid | null {
    if (trimline.points.length < 4) return null;
    try {
        const bottom = trimline.points.map((p) => ({ x: p.x, y: p.y, z: zMin }));
        const top = trimline.points.map((p) => ({ x: p.x, y: p.y, z: zMax }));
        const w0: IWire = unwrap(factory.polygon(bottom), "trimline bottom wire");
        const w1: IWire = unwrap(factory.polygon(top), "trimline top wire");
        const lofted = unwrap(factory.loft([w0, w1], true, true, "c0"), "trimline prism loft");
        return asSolid(factory, lofted);
    } catch (error) {
        console.warn("[base-modifier] trimline prism build failed:", error);
        return null;
    }
}

export interface TrimlineCutParams {
    lengthMm: number;
    widthMm: number;
}

/**
 * Cut a base solid down to the user's trimline footprint using OCCT booleans.
 *
 * Implemented as `solid − (boundingBox − trimlinePrism)`: subtracting the region
 * *outside* the trimline yields a clean perimeter cut, which is more robust than
 * intersecting directly. Returns the original solid unchanged if the cut cannot
 * produce a valid result (graceful fallback to the deformed footprint).
 */
export function applyTrimlineCut(
    factory: IShapeFactory,
    solid: ISolid,
    trimline: TrimlineCurve | null | undefined,
    params: TrimlineCutParams,
): ISolid {
    if (!trimline || trimline.points.length < 4) return solid;

    const zMin = -10;
    const zMax = 400;
    const prism = buildTrimlinePrism(factory, trimline, zMin, zMax);
    if (!prism) return solid;

    try {
        const margin = Math.max(params.lengthMm, params.widthMm);
        const origin = new XYZ({ x: -margin, y: -margin, z: zMin - 2 });
        const plane = new Plane({ origin, normal: XYZ.unitZ, xvec: XYZ.unitX });
        const boxResult = factory.box(
            plane,
            params.lengthMm + 2 * margin,
            params.widthMm + 2 * margin,
            zMax - zMin + 4,
        );
        if (!boxResult.isOk) return solid;

        const outside = factory.booleanCut([boxResult.value], [prism]);
        if (!outside.isOk) {
            console.warn("[base-modifier] trimline complement failed:", outside.error);
            return solid;
        }

        const trimmed = factory.booleanCut([solid], [outside.value]);
        if (!trimmed.isOk) {
            console.warn("[base-modifier] trimline cut failed:", trimmed.error);
            return solid;
        }
        return asSolid(factory, trimmed.value);
    } catch (error) {
        console.warn("[base-modifier] trimline cut error:", error);
        return solid;
    }
}

// --- Discrete element booleans --------------------------------------------

function buildElementTool(factory: IShapeFactory, el: PlacedElement, lengthMm: number): ISolid | null {
    if (el.kind === "custom") {
        return buildCustomElementTool(factory, el, lengthMm);
    }
    const profile = ELEMENT_PROFILES[el.kind];
    const rx = Math.max(2, profile.rxMm * el.scale.x);
    const ry = Math.max(2, profile.ryMm * el.scale.y);
    const h = Math.max(0.5, el.heightMm);
    const centerX = lengthMm / 2 + el.position.x;
    const centerY = el.position.y;
    const angleRad = (el.rotationDeg * Math.PI) / 180;
    const xvec = new XYZ({ x: Math.cos(angleRad), y: Math.sin(angleRad), z: 0 });
    const yvec = new XYZ({ x: -Math.sin(angleRad), y: Math.cos(angleRad), z: 0 });
    const origin = new XYZ({ x: centerX, y: centerY, z: 0 })
        .add(xvec.multiply(rx * -1))
        .add(yvec.multiply(ry * -1));

    const plane = new Plane({ origin, normal: XYZ.unitZ, xvec });
    const box = factory.box(plane, rx * 2, ry * 2, h);
    if (!box.isOk) return null;
    return box.value;
}

/** OCCT boolean tool for user custom GLB elements — oriented box from saved bounds. */
function buildCustomElementTool(factory: IShapeFactory, el: PlacedElement, lengthMm: number): ISolid | null {
    const bounds = getCustomElementBounds(el.customElementId);
    const sx = bounds.sizeX * el.scale.x;
    const sy = bounds.sizeY * el.scale.y;
    const h = Math.max(0.5, bounds.sizeZ * (el.heightMm / 4));
    const centerX = lengthMm / 2 + el.position.x;
    const centerY = el.position.y;
    const angleRad = (el.rotationDeg * Math.PI) / 180;
    const xvec = new XYZ({ x: Math.cos(angleRad), y: Math.sin(angleRad), z: 0 });
    const yvec = new XYZ({ x: -Math.sin(angleRad), y: Math.cos(angleRad), z: 0 });
    const origin = new XYZ({ x: centerX, y: centerY, z: 0 })
        .add(xvec.multiply(sx * -0.5))
        .add(yvec.multiply(sy * -0.5));

    const plane = new Plane({ origin, normal: XYZ.unitZ, xvec });
    const box = factory.box(plane, sx, sy, h);
    if (!box.isOk) return null;
    return box.value;
}

export function applyElements(
    factory: IShapeFactory,
    solid: ISolid,
    elements: PlacedElement[],
    lengthMm: number,
    repair: (shape: IShape) => IShape,
): ISolid {
    let current: IShape = solid;
    for (const el of elements) {
        try {
            const tool = buildElementTool(factory, el, lengthMm);
            if (!tool) continue;
            const profile = el.kind === "custom" ? { sign: 1 } : ELEMENT_PROFILES[el.kind];
            const result =
                profile.sign > 0
                    ? factory.booleanFuse([current], [tool], true)
                    : factory.booleanCut([current], [tool]);
            if (!result.isOk) {
                console.warn(`[base-modifier] element boolean skipped (${el.kind}): ${result.error}`);
                continue;
            }
            current = repair(result.value);
        } catch (error) {
            console.warn(`[base-modifier] element boolean failed (${el.kind}):`, error);
        }
    }
    return current as ISolid;
}

// --- Skive booleans (disabled) --------------------------------------------

/**
 * @deprecated Clinically inverted. The Kirby skive is a plane half-space RAISE
 * applied in heightAt / applyHeelSkiveToTopMesh. This boolean CUT is a permanent
 * no-op (G4) so export cannot cancel the raise.
 */
export function applySkives(
    _factory: IShapeFactory,
    solid: ISolid,
    _corrections: SideCorrections,
    _params: { lengthMm: number; widthMm: number; side: Side },
): ISolid {
    return solid;
}
