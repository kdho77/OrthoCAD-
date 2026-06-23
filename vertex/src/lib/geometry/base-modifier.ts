// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BufferGeometry } from "three";
import type { SolidResult } from "@/lib/chili3d/kernel";
import { getDesignBase } from "@/lib/geometry/base-asset";
import {
    type HeightFieldParams,
    heelCupSideWallWeight,
    heelCupWidthLateralOffsetMm,
    heightAt,
    smoothstep,
} from "@/lib/geometry/height-field";
import { SMOOTH_INWARD_LIMIT_MM } from "@/lib/geometry/mesh-close";
import { closeGlbInsoleToSolid } from "@/lib/geometry/mesh-close";
import { analyzeManifold, type ManifoldReport } from "@/lib/geometry/manifold";
import type { DesignState, Side, SideCorrections } from "@/types";

// Base + Modifier deformation core (see docs/base-modifier-architecture.md).
//
// Modifiers (corrections, elements) are applied to a base mesh as a vertical
// *displacement field* derived from the shared height field, rather than as an
// absolute surface. This preserves the base's intrinsic shape while layering on
// the change introduced by the current corrections — fast, watertight-preserving
// and identical between preview and the procedural authoritative path.
//
// Phase 2 adds: optional Laplacian smoothing of the displacement field for a
// clinically smooth top, and mode helpers (`resolveDesignMode` /
// `hasActiveModifiers`) that drive the viewer's base-vs-parametric feedback.

const ZERO_CORRECTIONS: SideCorrections = {
    forefootPostingDeg: 0,
    rearfootPostingDeg: 0,
    medialSkiveMm: 0,
    lateralSkiveMm: 0,
    archFillMm: 0,
    archHeightMm: 0,
    heelCupDepthMm: 0,
    heelCupHeightMm: 0,
    heelCupWidthMm: 0,
    heelLiftMm: 0,
    apexMoveMm: 0,
    medialFlangeMm: 0,
    lateralFlangeMm: 0,
    // wedge fields intentionally absent (undefined) for neutral / baseline
    // calculations — see neutralField and wedge system design.
};

/**
 * Reference thickness (mm) the base's neutral baseline is evaluated at. Matches
 * the parametric default thickness, so a design left at the default thickness
 * adds *no* vertical shift to the base, while moving the thickness slider lifts
 * (or lowers) the top surface by the difference — directional, bottom-anchored
 * thickness (see requirement: thickness expands upward from the stable bottom).
 */
export const BASE_REFERENCE_THICKNESS_MM = 3;

/** Neutral field (no corrections, no elements) used as the displacement baseline. */
function neutralField(field: HeightFieldParams): HeightFieldParams {
    return {
        ...field,
        // Fixed baseline thickness so the thickness slider produces a real delta
        // (top lifts upward) instead of cancelling out in `correctionDeltaAt`.
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        // Explicitly strip wedge fields so wedgeDeltaAt returns 0 for neutral.
        // (Wedges are surface corrections; their absence in neutral ensures
        // they contribute fully to the delta applied on top of a base.)
        corrections: {
            ...ZERO_CORRECTIONS,
            rearfootWedge: undefined,
            forefootWedge: undefined,
        },
        elements: [],
        includeElements: false,
        includeSkives: true,
        trimline: null,
    };
}

/** Pure modifier contribution (mm) at a normalized footprint coordinate. */
export function correctionDeltaAt(
    u: number,
    vSigned: number,
    field: HeightFieldParams,
    neutral: HeightFieldParams,
): number {
    return heightAt(u, vSigned, field) - heightAt(u, vSigned, neutral);
}

/** Adjacency list from an indexed geometry, used for Laplacian smoothing. */
function buildAdjacency(index: ArrayLike<number>, vertexCount: number): number[][] {
    const adj: Set<number>[] = Array.from({ length: vertexCount }, () => new Set<number>());
    for (let i = 0; i < index.length; i += 3) {
        const a = index[i]!;
        const b = index[i + 1]!;
        const c = index[i + 2]!;
        adj[a]!.add(b).add(c);
        adj[b]!.add(a).add(c);
        adj[c]!.add(a).add(b);
    }
    return adj.map((s) => Array.from(s));
}

// Adjacency is expensive to build for a 70k+ vertex base; the base mesh topology
// is stable across edits, so cache it keyed by the source geometry.
const baseAdjacencyCache = new WeakMap<BufferGeometry, number[][] | null>();

