// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Physical-foot gate for belt G-code. Rules are the frozen port of
// kdho77/VertexSlice validation/handedness_gates/hand_classify.py
// (branch cursor/lr-swap-gates-1124). Do not loosen them.

const ARCH_MIN_MM = 5.0;
const END_MIN_MM = 5.0;
const AXIS_WORD = /([XYZEF])(-?\d*\.?\d+)/g;

export type GcodeFoot = "left" | "right" | "inconclusive";

/** Metrics match hand_classify.py. They are present once the part is long enough to score. */
export interface GcodeFootDetection {
    foot: GcodeFoot;
    reason?: string;
    heelEndMaxY?: number;
    toeEndMaxY?: number;
    heelHighZt?: boolean;
    archMaxYXminus?: number;
    archMaxYXplus?: number;
    medialSide?: "X+" | "X-";
    lengthMm?: number;
    xCentre?: number;
}

export class GcodeHandednessError extends Error {
    readonly code = "GCODE_HANDEDNESS_MISMATCH" as const;

    constructor(message: string) {
        super(message);
        this.name = "GcodeHandednessError";
    }
}

function pythonRound(value: number, digits: number): number {
    const factor = 10 ** digits;
    const shifted = value * factor;
    const sign = shifted < 0 ? -1 : 1;
    const abs = Math.abs(shifted);
    const base = Math.floor(abs);
    const frac = abs - base;
    const rounded = Math.abs(frac - 0.5) < 1e-9 ? (base % 2 === 0 ? base : base + 1) : Math.round(abs);
    const result = (sign * rounded) / factor;
    return result === 0 ? 0 : result;
}

/** Extrusion moves only (E>0), absolute XYZ, same word scan as hand_classify.py. */
function extrusions(gcode: string): Float64Array {
    const coords: number[] = [];
    let x = 0;
    let y = 0;
    let z = 0;
    const lines = gcode.split("\n");
    for (let li = 0; li < lines.length; li++) {
        let line = lines[li] ?? "";
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (!(line.startsWith("G1") || line.startsWith("G0"))) continue;
        const semi = line.indexOf(";");
        const code = semi >= 0 ? line.slice(0, semi) : line;
        let ev: number | null = null;
        AXIS_WORD.lastIndex = 0;
        for (const match of code.matchAll(AXIS_WORD)) {
            const key = match[1];
            const value = Number(match[2]);
            if (key === "X") x = value;
            else if (key === "Y") y = value;
            else if (key === "Z") z = value;
            else if (key === "E") ev = value;
        }
        if (ev !== null && ev > 0) {
            coords.push(x, y, z);
        }
    }
    return Float64Array.from(coords);
}

function bandMax(
    points: Float64Array,
    z0: number,
    length: number,
    a: number,
    b: number,
    cx: number,
    side: -1 | 1,
): number {
    let best: number | null = null;
    for (let i = 0; i < points.length; i += 3) {
        const px = points[i] ?? 0;
        const py = points[i + 1] ?? 0;
        const pz = points[i + 2] ?? 0;
        const t = (pz - py - z0) / length;
        const onSide = side < 0 ? px < cx : px >= cx;
        if (t >= a && t < b && onSide && (best === null || py > best)) best = py;
    }
    return best === null ? 0 : best;
}

/**
 * Detect the physical foot in belt G-code.
 * zt = Z - Y. Belt contact is Y <= 0.6. The end fifth with the larger max Y is the heel.
 * The middle fifth (0.4–0.6) side with the larger max Y is medial.
 * LEFT iff (medial on X+) == (heel at high zt). Differences under 5.0 mm are inconclusive.
 */
export function detectGcodeFoot(gcode: string): GcodeFootDetection {
    const points = extrusions(gcode);
    const count = points.length / 3;
    if (count < 1000) return { foot: "inconclusive", reason: "too few extrusions" };

    let belt = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < points.length; i += 3) {
        const px = points[i] ?? 0;
        const py = points[i + 1] ?? 0;
        if (py > 0.6) continue;
        belt += 1;
        const zt = (points[i + 2] ?? 0) - py;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (zt < z0) z0 = zt;
        if (zt > z1) z1 = zt;
    }
    if (belt < 200) return { foot: "inconclusive", reason: "no belt-contact layer" };

    const length = z1 - z0;
    if (length < 80) return { foot: "inconclusive", reason: `part length ${length.toFixed(1)} mm` };

    const cx = (minX + maxX) / 2;
    const loEnd = Math.max(
        bandMax(points, z0, length, 0.0, 0.2, cx, -1),
        bandMax(points, z0, length, 0.0, 0.2, cx, 1),
    );
    const hiEnd = Math.max(
        bandMax(points, z0, length, 0.8, 1.0001, cx, -1),
        bandMax(points, z0, length, 0.8, 1.0001, cx, 1),
    );
    const archMinus = bandMax(points, z0, length, 0.4, 0.6, cx, -1);
    const archPlus = bandMax(points, z0, length, 0.4, 0.6, cx, 1);
    const scored: GcodeFootDetection = {
        foot: "inconclusive",
        heelEndMaxY: pythonRound(Math.max(loEnd, hiEnd), 2),
        toeEndMaxY: pythonRound(Math.min(loEnd, hiEnd), 2),
        heelHighZt: hiEnd > loEnd,
        archMaxYXminus: pythonRound(archMinus, 2),
        archMaxYXplus: pythonRound(archPlus, 2),
        medialSide: archPlus > archMinus ? "X+" : "X-",
        lengthMm: pythonRound(length, 1),
        xCentre: pythonRound(cx, 2),
    };
    if (Math.abs(hiEnd - loEnd) < END_MIN_MM) {
        scored.reason = "heel end not distinct";
        return scored;
    }
    if (Math.abs(archPlus - archMinus) < ARCH_MIN_MM) {
        scored.reason = "arch side not distinct";
        return scored;
    }
    const medialOnPlus = archPlus > archMinus;
    const heelHigh = hiEnd > loEnd;
    scored.foot = medialOnPlus === heelHigh ? "left" : "right";
    return scored;
}

/**
 * Fail the production when the sliced foot is not the requested side.
 * Inconclusive G-code fails too. The message names both sides.
 */
export function assertGcodeHandedness(gcode: string, requestedSide: "left" | "right"): void {
    const detected = detectGcodeFoot(gcode);
    if (detected.foot === requestedSide) return;
    const detectedLabel =
        detected.foot === "inconclusive"
            ? detected.reason
                ? `inconclusive (${detected.reason})`
                : "inconclusive"
            : `a physical ${detected.foot} foot`;
    throw new GcodeHandednessError(
        `Handedness check failed: requested ${requestedSide}, G-code is ${detectedLabel}. File not delivered.`,
    );
}
