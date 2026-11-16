// Top trimline presets — Full, Sulcus, Met-head (distal AP ±3 mm of landmark).

import * as THREE from "three";
import { cloneTrimline, sampleDefaultOutline, type TrimlineCurve } from "@/lib/geometry/trimline";
import type { TrimPresetId } from "@/types";

export const TRIM_PRESET_LABELS: Record<TrimPresetId, string> = {
    full: "Full",
    sulcus: "Sulcus",
    met_head: "Met-head",
};

/**
 * Normalized length u (0 heel → 1 toe) for each clinical landmark.
 * Sulcus ≈ 3/4 length, met-head a little shorter.
 */
export const TRIM_PRESET_LANDMARK_U: Record<Exclude<TrimPresetId, "custom">, number> = {
    full: 1,
    sulcus: 0.72,
    met_head: 0.66,
};

export const TRIM_PRESET_DISTAL_AP_TOLERANCE_MM = 3;

export interface TrimPresetBuildOptions {
    lengthMm: number;
    widthMm: number;
    /** Fine-tune distal cut ±3 mm from landmark (default 0). */
    distalApOffsetMm?: number;
    /** Base outline to trim; defaults to parametric full outline. */
    baseCurve?: TrimlineCurve;
}

interface LengthFrame {
    lengthOf: (p: THREE.Vector3) => number;
    widthOf: (p: THREE.Vector3) => number;
    point: (length: number, width: number, z: number) => THREE.Vector3;
    heel: number;
    toe: number;
    span: number;
}

/**
 * Length runs along the longer footprint axis. Heel is the minimum of that
 * axis: reoriented meshes put the heel at the low end, and a centered outline
 * (heel at −L/2) uses the same end. Width is the other axis, unchanged.
 */
function lengthFrame(points: THREE.Vector3[]): LengthFrame {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    if (spanX >= spanY) {
        return {
            lengthOf: (p) => p.x,
            widthOf: (p) => p.y,
            point: (length, width, z) => new THREE.Vector3(length, width, z),
            heel: minX,
            toe: maxX,
            span: spanX,
        };
    }
    return {
        lengthOf: (p) => p.y,
        widthOf: (p) => p.x,
        point: (length, width, z) => new THREE.Vector3(width, length, z),
        heel: minY,
        toe: maxY,
        span: spanY,
    };
}

function crossAt(
    a: THREE.Vector3,
    b: THREE.Vector3,
    at: number,
    lengthOf: (p: THREE.Vector3) => number,
): THREE.Vector3 {
    const la = lengthOf(a);
    const lb = lengthOf(b);
    const denom = lb - la;
    const t = Math.abs(denom) < 1e-9 ? 0 : (at - la) / denom;
    const clamped = Math.max(0, Math.min(1, t));
    return a.clone().lerp(b, clamped);
}

/**
 * Build a closed trimline for the preset by shortening the distal AP to the landmark plane.
 * The cut is measured from the outline's own heel, so a centered or shifted mesh
 * frame still lands on the landmark. Full returns the base curve unchanged.
 */
export function buildTrimPresetCurve(
    preset: Exclude<TrimPresetId, "custom">,
    opts: TrimPresetBuildOptions,
): TrimlineCurve {
    const base = opts.baseCurve ?? sampleDefaultOutline(opts.lengthMm, opts.widthMm);
    if (preset === "full") {
        return cloneTrimline(base);
    }

    const frame = lengthFrame(base.points);
    const offset = opts.distalApOffsetMm ?? 0;
    const fromHeel = frame.span * TRIM_PRESET_LANDMARK_U[preset] + offset;
    const xCut = Math.max(frame.heel + frame.span * 0.35, frame.heel + fromHeel);
    return shortenCurveAtDistalAp(cloneTrimline(base), Math.min(frame.toe - 0.5, xCut));
}

/**
 * Replace the distal portion of a closed footprint curve with a rounded end
 * whose apex sits on `xCut` (length-axis coordinate, heel → toe).
 *
 * The cap is spliced between the two real border crossings, in loop order.
 * Appending it after the heel produces a rectangular spike and a self-overlapping
 * fill that does not cut the toe.
 */
export function shortenCurveAtDistalAp(curve: TrimlineCurve, xCut: number): TrimlineCurve {
    const pts = curve.points;
    if (pts.length < 8) return curve;

    const frame = lengthFrame(pts);
    if (frame.span < 1) return curve;
    if (xCut <= frame.heel + frame.span * 0.2) return curve;
    if (xCut >= frame.toe - 0.25) return curve;

    const room = xCut - frame.heel;
    const sagitta = Math.min(12, Math.max(4, frame.span * 0.04), room * 0.45);
    const xMeet = xCut - sagitta;
    const distal = pts.map((p) => frame.lengthOf(p) > xMeet + 0.15);
    if (!distal.some(Boolean)) return curve;

    let chainStart = -1;
    for (let i = 0; i < pts.length; i++) {
        const prev = (i - 1 + pts.length) % pts.length;
        if (!distal[i] && distal[prev]) {
            chainStart = i;
            break;
        }
    }
    if (chainStart < 0) return curve;

    const proximal: THREE.Vector3[] = [];
    let i = chainStart;
    while (!distal[i] && proximal.length < pts.length) {
        proximal.push(pts[i]!.clone());
        i = (i + 1) % pts.length;
    }
    if (proximal.length < 3) return curve;
    const firstDistal = pts[i]!;
    const lastProx = proximal[proximal.length - 1]!;

    let lastDistal = firstDistal;
    let guard = 0;
    while (distal[i] && guard < pts.length) {
        lastDistal = pts[i]!;
        i = (i + 1) % pts.length;
        guard++;
    }
    const enter = crossAt(lastProx, firstDistal, xMeet, frame.lengthOf);
    const exit = crossAt(lastDistal, pts[i]!, xMeet, frame.lengthOf);

    const steps = 16;
    const arc: THREE.Vector3[] = [];
    const l0 = frame.lengthOf(enter);
    const l1 = frame.lengthOf(exit);
    const w0 = frame.widthOf(enter);
    const w1 = frame.widthOf(exit);
    const bulge = xCut - (l0 + l1) / 2;
    for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const length = l0 + (l1 - l0) * t + bulge * Math.sin(Math.PI * t);
        const width = w0 + (w1 - w0) * t;
        const z = enter.z + (exit.z - enter.z) * t;
        arc.push(frame.point(length, width, z));
    }

    return { points: [...proximal, ...arc] };
}
