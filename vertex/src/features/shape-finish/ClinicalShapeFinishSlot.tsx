// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ShapeFinishPanel } from "@/features/shape-finish/ShapeFinishPanel";
import { shouldShowShapeFinishOnShapeStep } from "@/features/shape-finish/shape-finish-mount";

/** Drop into clinical Shape step when PR #168 is enabled. */
export function ClinicalShapeFinishSlot() {
    if (!shouldShowShapeFinishOnShapeStep()) return null;
    return <ShapeFinishPanel />;
}
