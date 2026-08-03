// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Clinical parametric fits from registered scan landmarks / geometry.
 *
 * - Arch: optional ARCH apex marker → raise = gap above stock base surface at that XY
 * - Heel cup width: scan heel width + clearance → signed heelCupWidthMm (± widen/narrow)
 */

import type { BufferGeometry } from "three";
import * as THREE from "three";
import { CLINICAL_LIMITS } from "@/lib/geometry/clinical-constraints";
import { ARCH_DEFAULT_APEX_U } from "@/lib/geometry/fit-arch-from-scan";
import { HEEL_CUP_WIDTH_MAX_LATERAL_SCALE } from "@/lib/geometry/height-field";
import type { SideCorrections } from "@/types";

/** Nominal absolute arch apex height of the default stock GLB (plantar → apex), mm. */
export const DEFAULT_STOCK_ARCH_APEX_HEIGHT_MM = 23.5;

/** Heel cup target = scan heel width + this clearance (mm). */
export const HEEL_CUP_WIDTH_CLEARANCE_MM = 5;

/** Heel band along length for width measure (slightly past classic heel third). */
const HEEL_U_MAX = 0.38;
/** Half-width of the longitudinal band around M3 used for heel width (u units). */
const HEEL_MARKER_U_HALF = 0.08;

export type ArchMarkerFitResult = {
    archHeightMm: number;
    apexMoveMm: number;
    /** Gap of ARCH marker above stock base surface at the same XY (mm). */
    gapMm: number;
    /** Absolute scan arch height above heel seat when heel is available (mm). */
    scanArchHeightMm: number;
    /** Stock / reference absolute apex height used for messaging (mm). */
    stockArchHeightMm: number;
    baseSurfaceZ: number;
    apexU: number;
    clamped: boolean;
};

export type HeelCupWidthFitResult = {
    heelCupWidthMm: number;
    scanHeelWidthMm: number;
    baseHeelWidthMm: number;
    targetCupWidthMm: number;
    /** True when target exceeded ± max lateral scale. */
    clamped: boolean;
};

function clampArchParams(
    height: number,
    apex: number,
): { archHeightMm: number; apexMoveMm: number; clamped: boolean } {
    const hLim = CLINICAL_LIMITS.archHeightMm;
    const aLim = CLINICAL_LIMITS.apexMoveMm;
    const heightRounded = Math.round(height * 10) / 10;
    const apexRounded = Math.round(apex * 10) / 10;
    const archHeightMm = Math.max(hLim.min, Math.min(hLim.max, heightRounded));
    const apexMoveMm = Math.max(aLim.min, Math.min(aLim.max, apexRounded));
    return {
        archHeightMm,
        apexMoveMm,
        clamped: archHeightMm !== heightRounded || apexMoveMm !== apexRounded,
    };
}

/**
 * Fit additive archHeightMm + apexMoveMm from an ARCH apex marker in base space.
 *
 * Raise is the gap of the marker above the stock base top at the same XY
 * (what the shell must grow to meet the marker). Absolute scan−stock is kept
 * for messaging only.
 */
export function fitArchParamsFromApexMarker(args: {
    archPointBase: THREE.Vector3;
    /** Stock base top Z at the arch marker XY (same frame as archPointBase). */
    baseSurfaceZ: number;
    lengthMm: number;
    lengthMin?: number;
    lengthSize?: number;
    heelSeatBase?: THREE.Vector3 | null;
    /** Optional tissue clearance subtracted from the gap (default 0 for a placed marker). */
    clearanceMm?: number;
    stockArchHeightMm?: number;
}): ArchMarkerFitResult {
    const stockArchHeightMm = args.stockArchHeightMm ?? DEFAULT_STOCK_ARCH_APEX_HEIGHT_MM;
    const lengthMin = args.lengthMin ?? 0;
    const lengthSize = Math.max(1e-6, args.lengthSize ?? args.lengthMm);
    const clearanceMm = Math.max(0, args.clearanceMm ?? 0);
    const gapMm = args.archPointBase.z - args.baseSurfaceZ;
    const heightRaw = gapMm - clearanceMm;
    const scanArchHeightMm = args.heelSeatBase
        ? args.archPointBase.z - args.heelSeatBase.z
        : gapMm + stockArchHeightMm;
    const apexU = Math.max(0, Math.min(1, (args.archPointBase.x - lengthMin) / lengthSize));
    const apexMoveRaw = (apexU - ARCH_DEFAULT_APEX_U) * args.lengthMm;
    const { archHeightMm, apexMoveMm, clamped } = clampArchParams(heightRaw, apexMoveRaw);
    return {
        archHeightMm,
        apexMoveMm,
        gapMm,
        scanArchHeightMm,
        stockArchHeightMm,
        baseSurfaceZ: args.baseSurfaceZ,
        apexU,
        clamped,
    };
}

type PlantarBin = { x: number; y: number; z: number };

function collectPlantarBins(
    positions: ArrayLike<number>,
    vertexCount: number,
    scanToBase: THREE.Matrix4,
    uMin: number,
    uMax: number,
    lengthMin: number,
    lengthSize: number,
    cell = 3,
): PlantarBin[] {
    const bins = new Map<string, PlantarBin>();
    const tmp = new THREE.Vector3();
    for (let i = 0; i < vertexCount; i++) {
        tmp.set(positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!).applyMatrix4(scanToBase);
        const u = (tmp.x - lengthMin) / Math.max(1e-6, lengthSize);
        if (u < uMin || u > uMax) continue;
        const key = `${Math.floor(tmp.x / cell)},${Math.floor(tmp.y / cell)}`;
        const prev = bins.get(key);
        if (!prev || tmp.z < prev.z) bins.set(key, { x: tmp.x, y: tmp.y, z: tmp.z });
    }
    return [...bins.values()];
}

