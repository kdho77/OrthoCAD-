// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BufferGeometry } from "three";
import type { SolidResult } from "@/lib/chili3d/kernel";
import { getDesignBase } from "@/lib/geometry/base-asset";
import {
    type HeightFieldParams,
    heightAt,
    heelCupWidthScaleFactor,
    quinticSmoothstep,
    smoothstep,
} from "@/lib/geometry/height-field";
import {
    closeGlbInsoleToSolid,
    extractOrderedBoundaryLoopWithIndices,
    SMOOTH_INWARD_LIMIT_MM,
    submeshByVertexRange,
} from "@/lib/geometry/mesh-close";
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

/** Vertices with top factor above this are considered top-sheet. */
const TOP_FACTOR_THRESHOLD = 0.9;

/** Laplacian iterations for heel-cup width lateral displacement (multi-mesh safe). */
const HEEL_CUP_WIDTH_LAPLACIAN_ITERS = 2;

/**
 * Position quantization for coincident-copy grouping — matches mesh-close QUANT
 * (1e4 → 0.1µm bins) so sync keeps the same copies welded that boundary extract
 * would otherwise split after index-adjacency Laplacian.
 */
const WIDTH_COINCIDENT_QUANT = 1e4;

function widthCoincidentQuantKey(x: number, y: number, z: number): string {
    return `${Math.round(x * WIDTH_COINCIDENT_QUANT)},${Math.round(y * WIDTH_COINCIDENT_QUANT)},${Math.round(z * WIDTH_COINCIDENT_QUANT)}`;
}

function allowTopMeshNeighbor(
    index: number,
    isMultiMesh: boolean,
    topVertexCount: number,
    topFactors: Float32Array | null,
): boolean {
    if (isMultiMesh && topVertexCount > 0) return index < topVertexCount;
    return topFactors ? topFactors[index]! > TOP_FACTOR_THRESHOLD : true;
}

/**
 * Force all verts that share a base-position quant key to carry the same delta.
 * Prevents index-adjacency Laplacian from separating unwelded GLB position copies
 * (which fragments position-quantized rim extraction into thousands of tiny loops).
 */
function syncCoincidentDeltas(delta: Float32Array, groups: number[][]): void {
    for (const group of groups) {
        if (group.length < 2) continue;
        let sum = 0;
        for (const j of group) sum += delta[j]!;
        const mean = sum / group.length;
        for (const j of group) delta[j] = mean;
    }
}

/**
 * Build coincident-position groups for width Laplacian sync.
 *
 * Multi-mesh: groups are built from the TOP range [0, topVertexCount) ONLY so a
 * top vert and a bottom vert that happen to share a quant key never average
 * together. `crossMeshGroupCount` is measured over the full mesh as a safety
 * check (how many position bins would have mixed top+bottom if we had not
 * scoped) — sync itself never uses those mixed groups.
 *
 * Returns `allGroups` covering every sync-range index (singletons included) for
 * the position-welded Laplacian supernode graph.
 */
function buildWidthCoincidenceGroups(
    array: Float32Array,
    count: number,
    isMultiMesh: boolean,
    topVertexCount: number,
): {
    groups: number[][];
    allGroups: number[][];
    syncIndexCount: number;
    crossMeshGroupCount: number;
} {
    const syncEnd = isMultiMesh && topVertexCount > 0 ? topVertexCount : count;
    const syncMap = new Map<string, number[]>();
    for (let i = 0; i < syncEnd; i++) {
        const k = widthCoincidentQuantKey(array[i * 3]!, array[i * 3 + 1]!, array[i * 3 + 2]!);
        let g = syncMap.get(k);
        if (!g) {
            g = [];
            syncMap.set(k, g);
        }
        g.push(i);
    }
    const allGroups = [...syncMap.values()];
    const groups = allGroups.filter((g) => g.length > 1);

    // Safety audit: full-mesh bins that contain BOTH a top-range and bottom-range index.
    let crossMeshGroupCount = 0;
    if (isMultiMesh && topVertexCount > 0 && topVertexCount < count) {
        const fullMap = new Map<string, { hasTop: boolean; hasBot: boolean }>();
        for (let i = 0; i < count; i++) {
            const k = widthCoincidentQuantKey(array[i * 3]!, array[i * 3 + 1]!, array[i * 3 + 2]!);
            let e = fullMap.get(k);
            if (!e) {
                e = { hasTop: false, hasBot: false };
                fullMap.set(k, e);
            }
            if (i < topVertexCount) e.hasTop = true;
            else e.hasBot = true;
        }
        for (const e of fullMap.values()) {
            if (e.hasTop && e.hasBot) crossMeshGroupCount++;
        }
    }

    return { groups, allGroups, syncIndexCount: syncEnd, crossMeshGroupCount };
}

/**
 * Laplacian on the position-welded supernode graph: coincident base-position
 * copies share one delta, so diffusion cannot separate them. Index-adjacency
 * edges are lifted to supernode↔supernode edges. Result is scattered back to
 * every member index (identical delta within each group).
 */
function relaxLateralDeltaFieldWelded(
    raw: Float32Array,
    adj: number[][],
    allGroups: number[][],
    allowNeighbor: (i: number) => boolean,
    iterations: number,
): Float32Array {
    const groupCount = allGroups.length;
    const vertToGroup = new Int32Array(raw.length).fill(-1);
    for (let g = 0; g < groupCount; g++) {
        for (const vi of allGroups[g]!) vertToGroup[vi] = g;
    }

    // Lift index adjacency → supernode adjacency (unique neighbors).
    const superAdj: number[][] = Array.from({ length: groupCount }, () => []);
    const seen = Array.from({ length: groupCount }, () => new Set<number>());
    for (let g = 0; g < groupCount; g++) {
        for (const vi of allGroups[g]!) {
            for (const n of adj[vi] ?? []) {
                if (!allowNeighbor(n)) continue;
                const ng = vertToGroup[n]!;
                if (ng < 0 || ng === g || seen[g]!.has(ng)) continue;
                seen[g]!.add(ng);
                superAdj[g]!.push(ng);
            }
        }
    }

    // One delta per supernode (raw is already equal within a group; take [0]).
    let current = new Float32Array(groupCount);
    for (let g = 0; g < groupCount; g++) {
        current[g] = raw[allGroups[g]![0]!]!;
    }

    for (let it = 0; it < iterations; it++) {
        const next = new Float32Array(groupCount);
        for (let g = 0; g < groupCount; g++) {
            const neighbors = superAdj[g]!;
            if (neighbors.length === 0) {
                next[g] = current[g]!;
                continue;
            }
            let sum = 0;
            for (const n of neighbors) sum += current[n]!;
            next[g] = current[g]! * 0.5 + (sum / neighbors.length) * 0.5;
        }
        current = next;
    }

    const out = new Float32Array(raw);
    for (let g = 0; g < groupCount; g++) {
        const v = current[g]!;
        for (const vi of allGroups[g]!) out[vi] = v;
    }
    // Bottom / non-sync indices keep raw (already in `out` via copy).
    return out;
}

