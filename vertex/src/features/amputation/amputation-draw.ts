// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { Side } from "@/types";

/**
 * High-contrast cut on the white top sheet. Not the yellow trimline handles
 * and not the bottom-pattern stroke.
 */
export const AMPUTATION_CUT_COLOR = "#e11d48";
export const AMPUTATION_CUT_HALO = "#ffffff";

export interface FootBounds {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
}

/** Parametric sheet before a live mesh bbox is known. Heel at x = 0. */
export function layoutFootBounds(lengthMm: number, widthMm: number): FootBounds {
    const half = Math.max(1, widthMm) / 2;
    return { minX: 0, maxX: Math.max(1, lengthMm), minY: -half, maxY: half, minZ: 0, maxZ: 4 };
}

export interface MeshHit {
    x: number;
    y: number;
}

/**
 * Mesh-local hit → mirror-safe cut frame.
 * x is millimetres from the heel toward the toe.
 * y is millimetres from the midline, medial positive, on both feet.
 * Nothing is invented: the hit is the only input.
 */
export function amputationPointFromMesh(
    localX: number,
    localY: number,
    side: Side,
    lengthMm: number,
    widthMm: number,
    bounds: FootBounds,
): MeshHit {
    const lenSize = Math.max(1e-3, bounds.maxX - bounds.minX);
    const u = Math.min(1, Math.max(0, (localX - bounds.minX) / lenSize));
    const halfW = Math.max(1e-3, (bounds.maxY - bounds.minY) * 0.5);
    const midY = (bounds.minY + bounds.maxY) * 0.5;
    const ySpan = localY - midY;
    const medial = side === "left" ? ySpan : -ySpan;
    const y = (medial / halfW) * (Math.max(1e-3, widthMm) / 2);
    return { x: u * Math.max(0, lengthMm), y };
}

/** Inverse of `amputationPointFromMesh` so a panel click lands on the sheet. */
export function meshPointFromAmputation(
    x: number,
    y: number,
    side: Side,
    lengthMm: number,
    widthMm: number,
    bounds: FootBounds,
): MeshHit {
    const lenSize = Math.max(1e-3, bounds.maxX - bounds.minX);
    const u = Math.max(0, lengthMm) > 1e-6 ? x / lengthMm : 0;
    const mx = bounds.minX + u * lenSize;
    const halfW = Math.max(1e-3, (bounds.maxY - bounds.minY) * 0.5);
    const midY = (bounds.minY + bounds.maxY) * 0.5;
    const halfWidth = Math.max(1e-3, widthMm) / 2;
    const medialMm = (y / halfWidth) * halfW;
    const my = midY + (side === "left" ? medialMm : -medialMm);
    return { x: mx, y: my };
}

export interface StrokeSource {
    x: number;
    y: number;
    /** Mesh-local hit. Present for clicks on the sheet, absent for the panel canvas. */
    localX?: number;
    localY?: number;
}

/**
 * Polyline to draw. Empty when the user has not placed a point.
 * No sample, default, or bottom-pattern stand-in.
 */
export function strokeLocals(
    points: readonly StrokeSource[],
    side: Side,
    lengthMm: number,
    widthMm: number,
    bounds: FootBounds,
): MeshHit[] {
    const out: MeshHit[] = [];
    for (const p of points) {
        if (Number.isFinite(p.localX) && Number.isFinite(p.localY)) {
            out.push({ x: p.localX as number, y: p.localY as number });
            continue;
        }
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        out.push(meshPointFromAmputation(p.x, p.y, side, lengthMm, widthMm, bounds));
    }
    return out;
}
