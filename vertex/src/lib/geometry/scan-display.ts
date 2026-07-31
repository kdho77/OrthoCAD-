// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Provisional DISPLAY-ONLY framing for unregistered scans (Amendment M).
 *
 * Unit scale is a discrete, deterministic units correction (mm/cm/m) — never a
 * fitted Kabsch scale. The transform lives on the mesh matrix only; geometry
 * vertices are never mutated. It must not reach the export path.
 */

import type { BufferGeometry } from "three";
import * as THREE from "three";
import { INSOLE_LENGTH_MM } from "@/lib/geometry/layout";

/** Adult foot length band used only to pick among discrete unit candidates. */
export const FOOT_LENGTH_MM_LO = 120;
export const FOOT_LENGTH_MM_HI = 400;
export const FOOT_LENGTH_MM_TARGET = 270;

/** Lift above the plantar plane so the provisional scan is not buried in the base. */
export const PROVISIONAL_LIFT_MM = 28;

export type InferredScanUnit = "mm" | "cm" | "m";
export type DominantAxis = "x" | "y" | "z";

export type ScanDisplayInfo = {
    rawMin: [number, number, number];
    rawMax: [number, number, number];
    rawSize: [number, number, number];
    rawLongest: number;
    rawCenter: [number, number, number];
    dominantRawAxis: DominantAxis;
    inferredUnit: InferredScanUnit;
    /** Multiply raw coordinates by this to express millimetres (1 | 10 | 1000). */
    displayScale: number;
    /** Column-major mesh.matrix for unregistered display (not registration). */
    provisionalMatrixElements: number[];
    /**
     * When display was built from a selected-component bbox, the full-raw
     * inference (before cleanup) for before/after UI. Undefined if same as above.
     */
    priorRawInferredUnit?: InferredScanUnit;
    priorRawDominantAxis?: DominantAxis;
    priorRawLongest?: number;
};

function bboxOf(geometry: BufferGeometry): {
    min: THREE.Vector3;
    max: THREE.Vector3;
    size: THREE.Vector3;
    center: THREE.Vector3;
    longest: number;
    dominant: DominantAxis;
} {
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const box = geometry.boundingBox ?? new THREE.Box3();
    const min = box.min.clone();
    const max = box.max.clone();
    const size = new THREE.Vector3().subVectors(max, min);
    const center = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);
    let dominant: DominantAxis = "x";
    let longest = size.x;
    if (size.y > longest) {
        longest = size.y;
        dominant = "y";
    }
    if (size.z > longest) {
        longest = size.z;
        dominant = "z";
    }
    return { min, max, size, center, longest, dominant };
}

/**
 * Discrete unit inference — pick among {mm, cm, m} only.
 * Not continuous, not optimised, not a Kabsch scale.
 */
export function inferScanDisplayScale(rawLongest: number): {
    inferredUnit: InferredScanUnit;
    displayScale: number;
} {
    const candidates: { inferredUnit: InferredScanUnit; displayScale: number }[] = [
        { inferredUnit: "mm", displayScale: 1 },
        { inferredUnit: "cm", displayScale: 10 },
        { inferredUnit: "m", displayScale: 1000 },
    ];
    let best = candidates[0]!;
    let bestScore = Infinity;
    for (const c of candidates) {
        const mm = rawLongest * c.displayScale;
        const inBand = mm >= FOOT_LENGTH_MM_LO && mm <= FOOT_LENGTH_MM_HI;
        const dist = Math.abs(mm - FOOT_LENGTH_MM_TARGET);
        // Prefer in-band candidates; among equals, nearest to target.
        const score = (inBand ? 0 : 1e9) + dist;
        if (score < bestScore) {
            bestScore = score;
            best = c;
        }
    }
    return best;
}

