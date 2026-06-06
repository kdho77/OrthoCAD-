import {
    type IFace,
    type IShape,
    type ISolid,
    type IShapeFactory,
    type IWire,
    type Result,
    Plane,
    ShapeTypes,
    XYZ,
} from "@chili3d/core";
import { ELEMENT_PROFILES } from "@/lib/geometry/elements";
import {
    bump,
    type GridPoint,
    type HeightFieldParams,
    heightAt,
    outlineHalfWidth,
    resolveOutlineHalfWidth,
} from "@/lib/geometry/height-field";
import { repairOcctSolid } from "@/lib/geometry/repair";
import { getCustomElementBounds } from "@/lib/geometry/custom-element-bounds";
import type { InsoleParams } from "@/lib/geometry/insole";
import type { PlacedElement, SideCorrections } from "@/types";

function unwrap<T>(result: Result<T, string>, context: string): T {
    if (!result.isOk) throw new Error(`${context}: ${result.error}`);
    return result.value;
}

function wireFromPoints(factory: IShapeFactory, points: GridPoint[]): IWire {
    return unwrap(factory.polygon(points.map((p) => ({ x: p.x, y: p.y, z: p.z }))), "wireFromPoints");
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

function ensureSolid(factory: IShapeFactory, shape: IShape): ISolid {
    const repaired = repairOcctSolid(factory, shape);
    if (repaired.shapeType === ShapeTypes.solid) return repaired as ISolid;
    try {
        return asSolid(factory, repaired);
    } catch {
        if (shape.shapeType === ShapeTypes.solid) return shape as ISolid;
        throw new Error("Could not convert shape to solid");
    }
}

/** Cross-width samples used to capture the clinical top contour at each station. */
const CROSS_SECTION_SAMPLES = 16;
/** Longitudinal loft stations from heel to toe. */
const LOFT_STATIONS = 40;

/**
 * Closed cross-section profile at one length station `u`.
 *
 * The medial/lateral footprint extent is driven by the (optionally user-edited)
 * trimline via `resolveOutlineHalfWidth`, so the lofted solid's outline matches
 * what the user drew. Unlike a flat ruled top, the upper edge of the profile is
 * sampled across the width from the shared height field (`heightAt`), so the
 * lofted top surface follows the real arch dome / heel cup / posting contour.
 *
 * Point order (simple, planar polygon at constant x — auto-closed by `polygon`):
 *   bottom-medial → top medial→lateral (sampled) → bottom-lateral → (close along bottom)
 *
 * Every station emits the same point count so the sections loft cleanly.
 */
function sectionWire(
    factory: IShapeFactory,
    u: number,
    params: HeightFieldParams,
): IWire {
    const { lengthMm, widthMm } = params;
    const halfW = widthMm / 2;
    const hw = resolveOutlineHalfWidth(u, params) * halfW;
    const x = u * lengthMm;

    const points: GridPoint[] = [{ x, y: -hw, z: 0 }];
    for (let k = 0; k <= CROSS_SECTION_SAMPLES; k++) {
        const vSigned = -1 + (2 * k) / CROSS_SECTION_SAMPLES;
        points.push({ x, y: vSigned * hw, z: heightAt(u, vSigned, params) });
    }
    points.push({ x, y: hw, z: 0 });

    return wireFromPoints(factory, points);
}

/** @internal Exported for WASM integration tests. */
export function buildBaseShell(factory: IShapeFactory, params: InsoleParams): ISolid {
    const field: HeightFieldParams = {
        side: params.side,
        lengthMm: params.lengthMm,
        widthMm: params.widthMm,
        thicknessMm: params.thicknessMm,
        corrections: params.corrections,
        includeSkives: true,
        includeElements: false,
        trimline: params.trimline,
    };

    const nx = LOFT_STATIONS;
    const sections: IWire[] = [];
    for (let i = 0; i <= nx; i++) {
        sections.push(sectionWire(factory, i / nx, field));
    }

    const lofted = unwrap(factory.loft(sections, true, true, "c1"), "insole loft");
    return asSolid(factory, lofted);
}

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

function applyElements(factory: IShapeFactory, solid: ISolid, elements: PlacedElement[], lengthMm: number): ISolid {
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
                console.warn(`[occt-insole] element boolean skipped (${el.kind}): ${result.error}`);
                continue;
            }
            current = repairOcctSolid(factory, result.value);
        } catch (error) {
            console.warn(`[occt-insole] element boolean failed (${el.kind}):`, error);
        }
    }
    return current as ISolid;
}

