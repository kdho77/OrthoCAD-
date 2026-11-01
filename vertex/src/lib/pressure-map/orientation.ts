// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { PressureImageOrientation, PressureMapContentBounds, Side } from "@/types";
import { detectContentBoundsFromRgba } from "./content-bounds";

/** Persisted result of content-based foot detection at import. */
export type { PressureImageOrientation } from "@/types";

const INK = (r: number, g: number, b: number, a: number) => a > 12 && (r + g + b) / 3 < 248;

function inkAt(rgba: Uint8ClampedArray, w: number, x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= w) return false;
    const i = (y * w + x) * 4;
    return INK(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!, rgba[i + 3]!);
}

function bandWidthProfile(
    rgba: Uint8ClampedArray,
    w: number,
    h: number,
    y0: number,
    y1: number,
): { minX: number; maxX: number } {
    let minX = w;
    let maxX = -1;
    for (let y = y0; y < y1; y++) {
        for (let x = 0; x < w; x++) {
            if (!inkAt(rgba, w, x, y)) continue;
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
        }
    }
    if (maxX < minX) return { minX: 0, maxX: w - 1 };
    return { minX, maxX };
}

/** Narrower lateral half at midfoot ⇒ medial is on +U (left foot, toe-up). */
function midfootMedialOnHighU(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    bounds: PressureMapContentBounds,
): boolean {
    const x0 = Math.floor(bounds.minU * width);
    const x1 = Math.ceil(bounds.maxU * width);
    const y0 = Math.floor(bounds.minV * height);
    const y1 = Math.ceil(bounds.maxV * height);
    const ch = Math.max(1, y1 - y0);
    const midY0 = y0 + Math.floor(ch * 0.38);
    const midY1 = y0 + Math.floor(ch * 0.58);
    const cx = (x0 + x1) / 2;
    let highSpan = 0;
    let lowSpan = 0;
    let rows = 0;
    for (let y = midY0; y < midY1; y++) {
        let minHi = width;
        let maxHi = -1;
        let minLo = width;
        let maxLo = -1;
        for (let x = x0; x < x1; x++) {
            if (!inkAt(rgba, width, x, y)) continue;
            if (x >= cx) {
                minHi = Math.min(minHi, x);
                maxHi = Math.max(maxHi, x);
            } else {
                minLo = Math.min(minLo, x);
                maxLo = Math.max(maxLo, x);
            }
        }
        if (maxHi >= minHi && maxLo >= minLo) {
            highSpan += maxHi - minHi;
            lowSpan += maxLo - minLo;
            rows++;
        }
    }
    if (rows === 0) return true;
    return highSpan < lowSpan;
}

/**
 * Infer heel→toe axis and medial side from pressure ink (arch waist / forefoot flare).
 * Mirror only when detected anatomical side ≠ assigned slot.
 */
export function analyzePressureImageOrientation(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    bounds: PressureMapContentBounds,
    assignToSide: Side,
): PressureImageOrientation {
    const x0 = Math.floor(bounds.minU * width);
    const x1 = Math.ceil(bounds.maxU * width);
    const y0 = Math.floor(bounds.minV * height);
    const y1 = Math.ceil(bounds.maxV * height);
    const ch = Math.max(1, y1 - y0);
    const cw = Math.max(1, x1 - x0);

    const topBand = bandWidthProfile(rgba, width, height, y0, y0 + Math.max(1, Math.floor(ch * 0.28)));
    const botBand = bandWidthProfile(rgba, width, height, y1 - Math.max(1, Math.floor(ch * 0.28)), y1);
    const topSpan = topBand.maxX - topBand.minX;
    const botSpan = botBand.maxX - botBand.minX;

    const verticalLength = ch >= cw * 0.85;
    let autoRotationDeg: number;
    if (verticalLength) {
        const toeAtLowV = topSpan >= botSpan;
        autoRotationDeg = toeAtLowV ? -90 : 90;
    } else {
        const toeAtLowU = topSpan >= botSpan;
        autoRotationDeg = toeAtLowU ? 0 : 180;
    }

    const medialOnHighU = midfootMedialOnHighU(rgba, width, height, bounds);
    const detectedImageSide: Side = verticalLength
        ? medialOnHighU
            ? "left"
            : "right"
        : medialOnHighU
          ? "right"
          : "left";

    return {
        detectedImageSide,
        autoRotationDeg,
        oppositeFootMirror: detectedImageSide !== assignToSide,
    };
}

export function analyzeFromRgba(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    assignToSide: Side,
): PressureImageOrientation {
    const bounds = detectContentBoundsFromRgba(width, height, rgba);
    return analyzePressureImageOrientation(rgba, width, height, bounds, assignToSide);
}