function getBaseAdjacency(base: BufferGeometry): number[][] | null {
    const cached = baseAdjacencyCache.get(base);
    if (cached !== undefined) return cached;
    const pos = base.getAttribute("position");
    const adj = base.index && pos ? buildAdjacency(base.index.array, pos.count) : null;
    baseAdjacencyCache.set(base, adj);
    return adj;
}

/** Half-blend Laplacian relaxation shared by vertical delta and width-lateral fields. */
function laplacianRelaxField(
    field: Float32Array,
    adj: number[][],
    iterations: number,
    options?: { vertexCount?: number; allowNeighbor?: (i: number, n: number) => boolean },
): void {
    const vertexCount = options?.vertexCount ?? field.length;
    const allowNeighbor = options?.allowNeighbor ?? (() => true);
    let current = field;
    for (let it = 0; it < iterations; it++) {
        const next = new Float32Array(field.length);
        for (let i = 0; i < vertexCount; i++) {
            const neighbors = adj[i]!;
            if (neighbors.length === 0) {
                next[i] = current[i]!;
                continue;
            }
            let sum = 0;
            let nCount = 0;
            for (const n of neighbors) {
                if (!allowNeighbor(i, n)) continue;
                sum += current[n]!;
                nCount++;
            }
            if (nCount === 0) {
                next[i] = current[i]!;
                continue;
            }
            next[i] = current[i]! * 0.5 + (sum / nCount) * 0.5;
        }
        for (let i = vertexCount; i < field.length; i++) {
            next[i] = current[i]!;
        }
        current = next;
    }
    field.set(current);
}

/** Limit per-vertex smoothing deviation; returns count of vertices that were clamped. */
function clampFieldDeviation(
    smoothed: Float32Array,
    original: Float32Array,
    limitMm: number,
    count: number,
): number {
    let clamped = 0;
    for (let i = 0; i < count; i++) {
        const d = smoothed[i]! - original[i]!;
        const clampedD = Math.max(-limitMm, Math.min(limitMm, d));
        if (Math.abs(clampedD - d) > 1e-9) clamped++;
        smoothed[i] = original[i]! + clampedD;
    }
    return clamped;
}

function maxEdgeJumpInField(
    field: Float32Array,
    adj: number[][],
    includeVertex: (i: number) => boolean,
): number {
    let maxJump = 0;
    for (let i = 0; i < adj.length; i++) {
        if (!includeVertex(i)) continue;
        for (const n of adj[i]!) {
            if (n <= i || !includeVertex(n)) continue;
            maxJump = Math.max(maxJump, Math.abs(field[i]! - field[n]!));
        }
    }
    return maxJump;
}

function smoothWidthLateralField(
    widthLateral: Float32Array,
    base: BufferGeometry,
    isMultiMesh: boolean,
    topVertexCount: number,
    vertexCount: number,
    widthSmoothIters: number,
    heelCupWidthMm: number,
): number {
    if (heelCupWidthMm <= 0 || widthSmoothIters <= 0) return 0;
    const widthAdj = getBaseAdjacency(base);
    if (!widthAdj) return 0;
    const topN = isMultiMesh && topVertexCount > 0 ? topVertexCount : vertexCount;
    const widthOriginal = widthLateral.slice(0, topN);
    const allowNeighbor = (i: number, n: number) =>
        isMultiMesh && topVertexCount > 0 ? i < topVertexCount && n < topVertexCount : true;
    laplacianRelaxField(widthLateral, widthAdj, widthSmoothIters, {
        vertexCount: topN,
        allowNeighbor,
    });
    return clampFieldDeviation(widthLateral, widthOriginal, SMOOTH_INWARD_LIMIT_MM, topN);
}

/** Verification metrics for heel-cup width Laplacian smoothing (tests / diagnostics). */
export interface HeelCupWidthSmoothingReport {
    zoneBandMaxEdgeJumpMm: number;
    topVertexBoundaryMaxEdgeJumpMm: number;
    transitionBandVertexCount: number;
    clampFiredCount: number;
}

/**
 * Sample and smooth the width-lateral field like `applyBaseModifiers`, then report
 * edge-jump metrics in the zone transition band and near the multi-mesh top seam.
 */
