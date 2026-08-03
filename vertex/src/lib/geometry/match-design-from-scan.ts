// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Orchestrator helpers: suggest shoe size from scan length, then fit parametric
 * arch height + apex from the registered medial plantar gap.
 *
 * Size and arch are separate clinical parameters. Registration stays rigid;
 * footprint scale lives only in design layout. When a non-default size is
 * selected, Kabsch targets must be the sized B1/B2/B3 (same XY map as
 * scaleGeometryToInsoleSize).
 */

import type * as THREE from "three";
import type { BufferGeometry, Matrix4 } from "three";
import {
    ARCH_FIT_CLEARANCE_MM,
    ArchFitError,
    type ArchFitReference,
    type ArchFitResult,
    archFitReferenceFromBase,
    archFitToCorrectionPatch,
    fitArchParamsFromScan,
    sampleArchFitReferenceAt,
} from "@/lib/geometry/fit-arch-from-scan";
import {
    type ArchMarkerFitResult,
    archMarkerFitToCorrectionPatch,
    DEFAULT_STOCK_ARCH_APEX_HEIGHT_MM,
    fitArchParamsFromApexMarker,
    formatArchMarkerFitMessage,
    formatHeelCupFitMessage,
    type HeelCupWidthFitResult,
    heelCupWidthParamForTarget,
    measureHeelWidthFromTopPositions,
    measureHeelWidthMm,
} from "@/lib/geometry/fit-scan-clinical-params";
import {
    formatSizeSuggestionLabel,
    measureBallWidthMm,
    measureFootLengthFromGeometry,
    type SizeSuggestion,
    suggestShoeSizeFromScan,
} from "@/lib/geometry/measure-foot-from-scan";
import type { DominantAxis } from "@/lib/geometry/scan-display";
import {
    DEFAULT_US_MEN_SIZE,
    footprintScaleFromNativeGeometry,
    type InsoleLayout,
    insoleLayoutFromDesign,
    type ShoeSizeSystem,
    type ShoeSizingDesign,
} from "@/lib/geometry/shoe-size";
import type { Side, SideCorrections } from "@/types";

/**
 * Soft warning threshold for marker residual (mm). Kabsch returns RMS for
 * display — clinical suggested markers often land 10–30 mm and are still
 * heel-seated; do not hard-block arch fit at this level.
 */
export const ARCH_MATCH_WARN_RMS_MM = 8;
/** Refuse only absurd residuals (likely wrong units / marker set). */
export const ARCH_MATCH_BLOCK_RMS_MM = 60;
/** @deprecated Alias of ARCH_MATCH_WARN_RMS_MM. */
export const ARCH_MATCH_MAX_RMS_MM = ARCH_MATCH_WARN_RMS_MM;

export { ARCH_FIT_CLEARANCE_MM };

