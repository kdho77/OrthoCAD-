// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { orderDownloadSides } from "@/lib/geometry/export-geometry";
import type { DesignState, Side } from "@/types";

export function isMilledOrder(design: { method?: string }): boolean {
    return design.method === "milling_3axis";
}

/**
 * A milled order always mills every foot on the order.
 * The active-foot toggle does not apply. Print orders keep the requested sides.
 */
export function cncSidesForOrder(design: DesignState, requested: Side[]): Side[] {
    if (!isMilledOrder(design)) return requested;
    const sides = orderDownloadSides(design);
    return sides.length > 0 ? sides : requested;
}

/** Sides the Mill export puts in one file. Milled orders use {@link cncSidesForOrder}. */
export function millExportSides(design: DesignState, requested?: Side[]): Side[] {
    return cncSidesForOrder(design, requested ?? orderDownloadSides(design));
}
