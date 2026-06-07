// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import * as THREE from "three";
import { heightAt, type HeightFieldParams } from "@/lib/geometry/height-field";
import { INSOLE_LENGTH_MM, INSOLE_WIDTH_MM } from "@/lib/geometry/layout";
import { getDesignTrimline, type TrimlineCurve } from "@/lib/geometry/trimline";
import type { DesignState, PlacedElement, Side } from "@/types";

/**
 * Base + Modifier — deformation core.
 *
 * A *base* is an externally authored surface (a loaded GLB prefab), and the
 * clinical corrections / elements / trimline are *modifiers* applied on top of
 * it. This module owns the fast, real-time **vertical deformation** path that
 * shapes a base mesh with the shared height field (`height-field.ts`).
 *
 * Topology-changing modifiers (clean trimline cuts, discrete boolean elements,
 * posting/skive wedges) are handled separately by the OCCT boolean pipeline in
 * `base-modifier-booleans.ts`, which is reserved for Confirm / Export so live
 * editing stays responsive. See docs/base-modifier-architecture.md.
 */

export type DesignMode = "base" | "parametric";

export interface DesignModeInfo {
    mode: DesignMode;
    /** Human-readable label for the active base, when in base mode. */
    baseName?: string;
    /** Custom prefab id backing the base, when in base mode. */
    baseId?: string;
}

/** Resolve whether a design is modifying a loaded base GLB or is pure parametric. */
export function resolveDesignMode(design: DesignState): DesignModeInfo {
    if (design.customPrefabId) {
        return { mode: "base", baseName: design.customPrefabName, baseId: design.customPrefabId };
    }
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

export interface BaseDeformOptions {
    side: Side;
    corrections: HeightFieldParams["corrections"];
    elements?: PlacedElement[];
    trimline?: TrimlineCurve | null;
    /**
     * Laplacian smoothing iterations over the sampled displacement field. 0 keeps
     * the deformation cheap for interactive drags; 1–2 yields a clinically smooth
     * top surface for idle / confirm previews.
     */
    smoothingIterations?: number;
    /** Global scale on the applied correction height (0..1). Defaults to 1. */
    intensity?: number;
}

/**
 * Build the height field used to deform a base mesh. The base's *measured*
 * thickness becomes the field baseline, so flat regions of the base are left
 * untouched and only the clinical corrections are added on top.
 */
function deformField(
    options: BaseDeformOptions,
    lengthMm: number,
    widthMm: number,
    baseThicknessMm: number,
): HeightFieldParams {
    return {
        side: options.side,
        lengthMm,
        widthMm,
        thicknessMm: baseThicknessMm,
        corrections: options.corrections,
        elements: options.elements ?? [],
        includeSkives: true,
        includeElements: true,
        trimline: options.trimline ?? null,
    };
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
 * Applies the shared clinical height field to a base mesh as a **vertical
 * deformation**, preserving the flat bottom.
 *
 * Convention (matches the parametric pipeline and app-exported GLBs): the base
 * is laid out with X = length, Y = width, Z = thickness (up). The bottom of the
 * base (min-Z) stays planar; vertices are lifted toward the top in proportion
 * to how high up the wall they sit, so the bottom remains a flat print/contact
 * surface while the top takes on the arch dome, heel cup, posting and elements.
 *
 * Returns a new geometry; the input is not mutated. Falls back to a clone of the
 * input when the base is degenerate (no usable extent on an axis).
 */
export function deformBaseGeometry(
    geometry: THREE.BufferGeometry,
    options: BaseDeformOptions,
): THREE.BufferGeometry {
    const out = geometry.clone();
    const posAttr = out.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!posAttr || posAttr.count === 0) return out;

    out.computeBoundingBox();
    const bb = out.boundingBox;
    if (!bb) return out;

    const size = new THREE.Vector3();
    bb.getSize(size);
    const lenExtent = size.x;
    const widthExtent = size.y;
    const thickExtent = size.z;

    // Degenerate base — nothing meaningful to deform along.
    if (lenExtent < 1e-3 || widthExtent < 1e-3 || thickExtent < 1e-3) return out;

    const lengthMm = lenExtent;
    const widthMm = widthExtent;
    const field = deformField(options, lengthMm, widthMm, thickExtent);
    const intensity = options.intensity ?? 1;
    const count = posAttr.count;

    // 1) Sample the additive correction height at every vertex's footprint (u,v).
    const delta = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        const x = posAttr.getX(i);
        const y = posAttr.getY(i);
        const u = (x - bb.min.x) / lenExtent;
        const vSigned = ((y - bb.min.y) / widthExtent) * 2 - 1;
        // heightAt returns baseThickness + corrections; subtract baseline to get
        // the pure additive clinical shaping (0 where the base is unmodified).
        delta[i] = heightAt(u, vSigned, field) - thickExtent;
    }

    // 2) Optional Laplacian smoothing of the displacement field for clinical
    //    smoothness independent of the base's tessellation quality.
    const iterations = options.smoothingIterations ?? 0;
    if (iterations > 0 && out.index) {
        const adj = buildAdjacency(out.index.array, count);
        let current = delta;
        for (let it = 0; it < iterations; it++) {
            const next = new Float32Array(count);
            for (let i = 0; i < count; i++) {
                const neighbors = adj[i]!;
                if (neighbors.length === 0) {
                    next[i] = current[i]!;
                    continue;
                }
                let sum = 0;
                for (const n of neighbors) sum += current[n]!;
                // Blend toward the neighbour average (0.5 weight = gentle relaxation).
                next[i] = current[i]! * 0.5 + (sum / neighbors.length) * 0.5;
            }
            current = next;
        }
        delta.set(current);
    }

    // 3) Apply the displacement along +Z, scaled by how high the vertex sits on
    //    the base wall (topness). The flat bottom (topness = 0) is preserved.
    for (let i = 0; i < count; i++) {
        const z = posAttr.getZ(i);
        const topness = (z - bb.min.z) / thickExtent;
        posAttr.setZ(i, z + delta[i]! * topness * intensity);
    }

    posAttr.needsUpdate = true;
    out.computeVertexNormals();
    out.computeBoundingBox();
    out.computeBoundingSphere();
    return out;
}

/**
 * Convenience wrapper that pulls the modifier inputs for one side straight from
 * a design + live correction set, including the committed trimline.
 */
export function deformBaseForDesign(
    geometry: THREE.BufferGeometry,
    design: DesignState,
    side: Side,
    corrections: HeightFieldParams["corrections"],
    elements: PlacedElement[],
    smoothingIterations = 0,
): THREE.BufferGeometry {
    return deformBaseGeometry(geometry, {
        side,
        corrections,
        elements,
        trimline: getDesignTrimline(design, side),
        smoothingIterations,
    });
}

/** Reference footprint extent used when a caller needs nominal base dimensions. */
export const NOMINAL_BASE_LENGTH_MM = INSOLE_LENGTH_MM;
export const NOMINAL_BASE_WIDTH_MM = INSOLE_WIDTH_MM;