/** Post-smoothing deviation clamp (SMOOTH_INWARD_LIMIT_MM safety net). */
function clampLateralDeviation(raw: Float32Array, smoothed: Float32Array, limitMm: number): void {
    for (let i = 0; i < smoothed.length; i++) {
        const dev = smoothed[i]! - raw[i]!;
        smoothed[i] = raw[i]! + Math.max(-limitMm, Math.min(limitMm, dev));
    }
}

export interface HeelCupWidthLateralDiagnostics {
    raw: Float32Array;
    smoothed: Float32Array;
    centerlineClosestIndex: number;
    centerlineClosestOffsetMm: number;
    centerlineSmoothedDeltaMm: number;
    maxLateralAtEdgeMm: number;
    maxTransitionBandJumpMm: number;
    /** Top-only sync range end index (=== topVertexCount on multi-mesh). */
    coincidenceSyncIndexCount: number;
    /** Full-mesh quant bins that contain both a top and a bottom index (audit). */
    crossMeshCoincidenceGroupCount: number;
    /** Number of top-scoped groups with ≥2 members used by syncCoincident. */
    coincidentGroupCount: number;
}

interface LateralDeltaContext {
    count: number;
    lengthAxis: AxisIndex;
    widthAxis: AxisIndex;
    lenMin: number;
    lenSize: number;
    widCenter: number;
    array: Float32Array;
}

function buildHeelCupWidthLateralDelta(
    base: BufferGeometry,
    field: HeightFieldParams,
    ctx: LateralDeltaContext,
    topFactors: Float32Array | null,
    isMultiMesh: boolean,
    topVertexCount: number,
): {
    raw: Float32Array;
    smoothed: Float32Array;
    coincidenceSyncIndexCount: number;
    crossMeshCoincidenceGroupCount: number;
    coincidentGroupCount: number;
} {
    const { count, lengthAxis, widthAxis, lenMin, lenSize, widCenter, array } = ctx;
    const raw = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        const lenCoord = array[i * 3 + lengthAxis]!;
        const widCoord = array[i * 3 + widthAxis]!;
        const u = Math.max(0, Math.min(1, (lenCoord - lenMin) / lenSize));
        const offset = widCoord - widCenter;
        const scale = heelCupWidthScaleFactor(u, field.corrections.heelCupWidthMm);
        raw[i] = offset * (scale - 1);
    }

    const {
        groups,
        allGroups,
        syncIndexCount: coincidenceSyncIndexCount,
        crossMeshGroupCount: crossMeshCoincidenceGroupCount,
    } = buildWidthCoincidenceGroups(array, count, isMultiMesh, topVertexCount);
    const coincidentGroupCount = groups.length;

    if (field.corrections.heelCupWidthMm <= 0) {
        return {
            raw,
            smoothed: raw,
            coincidenceSyncIndexCount,
            crossMeshCoincidenceGroupCount,
            coincidentGroupCount,
        };
    }

    const adj = getBaseAdjacency(base);
    if (!adj) {
        return {
            raw,
            smoothed: raw,
            coincidenceSyncIndexCount,
            crossMeshCoincidenceGroupCount,
            coincidentGroupCount,
        };
    }

    // Multi-mesh: sync groups are top-only by construction (see buildWidthCoincidenceGroups).
    if (isMultiMesh && topVertexCount > 0) {
        for (const g of allGroups) {
            for (const idx of g) {
                if (idx >= topVertexCount) {
                    throw new Error(
                        `[HC-WIDTH] syncCoincident group leaked bottom index ${idx} (topVertexCount=${topVertexCount})`,
                    );
                }
            }
        }
    }

    const allowN = (idx: number) => allowTopMeshNeighbor(idx, isMultiMesh, topVertexCount, topFactors);
    // Position-welded Laplacian: coincident copies are one supernode during
    // diffusion (cannot diverge), then scatter identical deltas. Avoids both
    // mid-iter sync (re-amplifies crease) and post-hoc average (same failure).
    const smoothed = relaxLateralDeltaFieldWelded(
        raw,
        adj,
        allGroups,
        allowN,
        HEEL_CUP_WIDTH_LAPLACIAN_ITERS,
    );
    clampLateralDeviation(raw, smoothed, SMOOTH_INWARD_LIMIT_MM);
    // Clamp can in principle introduce tiny float divergence within a group —
    // re-sync so rim extract still sees welded positions.
    syncCoincidentDeltas(smoothed, groups);
    return {
        raw,
        smoothed,
        coincidenceSyncIndexCount,
        crossMeshCoincidenceGroupCount,
        coincidentGroupCount,
    };
}

// --- Heel cup depth: monotone tangent displacement field --------------------
// Replaces the signed three-term bowl delta (heelCupDepthBowlDelta) on the
// base-mesh path with a separable, single-sign, monotone field:
//
//   displacement(v) = depthMm × A(s) × W(h) × d̂(v)
//
//  - s ∈ [0,1]: normalized rim-arc position, 0 at the posterior apex, 1 at the
//    anterior termination of each wall. No anterior-termination landmark data
//    exists for loaded bases, so terminations are symmetric (medial = lateral).
//  - A(s) = 1 − quinticSmoothstep(s): monotone decreasing, C2, never negative.
//  - h ∈ [0,1]: normalized wall height (0 = heel seat floor, 1 = local rim).
//    W(h) = quinticSmoothstep((h − h₀)/(1 − h₀)) with a hard floor basin h₀ so
//    the heel seat clinical contact surface is mathematically untouched.
//  - d̂(v) = normalize(up + λ(c)·r̂out): the uphill wall direction, made
//    convergence-free. c = up·n̂ from position-welded per-vertex normals (the
//    GLB top mesh is only partially index-shared, so coincident copies must
//    share one direction or the sheet would tear); λ(c) = |c|·√(1−c²) is the
//    horizontal share of the true uphill surface tangent normalize(up−(up·n̂)n̂),
//    damped to 0 at both flat extremes; r̂out is the horizontal unit radial away
//    from the heel-arc center. On the cup wall proper this coincides with the
//    spec's uphill tangent (up-and-outward at the wall slope, pure up on a
//    vertical wall). The literal projected tangent is direction-DISCONTINUOUS
//    at the rounded rim crest of the real Default.glb: uphill points *toward*
//    the crest from both flanks, so inner and outer wall displacements converge
//    and fold the crest (measured 175° wall dihedral, 4× triangle-area
//    collapse, before this substitution). Replacing the horizontal direction
//    with the smooth radial field keeps a single-sign, spatially C¹ horizontal
//    component — no two neighboring vertices can be displaced toward each
//    other, so crest folds are impossible. This also subsumes the spec's
//    near-floor degeneracy guard: at |c| → 1 (flat floor or crest) λ → 0 and
//    d̂ → pure up. ‖d̂‖ = 1 always, so amplitude truthfulness is unaffected.
//
// Every factor is non-negative and monotone with C2 falloff, so the field has
// a single sign everywhere — folds are impossible by construction. The
// displacement field is Laplacian-relaxed with the same pattern as the
// heel-cup width fix (2 iterations, 0.5 blend, top-mesh-only neighbors,
// SMOOTH_INWARD_LIMIT_MM deviation clamp), excluding the heel seat floor
// region entirely.

