// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { ShapeFinishPanel } from "@/features/shape-finish/ShapeFinishPanel";
import { shouldShowShapeFinishOnShapeStep } from "@/features/shape-finish/shape-finish-mount";

/** Drop into clinical Shape step when PR #168 is enabled. */
export function ClinicalShapeFinishSlot() {
    if (!shouldShowShapeFinishOnShapeStep()) return null;
    return <ShapeFinishPanel />;
}
