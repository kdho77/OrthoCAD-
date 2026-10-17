// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export { workpieceFromComposed, workpiecesFromDesign } from "./compose";
export { ballScallopMm } from "./drop-cutter";
export { generateCncJob } from "./export";
export type { ParseResult } from "./parse";
export { parseGcode } from "./parse";
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
