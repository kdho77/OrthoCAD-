// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { ShapeFinishPanel } from "@/features/shape-finish/ShapeFinishPanel";
import { shouldShowShapeFinishOnShapeStep } from "@/features/shape-finish/shape-finish-mount";

/** Drop into clinical Shape step when PR #168 is enabled. */
export function ClinicalShapeFinishSlot() {
    if (!shouldShowShapeFinishOnShapeStep()) return null;
    return <ShapeFinishPanel />;
}
