// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { BufferAttribute, BufferGeometry } from "three";
import type { Side } from "@/types";

/**
 * Flat sole in the footprint frame. Toe is +X, plantar is z = 0, top sheet is z = 8.
 * Large enough that a 12 mm JABBOUR string fits at scale 1, so chirality is not
 * hidden by the fit shrink. The right foot is the Y mirror, matching production
 * pairing. The rectangle is symmetric, so the mirror does not move the centreline.
 */
export const SOLE_MIN_X = 10;
export const SOLE_MAX_X = 250;
export const SOLE_HALF_Y = 45;
export const SOLE_TOP_Z = 8;

export function soleGeometry(side: Side): BufferGeometry {
    const ySign = side === "right" ? -1 : 1;
    const y0 = -SOLE_HALF_Y * ySign;
    const y1 = SOLE_HALF_Y * ySign;
    const bottom = [SOLE_MIN_X, y0, 0, SOLE_MAX_X, y0, 0, SOLE_MAX_X, y1, 0, SOLE_MIN_X, y1, 0];
    const top: number[] = [];
    for (let x = SOLE_MIN_X; x <= SOLE_MAX_X; x += 2) {
        for (let y = -SOLE_HALF_Y; y <= SOLE_HALF_Y; y += 2) {
            top.push(x, y * ySign, SOLE_TOP_Z);
        }
    }
    const position = new Float32Array(bottom.length + top.length);
    position.set(bottom, 0);
    position.set(top, bottom.length);
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(position, 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const outline = [
        { x: SOLE_MIN_X, y: y0, z: 0 },
        { x: SOLE_MAX_X, y: y0, z: 0 },
        { x: SOLE_MAX_X, y: y1, z: 0 },
        { x: SOLE_MIN_X, y: y1, z: 0 },
    ];
    geo.userData = { outlineRing: outline, thicknessMm: SOLE_TOP_Z };
    return geo;
}

export function positionHashBytes(geo: BufferGeometry): Buffer {
    const attr = geo.getAttribute("position");
    const array = attr.array as ArrayLike<number>;
    return Buffer.from(array as ArrayBuffer);
}