function widthFromYs(ys: number[]): number | null {
    if (ys.length < 4) return null;
    ys.sort((a, b) => a - b);
    const lo = ys[Math.floor(ys.length * 0.05)]!;
    const hi = ys[Math.min(ys.length - 1, Math.floor(ys.length * 0.95))]!;
    const w = hi - lo;
    return w > 1e-3 ? w : null;
}

/** Width of plantar samples in the heel band (base frame, mm). */
export function measureHeelWidthMm(
    positions: ArrayLike<number>,
    vertexCount: number,
    scanToBase: THREE.Matrix4,
    lengthMin: number,
    lengthSize: number,
    /** Optional heel-seat X in base space — narrows the longitudinal band around M3. */
    heelSeatX?: number | null,
): number | null {
    let uMin = 0;
    let uMax = HEEL_U_MAX;
    if (heelSeatX != null && Number.isFinite(heelSeatX)) {
        const uHeel = (heelSeatX - lengthMin) / Math.max(1e-6, lengthSize);
        uMin = Math.max(0, uHeel - HEEL_MARKER_U_HALF);
        uMax = Math.min(HEEL_U_MAX, uHeel + HEEL_MARKER_U_HALF);
        if (uMax <= uMin) {
            uMin = 0;
            uMax = HEEL_U_MAX;
        }
    }
    const bins = collectPlantarBins(positions, vertexCount, scanToBase, uMin, uMax, lengthMin, lengthSize);
    return widthFromYs(bins.map((p) => p.y));
}

/** Heel-band width from top positions already in footprint mm. */
export function measureHeelWidthFromTopPositions(
    positions: ArrayLike<number>,
    vertexCount: number,
    lengthMin: number,
    lengthSize: number,
    heelSeatX?: number | null,
): number | null {
    return measureHeelWidthMm(
        positions,
        vertexCount,
        new THREE.Matrix4().identity(),
        lengthMin,
        lengthSize,
        heelSeatX,
    );
}

/** Heel-band width of a base top surface (already in footprint mm). */
export function measureBaseHeelWidthMm(
    geometry: BufferGeometry,
    lengthMin: number,
    lengthSize: number,
    heelSeatX?: number | null,
): number | null {
    const pos = geometry.getAttribute("position");
    if (!pos || pos.count < 8) return null;
    const ud = geometry.userData as { topVertexCount?: number };
    const topN =
        typeof ud.topVertexCount === "number" && ud.topVertexCount > 0 ? ud.topVertexCount : pos.count;
    return measureHeelWidthFromTopPositions(
        pos.array as ArrayLike<number>,
        topN,
        lengthMin,
        lengthSize,
        heelSeatX,
    );
}

/**
 * Convert desired absolute cup width into signed heelCupWidthMm (−10…+10).
 * Positive widens; negative narrows relative to the stock base heel width.
 */
export function heelCupWidthParamForTarget(args: {
    scanHeelWidthMm: number;
    baseHeelWidthMm: number;
    clearanceMm?: number;
}): HeelCupWidthFitResult {
    const clearanceMm = args.clearanceMm ?? HEEL_CUP_WIDTH_CLEARANCE_MM;
    const targetCupWidthMm = args.scanHeelWidthMm + clearanceMm;
    const base = Math.max(1e-3, args.baseHeelWidthMm);
    const scale = targetCupWidthMm / base;
    const wLim = CLINICAL_LIMITS.heelCupWidthMm;
    const rawParam = ((scale - 1) / HEEL_CUP_WIDTH_MAX_LATERAL_SCALE) * 10;
    const rounded = Math.round(rawParam * 10) / 10;
    const heelCupWidthMm = Math.max(wLim.min, Math.min(wLim.max, rounded));
    return {
        heelCupWidthMm,
        scanHeelWidthMm: args.scanHeelWidthMm,
        baseHeelWidthMm: args.baseHeelWidthMm,
        targetCupWidthMm,
        clamped: heelCupWidthMm !== rounded,
    };
}

export function archMarkerFitToCorrectionPatch(fit: ArchMarkerFitResult): Partial<SideCorrections> {
    return {
        archHeightMm: fit.archHeightMm,
        apexMoveMm: fit.apexMoveMm,
        archFillMm: 0,
    };
}

export function formatArchMarkerFitMessage(fit: ArchMarkerFitResult): string {
    const apex = `${fit.apexMoveMm >= 0 ? "+" : ""}${fit.apexMoveMm.toFixed(1)}`;
    return `Arch ${fit.archHeightMm.toFixed(1)} mm · apex ${apex} mm (gap ${fit.gapMm.toFixed(1)} mm above base${fit.clamped ? ", clamped" : ""})`;
}

export function formatHeelCupFitMessage(fit: HeelCupWidthFitResult): string {
    const sign = fit.heelCupWidthMm >= 0 ? "+" : "";
    return `Heel cup ${sign}${fit.heelCupWidthMm.toFixed(1)} (scan ${fit.scanHeelWidthMm.toFixed(0)} + ${HEEL_CUP_WIDTH_CLEARANCE_MM} → ${fit.targetCupWidthMm.toFixed(0)} mm vs base ${fit.baseHeelWidthMm.toFixed(0)}${fit.clamped ? ", clamped" : ""})`;
}
