// Top trimline presets — Full, Sulcus, Met-head (distal AP ±3 mm of landmark).

import * as THREE from "three";
import { meshYSign } from "@/lib/geometry/handedness";
import { cloneTrimline, type TrimlineCurve } from "@/lib/geometry/trimline";
import type { Side, TrimPresetId } from "@/types";

export const TRIM_PRESET_LABELS: Record<TrimPresetId, string> = {
    full: "Full",
    sulcus: "Sulcus",
    met_head: "Met-head",
};

/**
 * Normalized length u (0 heel → 1 toe) for each clinical landmark.
 * The value is the medial (longer) end of the cut. Sulcus sits just behind
 * the toes; met-head / 3/4 length sits just proximal to the met heads.
 */
export const TRIM_PRESET_LANDMARK_U: Record<Exclude<TrimPresetId, "custom">, number> = {
    full: 1,
    sulcus: 0.72,
    met_head: 0.66,
};

export const TRIM_PRESET_DISTAL_AP_TOLERANCE_MM = 3;

/**
 * The met line is oblique: the lateral end is this far proximal of the medial
 * landmark. 0.07 of foot length is about 18 mm on a 260 mm foot.
 */
const MET_BREAK_U = 0.07;
const MET_BREAK_MIN_MM = 10;
const MET_BREAK_MAX_MM = 22;
/** Gentle distal bow of the cut off its chord, kept under half the met break. */
const CUT_BULGE_MM = 4.5;

export interface TrimPresetBuildOptions {
    lengthMm: number;
    widthMm: number;
    /** Fine-tune distal cut ±3 mm from landmark (default 0). */
    distalApOffsetMm?: number;
    /**
     * Outline to trim. Required. A missing curve does not fall back to the
     * parametric insole — base designs show nothing until the GLB boundary exists.
     */
    baseCurve?: TrimlineCurve;
    /** Which foot the outline belongs to. Medial is the longer end of the cut. */
    footSide?: Side;
}

interface LengthFrame {
    axis: "x" | "y";
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
            axis: "x",
            lengthOf: (p) => p.x,
            widthOf: (p) => p.y,
            point: (length, width, z) => new THREE.Vector3(length, width, z),
            heel: minX,
            toe: maxX,
            span: spanX,
        };
    }
    return {
        axis: "y",
        lengthOf: (p) => p.y,
        widthOf: (p) => p.x,
        point: (length, width, z) => new THREE.Vector3(width, length, z),
        heel: minY,
        toe: maxY,
        span: spanY,
    };
}

function chainBetween(points: THREE.Vector3[], from: number, to: number): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    let i = from;
    for (let guard = 0; guard <= points.length; guard++) {
        out.push(points[i]!);
        if (i === to) break;
        i = (i + 1) % points.length;
    }
    return out;
}

function pointAtLength(chain: THREE.Vector3[], target: number, frame: LengthFrame): THREE.Vector3 | null {
    for (let i = 0; i < chain.length - 1; i++) {
        const a = chain[i]!;
        const b = chain[i + 1]!;
        const la = frame.lengthOf(a);
        const lb = frame.lengthOf(b);
        if ((la - target) * (lb - target) > 0) continue;
        const denom = lb - la;
        const t = Math.abs(denom) < 1e-9 ? 0 : (target - la) / denom;
        if (t < -1e-4 || t > 1 + 1e-4) continue;
        return a.clone().lerp(b, Math.max(0, Math.min(1, t)));
    }
    return null;
}

/**
 * Build a closed trimline for the preset by shortening the distal end to an
 * oblique met line. Medial is longer than lateral. Full returns the base
 * curve unchanged. Without a base curve the result is empty.
 */
export function buildTrimPresetCurve(
    preset: Exclude<TrimPresetId, "custom">,
    opts: TrimPresetBuildOptions,
): TrimlineCurve {
    if (!opts.baseCurve || opts.baseCurve.points.length < 4) return { points: [] };
    const base = opts.baseCurve;
    if (preset === "full") return cloneTrimline(base);

    const frame = lengthFrame(base.points);
    const offset = opts.distalApOffsetMm ?? 0;
    const fromHeel = frame.span * TRIM_PRESET_LANDMARK_U[preset] + offset;
    const xCut = Math.max(frame.heel + frame.span * 0.35, frame.heel + fromHeel);
    const medial = meshYSign(opts.footSide ?? "left", "medial");
    return shortenCurveAtDistalAp(cloneTrimline(base), Math.min(frame.toe - 0.5, xCut), medial);
}

