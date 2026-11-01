// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { detectContentBoundsFromRgba } from "@/lib/pressure-map/content-bounds";
import { analyzeFromRgba } from "@/lib/pressure-map/orientation";
import type { PressureMapFoot, Side } from "@/types";

/** Medial ink sample (not the arch notch void). */
export const SYNTHETIC_MEDIAL_INK_UV: Record<Side, { u: number; v: number }> = {
    left: { u: 0.58, v: 0.44 },
    right: { u: 0.42, v: 0.44 },
};

/**
 * Asymmetric plantar pressure silhouette: forefoot flare at top, medial arch waist on
 * the anatomically correct image side (left foot → medial on +U).
 */
export function paintAsymmetricFootImage(anatomicalSide: Side, width = 240, height = 400): Uint8ClampedArray {
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < rgba.length; i += 4) {
        rgba[i] = 255;
        rgba[i + 1] = 255;
        rgba[i + 2] = 255;
        rgba[i + 3] = 255;
    }
    const medialSign = anatomicalSide === "left" ? 1 : -1;
    for (let y = 0; y < height; y++) {
        const v = y / height;
        const fore = 1 - v;
        const halfW = (0.22 + 0.2 * fore * fore) * width;
        for (let x = 0; x < width; x++) {
            const u = x / width;
            const du = (u - 0.5) * width;
            if (Math.abs(du) > halfW) continue;
            if (v > 0.38 && v < 0.55) {
                if (anatomicalSide === "left" && u > 0.54 && u < 0.88) continue;
                if (anatomicalSide === "right" && u > 0.12 && u < 0.46) continue;
            }
            const i = (y * width + x) * 4;
            const t = fore;
            rgba[i] = Math.floor(40 + 180 * t);
            rgba[i + 1] = Math.floor(30 + 40 * (1 - t));
            rgba[i + 2] = Math.floor(200 * (1 - t));
            rgba[i + 3] = 255;
        }
    }
    return rgba;
}

export function syntheticAsymmetricPressureFoot(
    anatomicalSide: Side,
    assignToSide: Side,
    width = 240,
    height = 400,
): PressureMapFoot {
    const rgba = paintAsymmetricFootImage(anatomicalSide, width, height);
    const bounds = detectContentBoundsFromRgba(width, height, rgba);
    const orientation = analyzeFromRgba(rgba, width, height, assignToSide);
    return {
        imageDataUrl: `synthetic://${anatomicalSide}-${assignToSide}`,
        mimeType: "image/png",
        visible: true,
        imageWidth: width,
        imageHeight: height,
        contentBounds: bounds,
        alignment: { offsetMm: { x: 0, y: 0 }, scale: 1, rotationDeg: 0 },
        orientation,
        fileName: `${anatomicalSide}-foot-on-${assignToSide}.png`,
    };
}

/** Attach raw RGBA for preview software renders (not persisted). */
export function withSyntheticRgba(
    foot: PressureMapFoot,
    rgba: Uint8ClampedArray,
): PressureMapFoot & {
    rgba: Uint8ClampedArray;
} {
    return { ...foot, rgba };
}
