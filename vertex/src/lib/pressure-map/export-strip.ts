// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { DesignState } from "@/types";

/** Remove visualization-only pressure maps so manufacturing metadata stays unchanged. */
export function designStateForManufacturingExport(design: DesignState): DesignState {
    if (!design.pressureMaps) return design;
    const { pressureMaps: _omit, ...rest } = design;
    return rest;
}
