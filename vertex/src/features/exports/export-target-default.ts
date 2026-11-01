// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { ExportOutputTarget } from "@/features/exports/export-target";

/** Print / Export footer defaults to Pair; Left and Right are optional overrides. */
export function effectiveExportTarget(
    target: ExportOutputTarget | null,
    cncLocked?: boolean,
): ExportOutputTarget {
    if (cncLocked) return "pair";
    return target ?? "pair";
}
