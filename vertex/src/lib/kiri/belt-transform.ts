// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { PrinterPreset } from "./presets";

export type BeltAxis = "X" | "Y" | "Z";

export interface BeltAxisMap {
    across: BeltAxis;
    gantry: BeltAxis;
    belt: BeltAxis;
}

export interface BeltPoint {
    x: number;
    y: number;
    z: number;
}

export interface MachinePoint {
    across: number;
    gantry: number;
    belt: number;
}

export interface BeltTransformConfig {
    beltGantryAngleDeg: number;
    beltAxisMap: BeltAxisMap;
    beltLeanSign: 1 | -1;
    beltTravelSign: 1 | -1;
    beltLeadInMm: number;
    layerHeightMm: number;
    printDirection: "toe-first" | "heel-first";
    acrossMarginMm: number;
    lineWidthMm: number;
    nozzleDiameterMm: number;
    filamentDiameterMm: number;
    flowMultiplier: number;
    retractionEnabled: boolean;
    retractMm: number;
    retractFeedMmMin: number;
    firstLayerFeedScale: number;
    accelPrint: number;
    accelTravel: number;
    accelEnd: number;
    nozzleTempC: number;
    gantryStrokeMm: number;
    beltWidthMm: number;
}

export class BeltConfigError extends Error {
    readonly code = "BELT_CONFIG";
    constructor(message: string) {
        super(message);
        this.name = "BeltConfigError";
    }
}

export class BeltBoundsError extends Error {
    readonly code = "BELT_BOUNDS";
    constructor(message: string) {
        super(message);
        this.name = "BeltBoundsError";
    }
}

export class MissingToeHeelError extends Error {
    readonly code = "MISSING_TOE_HEEL";
    constructor(message: string) {
        super(message);
        this.name = "MissingToeHeelError";
    }
}

export class SlicePlaneError extends Error {
    readonly code = "SLICE_PLANE";
    readonly planeZ: number;
    constructor(planeZ: number, message: string) {
        super(message);
        this.name = "SlicePlaneError";
        this.planeZ = planeZ;
    }
}

export class BeltContactError extends Error {
    readonly code = "BELT_CONTACT";
    readonly layerIndex: number;
    readonly move: string;
    readonly gantry: number;
    constructor(layerIndex: number, move: string, gantry: number) {
        super(
            `Belt contact violation at layer ${layerIndex}: ${move} gantry=${gantry} ` +
                `(gantry < -1e-6 is a defect, not clamped)`,
        );
        this.name = "BeltContactError";
        this.layerIndex = layerIndex;
        this.move = move;
        this.gantry = gantry;
    }
}

export const DEFAULT_BELT_AXIS_MAP: BeltAxisMap = { across: "X", gantry: "Y", belt: "Z" };

/** Cura/IdeaFormer flow anchor at lineWidth 0.80, layerHeight 0.65, θ 45°. */
export const FLOW_ANCHOR_E_PER_MM = 0.0908;
export const FLOW_ANCHOR_LINE_WIDTH_MM = 0.8;
export const FLOW_ANCHOR_LAYER_HEIGHT_MM = 0.65;
export const FLOW_ANCHOR_SEGMENT_MM = 15.2;
export const FLOW_ANCHOR_E = 1.38016;

const DEG = Math.PI / 180;

export interface BeltTrig {
    theta: number;
    sin: number;
    cos: number;
    tan: number;
    leanSign: 1 | -1;
    travelSign: 1 | -1;
}

export function beltTrig(
    cfg: Pick<BeltTransformConfig, "beltGantryAngleDeg" | "beltLeanSign" | "beltTravelSign">,
): BeltTrig {
    validateBeltAngle(cfg.beltGantryAngleDeg);
    const theta = cfg.beltGantryAngleDeg * DEG;
    return {
        theta,
        sin: Math.sin(theta),
        cos: Math.cos(theta),
        tan: Math.tan(theta),
        leanSign: cfg.beltLeanSign,
        travelSign: cfg.beltTravelSign,
    };
}

export function validateBeltAngle(angleDeg: number): void {
    if (!(angleDeg > 0 && angleDeg < 90) || !Number.isFinite(angleDeg)) {
        throw new BeltConfigError(`beltGantryAngleDeg must be in (0°, 90°), got ${angleDeg}`);
    }
}

export function validateBeltAxisMap(map: BeltAxisMap): void {
    const axes = [map.across, map.gantry, map.belt];
    if (new Set(axes).size !== 3) {
        throw new BeltConfigError(`beltAxisMap must be a permutation of X,Y,Z; got ${JSON.stringify(map)}`);
    }
}

export function validateBeltConfig(cfg: BeltTransformConfig): void {
    validateBeltAngle(cfg.beltGantryAngleDeg);
    validateBeltAxisMap(cfg.beltAxisMap);
}

/** Perpendicular bead thickness — derived, not a config input. */
export function perpendicularThicknessMm(
    cfg: Pick<BeltTransformConfig, "layerHeightMm" | "beltGantryAngleDeg">,
): number {
    validateBeltAngle(cfg.beltGantryAngleDeg);
    return cfg.layerHeightMm * Math.sin(cfg.beltGantryAngleDeg * DEG);
}

/** Horizontal pitch in the X-rotated slice frame. */
export function slicePitchRotatedMm(
    cfg: Pick<BeltTransformConfig, "layerHeightMm" | "beltGantryAngleDeg">,
): number {
    return perpendicularThicknessMm(cfg);
}

/** Commanded belt-axis coordinate of layer n (0-based). */
export function layerBeltZ(n: number, layerHeightMm: number): number {
    return layerHeightMm * (n + 1);
}

