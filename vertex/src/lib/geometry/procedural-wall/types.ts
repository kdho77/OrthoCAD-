// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Stage 0 wall-model representation (Option B).
 *
 * Extracted from an unmodified stock base so a later loft can rebuild the
 * bottom + walls from the TOP surface plus a plantar outline. S0 only proves
 * the representation can reproduce the stock shape; modifiers stay on the
 * legacy path.
 */

export type WallModelMode = "legacy" | "procedural";

/** Regular UV height field over the footprint AABB (NaN / !inside = exterior). */
export interface UvHeightField {
    originX: number;
    originY: number;
    sizeX: number;
    sizeY: number;
    nu: number;
    nv: number;
    /** Row-major z[iv * nu + iu], NaN outside the surface. */
    z: Float32Array;
    inside: Uint8Array;
    /** Scattered source samples for nearest-Z fallback (x,y,z packed). */
    samples: Float32Array;
}

/** Clinical top sheet: UV height field plus the stock top mesh (exact S0 cap). */
export interface TopSurface {
    field: UvHeightField;
    /** Original top-sheet triangles (local indices). */
    meshPositions?: Float32Array;
    meshIndices?: Uint32Array;
    /** Local indices of the ordered top rim (CCW, heel-started). */
    rimLocal?: number[];
}

/** Closed C2 spline (periodic cubic interpolant) plus the source polyline. */
export interface ClosedC2Spline {
    /** Interpolating control polyline (source samples, CCW, heel-started). */
    controls: Array<{ x: number; y: number; z: number }>;
    /** True when the spline is a periodic cubic interpolant (C2). */
    c2: true;
}

/** Top-edge trim: stock top rim fitted to a closed C2 spline. */
export interface TrimCurve {
    spline: ClosedC2Spline;
    /** Source rim vertex count before the spline fit. */
    sourceCount: number;
}

/**
 * Plantar outline: closed C2 spline in XY plus the stock plantar Z field.
 * Sole-UV is derived from this curve — never from wall topology.
 */
export interface BottomOutline {
    spline: ClosedC2Spline;
    plantarZ: UvHeightField;
    /** Source plantar-silhouette sample count before the spline fit. */
    sourceCount: number;
    /** Welded plantar sheet (downward faces, original topology). */
    meshPositions?: Float32Array;
    meshIndices?: Uint32Array;
    /** Local indices of the ordered plantar boundary (CCW, heel-started). */
    rimLocal?: number[];
    /** True when the tilt-gated flood no longer covers the stock dish interior. */
    dishLost?: boolean;
    floodFaceCount?: number;
    floodZSpanMm?: number;
    interiorFaceCount?: number;
}

/**
 * Parametric wall (Rhino model). Reverse-fit residuals are no longer used.
 * Flare / fillets are stock-measured defaults (flare is never clamped).
 * `offset*` arrays stay empty for S0 field-shape compatibility.
 */
export interface WallProfile {
    /** Per-station flare from vertical (deg). 0 = vertical wall. */
    flareDeg: number[];
    /** Per-station cup / wall height (mm): trim.z − outline.z. */
    cupHeightMm: number[];
    /** Bottom-join fillet (mm). */
    filletMm: number;
    /** Per-station bottom fillet (mm). */
    filletMmAt: number[];
    /** Top-rim fillet (mm). Must not drop cup height by more than 0.5 mm. */
    wallFilletTopMm: number;
    wallFilletBottomMm: number;
    /** Unused (reverse-fit removed). */
    offsetH: number[];
    offsetMm: number[][];
    offsetXyz: Array<Array<{ x: number; y: number; z: number }>>;
}

export type DeviceTypePreset = "functional" | "accommodative";

export interface LateralFlangeParams {
    /** 0 = identity (standard wall unchanged). Range 0–10, step 1. */
    heightMm: number;
    /** Along-wall length (mm). Range 20–80, step 5. */
    lengthMm: number;
    /** Extra flare (deg). Range 0–25. */
    angleDeg: number;
}

/** One planform column: plane spanned by inward n(s) and +Z. */
export interface PlanformColumn {
    s: number;
    s01: number;
    outline: { x: number; y: number; z: number };
    n: { x: number; y: number };
    tangent: { x: number; y: number };
    rim: { x: number; y: number; z: number };
    rho: number;
}

/** Smoothed BottomOutline frame. n(s) is the inward normal of the filtered curve. */
export interface PlanformFrame {
    columns: PlanformColumn[];
    totalS: number;
    minRho: number;
    spacingOk: boolean;
    detSignStable: boolean;
    maxFitResidualMm: number;
}

/** Per-column 2D cubic B-spline P(t) = (offset along n, z). Allows overhang. */
export interface ColumnProfile {
    s01: number;
    /** 8–12 cubic B-spline poles in (n, z). */
    poles: Array<{ n: number; z: number }>;
    residualMm: number;
    plantar: { n: number; z: number };
    rim: { n: number; z: number };
}

