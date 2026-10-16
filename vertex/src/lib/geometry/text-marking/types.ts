// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Side, TextMarking, TextMode, TextSurface } from "@/types";

export type { TextMarking, TextMode, TextSurface };

export interface TextXy {
    x: number;
    y: number;
}

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
}

export interface TextApplyMeta {
    surface: TextSurface;
    mode: TextMode;
    depthMm: number;
    heightMm: number;
    capHeightMm: number;
    advanceMm: number;
    centroids: Array<{ x: number; y: number; z: number }>;
    /** World-space width along the placement axis (mm). */
    mappedWidthMm: number;
}
