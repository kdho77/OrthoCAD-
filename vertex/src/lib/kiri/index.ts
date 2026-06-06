// Kiri:Moto integration boundary (Phase 3).
//
// Browser-based slicing for TPU prints (including 45° belt printers) and 3-axis
// CNC toolpaths + G-code. Ships a self-contained in-house engine
// (`generateGcode`); the hosted Kiri:Moto engine can be swapped in behind this
// same interface without touching call sites.

export { type CamOverrides, type CamResult, generateGcode } from "./engine";
export { type PrinterPreset, PRINTER_PRESETS, presetsForMethod } from "./presets";
export type { GcodeStats } from "./gcode";
export type { Move } from "./slicer";