export function measureHeelCupWidthSmoothing(
    base: BufferGeometry,
    field: HeightFieldParams,
    smoothingIterations: number,
): HeelCupWidthSmoothingReport {
    const pos = base.getAttribute("position");
    if (!pos) {
        return {
            zoneBandMaxEdgeJumpMm: 0,
            topVertexBoundaryMaxEdgeJumpMm: 0,
            transitionBandVertexCount: 0,
            clampFiredCount: 0,
        };
    }

    base.computeBoundingBox();
    const box = base.boundingBox;
    if (!box) {
        return {
            zoneBandMaxEdgeJumpMm: 0,
            topVertexBoundaryMaxEdgeJumpMm: 0,
            transitionBandVertexCount: 0,
            clampFiredCount: 0,
        };
    }

    const min = [box.min.x, box.min.y, box.min.z] as const;
    const size = [
        box.max.x - box.min.x || 1,
        box.max.y - box.min.y || 1,
        box.max.z - box.min.z || 1,
    ] as const;
    const { lengthAxis, widthAxis, thickAxis: _thickAxis } = resolveBaseAxes(size[0], size[1], size[2]);
    const lenMin = min[lengthAxis];
    const lenSize = size[lengthAxis];
    const widMin = min[widthAxis];
    const widSize = size[widthAxis];
    const widCenter = widMin + widSize / 2;

    const array = pos.array as Float32Array;
    const count = pos.count;
    const corrections = field.corrections;
    const heelCupWidthMm = corrections.heelCupWidthMm;
    const baseUserData = (base as { userData?: { isMultiMeshBase?: boolean; topVertexCount?: number } })
        .userData;
    const isMultiMesh = !!baseUserData?.isMultiMeshBase;
    const topVertexCount =
        isMultiMesh && typeof baseUserData?.topVertexCount === "number" && baseUserData.topVertexCount > 0
            ? baseUserData.topVertexCount
            : 0;
    const topN = isMultiMesh && topVertexCount > 0 ? topVertexCount : count;

    const medialSign = field.side === "left" ? -1 : 1;
    const widthSign = -(detectArchSideSign(base) * medialSign);

    const widthLateral = new Float32Array(count);
    const inTransitionBand = new Uint8Array(count);
    let transitionBandVertexCount = 0;
    for (let i = 0; i < count; i++) {
        const lenCoord = array[i * 3 + lengthAxis]!;
        const widCoord = array[i * 3 + widthAxis]!;
        const u = Math.max(0, Math.min(1, (lenCoord - lenMin) / lenSize));
        const vSigned = Math.max(-1, Math.min(1, (widthSign * (widCoord - widCenter)) / (widSize / 2)));
        widthLateral[i] = heelCupWidthLateralOffsetMm(u, vSigned, heelCupWidthMm);
        if (heelCupWidthMm > 0) {
            const zone = heelCupSideWallWeight(u, vSigned, heelCupWidthMm);
            if (zone > 0.01 && zone < 0.99) {
                inTransitionBand[i] = 1;
                transitionBandVertexCount++;
            }
        }
    }

    const clampFiredCount = smoothWidthLateralField(
        widthLateral,
        base,
        isMultiMesh,
        topVertexCount,
        count,
        smoothingIterations,
        heelCupWidthMm,
    );

    const widthAdj = getBaseAdjacency(base);
    if (!widthAdj || heelCupWidthMm <= 0) {
        return {
            zoneBandMaxEdgeJumpMm: 0,
            topVertexBoundaryMaxEdgeJumpMm: 0,
            transitionBandVertexCount,
            clampFiredCount,
        };
    }

    const boundaryBand = Math.min(500, Math.max(32, Math.floor(topN * 0.02)));
    const zoneBandMaxEdgeJumpMm = maxEdgeJumpInField(
        widthLateral,
        widthAdj,
        (i) => i < topN && inTransitionBand[i] === 1,
    );
    const topVertexBoundaryMaxEdgeJumpMm = maxEdgeJumpInField(
        widthLateral,
        widthAdj,
        (i) => i < topN && i >= topN - boundaryBand,
    );

    return {
        zoneBandMaxEdgeJumpMm,
        topVertexBoundaryMaxEdgeJumpMm,
        transitionBandVertexCount,
        clampFiredCount,
    };
}

// --- Top / bottom surface classification -----------------------------------
// A real clinical base (e.g. a Rhino STL) has a distinct contoured top surface
// and a defined bottom surface. We classify every vertex into a 0..1 "top
// factor": 1 = part of the top sheet (free to move with corrections), 0 = part
// of the bottom sheet (held fixed so the original bottom contour is preserved),
// with side walls blending between. The factor is derived from vertex normals
// (robust to the contoured top's varying height) plus a thin bottom-band guard,
// and cached per base geometry since the base mesh is stable across edits.

/** Vertices within this height of the base minimum are always treated as bottom. */
const BOTTOM_BAND_MM = 2.0;
const BOTTOM_BAND_TRANSITION_MM = 2.5;