/** Anterior termination of the heel-cup rim arc (symmetric fallback, radians). */
const HEEL_CUP_DEPTH_ARC_TERMINATION_RAD = (130 / 180) * Math.PI;
/** Heel-cup arc center along the footprint length (matches the seat bump center). */
const HEEL_CUP_DEPTH_HEEL_CENTER_U = 0.13;
/** Wall-height basin: W(h) ≡ 0 for h ≤ h₀ (heel seat floor stays untouched). */
const HEEL_CUP_DEPTH_FLOOR_BASIN_H = 0.1;
/** Arc bins per side used to resolve the local rim height along the rim. */
const HEEL_CUP_DEPTH_RIM_BINS = 32;
/** Laplacian iterations for the depth displacement field (same as the width fix). */
const HEEL_CUP_DEPTH_LAPLACIAN_ITERS = 2;
/**
 * Diffusion iterations for the welded vertex normals feeding d̂. The real
 * Default.glb top sheet carries pre-existing sliver creases (up to ~58°
 * between adjacent well-formed faces), so raw normals are far too noisy to
 * steer a displacement direction — adjacent vertices would shear apart.
 * ~10 rounds of 0.5-blend diffusion on ~1 mm edges smooths the direction
 * field over a ~3 mm radius while fully preserving the floor/wall/rim
 * distinction (the wall stands ~12–20 mm tall).
 */
const HEEL_CUP_DEPTH_NORMAL_DIFFUSION_ITERS = 10;

interface HeelCupDepthFrame {
    /** Position-weld group per vertex; −1 for ineligible (e.g. bottom mesh). */
    groupOf: Int32Array;
    groupCount: number;
    /** Per-group raw unit-depth displacement A(s)·W(h)·d̂ (3 comps per group). */
    vecRaw: Float32Array;
    /**
     * Unit-depth displacement after vector Laplacian relaxation (floor region
     * excluded entirely) and peak renormalization (‖vec‖ at the raw-field peak
     * restored, so slider mm stays physical mm at the posterior apex).
     */
    vecSmoothed: Float32Array;
}

const heelCupDepthFrameCache = new WeakMap<BufferGeometry, HeelCupDepthFrame | null>();

/**
 * Depth-specific group-graph vector relaxation: floor groups neither move nor
 * pull (the heel seat is excluded from smoothing entirely). Smoothing the full
 * vector field — rather than a scalar amplitude — also diffuses the *direction*
 * across degenerate sliver triangles and the convergent rim crest, which is
 * what makes tangent displacement shear-safe on the real mesh.
 */
function relaxDepthVec(
    raw: Float32Array,
    adj: number[][] | null,
    isFloor: Uint8Array,
    iterations: number,
): Float32Array {
    if (!adj) return raw.slice();
    const groupCount = raw.length / 3;
    let current = raw;
    for (let it = 0; it < iterations; it++) {
        const next = new Float32Array(raw.length);
        for (let g = 0; g < groupCount; g++) {
            if (isFloor[g]) continue;
            const neighbors = adj[g]!;
            let sx = 0;
            let sy = 0;
            let sz = 0;
            let n = 0;
            for (const nb of neighbors) {
                if (isFloor[nb]) continue;
                sx += current[nb * 3]!;
                sy += current[nb * 3 + 1]!;
                sz += current[nb * 3 + 2]!;
                n++;
            }
            if (n === 0) {
                next[g * 3] = current[g * 3]!;
                next[g * 3 + 1] = current[g * 3 + 1]!;
                next[g * 3 + 2] = current[g * 3 + 2]!;
                continue;
            }
            next[g * 3] = current[g * 3]! * 0.5 + (sx / n) * 0.5;
            next[g * 3 + 1] = current[g * 3 + 1]! * 0.5 + (sy / n) * 0.5;
            next[g * 3 + 2] = current[g * 3 + 2]! * 0.5 + (sz / n) * 0.5;
        }
        current = next;
    }
    return current === raw ? raw.slice() : current;
}

/**
 * Build (and cache) the per-base heel-cup depth frame: position-weld groups
 * and the raw + relaxed unit-depth displacement vectors A(s)·W(h)·d̂. Pure
 * function of the base geometry, so it is computed once per loaded base
 * (HC-6: drags only rescale it by depthMm).
 */
