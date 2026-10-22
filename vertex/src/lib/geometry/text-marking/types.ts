// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Side, TextAnchor, TextFeet, TextMarking, TextMode, TextSurface } from "@/types";

export type { TextAnchor, TextFeet, TextMarking, TextMode, TextSurface };

export interface TextXy {
    x: number;
    y: number;
}

/** Map a 2D glyph point at extrusion parameter t into world space. */
export type MapTextPoint = (p: TextXy, t: number) => { x: number; y: number; z: number };

export interface TextContour {
    points: TextXy[];
    hole: boolean;
}

export interface TextGlyphGroup {
    outer: TextXy[];
    holes: TextXy[][];
}

export interface FlattenedText {
    groups: TextGlyphGroup[];
    /** Font advance plus tracking, mm. */
    advanceMm: number;
    capHeightMm: number;
    bold: boolean;
    minStrokeMm: number;
    centroids: TextXy[];
}

export interface TextApplyContext {
    side: Side;
    /**
     * Distal-skive feather in the print frame. Glyphs that enter the skive
     * (feather 0) are dropped; a glyph entirely in the 5 mm band is scaled.
     * Omit on the full-length path.
     */
    skiveFeatherAt?: (x: number, y: number) => number;
}

export interface TextHostRepair {
    collapsed: number;
    siBefore: number;
    siAfter: number;
}

export interface TextApplyMeta {
    surface: TextSurface;
    mode: TextMode;
    depthMm: number;
    heightMm: number;
    capHeightMm: number;
    advanceMm: number;
    centroids: Array<{
        x: number;
        y: number;
        z: number;
        /** Outward wall normal at the glyph centroid (wall only). */
        nOut?: { x: number; y: number; z: number };
        /** Placement-u of the station under this centroid (wall only). */
        u?: number;
    }>;
    /** World-space width along the placement axis (mm). */
    mappedWidthMm: number;
    /** Inclusive glyph extent in placement-u (wall only). */
    wallUMin?: number;
    wallUMax?: number;
    /** Mapped font-outline loops on the host surface (t = surface). */
    outlineWorld?: Array<{
        outer: Array<{ x: number; y: number; z: number }>;
        holes: Array<Array<{ x: number; y: number; z: number }>>;
    }>;
    hostRepair?: TextHostRepair;
}