type AxisIndex = 0 | 1 | 2;

interface BaseAxes {
    /** Local axis carrying the insole length (heel→toe). */
    lengthAxis: AxisIndex;
    /** Local axis carrying the insole width (medial↔lateral). */
    widthAxis: AxisIndex;
    /** Local axis carrying thickness / up (deformation direction). */
    thickAxis: AxisIndex;
}

/**
 * Determine which local axis is length / width / thickness from the base's
 * extents: thickness = smallest extent (the vertical/up axis on an insole),
 * length = largest, width = the remaining one. This makes the deformation
 * robust to bases authored in any orientation — e.g. the sample Rhino STL whose
 * length runs along Y (X≈90, Y≈266, Z≈25), not the parametric X convention.
 */
function resolveBaseAxes(sizeX: number, sizeY: number, sizeZ: number): BaseAxes {
    const sizes: [AxisIndex, number][] = [
        [0, sizeX],
        [1, sizeY],
        [2, sizeZ],
    ];
    sizes.sort((a, b) => a[1] - b[1]);
    return { thickAxis: sizes[0]![0], widthAxis: sizes[1]![0], lengthAxis: sizes[2]![0] };
}

const baseTopFactorCache = new WeakMap<BufferGeometry, Float32Array | null>();

/**
 * Classify each vertex of a base mesh into a 0..1 top factor. Returns `null`
 * when the mesh has no recognisable bottom surface, signalling callers to fall
 * back to a plain height-based weight.
 */
export function classifyBaseTopFactors(base: BufferGeometry): Float32Array | null {
    const cached = baseTopFactorCache.get(base);
    if (cached !== undefined) return cached;

    const pos = base.getAttribute("position");
    if (!pos) {
        baseTopFactorCache.set(base, null);
        return null;
    }

    let normal = base.getAttribute("normal");
    if (!normal || normal.count !== pos.count) {
        base.computeVertexNormals();
        normal = base.getAttribute("normal");
    }

    const count = pos.count;
    const posArr = pos.array as ArrayLike<number>;
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) {
        for (let a = 0; a < 3; a++) {
            const c = posArr[i * 3 + a]!;
            if (c < min[a]!) min[a] = c;
            if (c > max[a]!) max[a] = c;
        }
    }
    const { thickAxis } = resolveBaseAxes(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    const thickMin = min[thickAxis];
    const thickSize = max[thickAxis] - thickMin || 1;
    const normArr = normal ? (normal.array as ArrayLike<number>) : null;

    // Detect normal orientation: the top region (upper 30% of thickness) should
    // face up. If it faces down the mesh has inverted normals — flip the sign.
    let topRegionNSum = 0;
    let topRegionN = 0;
    for (let i = 0; i < count; i++) {
        const nUp = normArr ? normArr[i * 3 + thickAxis]! : 1;
        if (posArr[i * 3 + thickAxis]! - thickMin > thickSize * 0.7) {
            topRegionNSum += nUp;
            topRegionN++;
        }
    }
    const flip = topRegionN > 0 && topRegionNSum / topRegionN < 0 ? -1 : 1;

    const factors = new Float32Array(count);
    let downCount = 0;
    for (let i = 0; i < count; i++) {
        const nUp = (normArr ? normArr[i * 3 + thickAxis]! : 1) * flip;
        if (nUp < -0.5) downCount++;
        const heightAbove = posArr[i * 3 + thickAxis]! - thickMin;
        // Bottom-band guard keeps the genuine bottom face anchored regardless of
        // normal noise; the normal term separates the top sheet from the walls.
        const hFactor = smoothstep(BOTTOM_BAND_MM, BOTTOM_BAND_MM + BOTTOM_BAND_TRANSITION_MM, heightAbove);
        const nFactor = smoothstep(-0.3, 0.4, nUp);
        factors[i] = Math.max(0, Math.min(1, hFactor * nFactor));
    }

    // No meaningful downward-facing surface ⇒ classification is unreliable
    // (e.g. an open shell). Signal the height-weight fallback instead.
    if (downCount < count * 0.01) {
        baseTopFactorCache.set(base, null);
        return null;
    }

    baseTopFactorCache.set(base, factors);
    return factors;
}

