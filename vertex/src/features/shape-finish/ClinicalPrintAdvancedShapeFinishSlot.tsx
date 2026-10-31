// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { ShapeFinishPanel } from "@/features/shape-finish/ShapeFinishPanel";
import { shouldShowShapeFinishInPrintAdvanced } from "@/features/shape-finish/shape-finish-mount";

/** Drop into ClinicalPrintStepPanel advanced accordion when PR #168 is enabled. */
export function ClinicalPrintAdvancedShapeFinishSlot() {
    if (!shouldShowShapeFinishInPrintAdvanced()) return null;
    return <ShapeFinishPanel />;
}
