// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { ProductionMethod } from "@/types";

/** UI-only gate until shell manufacturing is product-ready (Setup > Production). */
export const PRINTING_SHELL_SELECTABLE_IN_UI = false;

export function productionMethodDisabledInUi(id: ProductionMethod): boolean {
    return id === "printing_shell" && !PRINTING_SHELL_SELECTABLE_IN_UI;
}
