// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import * as THREE from "three";
import { sideOffsetX } from "@/lib/geometry/layout";
import { insoleLayoutFromDesign } from "@/lib/geometry/shoe-size";
import { getDesignTrimline, sampleDefaultOutline } from "@/lib/geometry/trimline";
import type {
    DesignState,
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

export interface PressureMapPlanePlacement {
    /** Center in footprint mm (x heel→toe, y medial/lateral). */
    centerFootprint: THREE.Vector2;
    /** Full plane extent along footprint X and Y (mm). */
    sizeFootprint: THREE.Vector2;
    /** Rotation in footprint plane (radians). */
    rotationRad: number;
    /** When true, sample U is mirrored so medial stays medial for this side. */
    mirrorImageU: boolean;
}

const PLANE_Z_GAP_MM = 0.35;

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

/**
 * Auto-fit pressure content into the footprint AABB, preserving aspect ratio.
 * Image +U → footprint +X (heel→toe). Image +V maps to lateral direction without
 * swapping feet; right foot mirrors across the sagittal plane via `mirrorImageU`.
 */
export function autoPressureMapPlacement(
    side: Side,
    footprint: FootprintRect,
    foot: Pick<PressureMapFoot, "imageWidth" | "imageHeight" | "contentBounds">,
    alignment: PressureMapAlignment = DEFAULT_PRESSURE_MAP_ALIGNMENT,
): PressureMapPlanePlacement {
    const { w: cw, h: ch, cu, cv } = contentSizePx(foot.contentBounds, foot.imageWidth, foot.imageHeight);
    const contentAspect = cw / ch;
    const footAspect = footprint.lengthMm / Math.max(footprint.widthMm, 1e-6);

    let mapContentWidthToFootprintX = contentAspect >= footAspect;
    if (Math.abs(contentAspect - footAspect) < 0.08) {
        mapContentWidthToFootprintX = cw >= ch;
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

    const rot = THREE.MathUtils.degToRad(alignment.rotationDeg);
    const center = new THREE.Vector2(
        footprint.centerX + alignment.offsetMm.x,
        footprint.centerY + alignment.offsetMm.y,
    );

    // Shift so detected content centroid lands on footprint center (approximate registration).
    const du = cu - 0.5;
    const dv = cv - 0.5;
    center.x -= du * planeLen;
    const medialSign = medialFootprintSign(side);
    center.y -= medialSign * dv * planeWid;

    return {
        centerFootprint: center,
        sizeFootprint: new THREE.Vector2(planeLen, planeWid),
        rotationRad: rot,
        mirrorImageU: side === "right",
    };
}

/** World/group-local pose for the overlay mesh (same Rx(−90°) parent as InsoleMesh). */
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
        position: new THREE.Vector3(localX, localY, -PLANE_Z_GAP_MM),
        rotation: new THREE.Euler(0, 0, placement.rotationRad),
        scale: placement.sizeFootprint,
        mirrorImageU: placement.mirrorImageU,
    };
}
