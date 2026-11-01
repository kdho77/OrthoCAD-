// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { BufferGeometry } from "three";
import { medialWidthSignForSide } from "@/lib/clinical/medial-sign";
import { binaryStlToGeometry } from "@/lib/geometry/stl";
import type { Side } from "@/types";

export type StlArchMedialCheck = {
    ok: boolean;
    apexY: number;
    apexX: number;
    apexZ: number;
    medialWidthSign: number;
    reason?: string;
};

/** Top-view medial check: arch apex sample in midfoot band should lie on medial half (+Y for left). */
export function checkStlArchApexMedial(stl: ArrayBuffer, side: Side): StlArchMedialCheck {
    const geo = binaryStlToGeometry(stl);
    const pos = geo.getAttribute("position");
    const medialSign = medialWidthSignForSide(side);
    let bestZ = -Infinity;
    let apexX = 0;
    let apexY = 0;
    let apexZ = 0;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        if (x < 85 || x > 145) continue;
        if (z > bestZ) {
            bestZ = z;
            apexX = x;
            apexY = y;
            apexZ = z;
        }
    }
    geo.dispose();
    const onMedial = apexY * medialSign > 0;
    return {
        ok: onMedial && Number.isFinite(bestZ),
        apexX,
        apexY,
        apexZ,
        medialWidthSign: medialSign,
        reason: onMedial ? undefined : `arch apex Y=${apexY.toFixed(2)} wrong side for ${side}`,
    };
}

export function stlBoundingBox(stl: ArrayBuffer): {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
} {
    const geo = binaryStlToGeometry(stl);
    geo.computeBoundingBox();
    const b = geo.boundingBox!;
    const out = { minX: b.min.x, maxX: b.max.x, minY: b.min.y, maxY: b.max.y, minZ: b.min.z, maxZ: b.max.z };
    geo.dispose();
    return out;
}

export function meanPlantarZInHeel(stl: ArrayBuffer, medial: boolean, side: Side): number {
    const geo = binaryStlToGeometry(stl);
    const pos = geo.getAttribute("position");
    const medialSign = medialWidthSignForSide(side);
    let sum = 0;
    let n = 0;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        if (x > 55) continue;
        if (medial ? y * medialSign <= 0 : y * medialSign >= 0) continue;
        sum += z;
        n++;
    }
    geo.dispose();
    return n > 0 ? sum / n : NaN;
}
