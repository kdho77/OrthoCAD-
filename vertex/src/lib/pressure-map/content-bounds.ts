// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { PressureMapContentBounds } from "@/types";

const BG_LUM = 248;
const ALPHA_FLOOR = 12;

/**
 * Zero alpha on near-white or uniform light background.
 * Saturated ink (jet colormap blues through reds) stays opaque.
 */
export function keyNearWhiteBackground(rgba: Uint8ClampedArray): void {
    for (let i = 0; i < rgba.length; i += 4) {
        const r = rgba[i] ?? 0;
        const g = rgba[i + 1] ?? 0;
        const b = rgba[i + 2] ?? 0;
        const lum = (r + g + b) / 3;
        const chroma = Math.max(r, g, b) - Math.min(r, g, b);
        if (lum >= BG_LUM || (lum >= 236 && chroma <= 14)) rgba[i + 3] = 0;
    }
}

/**
 * Detect the tight bounding box of visible pressure content, ignoring white margins
 * and transparent padding. Returns normalized UV bounds in [0, 1].
 */
export function detectContentBoundsFromImageData(data: ImageData): PressureMapContentBounds {
    const { width, height, data: px } = data;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const a = px[i + 3]!;
            const r = px[i]!;
            const g = px[i + 1]!;
            const b = px[i + 2]!;
            const lum = (r + g + b) / 3;
            const ink = a > ALPHA_FLOOR && lum < BG_LUM;
            if (!ink) continue;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }
    }
    if (maxX < minX || maxY < minY) {
        return { minU: 0, minV: 0, maxU: 1, maxV: 1 };
    }
    const pad = 0.002;
    const minU = Math.max(0, minX / width - pad);
    const minV = Math.max(0, minY / height - pad);
    const maxU = Math.min(1, (maxX + 1) / width + pad);
    const maxV = Math.min(1, (maxY + 1) / height + pad);
    return { minU, minV, maxU, maxV };
}

export function detectContentBoundsFromRgba(
    width: number,
    height: number,
    rgba: Uint8ClampedArray,
): PressureMapContentBounds {
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const a = rgba[i + 3]!;
            const r = rgba[i]!;
            const g = rgba[i + 1]!;
            const b = rgba[i + 2]!;
            const lum = (r + g + b) / 3;
            const ink = a > ALPHA_FLOOR && lum < BG_LUM;
            if (!ink) continue;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }
    }
    if (maxX < minX || maxY < minY) {
        return { minU: 0, minV: 0, maxU: 1, maxV: 1 };
    }
    const pad = 0.002;
    return {
        minU: Math.max(0, minX / width - pad),
        minV: Math.max(0, minY / height - pad),
        maxU: Math.min(1, (maxX + 1) / width + pad),
        maxV: Math.min(1, (maxY + 1) / height + pad),
    };
}
