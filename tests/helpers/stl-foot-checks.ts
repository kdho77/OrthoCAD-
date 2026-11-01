// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { medialSign } from "@/lib/clinical/medial-sign";
import { binaryStlToGeometry } from "@/lib/geometry/stl";
import type { Side } from "@/types";

export type StlArchMedialCheck = {
    ok: boolean;
    apexY: number;
    apexX: number;
    apexZ: number;
    medialSign: number;
    reason?: string;
};

/** Top-view medial check. Export frame: left medial is −Y, right medial is +Y. */
export function checkStlArchApexMedial(stl: ArrayBuffer, side: Side): StlArchMedialCheck {
    const geo = binaryStlToGeometry(stl);
    const pos = geo.getAttribute("position");
    const sign = medialSign(side);
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
    const onMedial = apexY * sign > 0;
    return {
        ok: onMedial && Number.isFinite(bestZ),
        apexX,
        apexY,
        apexZ,
        medialSign: sign,
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
    const sign = medialSign(side);
    let sum = 0;
    let n = 0;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        if (x > 55) continue;
        if (medial ? y * sign <= 0 : y * sign >= 0) continue;
        sum += z;
        n++;
    }
    geo.dispose();
    return n > 0 ? sum / n : NaN;
}

/** Mean Z of the upper quartile in the heel half (top sheet, not the plantar bed). */
export function meanTopHeelZ(stl: ArrayBuffer, medial: boolean, side: Side): number {
    const geo = binaryStlToGeometry(stl);
    const pos = geo.getAttribute("position");
    const sign = medialSign(side);
    const zs: number[] = [];
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        if (x > 55) continue;
        if (medial ? y * sign <= 0 : y * sign >= 0) continue;
        zs.push(z);
    }
    geo.dispose();
    if (zs.length < 8) return NaN;
    zs.sort((a, b) => a - b);
    const start = Math.floor(zs.length * 0.75);
    let sum = 0;
    for (let i = start; i < zs.length; i++) sum += zs[i]!;
    return sum / (zs.length - start);
}
