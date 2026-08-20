// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BufferAttribute, BufferGeometry } from "three";
import type { Side } from "@/types";
import {
    type BeltPoint,
    type BeltTransformConfig,
    MissingToeHeelError,
    rotateBeltToSliceFrame,
    TOE_FIRST_ORIENT_MATRIX,
} from "./belt-transform";

export interface BeltFrameMesh {
    geometry: BufferGeometry;
    side: Side;
    lengthMm: number;
    widthMm: number;
    heightMm: number;
}

/**
 * Footprint (X heel→toe, Y ML centred, Z plantar-up) → belt frame
 * (x across, y along belt toe-first, z height). Linear map has det +1.
 */
export function orientMeshToBeltFrame(
    geometry: BufferGeometry,
    side: Side | undefined,
    cfg: BeltTransformConfig,
): BeltFrameMesh {
    if (side !== "left" && side !== "right") {
        throw new MissingToeHeelError(
            "Belt export requires side (left|right) on the export payload; " +
                "refusing to infer toe/heel from bounding-box or determinant.",
        );
    }

    const src = geometry.getAttribute("position");
    if (!src || src.count < 3) {
        throw new MissingToeHeelError("Belt export received an empty mesh; no toe-heel frame to apply.");
    }

    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < src.count; i++) {
        const x = src.getX(i);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
    }

    const out = new Float32Array(src.count * 3);
    for (let i = 0; i < src.count; i++) {
        const p = footprintToBelt({ x: src.getX(i), y: src.getY(i), z: src.getZ(i) }, cfg.printDirection, maxX, minX);
        out[i * 3] = p.x;
        out[i * 3 + 1] = p.y;
        out[i * 3 + 2] = p.z;
    }

    let bx0 = Infinity;
    let bz0 = Infinity;
    for (let i = 0; i < src.count; i++) {
        if (out[i * 3] < bx0) bx0 = out[i * 3];
        if (out[i * 3 + 2] < bz0) bz0 = out[i * 3 + 2];
    }
    const dx = cfg.acrossMarginMm - bx0;
    const dz = -bz0;
    for (let i = 0; i < src.count; i++) {
        out[i * 3] += dx;
        out[i * 3 + 2] += dz;
    }

    let maxBx = -Infinity;
    let maxBy = -Infinity;
    let maxBz = -Infinity;
    let minBx = Infinity;
    let minBy = Infinity;
    let minBz = Infinity;
    for (let i = 0; i < src.count; i++) {
        const x = out[i * 3];
        const y = out[i * 3 + 1];
        const z = out[i * 3 + 2];
        if (x < minBx) minBx = x;
        if (x > maxBx) maxBx = x;
        if (y < minBy) minBy = y;
        if (y > maxBy) maxBy = y;
        if (z < minBz) minBz = z;
        if (z > maxBz) maxBz = z;
    }

    const result = new BufferGeometry();
    result.setAttribute("position", new BufferAttribute(out, 3));
    if (geometry.index) result.setIndex(geometry.index.clone());
    result.userData = { ...geometry.userData, side, frame: "belt" };
    result.computeBoundingBox();

    return {
        geometry: result,
        side,
        lengthMm: maxBy - minBy,
        widthMm: maxBx - minBx,
        heightMm: maxBz - minBz,
    };
}

export function footprintToBelt(
    p: BeltPoint,
    printDirection: "toe-first" | "heel-first",
    maxX: number,
    minX: number,
): BeltPoint {
    const yAlong = printDirection === "toe-first" ? maxX - p.x : p.x - minX;
    return { x: p.y, y: yAlong, z: p.z };
}

export function toeFirstOrientMatrix(): typeof TOE_FIRST_ORIENT_MATRIX {
    return TOE_FIRST_ORIENT_MATRIX;
}

export function applyXRotationToGeometry(geometry: BufferGeometry, cfg: BeltTransformConfig): BufferGeometry {
    const src = geometry.getAttribute("position");
    const out = new Float32Array(src.count * 3);
    for (let i = 0; i < src.count; i++) {
        const r = rotateBeltToSliceFrame({ x: src.getX(i), y: src.getY(i), z: src.getZ(i) }, cfg);
        out[i * 3] = r.x;
        out[i * 3 + 1] = r.y;
        out[i * 3 + 2] = r.z;
    }
    const result = new BufferGeometry();
    result.setAttribute("position", new BufferAttribute(out, 3));
    if (geometry.index) result.setIndex(geometry.index.clone());
    result.computeBoundingBox();
    return result;
}
