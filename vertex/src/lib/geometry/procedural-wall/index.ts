// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export { fitClosedC2Spline, resampleClosedC2, resamplePolyline } from "./curves";
export { extractStockWallModel, matchedLoftCurves, sampleUvField } from "./extract";
export { foldReport, hausdorffReport, reconstructionManifold } from "./metrics";
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
    FoldReport,
    HausdorffReport,
    LoftOptions,
    S0ParityReport,
    StockWallModel,
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
} from "./types";
