// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type * as THREE from "three";
import type { BufferGeometry } from "three";
import { type KabschResult, kabschRigid } from "@/lib/geometry/kabsch";

/**
 * Rigid scan-to-base registration via Kabsch (rotation + translation only).
 *
 * The previous bbox-principal path applied uniform scale and is deleted — it
 * contradicted the ratified rigid-no-scale clinical rule and had zero callers.
 *
 * This module is pure: no UI, store, or geometry-pipeline wiring in Phase 1.
 */

export type { KabschResult };

/** @deprecated Alias retained for type continuity; prefer KabschResult. */
export type RegistrationResult = KabschResult;

/**
 * Rigid Kabsch: patient markers M1/M2/M3 → base landmarks B1/B2/B3.
 * No scale. Reflection → typed KabschError ("wrong_foot_marker_order").
 */
export function registerScanToBase(
    scanMarkers: [THREE.Vector3, THREE.Vector3, THREE.Vector3],
    baseMarkers: [THREE.Vector3, THREE.Vector3, THREE.Vector3],
): KabschResult {
    return kabschRigid(scanMarkers, baseMarkers);
}

/** Apply a rigid registration matrix to a cloned geometry. */
export function applyRegistration(geometry: BufferGeometry, reg: KabschResult): BufferGeometry {
    const g = geometry.clone();
    g.applyMatrix4(reg.matrix);
    g.computeVertexNormals();
    g.computeBoundingBox();
    return g;
}