// --- Medial / lateral orientation ------------------------------------------
// The clinical height field expects the medial longitudinal arch on the medial
// side (derived from foot side). A loaded base can be authored with either
// width edge as medial, so we infer the arch side directly from the geometry —
// in the midfoot the medial side carries the taller top surface — and adjust
// the sampling coordinate so the arch always lands medial. We adjust the
// footprint coordinate rather than moving vertices, so the base mesh (and its
// preserved bottom) is never physically mirrored.

/** Midfoot band (normalized length) used to read the arch asymmetry. */
const MIDFOOT_U_MIN = 0.32;
const MIDFOOT_U_MAX = 0.62;

const baseArchSideCache = new WeakMap<BufferGeometry, number>();

/**
 * Detect which width half of a base carries the medial arch. Returns `+1` when
 * the arch is on the `+width` half, `-1` on the `−width` half, and `+1` (no-op)
 * for symmetric bases where the asymmetry is negligible. Cached per base mesh.
 */
export function detectArchSideSign(base: BufferGeometry): number {
    const cached = baseArchSideCache.get(base);
    if (cached !== undefined) return cached;

    const pos = base.getAttribute("position");
    if (!pos) {
        baseArchSideCache.set(base, 1);
        return 1;
    }

    const posArr = pos.array as ArrayLike<number>;
    const count = pos.count;
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) {
        for (let a = 0; a < 3; a++) {
            const c = posArr[i * 3 + a]!;
            if (c < min[a]!) min[a] = c;
            if (c > max[a]!) max[a] = c;
        }
    }
    const { lengthAxis, widthAxis, thickAxis } = resolveBaseAxes(
        max[0] - min[0],
        max[1] - min[1],
        max[2] - min[2],
    );
    const lenMin = min[lengthAxis];
    const lenSize = max[lengthAxis] - lenMin || 1;
    const widSize = max[widthAxis] - min[widthAxis] || 1;
    const widCenter = min[widthAxis] + widSize / 2;
    const thickMin = min[thickAxis];
    const thickSize = max[thickAxis] - thickMin || 1;
    const factors = classifyBaseTopFactors(base);

    // Average top-surface height on each width half within the midfoot band.
    let posSum = 0;
    let posN = 0;
    let negSum = 0;
    let negN = 0;
    for (let i = 0; i < count; i++) {
        const u = (posArr[i * 3 + lengthAxis]! - lenMin) / lenSize;
        if (u < MIDFOOT_U_MIN || u > MIDFOOT_U_MAX) continue;
        const w = factors ? factors[i]! : (posArr[i * 3 + thickAxis]! - thickMin) / thickSize;
        if (w < 0.5) continue; // top-sheet vertices only
        const n = posArr[i * 3 + widthAxis]! - widCenter;
        const h = posArr[i * 3 + thickAxis]! - thickMin;
        if (n > widSize * 0.05) {
            posSum += h;
            posN++;
        } else if (n < -widSize * 0.05) {
            negSum += h;
            negN++;
        }
    }

    let sign = 1;
    if (posN > 0 && negN > 0) {
        const diff = posSum / posN - negSum / negN;
        // Require a real asymmetry (>2% of thickness) so symmetric bases no-op.
        if (Math.abs(diff) > thickSize * 0.02) sign = diff > 0 ? 1 : -1;
    }

    baseArchSideCache.set(base, sign);
    return sign;
}

/**
 * Apply the current design modifiers to a base mesh as a vertical deformation.
 *
 * The modifier delta (from the shared height field) is sampled per-vertex using
 * footprint (u, v) coordinates derived from the geometry's extents (orientation
 * robust). The same delta is added to *all* vertices along the detected up axis.
 * This preserves exact relative alignment/separation between layers in multi-mesh
 * "Top" + "Bottom" GLB bases (and the overall shell shape for single-mesh bases).
 *
 * `classifyBaseTopFactors` is still used for arch-side inference and validation.
 * Laplacian smoothing (if requested) operates on the full displacement field.
 *
 * Returns a new geometry; the input is untouched.
 *
 * `smoothingIterations` relaxes the sampled displacement field over the mesh
 * topology (Laplacian) for a clinically smooth top surface independent of the
 * base's tessellation. Pass `0` while dragging to keep editing responsive, and
 * `1`–`2` when idle / exporting.
 */
