// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BufferGeometry } from "three";
import type { SolidResult } from "@/lib/chili3d/kernel";
import { getDesignBase } from "@/lib/geometry/base-asset";
import { type HeightFieldParams, heightAt, smoothstep } from "@/lib/geometry/height-field";
import { analyzeManifold } from "@/lib/geometry/manifold";
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
    apexMoveMm: 0,
    medialFlangeMm: 0,
    lateralFlangeMm: 0,
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
        corrections: ZERO_CORRECTIONS,
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

/**
 * Apply the current design modifiers to a base mesh as a vertical deformation.
 *
 * Vertices are classified into a top sheet / bottom sheet / side walls (via
 * `classifyBaseTopFactors`) and lifted by the modifier delta weighted by their
 * top factor, so the **original bottom surface is preserved** while only the top
 * and side walls respond to corrections / trimline / thickness. When the base
 * has no recognisable bottom, it falls back to a plain normalised-height weight
 * (the previous behaviour). Returns a new geometry; the input is untouched.
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

    // 1) Sample the pure modifier delta at every vertex's footprint (u, vSigned),
    //    mapping length/width from the detected base axes (orientation-robust).
    const delta = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        const lenCoord = array[i * 3 + lengthAxis]!;
        const widCoord = array[i * 3 + widthAxis]!;
        const u = Math.max(0, Math.min(1, (lenCoord - lenMin) / lenSize));
        const vSigned = Math.max(-1, Math.min(1, (widCoord - widCenter) / (widSize / 2)));
        delta[i] = correctionDeltaAt(u, vSigned, field, neutral);
    }

    // 2) Optional Laplacian relaxation of the displacement field (cached adjacency).
    const adj = smoothingIterations > 0 ? getBaseAdjacency(base) : null;
    if (adj) {
        let current = delta;
        for (let it = 0; it < smoothingIterations; it++) {
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

    // 3) Apply the displacement along the thickness (up) axis, weighted by the
    //    per-vertex top factor (or normalised height as a fallback), so the
    //    bottom sheet stays put and only the top surface / side walls move.
    for (let i = 0; i < count; i++) {
        const t = array[i * 3 + thickAxis]!;
        const w = topFactors ? topFactors[i]! : Math.max(0, Math.min(1, (t - thickMin) / thickSize));
        array[i * 3 + thickAxis] = t + delta[i]! * w;
    }

    pos.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
}

/** Authoritative-tier result: modified base geometry + manifold/topology report. */
export function modifiedBaseResult(
    base: BufferGeometry,
    field: HeightFieldParams,
    smoothingIterations = 0,
): SolidResult {
    const geometry = applyBaseModifiers(base, field, smoothingIterations);
    const mesh = analyzeManifold(geometry);
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
export function resolveDesignMode(design: DesignState): DesignModeInfo {
    const base = getDesignBase(design);
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