/**
 * Replace the distal portion of a closed footprint curve with a smooth oblique
 * end. `xCut` is the medial (longer) length. The lateral end sits proximal of
 * that, and the span between them bows gently toward the toes.
 *
 * The cap is spliced between the two real border crossings, in loop order.
 */
export function shortenCurveAtDistalAp(
    curve: TrimlineCurve,
    xCut: number,
    medialWidthSign: 1 | -1 = -1,
): TrimlineCurve {
    const pts = curve.points;
    if (pts.length < 8) return curve;

    const frame = lengthFrame(pts);
    if (frame.span < 1) return curve;
    if (xCut <= frame.heel + frame.span * 0.2) return curve;
    if (xCut >= frame.toe - 0.25) return curve;

    let heelI = 0;
    let toeI = 0;
    for (let i = 1; i < pts.length; i++) {
        if (frame.lengthOf(pts[i]!) < frame.lengthOf(pts[heelI]!)) heelI = i;
        if (frame.lengthOf(pts[i]!) > frame.lengthOf(pts[toeI]!)) toeI = i;
    }
    const forward = chainBetween(pts, heelI, toeI);
    const back = chainBetween(pts, toeI, heelI);
    if (forward.length < 3 || back.length < 3) return curve;

    const meanWidth = (chain: THREE.Vector3[]) =>
        chain.reduce((sum, p) => sum + frame.widthOf(p), 0) / chain.length;
    const forwardMedial = meanWidth(forward) * medialWidthSign >= meanWidth(back) * medialWidthSign;
    const medialChain = forwardMedial ? forward : back;
    const lateralChain = forwardMedial ? back : forward;

    const obliquity = Math.min(MET_BREAK_MAX_MM, Math.max(MET_BREAK_MIN_MM, frame.span * MET_BREAK_U));
    const xLat = Math.max(frame.heel + frame.span * 0.48, xCut - obliquity);
    const pMed = pointAtLength(medialChain, xCut, frame);
    const pLat = pointAtLength(lateralChain, xLat, frame);
    if (!pMed || !pLat) return curve;

    const wMed = frame.widthOf(pMed);
    const wLat = frame.widthOf(pLat);
    const bulge = Math.min(CUT_BULGE_MM, Math.abs(xCut - xLat) * 0.4);
    const allowed = (width: number) => {
        const span = wLat - wMed;
        const t = Math.abs(span) < 1e-9 ? 0 : (width - wMed) / span;
        const tc = Math.max(0, Math.min(1, t));
        const chord = xCut + (xLat - xCut) * tc;
        return chord + bulge * Math.sin(Math.PI * tc);
    };

    const distal = pts.map((p) => frame.lengthOf(p) > allowed(frame.widthOf(p)) + 0.15);
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

    const crossAllowed = (inside: THREE.Vector3, outside: THREE.Vector3) => {
        let lo = 0;
        let hi = 1;
        for (let k = 0; k < 18; k++) {
            const mid = (lo + hi) / 2;
            const p = inside.clone().lerp(outside, mid);
            if (frame.lengthOf(p) > allowed(frame.widthOf(p))) hi = mid;
            else lo = mid;
        }
        return inside.clone().lerp(outside, (lo + hi) / 2);
    };
    const enter = crossAllowed(lastProx, firstDistal);
    const exit = crossAllowed(pts[i]!, lastDistal);

    const steps = 16;
    const arc: THREE.Vector3[] = [];
    const w0 = frame.widthOf(enter);
    const w1 = frame.widthOf(exit);
    for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const width = w0 + (w1 - w0) * t;
        const length = allowed(width);
        const z = enter.z + (exit.z - enter.z) * t;
        arc.push(frame.point(length, width, z));
    }

    return { points: [...proximal, ...arc] };
}

function pointInPolygonXY(x: number, y: number, poly: THREE.Vector3[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i]!.x;
        const yi = poly[i]!.y;
        const xj = poly[j]!.x;
        const yj = poly[j]!.y;
        const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
        if (intersects) inside = !inside;
    }
    return inside;
}

function distToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lenSq = abx * abx + aby * aby;
    if (lenSq < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq));
    return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

function onOrInside(p: THREE.Vector3, poly: THREE.Vector3[], tolMm: number): boolean {
    if (pointInPolygonXY(p.x, p.y, poly)) return true;
    for (let i = 0; i < poly.length; i++) {
        if (distToSegment(p, poly[i]!, poly[(i + 1) % poly.length]!) <= tolMm) return true;
    }
    return false;
}

