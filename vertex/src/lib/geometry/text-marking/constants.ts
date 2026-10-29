// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Side } from "@/types";
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
export const TEXT_MAX_CHARS = 24;
/** Geometry will not cut side letters shorter than this, even though the slider starts at 2.5. */
export const TEXT_WALL_FEATURE_MIN_MM = 5;
/** 3-axis mill default. Fit warns when the stroke is narrower than this. */
export const TEXT_CNC_TOOL_MM = 6;
/** A–Z, digits, and the punctuation patient marks actually use. */
export const TEXT_ALLOWED_CHAR = /[^A-Z0-9 .,/'’-]/;
export const TEXT_MIN_LETTER_SPACING_MM = 0.6;
export const TEXT_BOOLEAN_EPS_MM = 0.05;
/** Uniform outer-cap poke along the smoothed host normal (mm). */
export const TEXT_BOOLEAN_OUTSET_MM = 0.5;
export const TEXT_WELD_MM = 1e-4;
/** CDT Steiner grid on glyph caps (mm). */
export const TEXT_CUTTER_STEINER_MM = 0.25;
/** Max edge on the refined 2D cutter before mapping (mm). */
export const TEXT_CUTTER_MAX_EDGE_MM = 0.3;
/**
 * Adaptive glyph outline. Turning wins when a curve cannot reach the minimum
 * length without bending more than TEXT_OUTLINE_TURN_DEG. Corners above
 * TEXT_FEATURE_CORNER_DEG stay as tagged feature vertices.
 */
export const TEXT_OUTLINE_TURN_DEG = 8;
export const TEXT_OUTLINE_SEG_MIN_MM = 0.3;
export const TEXT_OUTLINE_SEG_MAX_MM = 0.6;
export const TEXT_FEATURE_CORNER_DEG = 30;
/** Quality CDT on each glyph cap. Distinct from the locked TEXT_CUTTER_* pair. */
export const TEXT_CDT_MIN_ANGLE_DEG = 20;
export const TEXT_CDT_MAX_EDGE_MM = 0.6;
/** Triangle `pq20a0.18`: minimum angle 20°, maximum area 0.18 mm². */
export const TEXT_CDT_MAX_AREA_MM2 = 0.18;
export const TEXT_CDT_STEINER_MM = 0.45;
/** Wall-quad diagonals are exempt from 0.6 mm. Their limit is 0.6·√2. */
export const TEXT_WALL_MAX_EDGE_MM = 0.6 * Math.SQRT2;
/** QEM / acceptance caps. Bottom stays at 120k; wall and medial ship up to 160k. */
export const TEXT_TRI_CAP_BOTTOM = 120_000;
export const TEXT_TRI_CAP_WALL = 160_000;
/** Planar-region QEM on floors and caps. Boundaries and features stay locked. */
export const TEXT_QEM_COPLANAR_MM = 0.005;
/** Decimation guard: outline Hausdorff must stay at or under this (mm). */
export const TEXT_QEM_HAUSDORFF_MM = 0.044;
/** Cut-ring remesh target edge (mm). Feature edges stay locked. */
export const TEXT_CUT_RELAX_TARGET_MM = 0.5;
/** Sidewall bands through the extrusion (vertex rings = this + 1). */
export const TEXT_CUTTER_SIDEWALL_RINGS = 3;
/** Local host refine: footprint pad and max edge (mm). */
export const TEXT_HOST_REFINE_PAD_MM = 1;
export const TEXT_HOST_REFINE_MAX_EDGE_MM = 0.4;
/** Outer-wall normal smoothing radius (mm). */
export const TEXT_NORMAL_SMOOTH_MM = 1;
/** Acceptance / collapse / refine region around the mapped glyph footprint (mm). */
export const TEXT_REGION_PAD_MM = 1;
/** Host-only SI / sliver repair band (mm). */
export const TEXT_HOST_SI_PAD_MM = 2;
/** Host edge dihedral above this is a crease, not a smooth wall–wall pair. */
export const TEXT_HOST_SMOOTH_DIHEDRAL_DEG = 20;
/** Fillet top: host dihedral to the plantar face drops below this (deg). */
export const TEXT_FILLET_DIHEDRAL_DEG = 10;
/** Drop / edge-collapse needles after the boolean (area mm²). */
export const TEXT_DEGENERATE_AREA_MM2 = 1e-6;
/** Drop / edge-collapse needles after the boolean (minimum interior angle). */
export const TEXT_DEGENERATE_MIN_ANGLE_DEG = 0.5;
/** Host pre-boolean sliver repair (minimum interior angle). */
export const TEXT_HOST_SLIVER_MIN_ANGLE_DEG = 1;
/** Post-boolean split of leftover long / needle edges in the text AABB (mm / deg). */
export const TEXT_RESULT_MAX_EDGE_MM = 0.6;
export const TEXT_RESULT_SPLIT_ANGLE_DEG = 5;
export const TEXT_REMAINING_MIN_MM = 1.0;
export const TEXT_BOTTOM_INSET_MM = 4;
/**
 * Keep-out above the plantar fillet point F.
 * 1.0 mm (was 1.5) is the clearance that still clears F and fits a 6 mm × 84.6 mm
 * string on SAMPLE_Top. See the CAD sign-off comment on PR 192.
 */
export const TEXT_WALL_EDGE_CLEARANCE_MM = 1.0;
export const TEXT_WALL_MIN_THICK_MM = 2;
export const TEXT_DEPTH_STEP_MM = 0.1;
/**
 * Extra band below the rim, beyond the fillet clearance.
 * The measured top round is ~0.68 mm, not 1.84. Reserving 1.84 mm as well as the
 * fillet clearance rejects the acceptance string. Letters may meet the rim.
 */
export const TEXT_TRIMLINE_RIM_BAND_MM = 0;
/** Outside-region vertex identity after CSG (mm). */
export const TEXT_OUTSIDE_IDENT_MM = 1e-4;

export const TEXT_CAP = {
    wall: { min: 2.5, default: 3.5, max: 12 },
    bottom: { min: 2.5, default: 12, max: 12 },
} as const;

export const TEXT_ENGRAVE = {
    wall: { min: 0.3, default: 0.4, max: 1.2 },
    bottom: { min: 0.3, default: 0.6, max: 1.2 },
} as const;

export const TEXT_EMBOSS_WALL = { min: 0.3, default: 0.4, max: 1.2 } as const;

export const TEXT_U = {
    bottom: { min: 0.12, default: 0.32, max: 0.78 },
    wall: { min: 0.2, default: 0.42, max: 0.8 },
} as const;

export const TEXT_ANCHOR_U = { heel: 0.18, arch: 0.32, forefoot: 0.68 } as const;

export function isSideText(surface: TextSurface): boolean {
    return surface === "wall" || surface === "medial";
}

export function unsupportedTextChars(text: string): string {
    const bad = text.toUpperCase().match(new RegExp(TEXT_ALLOWED_CHAR.source, "g"));
    if (!bad?.length) return "";
    return [...new Set(bad)].join(" ");
}

export function sanitizeText(text: string): string {
    return text.toUpperCase().replace(new RegExp(TEXT_ALLOWED_CHAR.source, "g"), "").slice(0, TEXT_MAX_CHARS);
}

export const TEXT_ROTATION_MAX_DEG = 90;

export function defaultTextMarking(surface: TextSurface = "bottom"): TextMarking {
    const side = isSideText(surface);
    return {
        text: "",
        surface,
        mode: "engrave",
        bold: true,
        capHeightMm: side ? TEXT_CAP.wall.default : TEXT_CAP.bottom.default,
        depthMm: side ? TEXT_ENGRAVE.wall.default : TEXT_ENGRAVE.bottom.default,
        heightMm: side ? TEXT_EMBOSS_WALL.default : TEXT_ENGRAVE.bottom.default,
        letterSpacingMm: TEXT_MIN_LETTER_SPACING_MM,
        rotationDeg: 0,
        placementU: side ? TEXT_U.wall.default : TEXT_ANCHOR_U.arch,
        anchor: "arch",
        feet: "both",
        differentOnLR: false,
        textLeft: "",
        textRight: "",
        nudgeAlongMm: 0,
        nudgeAcrossMm: 0,
    };
}

/** Per-foot string and Editing L / R / Both. Glyphs are never mirrored here. */
export function markingForSide(marking: TextMarking, side: Side): TextMarking {
    const feet = marking.feet ?? "both";
    if (feet === "left" && side !== "left") return { ...marking, text: "" };
    if (feet === "right" && side !== "right") return { ...marking, text: "" };
    const raw = marking.differentOnLR
        ? side === "left"
            ? marking.textLeft || marking.text
            : marking.textRight || marking.text
        : marking.text;
    return { ...marking, text: sanitizeText(raw) };
}

export function hasActiveTextMarking(marking: TextMarking | null | undefined): boolean {
    return Boolean(marking && marking.text.trim().length > 0);
}

export function snapTextStep(value: number, min: number, max: number, step: number): number {
    const snapped = Math.round(value / step) * step;
    const clamped = Math.min(max, Math.max(min, snapped));
    return Number(clamped.toFixed(4));
}
