// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

export type { BallBandGeometry, UncutCorner } from "./band";
export { ballBandGeometry, ballHalfWidthMm, ballProfileZ, contourLegend, hausdorffClosed } from "./band";
export { attachOrbitMesh, workpieceFromComposed, workpiecesFromDesign } from "./compose";
export { buildContourPass } from "./contour";
export { ballScallopMm, cutterTipFromSample, dropCutterZ, SKIN_FLOOR_MM } from "./drop-cutter";
export { ENVELOPE_CLEARANCE_MM, toolFootprintLocal } from "./envelope";
export { generateCncJob } from "./export";
export type { ParseResult } from "./parse";
export { parseGcode } from "./parse";
export type { PartPlacement, PlacementIssue } from "./placement";
export {
    autoTranslate,
    defaultPlacements,
    defaultRotationDeg,
    evaluateAllPlacements,
    evaluatePlacedPart,
    machineXY,
    placementMarginMm,
    placeWorkpieces,
    rotateAround,
    transformOutline,
    worldPoint,
} from "./placement";
export { renderToolpathPreview } from "./preview";
export {
    cloneProfile,
    contourOffsetMm,
    IDAHO_PROFILE,
    maxStepdownMm,
    skinZ,
    stepoverMm,
    toolRadiusMm,
    wallClearZ,
} from "./profile";
export { evaluateStock, simulateMoves } from "./simulate";
export type {
    CncErrorCode,
    CncJobResult,
    CncWorkpiece,
    FeedClass,
    HeelDirection,
    Heightmap,
    MillingProfile,
    PlacedPart,
    Pocket,
    Point,
    ToolType,
    TopOffsetMeaning,
} from "./types";
export { CncExportError } from "./types";
export { outlineFromGeometry, workpieceFromGeometry } from "./workpiece";
