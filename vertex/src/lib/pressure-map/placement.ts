// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import * as THREE from "three";
import { sideOffsetX } from "@/lib/geometry/layout";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { getDesignTrimline, sampleDefaultOutline } from "@/lib/geometry/trimline";
import type {
    DesignState,
    PressureImageOrientation,
    PressureMapAlignment,
    PressureMapContentBounds,
    PressureMapFoot,
    Side,
} from "@/types";
import { DEFAULT_PRESSURE_MAP_ALIGNMENT, medialFootprintSign } from "./types";

export interface FootprintRect {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    centerX: number;
    centerY: number;
    lengthMm: number;
    widthMm: number;
}

/** Uniform contain of the cropped ink inside the footprint. Aspect is never stretched. */
export interface PressureMapContainFit {
    /** Plane length / footprint length. Below 1 when width limits the scale. */
    lengthRatio: number;
    /** Plane width / footprint width. Below 1 when length limits the scale. */
    widthRatio: number;
    /** Axis that bound the uniform scale. */
    limitedBy: "length" | "width";
}

export interface PressureMapPlanePlacement {
    centerFootprint: THREE.Vector2;
    /** Content rectangle in the footprint frame: x = heel→toe length, y = width. */
    sizeFootprint: THREE.Vector2;
    /**
     * Mesh scale for a unit PlaneGeometry BEFORE {@link rotationRad}.
     * A −90° image rotation maps plane-local +Y onto footprint +X, so the long
     * axis must be scale.y, not scale.x.
     */
    planeScale: THREE.Vector2;
    rotationRad: number;
    /** Sagittal mirror only when image anatomical side ≠ assigned foot side. */
    mirrorImageU: boolean;
    /** How the ink rectangle was fitted. Ratios are against the footprint, not a stretch. */
    containFit: PressureMapContainFit;
}

/**
 * Millimetres under the plantar floor. SAMPLE_Top's sheet bottoms near z≈2;
 * the opaque bottom-pattern outline sits near z≈1.1, so the map stays in the
 * gap under the shell instead of inside the ~1 mm floor.
 */
export const PRESSURE_MAP_UNDER_FLOOR_MM = 1;

/** Fallback when the live shell bounds are not known yet (SAMPLE_Top-class floor). */
export const PRESSURE_MAP_PLANE_Z_MM = 1.2;

/**
 * Plane Z in the insole group (same frame as the shell, +Z dorsal).
 * High floors (SAMPLE_Top, z≈2): ~1 mm under the sheet but above the z≈0 fill
 * and the outline tube. A floor at z≈0 (parametric slab) gets the plane just
 * below that 1 mm sole.
 */
export function pressureMapPlaneZMm(plantarFloorZ: number): number {
    if (!Number.isFinite(plantarFloorZ)) return PRESSURE_MAP_PLANE_Z_MM;
    if (plantarFloorZ >= 1.6) return Math.max(1.2, plantarFloorZ - PRESSURE_MAP_UNDER_FLOOR_MM);
    return -0.45;
}

/** Medial direction in footprint Y. Same coefficient as height-field `medialSign(side)`. */
export function medialSign(side: Side): 1 | -1 {
    return medialFootprintSign(side);
}

export function footprintRectForDesign(design: DesignState, side: Side): FootprintRect {
    const layout = insoleLayoutFromDesign(design);
    const curve = getDesignTrimline(design, side) ?? sampleDefaultOutline(layout.lengthMm, layout.widthMm);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of curve.points) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
    }
    if (!Number.isFinite(minX)) {
        minX = 0;
        maxX = layout.lengthMm;
        minY = -layout.widthMm / 2;
        maxY = layout.widthMm / 2;
    }
    return {
        minX,
        maxX,
        minY,
        maxY,
        centerX: (minX + maxX) / 2,
        centerY: (minY + maxY) / 2,
        lengthMm: maxX - minX,
        widthMm: maxY - minY,
    };
}

/**
 * Footprint rect from a displayed insole mesh.
 * Geometry is length along X (0 at the heel) and width along Y; the mesh is
 * placed at [-length/2, sideOffset, 0] inside the Rx(−90°) group.
 */
