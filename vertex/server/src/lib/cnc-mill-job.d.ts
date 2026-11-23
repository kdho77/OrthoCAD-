// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Type stub for the generated Node ESM bundle. The .js file is emitted by
// scripts/bundle-cnc-mill-job.mjs and is not source.

export const PRINT_ORDER_CNC_REFUSAL: string;

export function assertMilledCncOrder(design: { method?: string }): void;

export function designStateFromDocument(doc: unknown): { method?: string };

export function millExportSides(design: unknown): Array<"left" | "right">;

export function buildMillCncGcode(input: { design: unknown }): Promise<{
    gcode: string;
    sides: Array<"left" | "right">;
    fileExtension: string;
    stats: { travelDistanceMm: number; estimatedTimeSec: number };
}>;