/** Build an arch-fit reference whose XY matches the sized insole. */
export function archFitReferenceFromBaseSized(
    geometry: BufferGeometry,
    lengthMm: number,
    widthMm: number,
): ArchFitReference {
    const scale = footprintScaleFromNativeGeometry(geometry, lengthMm, widthMm);
    if (!scale || (Math.abs(scale.sx - 1) < 1e-9 && Math.abs(scale.sy - 1) < 1e-9)) {
        return archFitReferenceFromBase(geometry);
    }
    const pos = geometry.getAttribute("position");
    if (!pos || pos.count < 3) {
        throw new ArchFitError("no_reference", "Base geometry has no positions");
    }
    const ud = geometry.userData as { topVertexCount?: number };
    const topN =
        typeof ud.topVertexCount === "number" && ud.topVertexCount > 0 ? ud.topVertexCount : pos.count;
    const src = pos.array as ArrayLike<number>;
    const scaled = new Float32Array(topN * 3);
    for (let i = 0; i < topN; i++) {
        const x = src[i * 3]!;
        const y = src[i * 3 + 1]!;
        const z = src[i * 3 + 2]!;
        scaled[i * 3] = (x - scale.x0) * scale.sx;
        scaled[i * 3 + 1] = (y - scale.yMid) * scale.sy;
        scaled[i * 3 + 2] = z;
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < topN; i++) {
        const x = scaled[i * 3]!;
        const y = scaled[i * 3 + 1]!;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    return {
        kind: "base",
        topPositions: scaled,
        topVertexCount: topN,
        lengthMin: minX,
        lengthSize: Math.max(1e-6, maxX - minX),
        widthCenter: (minY + maxY) / 2,
        widthHalf: Math.max(1e-6, (maxY - minY) / 2),
    };
}

export type ArchMatchGate =
    | { ok: true; warning?: string }
    | { ok: false; reason: string; code: "incomplete" | "error" | "rms" | "no_base" | "no_size" };

export function gateArchMatch(args: {
    residualRmsMm: number | null | undefined;
    incomplete: boolean;
    error: { code: string; message: string } | null | undefined;
    hasRawBase: boolean;
    sizeAccepted: boolean;
}): ArchMatchGate {
    if (!args.sizeAccepted) {
        return { ok: false, code: "no_size", reason: "Accept shoe size from the scan before matching arch" };
    }
    if (!args.hasRawBase) {
        return { ok: false, code: "no_base", reason: "Load a clinical base before matching arch from scan" };
    }
    if (args.incomplete) {
        return { ok: false, code: "incomplete", reason: "Register the scan (M1–M3) before matching arch" };
    }
    if (args.error) {
        return { ok: false, code: "error", reason: args.error.message };
    }
    if (args.residualRmsMm == null || !Number.isFinite(args.residualRmsMm)) {
        return { ok: false, code: "incomplete", reason: "Registration residual unavailable" };
    }
    if (args.residualRmsMm > ARCH_MATCH_BLOCK_RMS_MM) {
        return {
            ok: false,
            code: "rms",
            reason: `Registration RMS ${args.residualRmsMm.toFixed(1)} mm exceeds ${ARCH_MATCH_BLOCK_RMS_MM} mm — fix markers before arch match`,
        };
    }
    if (args.residualRmsMm > ARCH_MATCH_WARN_RMS_MM) {
        return {
            ok: true,
            warning: `High registration RMS (${args.residualRmsMm.toFixed(1)} mm) — arch fit may be approximate`,
        };
    }
    return { ok: true };
}

/** True when design is still at the default Men’s 9 / equivalent. */
export function isDefaultShoeSize(design?: ShoeSizingDesign | null): boolean {
    const layout = insoleLayoutFromDesign(design);
    return Math.abs(layout.usMenSize - DEFAULT_US_MEN_SIZE) < 1e-9;
}

/** Auto-apply size only when still at default and suggestion is in-range. */
export function shouldAutoApplySize(
    design: ShoeSizingDesign | null | undefined,
    suggestion: SizeSuggestion,
): boolean {
    return isDefaultShoeSize(design) && suggestion.inRange && suggestion.confidence !== "low";
}

export function suggestSizeFromScanGeometry(args: {
    geometry: BufferGeometry;
    displayScale: number;
    dominantRawAxis: DominantAxis;
    sizeSystem?: ShoeSizeSystem | null;
    /** Optional M1/M2 for ball-width advisory (raw scan units). */
    m1?: { x: number; y: number; z: number } | null;
    m2?: { x: number; y: number; z: number } | null;
}): SizeSuggestion | null {
    const footLengthMm = measureFootLengthFromGeometry(
        args.geometry,
        args.displayScale,
        args.dominantRawAxis,
    );
    if (footLengthMm == null) return null;
    const ballWidthMm = args.m1 && args.m2 ? measureBallWidthMm(args.m1, args.m2, args.displayScale) : null;
    return suggestShoeSizeFromScan({
        footLengthMm,
        ballWidthMm,
        sizeSystem: args.sizeSystem,
    });
}

export function matchArchParamsFromRegisteredScan(args: {
    scanPositions: ArrayLike<number>;
    scanVertexCount: number;
    scanToBase: Matrix4;
    rawBase: BufferGeometry;
    side: Side;
    layout: InsoleLayout;
    clearanceMm?: number;
}): ArchFitResult {
    const reference = archFitReferenceFromBaseSized(args.rawBase, args.layout.lengthMm, args.layout.widthMm);
    const clearanceMm = args.clearanceMm !== undefined ? args.clearanceMm : ARCH_FIT_CLEARANCE_MM;
    try {
        return fitArchParamsFromScan({
            scanPositions: args.scanPositions,
            scanVertexCount: args.scanVertexCount,
            scanToBase: args.scanToBase,
            reference,
            side: args.side,
            lengthMm: args.layout.lengthMm,
            clearanceMm,
        });
    } catch (e) {
        // Borderline medial gaps: retry without clearance rather than failing the match.
        if (clearanceMm > 0 && e instanceof ArchFitError && e.code === "insufficient_samples") {
            return fitArchParamsFromScan({
                scanPositions: args.scanPositions,
                scanVertexCount: args.scanVertexCount,
                scanToBase: args.scanToBase,
                reference,
                side: args.side,
                lengthMm: args.layout.lengthMm,
                clearanceMm: 0,
            });
        }
        throw e;
    }
}

export function formatArchFitMessage(fit: ArchFitResult): string {
    const apex = `${fit.apexMoveMm >= 0 ? "+" : ""}${fit.apexMoveMm.toFixed(1)}`;
    return `Arch ${fit.archHeightMm.toFixed(1)} mm · apex ${apex} mm (peak gap ${fit.peakGapMm.toFixed(1)} mm${fit.clamped ? ", clamped" : ""})`;
}

export function formatSizeSuggestionMessage(
    suggestion: SizeSuggestion,
    sizeSystem?: ShoeSizeSystem | null,
): string {
    const label = formatSizeSuggestionLabel(suggestion, sizeSystem);
    const conf = suggestion.confidence === "high" ? "" : ` · ${suggestion.confidence} confidence`;
    return `${label}${conf}`;
}

export type ArchCorrectionPatch = Partial<SideCorrections>;

export type ClinicalMatchResult = {
    correction: Partial<SideCorrections>;
    message: string;
    archSource: "marker" | "gap";
    heel: HeelCupWidthFitResult | null;
};

/**
 * Match arch (+ optional heel cup width) from a registered scan.
 * Prefers ARCH apex marker vs stock (~23.5 mm); falls back to medial gap fit.
 */
export function matchClinicalParamsFromRegisteredScan(args: {
    scanPositions: ArrayLike<number>;
    scanVertexCount: number;
    scanToBase: Matrix4;
    rawBase: BufferGeometry;
    side: Side;
    layout: InsoleLayout;
    /** ARCH marker in scan-local space (optional). */
    archMarkerLocal?: THREE.Vector3 | null;
    /** M3 heel centre in scan-local space (for seat Z / heel width). */
    heelMarkerLocal?: THREE.Vector3 | null;
    clearanceMm?: number;
}): ClinicalMatchResult {
    const reference = archFitReferenceFromBaseSized(args.rawBase, args.layout.lengthMm, args.layout.widthMm);
    if (reference.kind !== "base") {
        throw new ArchFitError("no_reference", "Sized arch reference missing top positions");
    }

    let archPatch: Partial<SideCorrections>;
    let archMsg: string;
    let archSource: "marker" | "gap";
    let heelSeatBase: THREE.Vector3 | null = null;
    if (args.heelMarkerLocal) {
        heelSeatBase = args.heelMarkerLocal.clone().applyMatrix4(args.scanToBase);
    }

    if (args.archMarkerLocal) {
        const archPointBase = args.archMarkerLocal.clone().applyMatrix4(args.scanToBase);
        const hit = sampleArchFitReferenceAt(archPointBase.x, archPointBase.y, reference);
        if (!hit.ok) {
            throw new ArchFitError(
                "insufficient_samples",
                "ARCH marker is not over the insole top — re-place it on the medial arch plantar surface",
            );
        }
        // Raise = gap of marker above stock shell at that XY (meets the placed point).
        const fit: ArchMarkerFitResult = fitArchParamsFromApexMarker({
            archPointBase,
            baseSurfaceZ: hit.z,
            heelSeatBase,
            lengthMm: args.layout.lengthMm,
            lengthMin: reference.lengthMin,
            lengthSize: reference.lengthSize,
            stockArchHeightMm: DEFAULT_STOCK_ARCH_APEX_HEIGHT_MM,
            clearanceMm: 0,
        });
        archPatch = archMarkerFitToCorrectionPatch(fit);
        archMsg = formatArchMarkerFitMessage(fit);
        archSource = "marker";
    } else {
        const fit = matchArchParamsFromRegisteredScan({
            scanPositions: args.scanPositions,
            scanVertexCount: args.scanVertexCount,
            scanToBase: args.scanToBase,
            rawBase: args.rawBase,
            side: args.side,
            layout: args.layout,
            clearanceMm: args.clearanceMm,
        });
        archPatch = archFitToCorrectionPatch(fit);
        archMsg = formatArchFitMessage(fit);
        archSource = "gap";
    }

    let heel: HeelCupWidthFitResult | null = null;
    const heelSeatX = heelSeatBase?.x ?? null;
    const scanHeel = measureHeelWidthMm(
        args.scanPositions,
        args.scanVertexCount,
        args.scanToBase,
        reference.lengthMin,
        reference.lengthSize,
        heelSeatX,
    );
    const baseHeel = measureHeelWidthFromTopPositions(
        reference.topPositions,
        reference.topVertexCount,
        reference.lengthMin,
        reference.lengthSize,
        heelSeatX,
    );
    if (scanHeel != null && baseHeel != null) {
        heel = heelCupWidthParamForTarget({
            scanHeelWidthMm: scanHeel,
            baseHeelWidthMm: baseHeel,
        });
    }

    const correction: Partial<SideCorrections> = {
        ...archPatch,
        ...(heel ? { heelCupWidthMm: heel.heelCupWidthMm } : {}),
    };
    const heelMsg = heel
        ? ` · ${formatHeelCupFitMessage(heel)}`
        : " · Heel width unavailable — check heel registration / cleanup";
    return {
        correction,
        message: `${archMsg}${heelMsg}`,
        archSource,
        heel,
    };
}