export function footprintRectFromInsoleMesh(
    mesh: THREE.Mesh,
    design: DesignState,
    side: Side,
): FootprintRect | null {
    const geo = mesh.geometry;
    const pos = geo?.getAttribute("position");
    if (!pos || pos.count < 100) return null;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const box = geo.boundingBox;
    if (!box) return null;
    const layout = insoleLayoutFromDesign(design);
    const offsetX = sideOffsetX(side, layout.widthMm);
    const minX = mesh.position.x + box.min.x + layout.lengthMm / 2;
    const maxX = mesh.position.x + box.max.x + layout.lengthMm / 2;
    const minY = mesh.position.y + box.min.y - offsetX;
    const maxY = mesh.position.y + box.max.y - offsetX;
    if (!(maxX > minX) || !(maxY > minY)) return null;
    return {
        minX,
        maxX,
        minY,
        maxY,
        centerX: (minX + maxX) / 2,
        centerY: (minY + maxY) / 2,
        lengthMm: maxX - minX,
        widthMm: maxY - minY,
    };
}

export function insolePlantarFloorZ(mesh: THREE.Mesh): number {
    const geo = mesh.geometry;
    if (!geo) return PRESSURE_MAP_PLANE_Z_MM + PRESSURE_MAP_UNDER_FLOOR_MM;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const z = geo.boundingBox?.min.z;
    return z != null && Number.isFinite(z) ? z : PRESSURE_MAP_PLANE_Z_MM + PRESSURE_MAP_UNDER_FLOOR_MM;
}

function orientationOf(foot: PressureMapFoot): PressureImageOrientation {
    if (foot.orientation) return foot.orientation;
    return {
        detectedImageSide: "left",
        autoRotationDeg: -90,
        oppositeFootMirror: false,
    };
}

function normalizeDeg(deg: number): number {
    return ((deg % 360) + 360) % 360;
}

/** Quarter-turn images store heel→toe on plane-local Y so Rz(±90°) lands it on footprint X. */
export function planeScaleForRotation(
    lengthMm: number,
    widthMm: number,
    autoRotationDeg: number,
): THREE.Vector2 {
    const rot = normalizeDeg(autoRotationDeg);
    const quarter = rot === 90 || rot === 270;
    return quarter ? new THREE.Vector2(widthMm, lengthMm) : new THREE.Vector2(lengthMm, widthMm);
}

function contentAspect(foot: PressureMapFoot, autoRotationDeg: number): number {
    const du = Math.max(1e-4, foot.contentBounds.maxU - foot.contentBounds.minU);
    const dv = Math.max(1e-4, foot.contentBounds.maxV - foot.contentBounds.minV);
    const alongU = du * foot.imageWidth;
    const alongV = dv * foot.imageHeight;
    const rot = normalizeDeg(autoRotationDeg);
    const quarter = rot === 90 || rot === 270;
    const alongLength = quarter ? alongV : alongU;
    const alongWidth = quarter ? alongU : alongV;
    return alongLength / Math.max(alongWidth, 1e-6);
}

/**
 * Contain the cropped ink inside the footprint on both axes.
 * One uniform scale keeps the image aspect. The binding axis is reported;
 * the other axis is shorter than the footprint instead of being stretched.
 */
export function autoPressureMapPlacement(
    _side: Side,
    footprint: FootprintRect,
    foot: Pick<PressureMapFoot, "imageWidth" | "imageHeight" | "contentBounds" | "alignment" | "orientation">,
    alignment: PressureMapAlignment = DEFAULT_PRESSURE_MAP_ALIGNMENT,
): PressureMapPlanePlacement {
    const orient = orientationOf(foot as PressureMapFoot);
    const aspect = contentAspect(foot as PressureMapFoot, orient.autoRotationDeg);
    const userScale = Math.max(0.05, alignment.scale);
    const maxLen = footprint.lengthMm * userScale;
    const maxWid = footprint.widthMm * userScale;

    let planeLen = maxLen;
    let planeWid = planeLen / aspect;
    let limitedBy: PressureMapContainFit["limitedBy"] = "length";
    if (planeWid > maxWid) {
        planeWid = maxWid;
        planeLen = planeWid * aspect;
        limitedBy = "width";
    }

    const rot = THREE.MathUtils.degToRad(orient.autoRotationDeg + alignment.rotationDeg);
    const center = new THREE.Vector2(
        footprint.centerX + alignment.offsetMm.x,
        footprint.centerY + alignment.offsetMm.y,
    );
    const containFit: PressureMapContainFit = {
        lengthRatio: planeLen / Math.max(footprint.lengthMm, 1e-6),
        widthRatio: planeWid / Math.max(footprint.widthMm, 1e-6),
        limitedBy,
    };

    return {
        centerFootprint: center,
        sizeFootprint: new THREE.Vector2(planeLen, planeWid),
        planeScale: planeScaleForRotation(planeLen, planeWid, orient.autoRotationDeg),
        rotationRad: rot,
        mirrorImageU: orient.oppositeFootMirror,
        containFit,
    };
}

