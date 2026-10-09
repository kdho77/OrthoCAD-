// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export {
    assertT0ClearsSheet,
    BEZIER_HANDLE_FRAC,
    COLUMN_PLANARITY_LIMIT_MM,
    type ColumnFrame,
    evalCubicBezier,
    FRAME_ANGLE_LIMIT_DEG,
    FRAME_SMOOTH_ITERS,
    HANDLE_CHORD_CAP,
    MERGE_ROW_MM,
    OUTLINE_STATION_SPACING_MM,
    offPlaneMm,
    rimOverhangMm,
    sampleByArcLength,
    sampleInPlaneSlope,
    summarizeWallBands,
    t0FromSheetSlope,
    U_BANDS,
    type WallBandRow,
} from "./bezier-column";
export { cdtPlanarBand, DISH_BAND_MM, delaunayXY } from "./cdt-band";
export { fitClosedC2Spline, resampleClosedC2, resamplePolyline } from "./curves";
export {
    applyMeasuredUnclamped,
    blendedFlareCurvature,
    blendedFlareDeg,
    CUP_BOWL,
    clampToBound,
    type DeviceTypePreset,
    FILLET_BOUNDS,
    FLARE_BOUNDS,
    type FlareProfileKind,
    type FlareRegionDiagnostic,
    LATERAL_FLANGE_BOUNDS,
    type MeasuredVsBoundRow,
    resolveWallDefaults,
    type WallRegionDefaults,
} from "./defaults";
export {
    extractPlantarSheet,
    extractStockWallModel,
    extractTopSheet,
    matchedLoftCurves,
    sampleUvField,
} from "./extract";
export { evaluateHeelCupGate } from "./hermite";
export {
    type ClassifiedHit,
    countSelfIntersections,
    formatSiBreakdown,
    type SelfIntersectionReport,
    type WallSubClass,
} from "./intersect";
export {
    buildHermiteStations,
    countColumnPlanReversals,
    MIN_REAL_BOTTOM_FILLET_MM,
} from "./loft";
export { defaultsFromStockCurves, diagnoseFlareProfiles, measureRegionFeatures } from "./measure";
export {
    countDegenerateFaces,
    countJunctionBandSlivers,
    cupHeightAtU,
    dishInteriorDeltaMm,
    foldReport,
    groundDriftMm,
    hausdorffReport,
    heelInnerWidthAtU,
    maxVertexDeltaMm,
    measureReconFlareDeg,
    medialArchUpperWallFolds,
    meshVertexMinZ,
    minWallThicknessMm,
    outlineRingDeviationMm,
    outlineSeamDihedrals,
    reconstructionManifold,
    sheetBoundaryStats,
    stitchVertexDeltaMm,
    tieredHausdorffReport,
} from "./metrics";
export { applyCurveModifiers } from "./modifiers";
export { assertNonCrossing, buildPlanformFrame } from "./planform";
export { reconstructProceduralWalls } from "./reconstruct";
export {
    mapZoneFixtures,
    soleUvFrameFromOutline,
    soleUvFrameFromPolyline,
    ZONE_FIXTURES,
    zoneFixturesMapIdentically,
} from "./sole-uv";
export {
    CROSSING_WINDOW,
    columnSidewaysSkewMm,
    countPlanViewChordCrossings,
    FLARE_DEV_CAP_DEG,
    type FlareCapReport,
    masterCurveRadii,
    pairAtNativeTop,
    pairByHarmonic,
    pairByOutwardRay,
    SKEW_LIMIT_MM,
    type StationPairing,
    smoothClosedToMinRadius,
} from "./stations";
export type {
    BottomOutline,
    ClinicalWallReport,
    ColumnProfile,
    FoldReport,
    HausdorffReport,
    LateralFlangeParams,
    LoftOptions,
    PlanformFrame,
    S0ParityReport,
    S1GateRow,
    S1ParityReport,
    StockWallModel,
    TieredHausdorffReport,
    TopSurface,
    TrimCurve,
    UvHeightField,
    WallModelMode,
    WallProfile,
} from "./types";
export {
    DEFAULT_LOFT_N,
    FOLD_HARD_LIMIT_DEG,
    FOLD_WORST_LIMIT_DEG,
    HAUSDORFF_LIMIT_MM,
    S1_HAUSDORFF,
    S1_MIN_WALL_MM,
    S1_PROFILE_RESIDUAL_MM,
} from "./types";
