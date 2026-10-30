// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

export {
    CLASS_PREVIEW_COLORS,
    classDensityPct,
    classFingerprint,
    classLineWidthMm,
    classSpeedMmS,
    HARDNESS_CLASS_TABLE,
    NAMED_HARDNESS_CLASSES,
    REGION_HARDNESS_CLASSES,
} from "../../../shared/print-recipe/hardness-class-table";
export {
    collectHardnessRegions,
    elementToRegion,
} from "./collect";
export { modelSettingsXml, packHardness3mf, readDesignFrom3mf } from "./export-3mf";
export { colorizePreviewByClass, verifyGcodeByClass } from "./gcode-verify";
export { boxMesh, bufferGeometryToMesh, meshSha, meshVolume, parseBinaryStl } from "./mesh";
export { buildRawModifiers, exportHardness3mf, STL_SHELL_ONLY_WARNING, samplerForDesign } from "./pipeline";
export { buildHeightFieldPrism, makeParametricSampler } from "./prism";
export { buildExportReport, volumeSettingsFor } from "./report";
export { resolveModifiers } from "./resolve";