function getHeelCupDepthFrame(
    base: BufferGeometry,
    ctx: LateralDeltaContext,
    thickAxis: AxisIndex,
    topFactors: Float32Array | null,
    isMultiMesh: boolean,
    topVertexCount: number,
): HeelCupDepthFrame | null {
    const cached = heelCupDepthFrameCache.get(base);
    if (cached !== undefined) return cached;

    const { count, lengthAxis, widthAxis, lenMin, lenSize, widCenter, array } = ctx;
    const heelCenterLen = lenMin + HEEL_CUP_DEPTH_HEEL_CENTER_U * lenSize;

    const eligible = (i: number): boolean => {
        if (isMultiMesh && topVertexCount > 0) return i < topVertexCount;
        return topFactors ? topFactors[i]! > 0.5 : true;
    };

    // 1) Position-weld groups over eligible vertices.
    const groupOf = new Int32Array(count).fill(-1);
    const keyToGroup = new Map<string, number>();
    const groupRep: number[] = [];
    for (let i = 0; i < count; i++) {
        if (!eligible(i)) continue;
        const key = `${array[i * 3]},${array[i * 3 + 1]},${array[i * 3 + 2]}`;
        let g = keyToGroup.get(key);
        if (g === undefined) {
            g = groupRep.length;
            keyToGroup.set(key, g);
            groupRep.push(i);
        }
        groupOf[i] = g;
    }
    const groupCount = groupRep.length;
    if (groupCount === 0) {
        heelCupDepthFrameCache.set(base, null);
        return null;
    }

    // 2) Heel-arc classification per group: s (arc position) and thick coord.
    const groupS = new Float32Array(groupCount).fill(Number.NaN);
    const groupSideBin = new Int32Array(groupCount).fill(-1);
    let floorZ = Infinity;
    const binRimZ = new Float64Array(2 * HEEL_CUP_DEPTH_RIM_BINS).fill(-Infinity);
    for (let g = 0; g < groupCount; g++) {
        const i = groupRep[g]!;
        const dLen = array[i * 3 + lengthAxis]! - heelCenterLen;
        const dWid = array[i * 3 + widthAxis]! - widCenter;
        const theta = Math.atan2(Math.abs(dWid), -dLen);
        if (theta > HEEL_CUP_DEPTH_ARC_TERMINATION_RAD) continue;
        const s = theta / HEEL_CUP_DEPTH_ARC_TERMINATION_RAD;
        groupS[g] = s;
        const side = dWid >= 0 ? 0 : 1;
        const bin = Math.min(
            HEEL_CUP_DEPTH_RIM_BINS - 1,
            Math.floor(s * HEEL_CUP_DEPTH_RIM_BINS),
        );
        groupSideBin[g] = side * HEEL_CUP_DEPTH_RIM_BINS + bin;
        const z = array[i * 3 + thickAxis]!;
        if (z < floorZ) floorZ = z;
        if (z > binRimZ[groupSideBin[g]!]!) binRimZ[groupSideBin[g]!] = z;
    }

    // 3) Raw gate A(s)·W(h) and floor mask per group.
    const gateRaw = new Float32Array(groupCount);
    const isFloor = new Uint8Array(groupCount);
    for (let g = 0; g < groupCount; g++) {
        const s = groupS[g]!;
        if (Number.isNaN(s)) continue;
        const rimZ = binRimZ[groupSideBin[g]!]!;
        const denom = rimZ - floorZ;
        const i = groupRep[g]!;
        const h = denom > 1e-9 ? (array[i * 3 + thickAxis]! - floorZ) / denom : 0;
        if (h <= HEEL_CUP_DEPTH_FLOOR_BASIN_H) {
            isFloor[g] = 1;
            continue;
        }
        const a = 1 - quinticSmoothstep(s);
        const w = quinticSmoothstep(
            (h - HEEL_CUP_DEPTH_FLOOR_BASIN_H) / (1 - HEEL_CUP_DEPTH_FLOOR_BASIN_H),
        );
        gateRaw[g] = a * w;
    }

    // 4) Position-welded normals (area-weighted face normals over eligible faces)
    //    and group adjacency for the amplitude relaxation.
    const groupNormal = new Float64Array(groupCount * 3);
    const adjSets: Set<number>[] = Array.from({ length: groupCount }, () => new Set<number>());
    const index = base.index ? (base.index.array as ArrayLike<number>) : null;
    if (index) {
        for (let f = 0; f < index.length; f += 3) {
            const va = index[f]!;
            const vb = index[f + 1]!;
            const vc = index[f + 2]!;
            const ga = groupOf[va]!;
            const gb = groupOf[vb]!;
            const gc = groupOf[vc]!;
            if (ga < 0 || gb < 0 || gc < 0) continue;
            const abx = array[vb * 3]! - array[va * 3]!;
            const aby = array[vb * 3 + 1]! - array[va * 3 + 1]!;
            const abz = array[vb * 3 + 2]! - array[va * 3 + 2]!;
            const acx = array[vc * 3]! - array[va * 3]!;
            const acy = array[vc * 3 + 1]! - array[va * 3 + 1]!;
            const acz = array[vc * 3 + 2]! - array[va * 3 + 2]!;
            const nx = aby * acz - abz * acy;
            const ny = abz * acx - abx * acz;
            const nz = abx * acy - aby * acx;
            for (const g of [ga, gb, gc]) {
                groupNormal[g * 3] += nx;
                groupNormal[g * 3 + 1] += ny;
                groupNormal[g * 3 + 2] += nz;
            }
            if (ga !== gb) {
                adjSets[ga]!.add(gb);
                adjSets[gb]!.add(ga);
            }
            if (gb !== gc) {
                adjSets[gb]!.add(gc);
                adjSets[gc]!.add(gb);
            }
            if (gc !== ga) {
                adjSets[gc]!.add(ga);
                adjSets[ga]!.add(gc);
            }
        }
    }
    const groupAdj = index ? adjSets.map((s) => Array.from(s)) : null;

    // 4b) Diffuse the welded normals so the direction field is spatially smooth
    //     (see HEEL_CUP_DEPTH_NORMAL_DIFFUSION_ITERS). Unnormalized blending of
    //     the area-weighted sums is stable; step 5 normalizes.
    if (groupAdj) {
        let current = groupNormal;
        for (let it = 0; it < HEEL_CUP_DEPTH_NORMAL_DIFFUSION_ITERS; it++) {
            const next = new Float64Array(groupCount * 3);
            for (let g = 0; g < groupCount; g++) {
                const neighbors = groupAdj[g]!;
                if (neighbors.length === 0) {
                    next[g * 3] = current[g * 3]!;
                    next[g * 3 + 1] = current[g * 3 + 1]!;
                    next[g * 3 + 2] = current[g * 3 + 2]!;
                    continue;
                }
                let sx = 0;
                let sy = 0;
                let sz = 0;
                for (const nb of neighbors) {
                    sx += current[nb * 3]!;
                    sy += current[nb * 3 + 1]!;
                    sz += current[nb * 3 + 2]!;
                }
                const inv = 1 / neighbors.length;
                next[g * 3] = current[g * 3]! * 0.5 + sx * inv * 0.5;
                next[g * 3 + 1] = current[g * 3 + 1]! * 0.5 + sy * inv * 0.5;
                next[g * 3 + 2] = current[g * 3 + 2]! * 0.5 + sz * inv * 0.5;
            }
            current = next;
        }
        groupNormal.set(current);
    }

    // 5) Uphill unit direction per group: d̂ = √(1−λ²)·up + λ·r̂out, with
    //    λ = |c|·√(1−c²) (c = up·n̂) the damped horizontal share of the true
    //    uphill tangent and r̂out the horizontal radial away from the heel-arc
    //    center. ‖d̂‖ = 1 and d̂·up > 0 wherever the gate is nonzero. Raw
    //    unit-depth displacement vector = A(s)·W(h)·d̂. See header comment.
    const vecRaw = new Float32Array(groupCount * 3);
    for (let g = 0; g < groupCount; g++) {
        const gate = gateRaw[g]!;
        if (gate === 0) continue;
        const i = groupRep[g]!;
        let nx = groupNormal[g * 3]!;
        let ny = groupNormal[g * 3 + 1]!;
        let nz = groupNormal[g * 3 + 2]!;
        const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
        let lambda = 0;
        if (nLen >= 1e-12) {
            nx /= nLen;
            ny /= nLen;
            nz /= nLen;
            const c = thickAxis === 0 ? nx : thickAxis === 1 ? ny : nz;
            lambda = Math.abs(c) * Math.sqrt(Math.max(0, 1 - c * c));
        }
        const rLen0 = array[i * 3 + lengthAxis]! - heelCenterLen;
        const rWid0 = array[i * 3 + widthAxis]! - widCenter;
        const rLenSq = rLen0 * rLen0 + rWid0 * rWid0;
        if (rLenSq < 1e-8) lambda = 0; // at the arc center: pure up
        const upShare = Math.sqrt(Math.max(0, 1 - lambda * lambda));
        vecRaw[g * 3 + thickAxis] = gate * upShare;
        if (lambda > 0) {
            const rInv = 1 / Math.sqrt(rLenSq);
            vecRaw[g * 3 + lengthAxis] += gate * lambda * rLen0 * rInv;
            vecRaw[g * 3 + widthAxis] += gate * lambda * rWid0 * rInv;
        }
    }

    // 6) Relax the vector field over the group graph (floor fully excluded),
    //    then restore the raw peak magnitude so the posterior apex displacement
    //    stays exactly depthMm (amplitude truthfulness; the scale is derived
    //    from this field only, never from the legacy bowl formula).
    const vecSmoothed = relaxDepthVec(vecRaw, groupAdj, isFloor, HEEL_CUP_DEPTH_LAPLACIAN_ITERS);
    let peakGroup = -1;
    let peakRawSq = 0;
    for (let g = 0; g < groupCount; g++) {
        const m =
            vecRaw[g * 3]! * vecRaw[g * 3]! +
            vecRaw[g * 3 + 1]! * vecRaw[g * 3 + 1]! +
            vecRaw[g * 3 + 2]! * vecRaw[g * 3 + 2]!;
        if (m > peakRawSq) {
            peakRawSq = m;
            peakGroup = g;
        }
    }
    if (peakGroup >= 0) {
        const peakSmoothedSq =
            vecSmoothed[peakGroup * 3]! * vecSmoothed[peakGroup * 3]! +
            vecSmoothed[peakGroup * 3 + 1]! * vecSmoothed[peakGroup * 3 + 1]! +
            vecSmoothed[peakGroup * 3 + 2]! * vecSmoothed[peakGroup * 3 + 2]!;
        if (peakSmoothedSq > 1e-12) {
            const scale = Math.sqrt(peakRawSq / peakSmoothedSq);
            for (let k = 0; k < vecSmoothed.length; k++) vecSmoothed[k] = vecSmoothed[k]! * scale;
        }
    }

    const frame: HeelCupDepthFrame = { groupOf, groupCount, vecRaw, vecSmoothed };
    heelCupDepthFrameCache.set(base, frame);
    return frame;
}