/**
 * Canvas pixel for a footprint point on the cropped-ink texture.
 * Row 0 is image-up (plane-local +Y), matching a CanvasTexture with flipY.
 */
export function footprintPointToCanvasPx(
    fx: number,
    fy: number,
    placement: Pick<PressureMapPlanePlacement, "centerFootprint" | "planeScale" | "rotationRad">,
    canvasWidth: number,
    canvasHeight: number,
): { x: number; y: number } {
    const dx = fx - placement.centerFootprint.x;
    const dy = fy - placement.centerFootprint.y;
    const c = Math.cos(placement.rotationRad);
    const s = Math.sin(placement.rotationRad);
    const lx = c * dx + s * dy;
    const ly = -s * dx + c * dy;
    const px = lx / placement.planeScale.x;
    const py = ly / placement.planeScale.y;
    return {
        x: (px + 0.5) * canvasWidth,
        y: (0.5 - py) * canvasHeight,
    };
}

function contentNormalized(
    u: number,
    v: number,
    bounds: PressureMapContentBounds,
): { cu: number; cv: number } {
    const du = Math.max(1e-6, bounds.maxU - bounds.minU);
    const dv = Math.max(1e-6, bounds.maxV - bounds.minV);
    return { cu: (u - bounds.minU) / du, cv: (v - bounds.minV) / dv };
}

/**
 * Unit-plane point (PlaneGeometry, before mesh scale/rotation) for an image UV.
 * +X is image-right, +Y is image-up. Mirror flips X only for an opposite-foot image.
 */
export function pressureMapGeometryPoint(
    u: number,
    v: number,
    foot: Pick<PressureMapFoot, "contentBounds" | "orientation">,
): THREE.Vector3 {
    const { cu, cv } = contentNormalized(u, v, foot.contentBounds);
    let px = cu - 0.5;
    const py = 0.5 - cv;
    if (foot.orientation?.oppositeFootMirror) px = -px;
    return new THREE.Vector3(px, py, 0);
}

/** Map a normalized image UV through the same crop, rotation, and scale as the mesh. */
export function footprintMmFromImageUv(
    u: number,
    v: number,
    _side: Side,
    foot: PressureMapFoot,
    placement: PressureMapPlanePlacement,
): { x: number; y: number } {
    const orient = orientationOf(foot);
    const p = pressureMapGeometryPoint(u, v, foot);
    const lx = p.x * placement.planeScale.x;
    const ly = p.y * placement.planeScale.y;
    const rot = THREE.MathUtils.degToRad(orient.autoRotationDeg + foot.alignment.rotationDeg);
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    return {
        x: placement.centerFootprint.x + (c * lx - s * ly),
        y: placement.centerFootprint.y + (s * lx + c * ly),
    };
}

export function pressureMapMeshPose(
    design: DesignState,
    side: Side,
    foot: PressureMapFoot,
    footprint: FootprintRect = footprintRectForDesign(design, side),
    plantarFloorZ?: number,
): {
    position: THREE.Vector3;
    rotation: THREE.Euler;
    /** Pre-rotation mesh scale (plane-local X, Y). */
    scale: THREE.Vector2;
    sizeFootprint: THREE.Vector2;
    mirrorImageU: boolean;
    centerFootprint: THREE.Vector2;
    rotationRad: number;
    containFit: PressureMapContainFit;
} {
    const layout = insoleLayoutFromDesign(design);
    const placement = autoPressureMapPlacement(side, footprint, foot, foot.alignment);
    const offsetX = sideOffsetX(side, layout.widthMm);
    const localX = placement.centerFootprint.x - layout.lengthMm / 2;
    const localY = offsetX + placement.centerFootprint.y;
    const z = plantarFloorZ == null ? PRESSURE_MAP_PLANE_Z_MM : pressureMapPlaneZMm(plantarFloorZ);
    return {
        position: new THREE.Vector3(localX, localY, z),
        rotation: new THREE.Euler(0, 0, placement.rotationRad),
        scale: placement.planeScale,
        sizeFootprint: placement.sizeFootprint,
        mirrorImageU: placement.mirrorImageU,
        centerFootprint: placement.centerFootprint,
        rotationRad: placement.rotationRad,
        containFit: placement.containFit,
    };
}

/** Footprint Y sign for medial (matches height-field / trimline `medialSign`). */
export function footprintMedialY(side: Side): number {
    return medialSign(side);
}
