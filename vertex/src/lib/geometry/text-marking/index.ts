// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export { applyTextMarkingToPrintSolid } from "./apply";
export {
    defaultTextMarking,
    hasActiveTextMarking,
    TEXT_BOOLEAN_EPS_MM,
    TEXT_CAP,
    TEXT_DEPTH_STEP_MM,
    TEXT_EMBOSS_WALL,
    TEXT_ENGRAVE,
    TEXT_FONT_ID,
    TEXT_MAX_CHARS,
    TEXT_MIN_LETTER_SPACING_MM,
    TEXT_MIN_STROKE_MM,
    TEXT_REGION_PAD_MM,
    TEXT_REMAINING_MIN_MM,
    TEXT_U,
    TEXT_WELD_MM,
} from "./constants";
export { flattenText, resampleClosedLoop } from "./contours";
export { cdtGlyphCap, cutterMaxEdgeMm } from "./cutter";
export { TextMarkingError } from "./errors";
export { loadTextFont } from "./font";
export { assertTextPrintGates } from "./gates";
export { textMarkingHash } from "./hash";
export { extractHostTextContext, lateralStations, localWallHeightMm } from "./place";
export { measureTextRegionQuality } from "./quality";
export { countSoupSelfIntersections } from "./soup-intersect";
export type { TextApplyMeta, TextMarking, TextMode, TextSurface } from "./types";
export {
    assertTextMarkingInRange,
    normalizeTextMarking,
    textControlBounds,
    wallCapMaxMm,
} from "./validate";
