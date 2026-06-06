import type { ProductionMethod } from "@/types";

export interface PrinterPreset {
    id: string;
    name: string;
    method: ProductionMethod;
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
        id: "apex-belt-v2-shell",
        name: "Apex Belt V2 — Shell (TPU)",
        method: "printing_shell",
        beltAngleDeg: 45,
        nozzleMm: 0.6,
        layerHeightMm: 0.3,
        material: "TPU 95A",
        bed: { x: 300, y: 100000, z: 200 },
    },
    {
        id: "desktop-fdm",
        name: "Desktop FDM (TPU)",
        method: "printing_solid",
        nozzleMm: 0.4,
        layerHeightMm: 0.2,
        material: "TPU 95A",
        bed: { x: 250, y: 210, z: 210 },
    },
    {
        id: "cnc-3axis",
        name: "3-Axis CNC Mill",
        method: "milling_3axis",
        bed: { x: 400, y: 300, z: 120 },
    },
];

export function presetsForMethod(method: ProductionMethod): PrinterPreset[] {
    return PRINTER_PRESETS.filter((p) => p.method === method);
}
