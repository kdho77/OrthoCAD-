import type { ProductionMethod } from "@/types";
import type { BeltAxisMap } from "./belt-transform";

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
    beltGantryAngleDeg?: number;
    beltAxisMap?: BeltAxisMap;
    beltLeanSign?: 1 | -1;
    beltTravelSign?: 1 | -1;
    beltLeadInMm?: number;
    printDirection?: "toe-first" | "heel-first";
    acrossMarginMm?: number;
    lineWidthMm?: number;
    nozzleDiameterMm?: number;
    filamentDiameterMm?: number;
    flowMultiplier?: number;
    retractionEnabled?: boolean;
    retractMm?: number;
    retractFeedMmMin?: number;
    firstLayerFeedScale?: number;
    accelPrint?: number;
    accelTravel?: number;
    accelEnd?: number;
    nozzleTempC?: number;
    gantryStrokeMm?: number;
    beltWidthMm?: number;
    beltLeadInTab?: boolean;
}

export const PRINTER_PRESETS: PrinterPreset[] = [
    {
        id: "apex-belt-v2",
        name: "Apex Belt V2 (TPU)",
        method: "printing_solid",
        beltAngleDeg: 45,
        beltGantryAngleDeg: 45,
        beltAxisMap: { across: "X", gantry: "Y", belt: "Z" },
        beltLeanSign: 1,
        beltTravelSign: 1,
        beltLeadInMm: 0,
        printDirection: "toe-first",
        nozzleMm: 0.8,
        nozzleDiameterMm: 0.8,
        layerHeightMm: 0.65,
        lineWidthMm: 0.8,
        filamentDiameterMm: 1.75,
        flowMultiplier: 0.42 / Math.sin(Math.PI / 4),
        retractionEnabled: false,
        retractMm: 1.0,
        retractFeedMmMin: 1500,
        firstLayerFeedScale: 600 / 1800,
        accelPrint: 8000,
        accelTravel: 10000,
        accelEnd: 4000,
        nozzleTempC: 230,
        beltLeadInTab: false,
        material: "TPU 95A",
        bed: { x: 300, y: 100000, z: 200 },
    },
    {
        id: "apex-belt-v2-shell",
        name: "Apex Belt V2 — Shell (TPU)",
        method: "printing_shell",
        beltAngleDeg: 45,
        beltGantryAngleDeg: 45,
        beltAxisMap: { across: "X", gantry: "Y", belt: "Z" },
        beltLeanSign: 1,
        beltTravelSign: 1,
        beltLeadInMm: 0,
        printDirection: "toe-first",
        nozzleMm: 0.8,
        nozzleDiameterMm: 0.8,
        layerHeightMm: 0.65,
        lineWidthMm: 0.8,
        filamentDiameterMm: 1.75,
        flowMultiplier: 0.42 / Math.sin(Math.PI / 4),
        retractionEnabled: false,
        retractMm: 1.0,
        retractFeedMmMin: 1500,
        firstLayerFeedScale: 600 / 1800,
        accelPrint: 8000,
        accelTravel: 10000,
        accelEnd: 4000,
        nozzleTempC: 230,
        beltLeadInTab: false,
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