export function applyBaseModifiers(
    base: BufferGeometry,
    field: HeightFieldParams,
    smoothingIterations = 0,
): BufferGeometry {
    const geometry = base.clone();
    const pos = geometry.getAttribute("position");
    if (!pos) return geometry;

    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box) return geometry;

    const min = [box.min.x, box.min.y, box.min.z] as const;
    const size = [
        box.max.x - box.min.x || 1,
        box.max.y - box.min.y || 1,
        box.max.z - box.min.z || 1,
    ] as const;
    const { lengthAxis, widthAxis, thickAxis } = resolveBaseAxes(size[0], size[1], size[2]);
    const lenMin = min[lengthAxis];
    const lenSize = size[lengthAxis];
    const widMin = min[widthAxis];
    const widSize = size[widthAxis];
    const widCenter = widMin + widSize / 2;
    const thickMin = min[thickAxis];
    const thickSize = size[thickAxis];

    const neutral = neutralField(field);
    const corrections = field.corrections;
    const fieldWithoutWidth: HeightFieldParams = {
        ...field,
        corrections: { ...corrections, heelCupWidthMm: 0 },
    };
    const array = pos.array as Float32Array;
    const count = pos.count;

    // Top/bottom classification keeps the original bottom surface stable; falls
    // back to a normalised-height weight when no bottom can be identified.
    const topFactors = classifyBaseTopFactors(base);

    // For explicit multi-mesh bases ("Top" + "Bottom" sub-meshes from GLB),
    // apply modifier delta only to the top vertex range [0 .. topVertexCount).
    // Bottom vertices stay fixed (flat plantar surface); the perimeter gap is
    // closed by closeGlbInsoleToSolid / applyBaseModifiersWithSidewall.
    const baseUserData = (base as { userData?: { isMultiMeshBase?: boolean; topVertexCount?: number } })
        .userData;
    const isMultiMesh = !!baseUserData?.isMultiMeshBase;
    const topVertexCount =
        isMultiMesh && typeof baseUserData?.topVertexCount === "number" && baseUserData.topVertexCount > 0
            ? baseUserData.topVertexCount
            : 0;

    // Orient the footprint width so the medial arch lands on the anatomically
    // medial side for this foot (instead of assuming the bbox +width is medial).
    const medialSign = field.side === "left" ? -1 : 1;
    const widthSign = -(detectArchSideSign(base) * medialSign);

    // 1) Sample the pure modifier delta at every vertex's footprint (u, vSigned),
    //    mapping length/width from the detected base axes (orientation-robust).
    const delta = new Float32Array(count);
    const widthLateral = new Float32Array(count);
    const heelCupWidthMm = corrections.heelCupWidthMm;
    for (let i = 0; i < count; i++) {
        const lenCoord = array[i * 3 + lengthAxis]!;
        const widCoord = array[i * 3 + widthAxis]!;
        const u = Math.max(0, Math.min(1, (lenCoord - lenMin) / lenSize));
        const vSigned = Math.max(-1, Math.min(1, (widthSign * (widCoord - widCenter)) / (widSize / 2)));
        // Depth and other corrections stay on the thickness axis; width is lateral-only.
        delta[i] = correctionDeltaAt(u, vSigned, fieldWithoutWidth, neutral);
        widthLateral[i] = heelCupWidthLateralOffsetMm(u, vSigned, heelCupWidthMm);
    }

    smoothWidthLateralField(
        widthLateral,
        base,
        isMultiMesh,
        topVertexCount,
        count,
        Math.max(smoothingIterations, 1),
        heelCupWidthMm,
    );

    // 2) Optional Laplacian relaxation of the displacement field (cached adjacency).
    // Multi-mesh GLB bases skip smoothing: diffusing wedge/posting deltas on the
    // merged adjacency graph collapses the top rim loop and breaks closeGlbInsoleToSolid.
    const effectiveSmoothing =
        isMultiMesh && topVertexCount > 0 ? 0 : smoothingIterations;
    const adj = effectiveSmoothing > 0 ? getBaseAdjacency(base) : null;
    if (adj) {
        laplacianRelaxField(delta, adj, effectiveSmoothing);
    }

    // 3) Apply the displacement along the thickness (up) axis. Multi-mesh GLBs
    //    use vertex-index separation (top range only). Single-mesh bases use
    //    normal/height topFactor weighting so the bottom sheet stays anchored.
    const originalBottomZ =
        isMultiMesh && topVertexCount > 0
            ? new Float32Array(count - topVertexCount)
            : null;
    if (originalBottomZ) {
        for (let i = topVertexCount; i < count; i++) {
            originalBottomZ[i - topVertexCount] = array[i * 3 + thickAxis]!;
        }
    }

    for (let i = 0; i < count; i++) {
        const t = array[i * 3 + thickAxis]!;
        const wCoord = array[i * 3 + widthAxis]!;
        let w: number;
        if (isMultiMesh && topVertexCount > 0) {
            w = i < topVertexCount ? 1 : 0;
        } else {
            w = topFactors ? topFactors[i]! : Math.max(0, Math.min(1, (t - thickMin) / thickSize));
        }
        array[i * 3 + thickAxis] = t + delta[i]! * w;
        array[i * 3 + widthAxis] = wCoord + widthLateral[i]! * w;
    }

    if (originalBottomZ && typeof console !== "undefined") {
        let maxDrift = 0;
        for (let i = topVertexCount; i < count; i++) {
            const drift = Math.abs(array[i * 3 + thickAxis]! - originalBottomZ[i - topVertexCount]!);
            if (drift > maxDrift) maxDrift = drift;
        }
        if (maxDrift > BASE_BOTTOM_DELTA_TOLERANCE_MM) {
            console.warn(
                `[WEDGE] Bottom mesh Z drift ${maxDrift.toFixed(3)}mm — HC-1 VIOLATION`,
            );
        }
    }

    pos.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
}

