// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export { fitClosedC2Spline, resampleClosedC2, resamplePolyline } from "./curves";
export { extractStockWallModel, matchedLoftCurves, sampleUvField } from "./extract";
export { countSelfIntersections } from "./intersect";
export {
    foldReport,
    hausdorffReport,
    minWallThicknessMm,
    reconstructionManifold,
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
export type {
    BottomOutline,
    ColumnProfile,
    FoldReport,
    HausdorffReport,
    LoftOptions,
    PlanformFrame,
    S0ParityReport,
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
