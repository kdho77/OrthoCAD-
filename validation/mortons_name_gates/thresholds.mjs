// Frozen before the candidate checkout is measured. Do not edit after grading starts.

/** Letter floor of the existing bottom engrave (BOTTOM_ENGRAVE.default is 0.6 mm). */
export const FLOOR_Z_MIN_MM = 0.45;
export const FLOOR_Z_MAX_MM = 0.75;
/** Horizontal face: |nz| / |n| at least this. */
export const FLOOR_MIN_ABS_NZ = 0.95;
/** A real bottom name cuts more than a sliver. */
export const FLOOR_AREA_MIN_MM2 = 8;
/** Same string on the Morton's foot must keep at least half the other foot's floor area. */
export const FLOOR_AREA_RATIO_MIN = 0.5;
/** Letters add mesh. A dropped name leaves the triangle count unchanged. */
export const ENGRAVE_TRI_DELTA_MIN = 100;

/** Upper wall and top. The 0.6 mm pocket is below this. */
export const SURFACE_Z_MIN_MM = 1;
/** Top and side cells may not move. */
export const SURFACE_MAX_DELTA_MM = 0.01;
export const SURFACE_CELL_MM = 1;

/** Morton's extension stays 3 mm. Gate the plateau, not a single cell. */
export const MORTON_HEIGHT_MM = 3;
export const MORTON_HEIGHT_TOL_MM = 0.2;
/** Cells this far above the stock top are the pad, not noise. */
export const MORTON_PLATEAU_MIN_MM = 1.5;
/** Left-foot medial is −Y. The raised pad's mean Y must stay on that side. */
export const MEDIAL_MEAN_Y_MAX_MM = 0;
export const ELEMENT_MEAN_Y_TOL_MM = 0.5;

/** Plantar read of a 12 mm word along the foot. */
export const PLANTAR_SPAN_X_MIN_MM = 20;
export const PLANTAR_SPAN_Y_MIN_MM = 6;
export const PLANTAR_SPAN_Y_MAX_MM = 14;
export const PLANTAR_AXIS_MAX_DEG = 20;

export const ENGRAVE_DEPTH_MM = 0.6;
export const MARKING_TEXT = "SAMPLE";

/** Product paths a fix for this defect may touch. Anything else under vertex/src fails R3. */
export const SCOPE_ALLOW_PREFIXES = [
    "vertex/src/lib/geometry/text-marking/",
    "vertex/src/workers/procedural-wall.worker.ts",
    "vertex/src/lib/geometry/procedural-wall/sample-top-preview.ts",
    "tests/",
    "validation/mortons_name_gates/",
];

export const KIRI_FILES = [
    "vertex/src/lib/kiri/slicer.ts",
    "vertex/src/lib/kiri/engine.ts",
    "vertex/src/lib/kiri/gcode.ts",
    "vertex/src/lib/kiri/presets.ts",
];

export const STOCK_FIXTURES = ["tests/fixtures/SAMPLE_Top.glb", "vertex/public/Templates/SAMPLE_Top.glb"];

export const FORBIDDEN_PATH_RE =
    /(^|\/)(vertex-web|vertex-api)(\/|$)|railway|SAMPLE_Top\.glb$|vertex\/src\/lib\/kiri\/|vertex\/src\/lib\/geometry\/mortons-extension\.ts$|vertex\/src\/lib\/geometry\/elements\.ts$/;