function buildSkiveWedge(
    factory: IShapeFactory,
    params: {
        lengthMm: number;
        widthMm: number;
        depthMm: number;
        medial: boolean;
        side: InsoleParams["side"];
    },
): ISolid | null {
    const { lengthMm, widthMm, depthMm, medial, side } = params;
    if (depthMm <= 0) return null;

    const halfW = widthMm / 2;
    const heelCenterX = 0.1 * lengthMm;
    const medialSign = side === "left" ? -1 : 1;
    const yCenter = medial ? -halfW * 0.55 * medialSign : halfW * 0.55 * medialSign;
    const wedgeWidth = halfW * 0.45;
    const wedgeLength = lengthMm * 0.22;
    const wedgeHeight = depthMm + 6;

    const origin = new XYZ({
        x: heelCenterX - wedgeLength / 2,
        y: yCenter - wedgeWidth / 2,
        z: -1,
    });
    const plane = new Plane({ origin, normal: XYZ.unitZ, xvec: XYZ.unitX });
    return unwrap(factory.box(plane, wedgeLength, wedgeWidth, wedgeHeight), "skive wedge");
}

function applySkives(
    factory: IShapeFactory,
    solid: ISolid,
    corrections: SideCorrections,
    params: Pick<InsoleParams, "lengthMm" | "widthMm" | "side">,
): ISolid {
    let current: IShape = solid;

    for (const [depthMm, medial] of [
        [corrections.medialSkiveMm, true],
        [corrections.lateralSkiveMm, false],
    ] as const) {
        const wedge = buildSkiveWedge(factory, {
            lengthMm: params.lengthMm,
            widthMm: params.widthMm,
            depthMm,
            medial,
            side: params.side,
        });
        if (!wedge) continue;
        try {
            const cut = factory.booleanCut([current], [wedge]);
            if (!cut.isOk) {
                console.warn(`[occt-insole] skive boolean skipped: ${cut.error}`);
                continue;
            }
            current = cut.value;
        } catch (error) {
            console.warn("[occt-insole] skive boolean failed:", error);
        }
    }

    return current as ISolid;
}

/**
 * Hollows a closed solid for shell printing. Tries OCCT offset/join first, then
 * boolean-cuts an inward offset core when join alone does not yield a closed BRep.
 */
function applyShelling(factory: IShapeFactory, solid: ISolid, wallThicknessMm: number): ISolid {
    if (wallThicknessMm <= 0) return solid;

    const outer = solid.clone() as ISolid;

    const tryClosed = (shape: IShape): ISolid | null => {
        const repaired = repairOcctSolid(factory, shape);
        if (repaired.isClosed()) return repaired as ISolid;
        return null;
    };

    const offsetAttempts = [-wallThicknessMm, wallThicknessMm] as const;
    for (const offset of offsetAttempts) {
        try {
            const shelled = factory.makeThickSolidByJoin(outer, [], offset);
            if (!shelled.isOk) continue;
            const closed = tryClosed(shelled.value);
            if (closed) return closed;
        } catch {
            // try next offset sign
        }
    }

    try {
        const inner = factory.makeThickSolidByJoin(outer, [], -wallThicknessMm);
        if (inner.isOk) {
            const hollow = factory.booleanCut([outer], [inner.value]);
            if (hollow.isOk) {
                const closed = tryClosed(hollow.value);
                if (closed) return closed;
            }
        }
    } catch (error) {
        console.warn("[occt-insole] hollow boolean failed:", error);
    }

    console.warn("[occt-insole] shelling could not produce a closed solid; using uncut solid");
    return solid;
}

/**
 * Builds a watertight insole solid with OpenCascade: lofted correction shell,
 * boolean element pads/sinks, heel skive cuts, optional wall shelling, then repair.
 */
export function buildOcctInsoleSolid(factory: IShapeFactory, params: InsoleParams): ISolid {
    let solid = buildBaseShell(factory, params);

    // Skives are baked into the lofted height field; optional boolean wedges refine heel cuts.
    if (params.corrections.medialSkiveMm > 0 || params.corrections.lateralSkiveMm > 0) {
        try {
            solid = applySkives(factory, solid, params.corrections, params);
            solid = repairOcctSolid(factory, solid) as ISolid;
        } catch (error) {
            console.warn("[occt-insole] skive boolean pass failed, using lofted skives:", error);
        }
    }

    if ((params.elements?.length ?? 0) > 0) {
        try {
            solid = applyElements(factory, solid, params.elements ?? [], params.lengthMm);
            solid = repairOcctSolid(factory, solid) as ISolid;
        } catch (error) {
            console.warn("[occt-insole] element boolean pass failed:", error);
        }
    }

    if (params.method === "printing_shell") {
        solid = applyShelling(factory, solid, params.thicknessMm);
    }

    return ensureSolid(factory, solid);
}

/** Exposed for tests — verifies the height field matches between kernels. */
export function correctionHeightSample(u: number, v: number, params: InsoleParams): number {
    return heightAt(u, v, {
        side: params.side,
        lengthMm: params.lengthMm,
        widthMm: params.widthMm,
        thicknessMm: params.thicknessMm,
        corrections: params.corrections,
        includeSkives: false,
        includeElements: false,
    });
}

export function heelRegion(u: number): number {
    return bump(u, 0.1, 0.16);
}

export { outlineHalfWidth };
