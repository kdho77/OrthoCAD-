// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { ProductionMethod } from "@/types";

/**
 * Printer family for Export. Belt is the inclined Apex belt.
 * CNC keeps the Idaho pocket layout. "bed" is a conventional 90° printer
 * (desktop FDM today). A future large bed such as the Mingda MD400D would
 * use "bed" and the existing side-by-side compose — it is not a preset here.
 */
export type ExportMachineFamily = "belt" | "cnc" | "bed";

/** Belt downloads one file per foot. CNC and bed printers keep one side-by-side layout. */
export type PairExportLayout = "separate-files" | "side-by-side";

export function exportMachineFamily(input: {
    method: ProductionMethod;
    beltAngleDeg?: number;
}): ExportMachineFamily {
    if (input.method === "milling_3axis") return "cnc";
    if (input.beltAngleDeg != null && input.beltAngleDeg > 0) return "belt";
    return "bed";
}

export function pairExportLayout(family: ExportMachineFamily): PairExportLayout {
    return family === "belt" ? "separate-files" : "side-by-side";
}
