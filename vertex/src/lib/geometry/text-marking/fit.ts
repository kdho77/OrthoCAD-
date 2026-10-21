// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    isSideText,
    TEXT_MIN_STROKE_MM,
    TEXT_REMAINING_MIN_MM,
    TEXT_WALL_EDGE_CLEARANCE_MM,
    TEXT_WALL_FEATURE_MIN_MM,
} from "./constants";
import type { TextGuideStation } from "./place";
import type { TextSurface } from "./types";

export type TextFitFix = "shrink" | "bottom" | "shorten";

export interface TextFitWarning {
    id: "taller" | "longer" | "feature" | "stroke" | "tool" | "chars";
    message: string;
    fixes: TextFitFix[];
}

export interface TextFitReport {
    warnings: TextFitWarning[];
    /** Depth was reduced so the wall keeps 1.0 mm. */
    notes: string[];
    clampedDepthMm: number | null;
}

export interface TextFitInput {
    surface: TextSurface;
    capMm: number;
    depthMm: number;
    advanceMm: number;
    strokeMm: number;
    /** Tallest usable wall on this side (mm). Bottom ignores this. */
    usableMm: number;
    /** Length of the run tall enough for capMm (mm). */
    fitLengthMm: number;
    thickMm: number;
    toolDiameterMm: number | null;
    unsupported: string;
}

export function usableAlong(
    stations: TextGuideStation[],
    capMm: number,
): { usableMm: number; fitLengthMm: number; thickMm: number } {
    if (!stations.length) return { usableMm: 0, fitLengthMm: 0, thickMm: 0 };
    let usable = 0;
    for (const st of stations) {
        const room = st.h - st.fillet - TEXT_WALL_EDGE_CLEARANCE_MM;
        if (room > usable) usable = room;
    }
    let best = 0;
    let start = -1;
    let thick = Infinity;
    for (let i = 0; i < stations.length; i++) {
        const st = stations[i]!;
        const room = st.h - st.fillet - TEXT_WALL_EDGE_CLEARANCE_MM;
        const ok = room + 1e-6 >= capMm && st.thick + 1e-6 >= 2;
        if (ok && start < 0) start = st.s;
        if (!ok && start >= 0) {
            best = Math.max(best, stations[i - 1]!.s - start);
            start = -1;
        }
        if (ok) thick = Math.min(thick, st.thick);
    }
    if (start >= 0) best = Math.max(best, stations[stations.length - 1]!.s - start);
    return {
        usableMm: usable,
        fitLengthMm: best,
        thickMm: Number.isFinite(thick) ? thick : 0,
    };
}

export function evaluateTextFit(input: TextFitInput): TextFitReport {
    const warnings: TextFitWarning[] = [];
    const notes: string[] = [];
    let clampedDepthMm: number | null = null;
    const side = isSideText(input.surface);
    if (input.unsupported) {
        warnings.push({
            id: "chars",
            message: `${input.unsupported} isn’t supported. Use A–Z, 0–9, and . , - ' /.`,
            fixes: [],
        });
    }
    if (side && input.capMm + 1e-6 < TEXT_WALL_FEATURE_MIN_MM) {
        warnings.push({
            id: "feature",
            message: `Side letters are ${input.capMm.toFixed(1)} mm high; the minimum feature size is ${TEXT_WALL_FEATURE_MIN_MM.toFixed(1)} mm.`,
            fixes: ["bottom"],
        });
    }
    if (input.strokeMm + 1e-6 < TEXT_MIN_STROKE_MM) {
        warnings.push({
            id: "stroke",
            message: `Stroke is ${input.strokeMm.toFixed(2)} mm, below the ${TEXT_MIN_STROKE_MM.toFixed(1)} mm minimum feature size.`,
            fixes: ["bottom"],
        });
    }
    if (input.toolDiameterMm != null && input.strokeMm + 1e-6 < input.toolDiameterMm) {
        warnings.push({
            id: "tool",
            message: `Stroke is ${input.strokeMm.toFixed(2)} mm, below the ${input.toolDiameterMm.toFixed(1)} mm CNC tool.`,
            fixes: [],
        });
    }
    if (side && input.usableMm > 0 && input.capMm > input.usableMm + 1e-6) {
        warnings.push({
            id: "taller",
            message: `Side text is ${input.capMm.toFixed(1)} mm tall; the usable wall is ${input.usableMm.toFixed(1)} mm (fillet plus ${TEXT_WALL_EDGE_CLEARANCE_MM.toFixed(1)} mm).`,
            fixes: ["shrink", "bottom"],
        });
    }
    if (input.fitLengthMm > 0 && input.advanceMm > input.fitLengthMm + 0.5) {
        warnings.push({
            id: "longer",
            message: `Text is ${input.advanceMm.toFixed(1)} mm long; the surface that can hold it is ${input.fitLengthMm.toFixed(1)} mm.`,
            fixes: ["shorten", "shrink"],
        });
    }
    if (side && input.thickMm > 0 && input.thickMm - input.depthMm < TEXT_REMAINING_MIN_MM - 1e-6) {
        const clamped = Math.max(0.3, Number((input.thickMm - TEXT_REMAINING_MIN_MM).toFixed(1)));
        clampedDepthMm = clamped;
        notes.push(
            `Depth clamped from ${input.depthMm.toFixed(1)} mm to ${clamped.toFixed(1)} mm so 1.0 mm of wall remains.`,
        );
    }
    return { warnings, notes, clampedDepthMm };
}
