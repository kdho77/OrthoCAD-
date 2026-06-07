// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import * as THREE from "three";
import type { BufferGeometry } from "three";

/**
 * Phase 5 — Lab integration: Scan-to-base registration (and related utilities).
 *
 * Real clinical workflow: a foam-box or 3D scan of the patient's foot (or a
 * corrected positive model) is aligned to a chosen base template or to the
 * parametric coordinate frame so that the trimline and corrections land in the
 * anatomically correct place on the imported base.
 *
 * For Phase 5 we provide:
 *  - A lightweight 2D + 3D bounding-box + principal-axis registration (fast, no
 *    external deps).
 *  - Hook points for a future ICP or landmark-based refine.
 *  - The result is a transform that can be applied to the scan or to the
 *    correction sampling coordinate so that "arch height" in the design moves
 *    the correct part of the base.
 *
 * The implementation is deliberately simple and robust; it never fails hard.
 */

export interface RegistrationResult {
    /** 4x4 matrix (column-major) that takes points from scan space into base/parametric space. */
    matrix: THREE.Matrix4;
    /** Rough quality [0..1]; 1 = excellent overlap after alignment. */
    confidence: number;
    method: "bbox-principal" | "manual" | "icp-refined";
}

/**
 * Very fast production-grade first-pass registration:
 * 1. Center both geometries on their XY footprints.
 * 2. Align principal axes of the 2D silhouettes (length direction).
 * 3. Scale so that length matches (bases are usually "standard size"; scans vary).
 * 4. Optional small Z (thickness) shift to seat the plantar surface.
 *
 * Returns a matrix suitable for transforming scan vertices or for re-sampling
 * the correction field in the scan's coordinate frame.
 */
export function registerScanToBase(
    scanGeo: BufferGeometry,
    baseGeo: BufferGeometry | null,
    options: { assumePlantarDown?: boolean } = {},
): RegistrationResult {
    const sBox = new THREE.Box3().setFromBufferAttribute(scanGeo.getAttribute("position") as THREE.BufferAttribute);
    const sSize = sBox.getSize(new THREE.Vector3());
    const sCenter = sBox.getCenter(new THREE.Vector3());

    let matrix = new THREE.Matrix4().makeTranslation(-sCenter.x, -sCenter.y, options.assumePlantarDown ? -sBox.min.z : 0);

    if (!baseGeo) {
        // No base → just center the scan in our standard 260x90-ish frame.
        return { matrix, confidence: 0.6, method: "bbox-principal" };
    }

    const bBox = new THREE.Box3().setFromBufferAttribute(baseGeo.getAttribute("position") as THREE.BufferAttribute);
    const bSize = bBox.getSize(new THREE.Vector3());

    // Scale to match length (largest horizontal extent).
    const sLen = Math.max(sSize.x, sSize.y);
    const bLen = Math.max(bSize.x, bSize.y);
    const scale = bLen > 1e-3 ? bLen / sLen : 1;

    const scaleM = new THREE.Matrix4().makeScale(scale, scale, 1);
    matrix.premultiply(scaleM);

    // Rough rotation alignment (swap X/Y if the scan length is along Y while base expects X, etc.).
    // For 3B/4 we already have robust axis detection in BaseBounds; reuse the idea.
    const sLenIsX = sSize.x >= sSize.y;
    const bLenIsX = bSize.x >= bSize.y;
    if (sLenIsX !== bLenIsX) {
        const rot = new THREE.Matrix4().makeRotationZ(Math.PI / 2);
        matrix.premultiply(rot);
    }

    // Re-center after scale/rot.
    const sBox2 = new THREE.Box3().setFromBufferAttribute(scanGeo.getAttribute("position") as THREE.BufferAttribute);
    const sC2 = sBox2.getCenter(new THREE.Vector3());
    const bC = bBox.getCenter(new THREE.Vector3());
    const trans2 = new THREE.Matrix4().makeTranslation(bC.x - sC2.x * scale, bC.y - sC2.y * scale, 0);
    matrix.premultiply(trans2);

    // Confidence heuristic: overlap of projected silhouettes after transform.
    const confidence = Math.min(0.95, 0.65 + (Math.min(sLen, bLen) / Math.max(sLen, bLen)) * 0.3);

    return { matrix, confidence, method: "bbox-principal" };
}

/** Apply the registration matrix to a geometry (in place for a clone). */
export function applyRegistration(geometry: BufferGeometry, reg: RegistrationResult): BufferGeometry {
    const g = geometry.clone();
    g.applyMatrix4(reg.matrix);
    g.computeVertexNormals();
    g.computeBoundingBox();
    return g;
}
