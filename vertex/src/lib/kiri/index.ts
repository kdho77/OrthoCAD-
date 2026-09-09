// Kiri:Moto integration boundary (Phase 3).
//
// Browser-based slicing for TPU prints (including 45° belt printers) and 3-axis
// CNC toolpaths + G-code. Ships a self-contained in-house engine
// (`generateGcode`); the hosted Kiri:Moto engine can be swapped in behind this
// same interface without touching call sites.

export { emitBeltFdm, measureGcodeEnvelope } from "./belt-export";
export { orientMeshToBeltFrame, toeFirstOrientMatrix } from "./belt-orient";
export {
    applyAxisMap,
    BeltContactError,
    type BeltPoint,
    type BeltTransformConfig,
    beltToMachine,
    beltTrig,
    extrusionPerMm,
    FLOW_ANCHOR_E,
    FLOW_ANCHOR_E_PER_MM,
    FLOW_ANCHOR_SEGMENT_MM,
    layerBeltZ,
    type MachinePoint,
    machineToBelt,
    orientationDeterminant,
    perpendicularThicknessMm,
    resolveBeltConfig,
    rotateBeltToSliceFrame,
    sliceFrameToMachine,
    slicePitchRotatedMm,
    TOE_FIRST_ORIENT_MATRIX,
} from "./belt-transform";
export { type CamOverrides, type CamResult, generateGcode } from "./engine";
export type { GcodeStats } from "./gcode";
export { PRINTER_PRESETS, type PrinterPreset, presetsForMethod } from "./presets";
export type { Move } from "./slicer";
