// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BufferGeometry } from "three";
import type { SolidResult } from "@/lib/chili3d/kernel";
import { type HeightFieldParams, heightAt } from "@/lib/geometry/height-field";
import { analyzeManifold } from "@/lib/geometry/manifold";
import type { SideCorrections } from "@/types";

// Base + Modifier deformation core (see docs/base-modifier-architecture.md).
//
// Modifiers (corrections, elements) are applied to a base mesh as a vertical
// *displacement field* derived from the shared height field, rather than as an
// absolute surface. This preserves the base's intrinsic shape while layering on
// the change introduced by the current corrections — fast, watertight-preserving
// and identical between preview and the procedural authoritative path.

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
export function correctionDeltaAt(u: number, vSigned: number, field: HeightFieldParams, neutral: HeightFieldParams): number {
    return heightAt(u, vSigned, field) - heightAt(u, vSigned, neutral);
}

/**
 * Apply the current design modifiers to a base mesh as a vertical deformation.
 *
 * The base is normalised through its bounding box (`x→u`, `y→vSigned`) and each
 * vertex is lifted by the modifier delta, weighted by normalised height so the
 * flat bottom is preserved and only the top surface moves. Returns a new
 * geometry; the input is left untouched.
 */
export function applyBaseModifiers(base: BufferGeometry, field: HeightFieldParams): BufferGeometry {
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
    for (let i = 0; i < array.length; i += 3) {
        const x = array[i]!;
        const y = array[i + 1]!;
        const z = array[i + 2]!;

        const u = Math.max(0, Math.min(1, (x - box.min.x) / sizeX));
        const vSigned = Math.max(-1, Math.min(1, (y - cy) / halfY));
        // Weight by height above the bottom plane so the base footprint/bottom
        // stays put and the deformation is concentrated on the top surface.
        const w = Math.max(0, Math.min(1, (z - minZ) / sizeZ));

        array[i + 2] = z + correctionDeltaAt(u, vSigned, field, neutral) * w;
    }

    pos.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
}

/** Authoritative-tier result: modified base geometry + manifold/topology report. */
export function modifiedBaseResult(base: BufferGeometry, field: HeightFieldParams): SolidResult {
    const geometry = applyBaseModifiers(base, field);
    const mesh = analyzeManifold(geometry);
    return {
        geometry,
        manifold: { ...mesh, occtClosed: false, isWatertight: mesh.isWatertight },
    };
}