// --- Automated validation metrics ------------------------------------------
// After a base deformation we can quantify how faithfully the bottom was held
// and how much the top moved, so callers/tests can assert the bottom is stable.

/** Max allowed bottom-surface movement for a "good" base output. */
export const BASE_BOTTOM_DELTA_TOLERANCE_MM = 0.05;
/** Vertices with top factor below this are considered bottom-sheet. */
const BOTTOM_FACTOR_THRESHOLD = 0.1;
/** Vertices with top factor above this are considered top-sheet. */
const TOP_FACTOR_THRESHOLD = 0.9;

export interface BaseValidation {
    /** Max |Δ| along the up axis over bottom-sheet vertices (topFactor < 0.1). */
    maxBottomDeltaMm: number;
    /** Mean Δ along the up axis over top-sheet vertices (topFactor > 0.9). */
    avgTopLiftMm: number;
    bottomVertexCount: number;
    topVertexCount: number;
    manifold: ManifoldReport;
    isWatertight: boolean;
    /** Two-manifold (every edge shared by ≤ 2 triangles) ⇒ consistent normals. */
    normalsConsistent: boolean;
    /** Bottom held within tolerance. */
    bottomStable: boolean;
    /** Overall pass: bottom stable and topology consistent. */
    ok: boolean;
}

/**
 * Validate a base deformation by comparing the modified geometry against the
 * original base. Computes the max bottom-vertex movement, the average top lift,
 * and basic manifold / normal-consistency checks. Returns the metrics so a
 * caller (or test) can assert `maxBottomDeltaMm < BASE_BOTTOM_DELTA_TOLERANCE_MM`.
 *
 * Read-only: does not modify either geometry or the deformation logic.
 */
export function validateBaseResult(
    base: BufferGeometry,
    modified: BufferGeometry,
    topFactors?: Float32Array | null,
    options?: { bottomDeltaToleranceMm?: number },
): BaseValidation {
    const tol = options?.bottomDeltaToleranceMm ?? BASE_BOTTOM_DELTA_TOLERANCE_MM;
    const manifold = analyzeManifold(modified);
    const factors = topFactors ?? classifyBaseTopFactors(base);

    const basePos = base.getAttribute("position");
    const modPos = modified.getAttribute("position");

    let maxBottomDeltaMm = 0;
    let bottomVertexCount = 0;
    let topLiftSum = 0;
    let topVertexCount = 0;

    if (basePos && modPos && basePos.count === modPos.count) {
        const count = basePos.count;
        const baseArr = basePos.array as ArrayLike<number>;
        const modArr = modPos.array as ArrayLike<number>;
        // Deformation only moves vertices along the up axis; derive it from extents.
        const min: [number, number, number] = [Infinity, Infinity, Infinity];
        const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < count; i++) {
            for (let a = 0; a < 3; a++) {
                const c = baseArr[i * 3 + a]!;
                if (c < min[a]!) min[a] = c;
                if (c > max[a]!) max[a] = c;
            }
        }
        const { thickAxis } = resolveBaseAxes(max[0] - min[0], max[1] - min[1], max[2] - min[2]);

        for (let i = 0; i < count; i++) {
            const f = factors ? factors[i]! : 1;
            const d = modArr[i * 3 + thickAxis]! - baseArr[i * 3 + thickAxis]!;
            if (f < BOTTOM_FACTOR_THRESHOLD) {
                maxBottomDeltaMm = Math.max(maxBottomDeltaMm, Math.abs(d));
                bottomVertexCount++;
            }
            if (f > TOP_FACTOR_THRESHOLD) {
                topLiftSum += d;
                topVertexCount++;
            }
        }
    }

    const avgTopLiftMm = topVertexCount > 0 ? topLiftSum / topVertexCount : 0;
    const normalsConsistent = manifold.nonManifoldEdges === 0;
    const bottomStable = maxBottomDeltaMm <= tol;

    return {
        maxBottomDeltaMm,
        avgTopLiftMm,
        bottomVertexCount,
        topVertexCount,
        manifold,
        isWatertight: manifold.isWatertight,
        normalsConsistent,
        bottomStable,
        ok: bottomStable && normalsConsistent,
    };
}

