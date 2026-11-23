// Frozen thresholds. Written before the candidate is graded.

export const BASE_SHA = "268aac85847160b5b2703a05688721ea4cb93b24";

export const NAMED_CLASSES = ["Extra Soft", "Soft", "Medium", "Hard", "Extra Hard"] as const;

/** hardness-class-table values this gate treats as the locked ladder. */
export const CLASS_LADDER = {
    "Extra Soft": { densityPct: 14, lineWidthMm: 0.7, speedMmS: 43.5, pattern: "gyroid" },
    Soft: { densityPct: 20, lineWidthMm: 0.7, speedMmS: 44.0, pattern: "gyroid" },
    Medium: { densityPct: 26, lineWidthMm: 1.0, speedMmS: 44.5, pattern: "gyroid" },
    Hard: { densityPct: 32, lineWidthMm: 1.0, speedMmS: 45.0, pattern: "gyroid" },
    "Extra Hard": { densityPct: 38, lineWidthMm: 1.0, speedMmS: 45.5, pattern: "gyroid" },
} as const;

export const DEVICE_MEDIUM_INFILL = "26";
export const PROFILE_ID = "apex-v2-insole-95a";
export const MATERIAL_ID = "apex_core";
export const FORM_KEYS = ["infill_density", "material", "model", "profile_id"] as const;

/** Keys modelSettingsXml already writes for a modifier part. */
export const MODIFIER_META_KEYS = [
    "depth",
    "designHash",
    "hardnessClass",
    "kind",
    "matrix",
    "meshSha",
    "name",
    "overrides",
    "priority",
    "regionId",
    "sourceHash",
    "sparse_infill_density",
    "sparse_infill_line_width",
    "sparse_infill_pattern",
    "sparse_infill_speed",
] as const;

export const SHELL_META_KEYS = ["matrix", "name", "slow_down_layer_time"] as const;

export const FOOTPRINT_TOL_MM = 2;
/**
 * Modifier AABB may sit this far outside the elementHeightAt planform.
 * A Soft met pad on base agreed in X within about 2 mm (foot 127–159, modifier 126–157).
 */
export const FOOTPRINT_AABB_PAD_MM = 4;
/**
 * Share of planform cells within 2 mm of a modifier vertex.
 * A modifier on the opposite Y sign of a medial Morton's pad covers about none of them.
 */
export const FOOTPRINT_COVERAGE_MIN = 0.65;
export const MORTONS_MIN_CELLS = 100;
export const MET_MIN_CELLS = 30;
export const HEEL_X_MM = 12;
export const HEEL_CLEARANCE_MM = 20;

export const FORBIDDEN_DIFF = [
    /(^|\/)vertex-web(\/|$)/,
    /(^|\/)vertex-api(\/|$)/,
    /railway/i,
    /prisma\/migrations\//,
    /text-marking/,
    /bottom-text-marking/,
    /procedural-wall\//,
    /seam/i,
];

export const FORBIDDEN_FORM_KEY = /seam|wall|perimeter|skin|top_shell|bottom_shell|layer|ironing|scarf/i;

export const EXISTING_TEST_FILES = [
    "tests/hardness-regions.gates.test.ts",
    "tests/split-elements-ui.test.ts",
    "vertex/shared/print-recipe/print-recipe.test.ts",
    "vertex/src/lib/hardness/hash.test.ts",
    "vertex/src/lib/hardness/resolve-bounds.test.ts",
    "vertex/src/lib/clinical/saved-design-snapshot.test.ts",
    "vertex/src/lib/geometry/anatomical-side.test.ts",
    "vertex/src/stores/design-store.elements.test.ts",
    "vertex/src/features/exports/vertexslice-regional-model.test.ts",
] as const;
