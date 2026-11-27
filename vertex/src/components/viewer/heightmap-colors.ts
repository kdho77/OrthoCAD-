// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import * as THREE from "three";

export type HeightmapZRange = { minZ: number; maxZ: number };

export function zRangeFromPositions(geometry: THREE.BufferGeometry): HeightmapZRange {
    const pos = geometry.getAttribute("position");
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < pos.count; i++) {
        const z = pos.getZ(i);
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
    }
    return { minZ, maxZ };
}

export function extendZRange(range: HeightmapZRange, geometry: THREE.BufferGeometry): HeightmapZRange {
    const pos = geometry.getAttribute("position");
    let maxZ = range.maxZ;
    for (let i = 0; i < pos.count; i++) {
        const z = pos.getZ(i);
        if (z > maxZ) maxZ = z;
    }
    return maxZ === range.maxZ ? range : { minZ: range.minZ, maxZ };
}

export function applyHeightmapColors(
    geometry: THREE.BufferGeometry,
    colors: THREE.BufferAttribute,
    zRange?: HeightmapZRange,
): void {
    const pos = geometry.getAttribute("position");
    const color = new THREE.Color();
    let minZ: number;
    let maxZ: number;
    if (zRange) {
        minZ = zRange.minZ;
        maxZ = zRange.maxZ;
    } else {
        const local = zRangeFromPositions(geometry);
        minZ = local.minZ;
        maxZ = local.maxZ;
    }
    const span = Math.max(1e-6, maxZ - minZ);
    for (let i = 0; i < pos.count; i++) {
        const t = Math.min(1, Math.max(0, (pos.getZ(i) - minZ) / span));
        color.setHSL(0.66 - 0.66 * t, 0.85, 0.5);
        colors.setXYZ(i, color.r, color.g, color.b);
    }
    colors.needsUpdate = true;
    geometry.setAttribute("color", colors);
}