/**
 * Apply modifiers then close the top/bottom perimeter gap for multi-mesh GLB bases.
 * Uses the post-wedge top rim with the existing two-pointer bridge walk.
 */
export function applyBaseModifiersWithSidewall(
    base: BufferGeometry,
    field: HeightFieldParams,
    smoothingIterations = 0,
): BufferGeometry {
    const modified = applyBaseModifiers(base, field, smoothingIterations);
    const userData = modified.userData as { isMultiMeshBase?: boolean; topVertexCount?: number };
    if (!userData.isMultiMeshBase || !userData.topVertexCount) {
        return modified;
    }
    try {
        const closed = closeGlbInsoleToSolid(modified);
        if (closed !== modified) {
            modified.dispose();
        }
        return closed;
    } catch (err) {
        if (typeof console !== "undefined") {
            const reason = err instanceof Error ? err.message : String(err);
            console.warn(`[base-modifier] sidewall bridge failed: ${reason}`);
        }
        return modified;
    }
}

/** Authoritative-tier result: modified base geometry + manifold/topology report. */
export function modifiedBaseResult(
    base: BufferGeometry,
    field: HeightFieldParams,
    smoothingIterations = 0,
    validate = false,
): SolidResult {
    const geometry = applyBaseModifiers(base, field, smoothingIterations);
    const mesh = analyzeManifold(geometry);
    if (validate) {
        const metrics = validateBaseResult(base, geometry, classifyBaseTopFactors(base));
        if (!metrics.bottomStable && typeof console !== "undefined") {
            console.warn(
                `[base-modifier] bottom delta ${metrics.maxBottomDeltaMm.toFixed(4)}mm exceeds ` +
                    `${BASE_BOTTOM_DELTA_TOLERANCE_MM}mm tolerance (avg top lift ` +
                    `${metrics.avgTopLiftMm.toFixed(3)}mm)`,
            );
        }
    }
    return {
        geometry,
        manifold: { ...mesh, occtClosed: false, isWatertight: mesh.isWatertight },
    };
}

// --- Mode resolution (drives viewer base-vs-parametric feedback) -----------

export type DesignMode = "base" | "parametric";

export interface DesignModeInfo {
    mode: DesignMode;
    /** Human-readable label for the active base, when in base mode. */
    baseName?: string;
    /** Asset id backing the base, when in base mode. */
    baseId?: string;
}

/** Resolve whether a design is modifying a loaded base template or pure parametric. */
export function resolveDesignMode(design: DesignState, side?: Side): DesignModeInfo {
    // Prefer explicit side, then a non-mirrored base (for stock default paired: show the source Right name),
    // then left, right, legacy. This keeps the badge label sensible for auto-mirrored stock Left+Right.
    let base =
        getDesignBase(design, side) ??
        getDesignBase(design, "right") ??
        getDesignBase(design, "left") ??
        getDesignBase(design);
    // If the chosen one is mirrored but its source sibling exists, prefer the source for the display name.
    if (base?.mirrored && design.paired) {
        const right = design.paired.rightBase;
        const left = design.paired.leftBase;
        if (right && right.mirrored !== true) base = right;
        else if (left && left.mirrored !== true) base = left;
    }
    if (base) return { mode: "base", baseName: base.name, baseId: base.assetId };
    return { mode: "parametric" };
}

/** True when any clinical modifier is actively shaping the design. */
export function hasActiveModifiers(design: DesignState, side?: Side): boolean {
    const sides: Side[] = side ? [side] : ["left", "right"];
    for (const s of sides) {
        const c = design.corrections[s];
        const anyCorrection = Object.values(c).some((v) => typeof v === "number" && Math.abs(v) > 1e-3);
        if (anyCorrection) return true;
        if (design.elements.some((e) => e.side === s)) return true;
        if (design.trimlines?.[s] && design.trimlines[s]!.length >= 4) return true;
    }
    return false;
}
