// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { Side } from "@/types";

export type ExportOutputTarget = Side | "pair";

export function sidesForExportTarget(target: ExportOutputTarget): Side[] {
    return target === "pair" ? ["left", "right"] : [target];
}

export function exportTargetLabel(target: ExportOutputTarget): string {
    if (target === "pair") return "Pair";
    return target === "left" ? "Left" : "Right";
}