/** Rotate so the longest AABB axis aligns with +X (viewer length axis, pre Rx−90°). */
function orientLongestToX(dominant: DominantAxis): THREE.Matrix4 {
    const m = new THREE.Matrix4();
    if (dominant === "x") return m.identity();
    if (dominant === "y") {
        // Y → X: rotate −90° about Z
        return m.makeRotationZ(-Math.PI / 2);
    }
    // Z → X: rotate +90° about Y
    return m.makeRotationY(Math.PI / 2);
}

/**
 * Build provisional display matrix: T_lift · R_orient · S_unit · T_center.
 * DISPLAY ONLY — never pass to Kabsch; never bake into geometry.
 */
export function computeProvisionalDisplayMatrix(
    displayScale: number,
    dominant: DominantAxis,
    center: THREE.Vector3,
): THREE.Matrix4 {
    const tCenter = new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z);
    const s = new THREE.Matrix4().makeScale(displayScale, displayScale, displayScale);
    const r = orientLongestToX(dominant);
    // Keep the framed scan near the base footprint origin (group supplies side offset).
    const tLift = new THREE.Matrix4().makeTranslation(INSOLE_LENGTH_MM / 2, 0, PROVISIONAL_LIFT_MM);
    return new THREE.Matrix4().multiplyMatrices(tLift, r).multiply(s).multiply(tCenter);
}

export function buildScanDisplayInfoFromBBox(
    min: THREE.Vector3,
    max: THREE.Vector3,
    prior?: {
        inferredUnit: InferredScanUnit;
        dominantRawAxis: DominantAxis;
        rawLongest: number;
    },
): ScanDisplayInfo {
    const size = new THREE.Vector3().subVectors(max, min);
    const center = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);
    let dominant: DominantAxis = "x";
    let longest = size.x;
    if (size.y > longest) {
        longest = size.y;
        dominant = "y";
    }
    if (size.z > longest) {
        longest = size.z;
        dominant = "z";
    }
    const { inferredUnit, displayScale } = inferScanDisplayScale(longest);
    const matrix = computeProvisionalDisplayMatrix(displayScale, dominant, center);
    const info: ScanDisplayInfo = {
        rawMin: [min.x, min.y, min.z],
        rawMax: [max.x, max.y, max.z],
        rawSize: [size.x, size.y, size.z],
        rawLongest: longest,
        rawCenter: [center.x, center.y, center.z],
        dominantRawAxis: dominant,
        inferredUnit,
        displayScale,
        provisionalMatrixElements: Array.from(matrix.elements),
    };
    if (prior) {
        info.priorRawInferredUnit = prior.inferredUnit;
        info.priorRawDominantAxis = prior.dominantRawAxis;
        info.priorRawLongest = prior.rawLongest;
    }
    return info;
}

export function buildScanDisplayInfo(geometry: BufferGeometry): ScanDisplayInfo {
    const { min, max } = bboxOf(geometry);
    return buildScanDisplayInfoFromBBox(min, max);
}

export function provisionalMatrixFromDisplay(display: ScanDisplayInfo): THREE.Matrix4 {
    return new THREE.Matrix4().fromArray(display.provisionalMatrixElements);
}

/**
 * Active mesh matrix: registration if present, else provisional display.
 * Registration never incorporates the provisional matrix (orient/center/lift).
 * Discrete `displayScale` is applied inside the registration path separately.
 */
export function resolveScanMeshMatrix(
    display: ScanDisplayInfo | undefined,
    registration: THREE.Matrix4 | null,
): THREE.Matrix4 {
    if (registration) return registration.clone();
    if (display) return provisionalMatrixFromDisplay(display);
    return new THREE.Matrix4().identity();
}

/**
 * Convert a world-space pick to scan LOCAL (geometry) coordinates via the
 * inverse of the mesh's current matrixWorld. Must be used for marker storage
 * so provisional display cannot leak into Kabsch.
 */
export function worldHitToScanLocal(
    worldPoint: THREE.Vector3,
    meshMatrixWorld: THREE.Matrix4,
): THREE.Vector3 {
    return worldPoint.clone().applyMatrix4(meshMatrixWorld.clone().invert());
}
