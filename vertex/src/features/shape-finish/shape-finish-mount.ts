// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Where Shape / Finish (Track 5b) mounts in the UI.
 *
 * **#168 clinical rail (not on main yet):** set `CLINICAL_RAIL_PR168_AVAILABLE` true after merge and
 * wire `ShapeFinishPanel` in:
 * - `ClinicalStepId === "shape"` (with corrections), or
 * - `ClinicalPrintStepPanel` advanced accordion (Print / Export step).
 *
 * Until then, `RightPanel` printing tab uses `printing-tab-fallback` only.
 */

/** Flip to `true` when PR #168 clinical workflow lands on main. */
export const CLINICAL_RAIL_PR168_AVAILABLE = false;

export type ShapeFinishMountId = "clinical-shape" | "clinical-print-advanced" | "printing-tab-fallback";

export function shapeFinishMountForLayout(): ShapeFinishMountId {
    if (!CLINICAL_RAIL_PR168_AVAILABLE) {
        return "printing-tab-fallback";
    }
    // Default post-#168: primary on Shape step; Print step uses advanced only.
    return "clinical-shape";
}

export function shouldShowShapeFinishInPrintingTab(): boolean {
    return shapeFinishMountForLayout() === "printing-tab-fallback";
}

/** Post-#168: render inside ClinicalPrintStepPanel advanced block. */
export function shouldShowShapeFinishInPrintAdvanced(): boolean {
    return CLINICAL_RAIL_PR168_AVAILABLE;
}

/** Post-#168: render on Shape workflow step. */
export function shouldShowShapeFinishOnShapeStep(): boolean {
    return CLINICAL_RAIL_PR168_AVAILABLE;
}
