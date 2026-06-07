// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BufferGeometry } from "three";
import type { SolidResult } from "@/lib/chili3d/kernel";
import { getDesignBase } from "@/lib/geometry/base-asset";
import { type HeightFieldParams, heightAt } from "@/lib/geometry/height-field";
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

/** Neutral field (no corrections, no elements) used as the displacement baseline. */
function neutralField(field: HeightFieldParams): HeightFieldParams {
    return {
        ...field,
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

/**
 * Apply the current design modifiers to a base mesh as a vertical deformation.
 *
 * The base is normalised through its bounding box (`x→u`, `y→vSigned`) and each
 * vertex is lifted by the modifier delta, weighted by normalised height so the
 * flat bottom is preserved and only the top surface moves. Returns a new
 * geometry; the input is left untouched.
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

    const sizeX = box.max.x - box.min.x || 1;
    const minY = box.min.y;
    const maxY = box.max.y;
    const cy = (minY + maxY) / 2;
    const halfY = (maxY - minY) / 2 || 1;
    const minZ = box.min.z;
    const sizeZ = box.max.z - box.min.z || 1;

    const neutral = neutralField(field);
    const array = pos.array as Float32Array;
    const count = pos.count;

    // 1) Sample the pure modifier delta at every vertex's footprint (u, vSigned).
    const delta = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        const x = array[i * 3]!;
        const y = array[i * 3 + 1]!;
        const u = Math.max(0, Math.min(1, (x - box.min.x) / sizeX));
        const vSigned = Math.max(-1, Math.min(1, (y - cy) / halfY));
        delta[i] = correctionDeltaAt(u, vSigned, field, neutral);
    }

    // 2) Optional Laplacian relaxation of the displacement field.
    if (smoothingIterations > 0 && geometry.index) {
        const adj = buildAdjacency(geometry.index.array, count);
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

    // 3) Apply the displacement along +Z, weighted by height above the bottom
    //    plane so the base footprint / flat bottom stays put.
    for (let i = 0; i < count; i++) {
        const z = array[i * 3 + 2]!;
        const w = Math.max(0, Math.min(1, (z - minZ) / sizeZ));
        array[i * 3 + 2] = z + delta[i]! * w;
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
