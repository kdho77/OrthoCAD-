// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { TextMarking, TextSurface } from "./types";

export const TEXT_FONT_ID = "Inter-Bold";
export const TEXT_FONT_PUBLIC_PATH = "/fonts/Inter-Bold.ttf";

export const TEXT_FLATTEN_CHORD_MM = 0.05;
export const TEXT_CONTOUR_EDGE_MIN_MM = 0.03;
export const TEXT_CONTOUR_EDGE_MAX_MM = 0.15;
export const TEXT_CLIPPER_PRECISION = 4;
export const TEXT_MIN_LOOP_AREA_MM2 = 0.3;
export const TEXT_BOLD_OFFSET_MM = 0.15;
export const TEXT_MIN_STROKE_MM = 0.9;
export const TEXT_MAX_CHARS = 40;
export const TEXT_MIN_LETTER_SPACING_MM = 0.6;
export const TEXT_BOOLEAN_EPS_MM = 0.05;
export const TEXT_WELD_MM = 1e-4;
/** CDT Steiner grid on glyph caps (mm). */
export const TEXT_CUTTER_STEINER_MM = 0.25;
/** Max edge on the refined 2D cutter before mapping (mm). */
export const TEXT_CUTTER_MAX_EDGE_MM = 0.3;
/** Sidewall bands through the extrusion (vertex rings = this + 1). */
export const TEXT_CUTTER_SIDEWALL_RINGS = 3;
/** Local host refine: footprint pad and max edge (mm). */
export const TEXT_HOST_REFINE_PAD_MM = 1;
export const TEXT_HOST_REFINE_MAX_EDGE_MM = 0.4;
/** Outer-wall normal smoothing radius (mm). */
export const TEXT_NORMAL_SMOOTH_MM = 1;
/** Acceptance region around the mapped glyph footprint (mm). */
export const TEXT_REGION_PAD_MM = 0.5;
/** Drop / edge-collapse needles after the boolean (area mm²). */
export const TEXT_DEGENERATE_AREA_MM2 = 1e-6;
/** Drop / edge-collapse needles after the boolean (minimum interior angle). */
export const TEXT_DEGENERATE_MIN_ANGLE_DEG = 1;
/** Post-boolean split of leftover long / needle edges in the text AABB (mm / deg). */
export const TEXT_RESULT_MAX_EDGE_MM = 0.55;
export const TEXT_RESULT_SPLIT_ANGLE_DEG = 5;
export const TEXT_REMAINING_MIN_MM = 1.2;
export const TEXT_BOTTOM_INSET_MM = 4;
export const TEXT_WALL_EDGE_CLEARANCE_MM = 1.5;
export const TEXT_WALL_MIN_THICK_MM = 2;
export const TEXT_DEPTH_STEP_MM = 0.2;
export const TEXT_TRIMLINE_RIM_BAND_MM = 1.84;

export const TEXT_CAP = {
    wall: { min: 5, default: 6 },
    bottom: { min: 6, default: 8, max: 14 },
} as const;

export const TEXT_ENGRAVE = {
    wall: { min: 0.6, default: 0.8, max: 1.2 },
    bottom: { min: 0.6, default: 0.8, max: 1.5 },
} as const;

export const TEXT_EMBOSS_WALL = { min: 0.6, default: 0.8, max: 1.2 } as const;

export const TEXT_U = {
    bottom: { min: 0.15, default: 0.3, max: 0.45 },
    wall: { min: 0.2, default: 0.42, max: 0.8 },
} as const;

export const TEXT_ROTATION_MAX_DEG = 90;

export function defaultTextMarking(surface: TextSurface = "bottom"): TextMarking {
    return {
        text: "",
        surface,
        mode: "engrave",
        bold: true,
        capHeightMm: surface === "wall" ? TEXT_CAP.wall.default : TEXT_CAP.bottom.default,
        depthMm: surface === "wall" ? TEXT_ENGRAVE.wall.default : TEXT_ENGRAVE.bottom.default,
        heightMm: TEXT_EMBOSS_WALL.default,
        letterSpacingMm: TEXT_MIN_LETTER_SPACING_MM,
        rotationDeg: 0,
        placementU: surface === "wall" ? TEXT_U.wall.default : TEXT_U.bottom.default,
    };
}

export function hasActiveTextMarking(marking: TextMarking | null | undefined): boolean {
    return Boolean(marking && marking.text.trim().length > 0);
}

export function snapTextStep(value: number, min: number, max: number, step: number): number {
    const snapped = Math.round(value / step) * step;
    const clamped = Math.min(max, Math.max(min, snapped));
    return Number(clamped.toFixed(4));
}
