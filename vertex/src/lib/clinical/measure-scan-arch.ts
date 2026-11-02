// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { BufferGeometry } from "three";
import { medialWidthSignForSide } from "@/lib/clinical/medial-sign";
import type { Side } from "@/types";

const ARCH_U_MIN = 0.28;
const ARCH_U_MAX = 0.58;
const HEEL_U_MAX = 0.22;
const FORE_U_MIN = 0.75;

export type ArchHeightMeasurement = {
    heightMm: number;
    /** Arch apex Z minus the heel/forefoot contact plane, before display scale. */
    rawHeight: number;
};

/**
 * Absolute medial-arch height in millimetres.
 *
 * Floor is the mean of the lowest heel and forefoot vertices. Arch height is
 * the highest medial midfoot vertex above that floor. This does not register
 * the scan to SAMPLE_Top and does not solve a gap fit.
 */
export function measureScanArchHeightMm(
    geometry: BufferGeometry,
    side: Side,
    displayScale = 1,
): ArchHeightMeasurement | null {
    const pos = geometry.getAttribute("position");
    if (!pos || pos.count < 30) return null;
    const scale = Number.isFinite(displayScale) && displayScale > 0 ? displayScale : 1;

    const n = pos.count;
    let minX = Infinity;
    let maxX = -Infinity;
    let sizeX = 0;
    let sizeY = 0;
    let sizeZ = 0;
    {
        let minY = Infinity;
        let maxY = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;
        for (let i = 0; i < n; i++) {
            const x = pos.getX(i);
            const y = pos.getY(i);
            const z = pos.getZ(i);
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            if (z < minZ) minZ = z;
            if (z > maxZ) maxZ = z;
        }
        sizeX = maxX - minX;
        sizeY = maxY - minY;
        sizeZ = maxZ - minZ;
    }

    const axis: "x" | "y" | "z" =
        sizeY > sizeX && sizeY >= sizeZ ? "y" : sizeZ > sizeX && sizeZ >= sizeY ? "z" : "x";
    const point = (i: number): [number, number, number] => {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        if (axis === "y") return [y, -x, z];
        if (axis === "z") return [z, y, -x];
        return [x, y, z];
    };

    let lenMin = Infinity;
    let lenMax = -Infinity;
    for (let i = 0; i < n; i++) {
        const x = point(i)[0];
        if (x < lenMin) lenMin = x;
        if (x > lenMax) lenMax = x;
    }
    const length = Math.max(1e-6, lenMax - lenMin);
    const medial = medialWidthSignForSide(side);

    let heelMin = Infinity;
    let foreMin = Infinity;
    let archZ = -Infinity;
    let archN = 0;
    for (let i = 0; i < n; i++) {
        const [x, y, z] = point(i);
        const u = (x - lenMin) / length;
        if (u <= HEEL_U_MAX && z < heelMin) heelMin = z;
        if (u >= FORE_U_MIN && z < foreMin) foreMin = z;
        if (u < ARCH_U_MIN || u > ARCH_U_MAX) continue;
        if (y * medial <= 0) continue;
        archN++;
        if (z > archZ) archZ = z;
    }
    if (!Number.isFinite(heelMin) || !Number.isFinite(foreMin) || archN < 4 || !Number.isFinite(archZ)) {
        return null;
    }
    const floor = (heelMin + foreMin) / 2;
    const rawHeight = archZ - floor;
    return { heightMm: rawHeight * scale, rawHeight };
}