/**
 * Per-group displacement vectors (mm) for the current depth value, with the
 * SMOOTH_INWARD_LIMIT_MM deviation clamp applied against the unsmoothed field
 * (same safety net the heel-cup width fix uses, in vector form).
 */
function heelCupDepthDisplacements(frame: HeelCupDepthFrame, depthMm: number): Float32Array {
    const out = new Float32Array(frame.groupCount * 3);
    for (let g = 0; g < frame.groupCount; g++) {
        let dx = depthMm * frame.vecSmoothed[g * 3]!;
        let dy = depthMm * frame.vecSmoothed[g * 3 + 1]!;
        let dz = depthMm * frame.vecSmoothed[g * 3 + 2]!;
        const rx = depthMm * frame.vecRaw[g * 3]!;
        const ry = depthMm * frame.vecRaw[g * 3 + 1]!;
        const rz = depthMm * frame.vecRaw[g * 3 + 2]!;
        const devLen = Math.sqrt((dx - rx) ** 2 + (dy - ry) ** 2 + (dz - rz) ** 2);
        if (devLen > SMOOTH_INWARD_LIMIT_MM) {
            const k = SMOOTH_INWARD_LIMIT_MM / devLen;
            dx = rx + (dx - rx) * k;
            dy = ry + (dy - ry) * k;
            dz = rz + (dz - rz) * k;
        }
        out[g * 3] = dx;
        out[g * 3 + 1] = dy;
        out[g * 3 + 2] = dz;
    }
    return out;
}

// --- Bottom-wall rim-conformity delta transfer (multi-mesh only) ------------
// Samples the already-applied top-mesh total correction at the top rim and
// scatters it onto bottom side-wall verts via BASE footprint correspondence
// with analytic falloff. No Laplacian / diffusion. Correspondence + weights
// are pure functions of the base mesh (cached); per-edit work is O(sparse).

/** Max footprint distance (mm) for a valid top-rim ↔ wall-top seed pair. */
export const RIM_PAIR_TOL_MM = 1.0;
/** Footprint corridor (mm) beyond which wall verts receive zero transfer. */
export const WALL_CORRIDOR_MM = 5.0;
/** Wall-top seed must sit at least this far above plantar (mm). */
export const WALL_TOP_MIN_Z_MM = 2.0;
/** Plantar band (mm): HC-1 fixed; transfer weight is identically zero. */
export const PLANTAR_Z_MAX_MM = 1.0;
/** Anterior taper start (normalized length u); weight still 1.0 at/below. */
export const ANTERIOR_U0 = 0.6;
/** Anterior taper end (normalized length u); weight identically 0.0 at/above. */
export const ANTERIOR_U1 = 0.8;

/** w_h = smoothstep(clamp(h, 0, 1)) — h ≥ 1 → full weight (wall-top target). */
export function rimConformityHeightWeight(h: number): number {
    return smoothstep(0, 1, Math.max(0, Math.min(1, h)));
}

/** w_u: 1 for u ≤ ANTERIOR_U0, 0 for u ≥ ANTERIOR_U1, C1 ramp between. */
export function rimConformityAnteriorTaperWeight(u: number): number {
    return smoothstep(ANTERIOR_U1, ANTERIOR_U0, u);
}