export interface StockWallModel {
    id: string;
    name: string;
    top: TopSurface;
    trim: TrimCurve;
    outline: BottomOutline;
    wall: WallProfile;
    planform?: PlanformFrame;
    /** @deprecated Reverse-fit columns are no longer generated. */
    columns?: ColumnProfile[];
    /** Footprint AABB after `reorientToFootprintFrame`. */
    bounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
    /** Measured vs bound table (Default.glb rule). */
    measuredVsBound?: import("./defaults").MeasuredVsBoundRow[];
    /** Lower-vs-upper-third flare (curved bowl vs sculpted kink/lip). */
    flareDiagnostics?: import("./defaults").FlareRegionDiagnostic[];
}

export interface LoftOptions {
    /** Perimeter samples (trim and outline are resampled to this N). */
    n?: number;
    /** Wall layers including the trim and outline rings. */
    wallLayers?: number;
    topRings?: number;
    bottomRings?: number;
}

export interface HausdorffReport {
    maxMm: number;
    p99Mm: number;
    meanMm: number;
    sampleCount: number;
}

export interface FoldReport {
    worstDeg: number;
    edgesAtLeast10Deg: number;
    interiorEdgeCount: number;
    /** Wall↔sheet seam dihedral (deg). Gated against stock at the same station. */
    seamWorstDeg?: number;
    /** Stock seam dihedral at the same outline stations (deg). */
    stockSeamWorstDeg?: number;
    /** Edges at ≥10° (for medial-arch-upper dumps). */
    hardEdges?: Array<{ a: number; b: number; deg: number; u: number; y: number; z: number }>;
}

export interface ClinicalWallReport {
    cupHeightAtU: { u: number; stockMm: number; reconMm: number; deltaMm: number }[];
    heelInnerWidthMm: { stock: number; recon: number; delta: number };
    flareMedialArchDeg: { placeholder: number; recon: number; delta: number };
    flareLateralHeelDeg: { placeholder: number; recon: number; delta: number };
    cupHeightDropMm: number;
}

export interface S1GateRow {
    id: string;
    name: string;
    topBitIdentical: boolean;
    topMaxDeltaMm: number;
    plantarMaxMm: number;
    outlineMaxMm: number;
    groundDriftMm: number;
    openEdges: number;
    nonManifold: number;
    watertight: boolean;
    selfIntersections: number;
    minWallMm: number;
    foldWorstDeg: number;
    foldGe10: number;
    seamWorstDeg: number;
    occtSolid: "ok" | "unavailable" | "fail";
    soleUvIdentical: boolean;
    clinical?: ClinicalWallReport;
    misses: string[];
}

export interface S0ParityReport {
    id: string;
    name: string;
    hausdorff: HausdorffReport;
    fold: FoldReport;
    manifold: { watertight: boolean; openEdges: number; nonManifoldEdges: number };
    soleUvIdentical: boolean;
}

export const DEFAULT_LOFT_N = 384;
export const DEFAULT_WALL_LAYERS = 24;
export const DEFAULT_TOP_RINGS = 48;
export const DEFAULT_BOTTOM_RINGS = 28;
export const PLANTAR_BAND_Z_MM = 1.0;
export const HAUSDORFF_LIMIT_MM = 0.2;
export const FOLD_WORST_LIMIT_DEG = 8;
export const FOLD_HARD_LIMIT_DEG = 10;

/** S1 column count (64–96), denser at heel and waist. */
export const S1_COLUMN_COUNT = 80;
export const S1_PROFILE_POLES = 10;
export const S1_LOFT_T_SAMPLES = 18;
export const S1_WAIST_RHO_MM = 15;
export const S1_PROFILE_RESIDUAL_MM = 0.1;
export const S1_MIN_WALL_MM = 0.8;

export const S1_HAUSDORFF = {
    topMax: 0.05,
    plantarMax: 0.05,
    curveMax: 0.1,
    wallMax: 0.5,
    wallP99: 0.3,
    wallMean: 0.15,
    heelCupMax: 0.3,
} as const;

export interface TieredHausdorffReport {
    top: HausdorffReport;
    plantar: HausdorffReport;
    rim: HausdorffReport;
    outline: HausdorffReport;
    wall: HausdorffReport;
    heelCup: HausdorffReport;
}

export interface S1ParityReport {
    id: string;
    name: string;
    hausdorff: TieredHausdorffReport;
    fold: FoldReport;
    manifold: { watertight: boolean; openEdges: number; nonManifoldEdges: number };
    selfIntersections: number;
    minWallMm: number;
    nonCrossing: boolean;
    soleUvIdentical: boolean;
}
