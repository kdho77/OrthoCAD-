// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { ShapeFinishPanel } from "@/features/shape-finish/ShapeFinishPanel";
import { shouldShowShapeFinishInPrintAdvanced } from "@/features/shape-finish/shape-finish-mount";

/** Drop into ClinicalPrintStepPanel advanced accordion when PR #168 is enabled. */
export function ClinicalPrintAdvancedShapeFinishSlot() {
    if (!shouldShowShapeFinishInPrintAdvanced()) return null;
    return <ShapeFinishPanel />;
}