/**
 * w_d: 1 for d ≤ RIM_PAIR_TOL_MM, 0 for d ≥ WALL_CORRIDOR_MM, C1 ramp between.
 * `d` is footprint distance to the paired seed's BASE wallTopIndex footprint.
 */
export function rimConformityDistanceWeight(d: number): number {
    return smoothstep(WALL_CORRIDOR_MM, RIM_PAIR_TOL_MM, d);
}

interface RimWallSeed {
    topRimIndex: number;
    wallTopIndex: number;
    fpLen: number;
    fpWid: number;
    wallTopZ: number;
    u: number;
}

interface RimConformityFrame {
    seeds: RimWallSeed[];
    botMinZ: number;
    lengthAxis: AxisIndex;
    widthAxis: AxisIndex;
    thickAxis: AxisIndex;
    topVertexCount: number;
    wallVertexIndex: Int32Array;
    wallSeedIndex: Int32Array;
    wallWeight: Float32Array;
}

const rimConformityCache = new WeakMap<BufferGeometry, RimConformityFrame | null>();

function buildRimConformityFrame(
    base: BufferGeometry,
    topVertexCount: number,
    lengthAxis: AxisIndex,
    widthAxis: AxisIndex,
    thickAxis: AxisIndex,
    lenMin: number,
    lenSize: number,
): RimConformityFrame | null {
    const pos = base.getAttribute("position");
    if (!pos || topVertexCount <= 0) return null;
    const baseArr = pos.array as Float32Array;
    const count = pos.count;
    if (topVertexCount >= count) return null;

    const topSub = submeshByVertexRange(base, 0, topVertexCount);
    let topRimIdx: number[];
    try {
        topRimIdx = extractOrderedBoundaryLoopWithIndices(topSub).indices;
    } finally {
        topSub.dispose();
    }
    if (topRimIdx.length < 3) return null;

    let botMinZ = Infinity;
    for (let i = topVertexCount; i < count; i++) {
        const z = baseArr[i * 3 + thickAxis]!;
        if (z < botMinZ) botMinZ = z;
    }
    if (!Number.isFinite(botMinZ)) return null;

    // Spatial hash of bottom verts for seed extraction + corridor queries.
    const cell = RIM_PAIR_TOL_MM;
    const hash = new Map<string, number[]>();
    const fpKey = (len: number, wid: number): string =>
        `${Math.floor(len / cell)},${Math.floor(wid / cell)}`;
    for (let i = topVertexCount; i < count; i++) {
        const len = baseArr[i * 3 + lengthAxis]!;
        const wid = baseArr[i * 3 + widthAxis]!;
        const k = fpKey(len, wid);
        let bucket = hash.get(k);
        if (!bucket) {
            bucket = [];
            hash.set(k, bucket);
        }
        bucket.push(i);
    }

    const queryBottom = (len: number, wid: number, tol: number): number[] => {
        const bins = Math.ceil(tol / cell) + 1;
        const cx = Math.floor(len / cell);
        const cy = Math.floor(wid / cell);
        const out: number[] = [];
        for (let dx = -bins; dx <= bins; dx++) {
            for (let dy = -bins; dy <= bins; dy++) {
                const bucket = hash.get(`${cx + dx},${cy + dy}`);
                if (!bucket) continue;
                for (const bi of bucket) {
                    const bl = baseArr[bi * 3 + lengthAxis]!;
                    const bw = baseArr[bi * 3 + widthAxis]!;
                    if (Math.hypot(bl - len, bw - wid) <= tol) out.push(bi);
                }
            }
        }
        return out;
    };

    const seeds: RimWallSeed[] = [];
    // Multiple top-rim verts may resolve to the same wallTopIndex; keep the
    // pair with the smallest footprint distance so seed NN is unambiguous.
    const seedByWallTop = new Map<number, RimWallSeed & { pairD: number }>();
    for (const j of topRimIdx) {
        const len = baseArr[j * 3 + lengthAxis]!;
        const wid = baseArr[j * 3 + widthAxis]!;
        const cands = queryBottom(len, wid, RIM_PAIR_TOL_MM);
        let best = -1;
        let bestZ = -Infinity;
        let bestD = Infinity;
        for (const bi of cands) {
            const z = baseArr[bi * 3 + thickAxis]!;
            const bl = baseArr[bi * 3 + lengthAxis]!;
            const bw = baseArr[bi * 3 + widthAxis]!;
            const d = Math.hypot(bl - len, bw - wid);
            if (z > bestZ + 1e-9 || (Math.abs(z - bestZ) <= 1e-9 && d < bestD)) {
                bestZ = z;
                best = bi;
                bestD = d;
            }
        }
        if (best < 0 || bestZ < WALL_TOP_MIN_Z_MM) continue;
        const u = Math.max(0, Math.min(1, (len - lenMin) / (lenSize || 1)));
        const prev = seedByWallTop.get(best);
        if (prev && prev.pairD <= bestD) continue;
        seedByWallTop.set(best, {
            topRimIndex: j,
            wallTopIndex: best,
            fpLen: baseArr[best * 3 + lengthAxis]!,
            fpWid: baseArr[best * 3 + widthAxis]!,
            wallTopZ: bestZ,
            u,
            pairD: bestD,
        });
    }
    for (const s of seedByWallTop.values()) {
        seeds.push({
            topRimIndex: s.topRimIndex,
            wallTopIndex: s.wallTopIndex,
            fpLen: s.fpLen,
            fpWid: s.fpWid,
            wallTopZ: s.wallTopZ,
            u: s.u,
        });
    }
    if (seeds.length === 0) return null;

    // Seed footprint hash for NN (d measured to seed.wallTopIndex BASE footprint).
    const seedCell = RIM_PAIR_TOL_MM;
    const seedHash = new Map<string, number[]>();
    const seedKey = (len: number, wid: number): string =>
        `${Math.floor(len / seedCell)},${Math.floor(wid / seedCell)}`;
    for (let s = 0; s < seeds.length; s++) {
        const seed = seeds[s]!;
        const k = seedKey(seed.fpLen, seed.fpWid);
        let bucket = seedHash.get(k);
        if (!bucket) {
            bucket = [];
            seedHash.set(k, bucket);
        }
        bucket.push(s);
    }

    const wallVerts: number[] = [];
    const wallSeeds: number[] = [];
    const wallWeights: number[] = [];
    const corridorBins = Math.ceil(WALL_CORRIDOR_MM / seedCell) + 1;

    for (let i = topVertexCount; i < count; i++) {
        const z = baseArr[i * 3 + thickAxis]!;
        if (z <= PLANTAR_Z_MAX_MM) continue;

        const len = baseArr[i * 3 + lengthAxis]!;
        const wid = baseArr[i * 3 + widthAxis]!;
        const cx = Math.floor(len / seedCell);
        const cy = Math.floor(wid / seedCell);

        let bestS = -1;
        let bestD = Infinity;
        for (let dx = -corridorBins; dx <= corridorBins; dx++) {
            for (let dy = -corridorBins; dy <= corridorBins; dy++) {
                const bucket = seedHash.get(`${cx + dx},${cy + dy}`);
                if (!bucket) continue;
                for (const s of bucket) {
                    const seed = seeds[s]!;
                    const d = Math.hypot(seed.fpLen - len, seed.fpWid - wid);
                    if (d < bestD) {
                        bestD = d;
                        bestS = s;
                    }
                }
            }
        }
        if (bestS < 0 || bestD >= WALL_CORRIDOR_MM) continue;

        const seed = seeds[bestS]!;
        const denom = seed.wallTopZ - botMinZ;
        const h = denom > 1e-9 ? (z - botMinZ) / denom : 0;
        const w =
            rimConformityHeightWeight(h) *
            rimConformityAnteriorTaperWeight(seed.u) *
            rimConformityDistanceWeight(bestD);
        if (w <= 0) continue;

        wallVerts.push(i);
        wallSeeds.push(bestS);
        wallWeights.push(w);
    }

    return {
        seeds,
        botMinZ,
        lengthAxis,
        widthAxis,
        thickAxis,
        topVertexCount,
        wallVertexIndex: Int32Array.from(wallVerts),
        wallSeedIndex: Int32Array.from(wallSeeds),
        wallWeight: Float32Array.from(wallWeights),
    };
}