function segmentsCross(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
): THREE.Vector3 | null {
    const rx = b.x - a.x;
    const ry = b.y - a.y;
    const sx = d.x - c.x;
    const sy = d.y - c.y;
    const den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-10) return null;
    const qx = c.x - a.x;
    const qy = c.y - a.y;
    const t = (qx * sy - qy * sx) / den;
    const u = (qx * ry - qy * rx) / den;
    if (t < -1e-4 || t > 1 + 1e-4 || u < -1e-4 || u > 1 + 1e-4) return null;
    return new THREE.Vector3(a.x + rx * t, a.y + ry * t, a.z + (b.z - a.z) * t);
}

function boundaryHit(
    p: THREE.Vector3,
    q: THREE.Vector3,
    poly: THREE.Vector3[],
): { point: THREE.Vector3; edge: number } | null {
    let best: { point: THREE.Vector3; edge: number; dist: number } | null = null;
    for (let i = 0; i < poly.length; i++) {
        const hit = segmentsCross(p, q, poly[i]!, poly[(i + 1) % poly.length]!);
        if (!hit) continue;
        const dist = Math.hypot(hit.x - p.x, hit.y - p.y);
        if (!best || dist < best.dist) best = { point: hit, edge: i, dist };
    }
    return best ? { point: best.point, edge: best.edge } : null;
}

function distalWalk(
    poly: THREE.Vector3[],
    fromEdge: number,
    toEdge: number,
    frame: LengthFrame,
): THREE.Vector3[] {
    const n = poly.length;
    const collect = (forward: boolean) => {
        const pts: THREE.Vector3[] = [];
        let e = fromEdge;
        for (let k = 0; k < n; k++) {
            const vertex = forward ? (e + 1) % n : e;
            pts.push(poly[vertex]!.clone());
            e = forward ? (e + 1) % n : (e - 1 + n) % n;
            if ((forward && e === toEdge) || (!forward && (e + 1) % n === toEdge)) break;
            if (!forward && e === toEdge) break;
        }
        return pts;
    };
    const mean = (pts: THREE.Vector3[]) =>
        pts.length === 0 ? -Infinity : pts.reduce((sum, p) => sum + frame.lengthOf(p), 0) / pts.length;
    const forward = collect(true);
    const backward = collect(false);
    return mean(forward) >= mean(backward) ? forward : backward;
}

/**
 * End a closed bottom pattern on the top trim's distal boundary.
 * Heel and midfoot points that already lie inside the trim are kept.
 * A trim that does not cut the pattern off (Full, or an inset pattern inside
 * the outline) is returned unchanged.
 */
export function endPatternOnTrim(pattern: TrimlineCurve, trim: TrimlineCurve | null): TrimlineCurve {
    if (!trim || trim.points.length < 4 || pattern.points.length < 4) return pattern;
    const tol = 0.8;
    const inside = pattern.points.map((p) => onOrInside(p, trim.points, tol));
    if (inside.every(Boolean)) return pattern;

    let runs = 0;
    for (let i = 0; i < inside.length; i++) {
        const prev = (i - 1 + inside.length) % inside.length;
        if (!inside[i] && inside[prev]) runs++;
    }
    if (runs !== 1) return pattern;

    let chainStart = -1;
    for (let i = 0; i < inside.length; i++) {
        const prev = (i - 1 + inside.length) % inside.length;
        if (inside[i] && !inside[prev]) {
            chainStart = i;
            break;
        }
    }
    if (chainStart < 0) return pattern;

    const kept: THREE.Vector3[] = [];
    let i = chainStart;
    while (inside[i] && kept.length < pattern.points.length) {
        kept.push(pattern.points[i]!.clone());
        i = (i + 1) % pattern.points.length;
    }
    if (kept.length < 3) return pattern;
    const firstOut = pattern.points[i]!;
    const lastIn = kept[kept.length - 1]!;

    let lastOut = firstOut;
    let guard = 0;
    while (!inside[i] && guard < pattern.points.length) {
        lastOut = pattern.points[i]!;
        i = (i + 1) % pattern.points.length;
        guard++;
    }
    const enterHit = boundaryHit(lastIn, firstOut, trim.points);
    const exitHit = boundaryHit(lastOut, pattern.points[i]!, trim.points);
    if (!enterHit || !exitHit) return pattern;

    const frame = lengthFrame(trim.points);
    const mid = distalWalk(trim.points, enterHit.edge, exitHit.edge, frame);
    const arc = [enterHit.point, ...mid, exitHit.point];
    return { points: [...kept, ...arc] };
}
