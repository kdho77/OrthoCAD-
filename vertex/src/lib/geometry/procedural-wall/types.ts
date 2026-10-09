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
}

/**
 * Wall column parameters that encode today's heel-cup flare and flange.
 * `offsetMm` is the residual radial offset from the quintic chord after the
 * flare/cup/fillet terms — required so S0 can reproduce the stock walls.
 */
export interface WallProfile {
    /** Per-station flare from vertical (deg). 0 = vertical wall. */
    flareDeg: number[];
    /** Per-station cup / wall height (mm): trim.z − outline.z. */
    cupHeightMm: number[];
    /** Global fillet radius (mm) fitted at the plantar junction. */
    filletMm: number;
    /** Per-station fillet radius (mm). */
    filletMmAt: number[];
    /** Sample heights in [0, 1] for `offsetMm` / `offsetXyz`. */
    offsetH: number[];
    /** offsetMm[hIndex][station] — outward (+) / inward (−) from the quintic chord. */
    offsetMm: number[][];
    /** Full 3D residual from the quintic chord (captures flange / cup that is not radial). */
    offsetXyz: Array<Array<{ x: number; y: number; z: number }>>;
}

export interface StockWallModel {
    id: string;
    name: string;
    top: TopSurface;
    trim: TrimCurve;
    outline: BottomOutline;
    wall: WallProfile;
    /** Footprint AABB after `reorientToFootprintFrame`. */
    bounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
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
