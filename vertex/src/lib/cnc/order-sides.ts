// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { orderDownloadSides } from "@/lib/geometry/export-geometry";
import type { DesignState, Side } from "@/types";
import { physicalSideLabel } from "../../../shared/export-filename";

/** Pair file (LR) or two copies of one physical foot (RR / LL). Omitted means LR. */
export type MillSide = "LR" | "RR" | "LL";

export function normalizeMillSide(value: string | null | undefined): MillSide {
    if (value === "RR" || value === "LL" || value === "LR") return value;
    return "LR";
}

function filenameBase(design: DesignState): { assetId?: string | null } {
    return { assetId: design.base?.assetId ?? design.paired?.leftBase?.assetId ?? null };
}

/**
 * Internal laterality of a physical foot. SAMPLE_Top stores the physical right
 * foot on internal left ({@link physicalSideLabel}).
 */
export function internalSideForPhysicalFoot(design: DesignState, physical: "left" | "right"): Side {
    const base = filenameBase(design);
    if (physicalSideLabel("left", base) === physical) return "left";
    return "right";
}

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

/**
 * Sides the Mill export puts in one file. Milled orders use {@link cncSidesForOrder}.
 * `RR` / `LL` are two copies of that physical foot. Omitted and `LR` keep today's sides.
 */
export function millExportSides(design: DesignState, requested?: Side[], millSide?: MillSide | null): Side[] {
    const mode = normalizeMillSide(millSide ?? undefined);
    if (mode !== "LR") {
        const internal = internalSideForPhysicalFoot(design, mode === "RR" ? "right" : "left");
        return [internal, internal];
    }
    return cncSidesForOrder(design, requested ?? orderDownloadSides(design));
}
