// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Foot-length / shoe-size suggestion from a cleaned foot scan.
 *
 * Length is heel→toe (Brannock / Mondopoint), NOT heel→MPJ. Ball width is
 * advisory only. Unit scale is the discrete mm/cm/m display correction — never
 * a fitted Kabsch scale.
 */

import type { BufferGeometry } from "three";
import type { DominantAxis } from "@/lib/geometry/scan-display";
import {
    FOOT_LENGTH_MM_MAX,
    FOOT_LENGTH_MM_MIN,
    footLengthMmToUk,
    footLengthMmToUsMen,
    formatFootLengthLabel,
    formatUkShoeSizeLabel,
    formatUsShoeSizeLabel,
    type InsoleLayout,
    insoleLayoutForFootLengthMm,
    insoleLayoutForUkSize,
    insoleLayoutForUsMenSize,
    normalizeFootLengthMm,
    normalizeShoeSizeSystem,
    type ShoeSizeSystem,
} from "@/lib/geometry/shoe-size";

/** Plausible adult ball width band (mm) for soft warnings. */
export const BALL_WIDTH_MM_LO = 70;
export const BALL_WIDTH_MM_HI = 120;

/** Length / ball-width ratio soft band (approx. adult). */
export const LENGTH_OVER_BALL_LO = 2.2;
export const LENGTH_OVER_BALL_HI = 3.6;

export type SizeSuggestionConfidence = "high" | "medium" | "low";

export type SizeSuggestion = {
    footLengthMm: number;
    ballWidthMm: number | null;
    usMenSize: number;
    ukSize: number;
    layout: InsoleLayout;
    confidence: SizeSuggestionConfidence;
    warnings: string[];
    inRange: boolean;
};

/** Remap raw → length-on-X (same convention as scan-landmark-suggest). */
function remapToLengthX(x: number, y: number, z: number, dominant: DominantAxis): [number, number, number] {
    if (dominant === "x") return [x, y, z];
    if (dominant === "y") return [y, -x, z];
    return [z, y, -x];
}

/**
 * Heel→toe length in millimetres from scan positions.
 * Applies discrete unit scale, orients longest axis to +X, then uses the
 * oriented AABB span. Component cleanup is the debris gate — fixed percentiles
 * would systematically undersize clean feet.
 */
export function measureFootLengthMm(args: {
    positions: ArrayLike<number>;
    vertexCount: number;
    displayScale: number;
    dominantRawAxis: DominantAxis;
}): number {
    const { positions, vertexCount, displayScale, dominantRawAxis } = args;
    const scale = Number.isFinite(displayScale) && displayScale > 0 ? displayScale : 1;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < vertexCount; i++) {
        const [x] = remapToLengthX(
            positions[i * 3]! * scale,
            positions[i * 3 + 1]! * scale,
            positions[i * 3 + 2]! * scale,
            dominantRawAxis,
        );
        if (x < min) min = x;
        if (x > max) max = x;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return 0;
    return Math.max(0, max - min);
}

/** Convenience wrapper over a BufferGeometry. */
export function measureFootLengthFromGeometry(
    geometry: BufferGeometry,
    displayScale: number,
    dominantRawAxis: DominantAxis,
): number | null {
    const pos = geometry.getAttribute("position");
    if (!pos || pos.count < 3) return null;
    return measureFootLengthMm({
        positions: pos.array as ArrayLike<number>,
        vertexCount: pos.count,
        displayScale,
        dominantRawAxis,
    });
}

/** Ball width |M1−M2| in mm (markers are in raw scan units). */
export function measureBallWidthMm(
    m1: { x: number; y: number; z: number },
    m2: { x: number; y: number; z: number },
    displayScale: number,
): number {
    const scale = Number.isFinite(displayScale) && displayScale > 0 ? displayScale : 1;
    const dx = (m1.x - m2.x) * scale;
    const dy = (m1.y - m2.y) * scale;
    const dz = (m1.z - m2.z) * scale;
    return Math.hypot(dx, dy, dz);
}

export function suggestShoeSizeFromScan(args: {
    footLengthMm: number;
    ballWidthMm?: number | null;
    sizeSystem?: ShoeSizeSystem | null;
}): SizeSuggestion {
    const sizeSystem = normalizeShoeSizeSystem(args.sizeSystem);
    const foot = args.footLengthMm;
    const warnings: string[] = [];
    const inRange = Number.isFinite(foot) && foot >= FOOT_LENGTH_MM_MIN && foot <= FOOT_LENGTH_MM_MAX;

    if (!Number.isFinite(foot) || foot <= 0) {
        warnings.push("Could not measure foot length from the scan");
    } else if (!inRange) {
        warnings.push(
            `Measured length ${foot.toFixed(0)} mm is outside the supported ${FOOT_LENGTH_MM_MIN}–${FOOT_LENGTH_MM_MAX} mm band`,
        );
    }

    const ballWidthMm =
        args.ballWidthMm != null && Number.isFinite(args.ballWidthMm) ? args.ballWidthMm : null;
    if (ballWidthMm != null) {
        if (ballWidthMm < BALL_WIDTH_MM_LO || ballWidthMm > BALL_WIDTH_MM_HI) {
            warnings.push(`Ball width ${ballWidthMm.toFixed(0)} mm looks unusual — check M1/M2`);
        }
        if (inRange && ballWidthMm > 1e-3) {
            const ratio = foot / ballWidthMm;
            if (ratio < LENGTH_OVER_BALL_LO || ratio > LENGTH_OVER_BALL_HI) {
                warnings.push("Length/ball-width ratio looks unusual — verify markers and cleanup");
            }
        }
    }

    const usMenSize = footLengthMmToUsMen(foot);
    const ukSize = footLengthMmToUk(foot);
    const layout =
        sizeSystem === "uk"
            ? insoleLayoutForUkSize(ukSize)
            : sizeSystem === "mm"
              ? insoleLayoutForFootLengthMm(normalizeFootLengthMm(foot), "mm")
              : insoleLayoutForUsMenSize(usMenSize);

    let confidence: SizeSuggestionConfidence = "high";
    if (!inRange || warnings.length >= 2) confidence = "low";
    else if (warnings.length === 1) confidence = "medium";

    return {
        footLengthMm: foot,
        ballWidthMm,
        usMenSize: layout.usMenSize,
        ukSize: layout.ukSize,
        layout,
        confidence,
        warnings,
        inRange,
    };
}

export function formatSizeSuggestionLabel(s: SizeSuggestion, sizeSystem?: ShoeSizeSystem | null): string {
    const system = normalizeShoeSizeSystem(sizeSystem);
    const sizeLabel =
        system === "uk"
            ? formatUkShoeSizeLabel(s.ukSize)
            : system === "mm"
              ? formatFootLengthLabel(s.layout.footLengthMm)
              : formatUsShoeSizeLabel(s.usMenSize);
    return `${sizeLabel} · ${s.footLengthMm.toFixed(0)} mm`;
}
