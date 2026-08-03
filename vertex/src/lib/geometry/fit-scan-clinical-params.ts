// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Clinical parametric fits from registered scan landmarks / geometry.
 *
 * - Arch: optional ARCH apex marker → absolute height vs stock apex → additive archHeightMm
 * - Heel cup width: scan heel width + clearance → heelCupWidthMm widen parameter
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

const HEEL_U_MAX = 1 / 3;
const ARCH_U_BAND = 0.12;

export type ArchMarkerFitResult = {
    archHeightMm: number;
    apexMoveMm: number;
    /** Absolute scan arch height above heel seat (mm). */
    scanArchHeightMm: number;
    /** Stock / reference absolute apex height used (mm). */
    stockArchHeightMm: number;
    apexU: number;
    clamped: boolean;
};

export type HeelCupWidthFitResult = {
    heelCupWidthMm: number;
    scanHeelWidthMm: number;
    baseHeelWidthMm: number;
    targetCupWidthMm: number;
    /** True when target was wider than max widen scale allows. */
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
 * Absolute scan arch height = marker Z − heel seat Z (M3). Additive raise is
 * that height minus the stock GLB apex height (~23.5 mm). Negative extras clamp to 0.
 */
export function fitArchParamsFromApexMarker(args: {
    archPointBase: THREE.Vector3;
    heelSeatBase: THREE.Vector3;
    lengthMm: number;
    lengthMin?: number;
    lengthSize?: number;
    stockArchHeightMm?: number;
}): ArchMarkerFitResult {
    const stockArchHeightMm = args.stockArchHeightMm ?? DEFAULT_STOCK_ARCH_APEX_HEIGHT_MM;
    const lengthMin = args.lengthMin ?? 0;
    const lengthSize = Math.max(1e-6, args.lengthSize ?? args.lengthMm);
    const scanArchHeightMm = args.archPointBase.z - args.heelSeatBase.z;
    const heightRaw = scanArchHeightMm - stockArchHeightMm;
    const apexU = Math.max(0, Math.min(1, (args.archPointBase.x - lengthMin) / lengthSize));
    const apexMoveRaw = (apexU - ARCH_DEFAULT_APEX_U) * args.lengthMm;
    const { archHeightMm, apexMoveMm, clamped } = clampArchParams(heightRaw, apexMoveRaw);
    return {
        archHeightMm,
        apexMoveMm,
        scanArchHeightMm,
        stockArchHeightMm,
        apexU,
        clamped,
    };
}

/** Width of plantar samples in the heel third (base frame, mm). */
export function measureHeelWidthMm(
    positions: ArrayLike<number>,
    vertexCount: number,
    scanToBase: THREE.Matrix4,
    lengthMin: number,
    lengthSize: number,
): number | null {
    const ys: number[] = [];
    const tmp = new THREE.Vector3();
    const cell = 3;
    const bins = new Map<string, { x: number; y: number; z: number }>();
    for (let i = 0; i < vertexCount; i++) {
        tmp.set(positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!).applyMatrix4(scanToBase);
        const u = (tmp.x - lengthMin) / Math.max(1e-6, lengthSize);
        if (u < 0 || u > HEEL_U_MAX) continue;
        const key = `${Math.floor(tmp.x / cell)},${Math.floor(tmp.y / cell)}`;
        const prev = bins.get(key);
        if (!prev || tmp.z < prev.z) bins.set(key, { x: tmp.x, y: tmp.y, z: tmp.z });
    }
    for (const p of bins.values()) ys.push(p.y);
    if (ys.length < 8) return null;
    ys.sort((a, b) => a - b);
    // Trim 5% tails for soft-tissue fluff.
    const lo = ys[Math.floor(ys.length * 0.05)]!;
    const hi = ys[Math.min(ys.length - 1, Math.floor(ys.length * 0.95))]!;
    const w = hi - lo;
    return w > 1e-3 ? w : null;
}

/** Heel-third width from top positions already in footprint mm. */
export function measureHeelWidthFromTopPositions(
    positions: ArrayLike<number>,
    vertexCount: number,
    lengthMin: number,
    lengthSize: number,
): number | null {
    return measureHeelWidthMm(positions, vertexCount, new THREE.Matrix4().identity(), lengthMin, lengthSize);
}

/** Heel-third width of a base top surface (already in footprint mm). */
export function measureBaseHeelWidthMm(
    geometry: BufferGeometry,
    lengthMin: number,
    lengthSize: number,
): number | null {
    const pos = geometry.getAttribute("position");
    if (!pos || pos.count < 8) return null;
    const ud = geometry.userData as { topVertexCount?: number };
    const topN =
        typeof ud.topVertexCount === "number" && ud.topVertexCount > 0 ? ud.topVertexCount : pos.count;
    return measureHeelWidthFromTopPositions(pos.array as ArrayLike<number>, topN, lengthMin, lengthSize);
}

/**
 * Convert desired absolute cup width into heelCupWidthMm (0–10 widen param).
 * Param only widens; if scan+clearance ≤ base width → 0.
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
    if (scale <= 1) {
        return {
            heelCupWidthMm: 0,
            scanHeelWidthMm: args.scanHeelWidthMm,
            baseHeelWidthMm: args.baseHeelWidthMm,
            targetCupWidthMm,
            clamped: false,
        };
    }
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

/** Measure stock absolute arch apex height from top positions (medial midfoot max Z − heel Z). */
export function measureStockArchApexHeightFromPositions(
    positions: ArrayLike<number>,
    vertexCount: number,
    lengthMin: number,
    lengthSize: number,
    medialSign: number,
): number | null {
    let heelN = 0;
    let heelSum = 0;
    let archZ = -Infinity;
    for (let i = 0; i < vertexCount; i++) {
        const x = positions[i * 3]!;
        const y = positions[i * 3 + 1]!;
        const z = positions[i * 3 + 2]!;
        const u = (x - lengthMin) / Math.max(1e-6, lengthSize);
        if (u >= 0 && u <= HEEL_U_MAX) {
            heelSum += z;
            heelN++;
        }
        if (Math.abs(u - ARCH_DEFAULT_APEX_U) <= ARCH_U_BAND && y * medialSign > 0) {
            if (z > archZ) archZ = z;
        }
    }
    if (heelN < 4 || !Number.isFinite(archZ)) return null;
    const heelRef = heelSum / heelN;
    const h = archZ - heelRef;
    return h > 1 && h < 80 ? h : null;
}

/** Measure stock absolute arch apex height from base top (medial midfoot max Z − heel Z). */
export function measureStockArchApexHeightMm(
    geometry: BufferGeometry,
    lengthMin: number,
    lengthSize: number,
    medialSign: number,
): number | null {
    const pos = geometry.getAttribute("position");
    if (!pos || pos.count < 8) return null;
    const ud = geometry.userData as { topVertexCount?: number };
    const topN =
        typeof ud.topVertexCount === "number" && ud.topVertexCount > 0 ? ud.topVertexCount : pos.count;
    return measureStockArchApexHeightFromPositions(
        pos.array as ArrayLike<number>,
        topN,
        lengthMin,
        lengthSize,
        medialSign,
    );
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
    return `Arch ${fit.archHeightMm.toFixed(1)} mm · apex ${apex} mm (scan ${fit.scanArchHeightMm.toFixed(1)} − stock ${fit.stockArchHeightMm.toFixed(1)}${fit.clamped ? ", clamped" : ""})`;
}

export function formatHeelCupFitMessage(fit: HeelCupWidthFitResult): string {
    return `Heel cup width ${fit.heelCupWidthMm.toFixed(1)} (scan ${fit.scanHeelWidthMm.toFixed(0)} + ${HEEL_CUP_WIDTH_CLEARANCE_MM} → ${fit.targetCupWidthMm.toFixed(0)} mm vs base ${fit.baseHeelWidthMm.toFixed(0)}${fit.clamped ? ", clamped" : ""})`;
}
