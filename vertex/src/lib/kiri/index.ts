import type { ProductionMethod } from "@/types";

// Kiri:Moto integration boundary (Phase 3).
//
// Kiri:Moto runs in the browser to slice TPU prints (including 45° belt
// printers) and to generate 3-axis CNC toolpaths + G-code. Phase 0 defines the
// presets and the request/response contract; the actual engine integration
// (iframe bridge or bundled worker) lands in Phase 3.

export interface PrinterPreset {
    id: string;
    name: string;
    method: Extract<ProductionMethod, "printing_solid" | "printing_shell" | "milling_3axis">;
    /** Belt printers slice on an inclined plane. */
    beltAngleDeg?: number;
    nozzleMm?: number;
    layerHeightMm?: number;
    material?: string;
    bed: { x: number; y: number; z: number };
}

export const PRINTER_PRESETS: PrinterPreset[] = [
    {
        id: "apex-belt-v2",
        name: "Apex Belt V2 (TPU)",
        method: "printing_solid",
        beltAngleDeg: 45,
        nozzleMm: 0.6,
        layerHeightMm: 0.3,
        material: "TPU 95A",
        bed: { x: 300, y: 100000, z: 200 },
    },
    {
        id: "cnc-3axis",
        name: "3-Axis CNC Mill",
        method: "milling_3axis",
        bed: { x: 400, y: 300, z: 120 },
    },
];

export interface SliceRequest {
    stl: ArrayBuffer;
    preset: PrinterPreset;
}

export interface SliceResult {
    gcode: string;
    estimatedTimeSec: number;
    estimatedMaterialMm3: number;
}

/** Placeholder slicer. Phase 3 replaces this with the Kiri:Moto engine. */
export async function slice(_req: SliceRequest): Promise<SliceResult> {
    throw new Error("Kiri:Moto slicing is integrated in Phase 3");
}