function getRimConformityFrame(
    base: BufferGeometry,
    topVertexCount: number,
    lengthAxis: AxisIndex,
    widthAxis: AxisIndex,
    thickAxis: AxisIndex,
    lenMin: number,
    lenSize: number,
): RimConformityFrame | null {
    const cached = rimConformityCache.get(base);
    if (cached !== undefined) return cached;
    const frame = buildRimConformityFrame(
        base,
        topVertexCount,
        lengthAxis,
        widthAxis,
        thickAxis,
        lenMin,
        lenSize,
    );
    rimConformityCache.set(base, frame);
    return frame;
}

/**
 * Scatter precomputed rim deltas onto bottom wall verts.
 * Reads corrected top positions from `array`; writes bottom from BASE only.
 */
function transferRimConformityDeltas(
    base: BufferGeometry,
    array: Float32Array,
    frame: RimConformityFrame,
): void {
    const basePos = base.getAttribute("position");
    if (!basePos) return;
    const baseArr = basePos.array as Float32Array;
    const { wallVertexIndex, wallSeedIndex, wallWeight, seeds, topVertexCount } = frame;

    for (let k = 0; k < wallVertexIndex.length; k++) {
        const i = wallVertexIndex[k]!;
        if (i < topVertexCount) {
            throw new Error(
                `[RIM-CONFORMITY] leak guard: attempted write to top index ${i} (topVertexCount=${topVertexCount})`,
            );
        }
        const seed = seeds[wallSeedIndex[k]!]!;
        const j = seed.topRimIndex;
        const w = wallWeight[k]!;
        const dx = array[j * 3]! - baseArr[j * 3]!;
        const dy = array[j * 3 + 1]! - baseArr[j * 3 + 1]!;
        const dz = array[j * 3 + 2]! - baseArr[j * 3 + 2]!;
        array[i * 3] = baseArr[i * 3]! + w * dx;
        array[i * 3 + 1] = baseArr[i * 3 + 1]! + w * dy;
        array[i * 3 + 2] = baseArr[i * 3 + 2]! + w * dz;
    }
}

