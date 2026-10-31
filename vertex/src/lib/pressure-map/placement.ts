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
import { DEFAULT_PRESSURE_MAP_ALIGNMENT } from "./types";

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

export interface PressureMapPlanePlacement {
    centerFootprint: THREE.Vector2;
    sizeFootprint: THREE.Vector2;
    rotationRad: number;
    /** Sagittal mirror only when image anatomical side ≠ assigned foot side. */
    mirrorImageU: boolean;
}

/** Slightly above the bottom-pattern fill plane (z≈0) so depth does not hide the map. */
export const PRESSURE_MAP_PLANE_Z_MM = 0.12;

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

function contentSizePx(
    bounds: PressureMapContentBounds,
    imageWidth: number,
    imageHeight: number,
): { w: number; h: number; cu: number; cv: number } {
    const w = Math.max(1, (bounds.maxU - bounds.minU) * imageWidth);
    const h = Math.max(1, (bounds.maxV - bounds.minV) * imageHeight);
    const cu = (bounds.minU + bounds.maxU) / 2;
    const cv = (bounds.minV + bounds.maxV) / 2;
    return { w, h, cu, cv };
}

/** Map image ink span to footprint length/width after auto rotation (portrait ⇒ −90° swaps axes). */
function contentSpanFootprintMm(
    contentWidthPx: number,
    contentHeightPx: number,
    autoRotationDeg: number,
): { alongLengthPx: number; alongWidthPx: number } {
    const rot = ((autoRotationDeg % 360) + 360) % 360;
    const swap = rot === 90 || rot === 270;
    return swap
        ? { alongLengthPx: contentHeightPx, alongWidthPx: contentWidthPx }
        : { alongLengthPx: contentWidthPx, alongWidthPx: contentHeightPx };
}

function orientationOf(foot: PressureMapFoot): PressureImageOrientation {
    if (foot.orientation) return foot.orientation;
    return {
        detectedImageSide: "left",
        autoRotationDeg: -90,
        oppositeFootMirror: false,
    };
}

/**
 * Auto-fit pressure ink into the footprint AABB. Toe→+X and medial→footprint medial
 * via rotation; UV mirror only when `oppositeFootMirror`.
 */
export function autoPressureMapPlacement(
    side: Side,
    footprint: FootprintRect,
    foot: Pick<PressureMapFoot, "imageWidth" | "imageHeight" | "contentBounds" | "alignment" | "orientation">,
    alignment: PressureMapAlignment = DEFAULT_PRESSURE_MAP_ALIGNMENT,
): PressureMapPlanePlacement {
    const orient = orientationOf(foot as PressureMapFoot);
    const { w: cw, h: ch, cu, cv } = contentSizePx(foot.contentBounds, foot.imageWidth, foot.imageHeight);
    const { alongLengthPx, alongWidthPx } = contentSpanFootprintMm(cw, ch, orient.autoRotationDeg);
    const contentAspect = alongLengthPx / Math.max(alongWidthPx, 1e-6);
    const footAspect = footprint.lengthMm / Math.max(footprint.widthMm, 1e-6);
    const fracU = Math.max(0.04, foot.contentBounds.maxU - foot.contentBounds.minU);
    const fracV = Math.max(0.04, foot.contentBounds.maxV - foot.contentBounds.minV);
    const rotNorm = ((orient.autoRotationDeg % 360) + 360) % 360;
    const rot90 = rotNorm === 90 || rotNorm === 270;
    const fracAlongLength = rot90 ? fracV : fracU;
    const fracAlongWidth = rot90 ? fracU : fracV;

    let mapContentWidthToFootprintX = contentAspect >= footAspect;
    if (Math.abs(contentAspect - footAspect) < 0.08) {
        mapContentWidthToFootprintX = alongLengthPx >= alongWidthPx;
    }

    let planeLen = footprint.lengthMm;
    let planeWid = footprint.widthMm;
    if (mapContentWidthToFootprintX) {
        planeWid = planeLen / contentAspect;
        if (planeWid > footprint.widthMm * 1.15) {
            planeWid = footprint.widthMm;
            planeLen = planeWid * contentAspect;
        }
    } else {
        planeLen = planeWid * contentAspect;
        if (planeLen > footprint.lengthMm * 1.15) {
            planeLen = footprint.lengthMm;
            planeWid = planeLen / contentAspect;
        }
    }

    const scale = Math.max(0.05, alignment.scale);
    planeLen *= scale;
    planeWid *= scale;

    // Plane UV is the full image; ink occupies a subset — expand so content spans the footprint.
    planeLen /= fracAlongLength;
    planeWid /= fracAlongWidth;

    const rot = THREE.MathUtils.degToRad(orient.autoRotationDeg + alignment.rotationDeg);
    const center = new THREE.Vector2(
        footprint.centerX + alignment.offsetMm.x,
        footprint.centerY + alignment.offsetMm.y,
    );

    const du = cu - 0.5;
    const dv = cv - 0.5;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    let pu = du;
    const pv = dv;
    if (orient.oppositeFootMirror) pu = -pu;
    const rx = c * pu - s * pv;
    let ry = s * pu + c * pv;
    if (side === "right") ry = -ry;
    center.x -= rx * planeLen;
    const medialSign = side === "left" ? -1 : 1;
    center.y -= medialSign * ry * planeWid;

    return {
        centerFootprint: center,
        sizeFootprint: new THREE.Vector2(planeLen, planeWid),
        rotationRad: rot,
        mirrorImageU: orient.oppositeFootMirror,
    };
}

/** Map normalized image UV to footprint mm using the same transform as auto placement. */
export function footprintMmFromImageUv(
    u: number,
    v: number,
    side: Side,
    foot: PressureMapFoot,
    placement: PressureMapPlanePlacement,
): { x: number; y: number } {
    const orient = orientationOf(foot);
    let pu = u - 0.5;
    const pv = v - 0.5;
    if (orient.oppositeFootMirror) pu = -pu;
    const rot = THREE.MathUtils.degToRad(orient.autoRotationDeg + foot.alignment.rotationDeg);
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const rx = c * pu - s * pv;
    let ry = s * pu + c * pv;
    if (side === "right") ry = -ry;
    const medialSign = side === "left" ? -1 : 1;
    return {
        x: placement.centerFootprint.x + rx * placement.sizeFootprint.x,
        y: placement.centerFootprint.y - medialSign * ry * placement.sizeFootprint.y,
    };
}

export function pressureMapMeshPose(
    design: DesignState,
    side: Side,
    foot: PressureMapFoot,
): {
    position: THREE.Vector3;
    rotation: THREE.Euler;
    scale: THREE.Vector2;
    mirrorImageU: boolean;
} {
    const layout = insoleLayoutFromDesign(design);
    const footprint = footprintRectForDesign(design, side);
    const placement = autoPressureMapPlacement(side, footprint, foot, foot.alignment);
    const offsetX = sideOffsetX(side, layout.widthMm);
    const localX = placement.centerFootprint.x - layout.lengthMm / 2;
    const localY = offsetX + placement.centerFootprint.y;
    return {
        position: new THREE.Vector3(localX, localY, PRESSURE_MAP_PLANE_Z_MM),
        rotation: new THREE.Euler(0, 0, placement.rotationRad),
        scale: placement.sizeFootprint,
        mirrorImageU: placement.mirrorImageU,
    };
}

/** Footprint Y sign for medial (matches height-field / trimline). */
export function footprintMedialY(side: Side): number {
    return side === "left" ? -1 : 1;
}
