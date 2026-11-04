// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { BufferGeometry } from "three";
import { PLANTAR_Z_MAX_MM, rimConformityHeightWeight, WALL_TOP_MIN_Z_MM } from "@/lib/geometry/base-modifier";

export const INSOLE_THICKNESS_MIN_MM = 0;
export const INSOLE_THICKNESS_MAX_MM = 10;
export const INSOLE_THICKNESS_STEP_MM = 0.5;
/** Default for newly created in-editor designs (not persisted until save). */
export const DEFAULT_INSOLE_THICKNESS_MM = 2;

/** Legacy designs and server rows without the field resolve to zero offset. */
export function resolveInsoleThicknessOffsetMm(value: number | null | undefined): number {
    if (value == null || !Number.isFinite(value)) return 0;
    return quantizeInsoleThicknessMm(value);
}

export function quantizeInsoleThicknessMm(value: number): number {
    if (!Number.isFinite(value)) return INSOLE_THICKNESS_MIN_MM;
    const clamped = Math.min(INSOLE_THICKNESS_MAX_MM, Math.max(INSOLE_THICKNESS_MIN_MM, value));
    return Math.round(clamped / INSOLE_THICKNESS_STEP_MM) * INSOLE_THICKNESS_STEP_MM;
}

export interface InsoleThicknessWallFrame {
    bottomIndices: number[];
    thicknessHz: Float64Array;
}

/** Bottom-mesh wall verts that inherit a smooth fraction of the rigid top lift. */
export function insoleThicknessWallFrame(
    base: BufferGeometry,
    topVertexCount: number,
    thickAxis: number,
): InsoleThicknessWallFrame | null {
    if (topVertexCount <= 0) return null;
    const pos = base.getAttribute("position");
    if (!pos) return null;
    const arr = pos.array as Float32Array;
    const count = pos.count;
    const bottomIndices: number[] = [];
    const hz: number[] = [];
    for (let i = topVertexCount; i < count; i++) {
        const baseZ = arr[i * 3 + thickAxis]!;
        if (baseZ <= PLANTAR_Z_MAX_MM) continue;
        bottomIndices.push(i);
        hz.push(Math.min(1, (baseZ - PLANTAR_Z_MAX_MM) / (WALL_TOP_MIN_Z_MM - PLANTAR_Z_MAX_MM)));
    }
    if (bottomIndices.length === 0) return null;
    return { bottomIndices, thicknessHz: Float64Array.from(hz) };
}

/**
 * Uniform plantar-normal lift of the top sheet (surface + rim). Bottom plantar
 * band stays fixed; side walls stretch via the same height ramp as shell lift.
 */
export function applyInsoleThicknessRigidOffset(input: {
    positions: Float32Array;
    topVertexCount: number;
    thickAxis: number;
    offsetMm: number;
    wallFrame?: InsoleThicknessWallFrame | null;
}): void {
    const offsetMm = resolveInsoleThicknessOffsetMm(input.offsetMm);
    if (offsetMm <= 1e-9) return;
    const { positions, topVertexCount, thickAxis, wallFrame } = input;
    for (let i = 0; i < topVertexCount; i++) {
        positions[i * 3 + thickAxis]! += offsetMm;
    }
    if (!wallFrame) return;
    for (let s = 0; s < wallFrame.bottomIndices.length; s++) {
        const i = wallFrame.bottomIndices[s]!;
        const w = rimConformityHeightWeight(wallFrame.thicknessHz[s]!);
        if (w <= 1e-9) continue;
        positions[i * 3 + thickAxis]! += offsetMm * w;
    }
}
