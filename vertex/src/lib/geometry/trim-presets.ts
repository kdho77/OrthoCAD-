// Top trimline presets — Full, Sulcus, Met-head (distal AP ±3 mm of landmark).

import * as THREE from "three";
import { cloneTrimline, sampleDefaultOutline, type TrimlineCurve } from "@/lib/geometry/trimline";
import type { TrimPresetId } from "@/types";

export const TRIM_PRESET_LABELS: Record<TrimPresetId, string> = {
    full: "Full",
    sulcus: "Sulcus",
    met_head: "Met-head",
};

/** Normalized length u (0 heel → 1 toe) for each clinical landmark. */
const LANDMARK_U: Record<Exclude<TrimPresetId, "custom">, number> = {
    full: 1,
    sulcus: 0.72,
    met_head: 0.66,
};

export const TRIM_PRESET_DISTAL_AP_TOLERANCE_MM = 3;

export interface TrimPresetBuildOptions {
    lengthMm: number;
    widthMm: number;
    /** Fine-tune distal cut ±3 mm from landmark (default 0). */
    distalApOffsetMm?: number;
    /** Base outline to trim; defaults to parametric full outline. */
    baseCurve?: TrimlineCurve;
}

/**
 * Build a closed trimline for the preset by shortening the distal AP to the landmark plane.
 */
export function buildTrimPresetCurve(
    preset: Exclude<TrimPresetId, "custom">,
    opts: TrimPresetBuildOptions,
): TrimlineCurve {
    const base = opts.baseCurve ?? sampleDefaultOutline(opts.lengthMm, opts.widthMm);
    if (preset === "full") {
        return cloneTrimline(base);
    }

    const offset = opts.distalApOffsetMm ?? 0;
    const xCut = Math.max(opts.lengthMm * 0.35, opts.lengthMm * LANDMARK_U[preset] + offset);
    return shortenCurveAtDistalAp(cloneTrimline(base), xCut);
}

/**
 * Shorten a closed footprint curve by replacing the toe cap with a semicircle at xCut.
 */
export function shortenCurveAtDistalAp(curve: TrimlineCurve, xCut: number): TrimlineCurve {
    const pts = curve.points;
    if (pts.length < 8) return curve;

    let yMedial = 0;
    let yLateral = 0;
    let medialCount = 0;
    let lateralCount = 0;

    const kept: THREE.Vector3[] = [];
    for (const p of pts) {
        if (p.x <= xCut + 0.25) {
            kept.push(p.clone());
            if (p.y < 0) {
                yMedial += p.y;
                medialCount++;
            } else {
                yLateral += p.y;
                lateralCount++;
            }
        }
    }

    if (kept.length < 4) return curve;

    const yM = medialCount ? yMedial / medialCount : -1;
    const yL = lateralCount ? yLateral / lateralCount : 1;
    const toeSteps = 12;
    for (let i = 0; i <= toeSteps; i++) {
        const t = i / toeSteps;
        const ang = Math.PI * (1 - t);
        const y = yM + (yL - yM) * (0.5 - 0.5 * Math.cos(ang));
        kept.push(new THREE.Vector3(xCut, y, 0));
    }

    return { points: kept };
}