/** Verification helper: post-smoothing lateral delta stats for heel-cup width. */
export function diagnoseHeelCupWidthLateral(
    base: BufferGeometry,
    field: HeightFieldParams,
): HeelCupWidthLateralDiagnostics | null {
    const pos = base.getAttribute("position");
    if (!pos) return null;

    base.computeBoundingBox();
    const box = base.boundingBox;
    if (!box) return null;

    const min = [box.min.x, box.min.y, box.min.z] as const;
    const size = [
        box.max.x - box.min.x || 1,
        box.max.y - box.min.y || 1,
        box.max.z - box.min.z || 1,
    ] as const;
    const { lengthAxis, widthAxis } = resolveBaseAxes(size[0], size[1], size[2]);
    const lenMin = min[lengthAxis];
    const lenSize = size[lengthAxis];
    const widCenter = min[widthAxis] + size[widthAxis] / 2;
    const array = pos.array as Float32Array;
    const count = pos.count;
    const topFactors = classifyBaseTopFactors(base);
    const baseUserData = (base as { userData?: { isMultiMeshBase?: boolean; topVertexCount?: number } }).userData;
    const isMultiMesh = !!baseUserData?.isMultiMeshBase;
    const topVertexCount =
        isMultiMesh && typeof baseUserData?.topVertexCount === "number" && baseUserData.topVertexCount > 0
            ? baseUserData.topVertexCount
            : 0;

    const {
        raw,
        smoothed,
        coincidenceSyncIndexCount,
        crossMeshCoincidenceGroupCount,
        coincidentGroupCount,
    } = buildHeelCupWidthLateralDelta(
        base,
        field,
        { count, lengthAxis, widthAxis, lenMin, lenSize, widCenter, array },
        topFactors,
        isMultiMesh,
        topVertexCount,
    );

    let centerlineClosestIndex = 0;
    let centerlineClosestOffsetMm = Infinity;
    const topLimit = isMultiMesh && topVertexCount > 0 ? topVertexCount : count;
    for (let i = 0; i < topLimit; i++) {
        const offset = Math.abs(array[i * 3 + widthAxis]! - widCenter);
        if (offset < centerlineClosestOffsetMm) {
            centerlineClosestOffsetMm = offset;
            centerlineClosestIndex = i;
        }
    }

    let maxLateralAtEdgeMm = 0;
    let maxTransitionBandJumpMm = 0;
    for (let i = 0; i < topLimit; i++) {
        const lenCoord = array[i * 3 + lengthAxis]!;
        const u = (lenCoord - lenMin) / lenSize;
        const absLat = Math.abs(smoothed[i]!);
        maxLateralAtEdgeMm = Math.max(maxLateralAtEdgeMm, absLat);
        // Transition band: longitudinal envelope between ~0.2 and ~0.35 (heel → midfoot fade).
        if (u >= 0.18 && u <= 0.38) {
            const neighbors = getBaseAdjacency(base)?.[i] ?? [];
            for (const n of neighbors) {
                if (n >= topLimit) continue;
                maxTransitionBandJumpMm = Math.max(
                    maxTransitionBandJumpMm,
                    Math.abs(smoothed[i]! - smoothed[n]!),
                );
            }
        }
    }

    return {
        raw,
        smoothed,
        centerlineClosestIndex,
        centerlineClosestOffsetMm,
        centerlineSmoothedDeltaMm: smoothed[centerlineClosestIndex]!,
        maxLateralAtEdgeMm,
        maxTransitionBandJumpMm,
        coincidenceSyncIndexCount,
        crossMeshCoincidenceGroupCount,
        coincidentGroupCount,
    };
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

    // Heel-cup depth is handled below as a dedicated tangent displacement field
    // (monotone, single-sign — see getHeelCupDepthFrame), so it is stripped from
    // the vertical height-field delta here, exactly like heel-cup width (which
    // heightAt never carried). The parametric (non-base) path still uses
    // heelCupDepthBowlDelta via heightAt and is unaffected.
    const depthMm = field.corrections.heelCupDepthMm;
    const fieldForDelta: HeightFieldParams =
        depthMm !== 0
            ? { ...field, corrections: { ...field.corrections, heelCupDepthMm: 0 } }
            : field;

    // 1) Sample the pure modifier delta at every vertex's footprint (u, vSigned),
    //    mapping length/width from the detected base axes (orientation-robust).
    const delta = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        const lenCoord = array[i * 3 + lengthAxis]!;
        const widCoord = array[i * 3 + widthAxis]!;
        const u = Math.max(0, Math.min(1, (lenCoord - lenMin) / lenSize));
        const vSigned = Math.max(-1, Math.min(1, (widthSign * (widCoord - widCenter)) / (widSize / 2)));
        delta[i] = correctionDeltaAt(u, vSigned, fieldForDelta, neutral);
    }

    // 2) Optional Laplacian relaxation of the displacement field (cached adjacency).
    // Multi-mesh GLB bases skip smoothing: diffusing wedge/posting deltas on the
    // merged adjacency graph collapses the top rim loop and breaks closeGlbInsoleToSolid.
    const effectiveSmoothing =
        isMultiMesh && topVertexCount > 0 ? 0 : smoothingIterations;
    const adj = effectiveSmoothing > 0 ? getBaseAdjacency(base) : null;
    if (adj) {
        let current = delta;
        for (let it = 0; it < effectiveSmoothing; it++) {
            const next = new Float32Array(count);
            for (let i = 0; i < count; i++) {
                const neighbors = adj[i]!;
                if (neighbors.length === 0) {
                    next[i] = current[i]!;
                    continue;
                }
                let sum = 0;
                for (const n of neighbors) sum += current[n]!;
                // Gentle relaxation: blend halfway toward the neighbour average.
                next[i] = current[i]! * 0.5 + (sum / neighbors.length) * 0.5;
            }
            current = next;
        }
        delta.set(current);
    }

    const { smoothed: lateralDelta } = buildHeelCupWidthLateralDelta(
        base,
        field,
        { count, lengthAxis, widthAxis, lenMin, lenSize, widCenter, array },
        topFactors,
        isMultiMesh,
        topVertexCount,
    );

    // Heel-cup depth tangent displacement (see field construction above). The
    // frame is a pure function of the base geometry (cached per base), only the
    // depthMm scale changes per edit — no per-drag rebuild cost (HC-6).
    const depthFrame =
        depthMm > 0
            ? getHeelCupDepthFrame(
                  base,
                  { count, lengthAxis, widthAxis, lenMin, lenSize, widCenter, array },
                  thickAxis,
                  topFactors,
                  isMultiMesh,
                  topVertexCount,
              )
            : null;
    const depthVec = depthFrame ? heelCupDepthDisplacements(depthFrame, depthMm) : null;

    // 3) Apply vertical + lateral displacement. Multi-mesh GLBs use vertex-index
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

    // Parallel composition: vertical, width-lateral, and depth-tangent displacements
    // are each computed from baseline positions (above) and summed here in one pass.
    // Neither width nor depth reads the other's deformed coordinates — clinical
    // axes stay independent regardless of slider commit order.
    for (let i = 0; i < count; i++) {
        const t = array[i * 3 + thickAxis]!;
        let w: number;
        if (isMultiMesh && topVertexCount > 0) {
            w = i < topVertexCount ? 1 : 0;
        } else {
            w = topFactors ? topFactors[i]! : Math.max(0, Math.min(1, (t - thickMin) / thickSize));
        }
        const vertD = delta[i]! * w;
        const latD = lateralDelta[i]! * w;
        let dx = 0;
        let dy = 0;
        let dz = 0;
        if (depthFrame && depthVec) {
            const g = depthFrame.groupOf[i]!;
            if (g >= 0 && w !== 0) {
                dx = w * depthVec[g * 3]!;
                dy = w * depthVec[g * 3 + 1]!;
                dz = w * depthVec[g * 3 + 2]!;
            }
        }
        array[i * 3 + thickAxis] = t + vertD;
        array[i * 3 + widthAxis] += latD;
        array[i * 3] += dx;
        array[i * 3 + 1] += dy;
        array[i * 3 + 2] += dz;
    }

    // Rim-conformity transfer: scatter top-rim total deltas onto bottom wall
    // verts (multi-mesh only). Correspondence + weights are BASE-cached;
    // this call only applies w · (correctedTop − baseTop) from base positions.
    if (isMultiMesh && topVertexCount > 0) {
        const rimFrame = getRimConformityFrame(
            base,
            topVertexCount,
            lengthAxis,
            widthAxis,
            thickAxis,
            lenMin,
            lenSize,
        );
        if (rimFrame && rimFrame.seeds.length > 0) {
            transferRimConformityDeltas(base, array, rimFrame);
        }
    }

    if (originalBottomZ && typeof console !== "undefined") {
        let maxDrift = 0;
        const baseArr = base.getAttribute("position")!.array as Float32Array;
        for (let i = topVertexCount; i < count; i++) {
            // HC-1: only the plantar band must stay fixed; wall verts intentionally move.
            if (baseArr[i * 3 + thickAxis]! > PLANTAR_Z_MAX_MM) continue;
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
 * Uses the post-wedge top rim with the min-chord DP bridge (mesh-close).
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