/**
 * Belt-frame (x across, y along belt, z height) → machine across/gantry/belt.
 * Z_belt = y + leanSign * z/tanθ; Y_gantry = z/sinθ; X_across = x.
 */
export function beltToMachine(p: BeltPoint, cfg: BeltTransformConfig): MachinePoint {
    const t = beltTrig(cfg);
    return {
        across: p.x,
        gantry: p.z / t.sin,
        belt: t.travelSign * (p.y + t.leanSign * (p.z / t.tan)),
    };
}

export function machineToBelt(m: MachinePoint, cfg: BeltTransformConfig): BeltPoint {
    const t = beltTrig(cfg);
    const belt = t.travelSign * m.belt;
    const z = m.gantry * t.sin;
    return {
        x: m.across,
        y: belt - t.leanSign * (z / t.tan),
        z,
    };
}

/** Rotate belt-frame point about X by leanSign·θ so z' = sinθ · s, s = y + lean·z/tanθ. */
export function rotateBeltToSliceFrame(p: BeltPoint, cfg: BeltTransformConfig): BeltPoint {
    const t = beltTrig(cfg);
    return {
        x: p.x,
        y: p.y * t.cos - t.leanSign * p.z * t.sin,
        z: p.y * t.sin + t.leanSign * p.z * t.cos,
    };
}

/** Rotated-frame → machine. At θ=45°, gantry = leanSign·(z' − y'), belt = z'/sinθ. */
export function sliceFrameToMachine(p: BeltPoint, cfg: BeltTransformConfig): MachinePoint {
    const t = beltTrig(cfg);
    return {
        across: p.x,
        gantry: (t.leanSign * (p.z * t.cos - p.y * t.sin)) / t.sin,
        belt: t.travelSign * (p.z / t.sin),
    };
}

export function applyAxisMap(m: MachinePoint, map: BeltAxisMap): { X: number; Y: number; Z: number } {
    const out = { X: 0, Y: 0, Z: 0 };
    out[map.across] = m.across;
    out[map.gantry] = m.gantry;
    out[map.belt] = m.belt;
    return out;
}

export function axisLetters(map: BeltAxisMap): { across: BeltAxis; gantry: BeltAxis; belt: BeltAxis } {
    return { across: map.across, gantry: map.gantry, belt: map.belt };
}

/**
 * Extrusion per mm of machine-space in-layer path.
 * Calibrated so 15.20 mm @ 0.80/0.65 yields E = 1.38016 with the default flow pair.
 */
export function extrusionPerMm(
    cfg: Pick<
        BeltTransformConfig,
        "lineWidthMm" | "layerHeightMm" | "filamentDiameterMm" | "flowMultiplier" | "beltGantryAngleDeg"
    >,
): number {
    const area = Math.PI * (cfg.filamentDiameterMm / 2) ** 2;
    const sin = Math.sin(cfg.beltGantryAngleDeg * DEG);
    return (cfg.flowMultiplier * cfg.lineWidthMm * cfg.layerHeightMm * sin) / area;
}

/** Linear part of footprint → belt-frame (toe-first). det = +1. */
export const TOE_FIRST_ORIENT_MATRIX: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
] = [
    [0, 1, 0],
    [-1, 0, 0],
    [0, 0, 1],
];

export function orientationDeterminant(matrix: readonly (readonly [number, number, number])[]): number {
    const [[a, b, c], [d, e, f], [g, h, i]] = matrix;
    return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

/** Holds emitted E invariant at 45° vs the prior 0.42 × layerHeight (no sinθ) model. */
const DEFAULT_FLOW_MULTIPLIER = 0.42 / Math.sin(Math.PI / 4);

export function resolveBeltConfig(
    preset: PrinterPreset,
    overrides: { layerHeightMm?: number } = {},
): BeltTransformConfig {
    const angle = preset.beltGantryAngleDeg ?? preset.beltAngleDeg ?? 45;
    const cfg: BeltTransformConfig = {
        beltGantryAngleDeg: angle,
        beltAxisMap: preset.beltAxisMap ?? DEFAULT_BELT_AXIS_MAP,
        beltLeanSign: preset.beltLeanSign ?? 1,
        beltTravelSign: preset.beltTravelSign ?? 1,
        beltLeadInMm: preset.beltLeadInMm ?? 0,
        layerHeightMm: overrides.layerHeightMm ?? preset.layerHeightMm ?? 0.65,
        printDirection: preset.printDirection ?? "toe-first",
        acrossMarginMm: preset.acrossMarginMm ?? 0,
        lineWidthMm: preset.lineWidthMm ?? 0.8,
        nozzleDiameterMm: preset.nozzleDiameterMm ?? preset.nozzleMm ?? 0.8,
        filamentDiameterMm: preset.filamentDiameterMm ?? 1.75,
        flowMultiplier: preset.flowMultiplier ?? DEFAULT_FLOW_MULTIPLIER,
        retractionEnabled: preset.retractionEnabled ?? false,
        retractMm: preset.retractMm ?? 1.0,
        retractFeedMmMin: preset.retractFeedMmMin ?? 1500,
        firstLayerFeedScale: preset.firstLayerFeedScale ?? 600 / 1800,
        accelPrint: preset.accelPrint ?? 8000,
        accelTravel: preset.accelTravel ?? 10000,
        accelEnd: preset.accelEnd ?? 4000,
        nozzleTempC: preset.nozzleTempC ?? 230,
        gantryStrokeMm: preset.gantryStrokeMm ?? preset.bed.z,
        beltWidthMm: preset.beltWidthMm ?? preset.bed.x,
    };
    validateBeltConfig(cfg);
    return cfg;
}
