// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { sampleDrop } from "./drop-cutter";
import {
    bboxOf,
    distToPoly,
    ensureCw,
    offsetClosedAll,
    perimeter,
    pointInPoly,
    resampleClosed,
    signedArea,
} from "./polygon";
import { stepoverMm } from "./profile";
import type { Heightmap, MillingProfile, Point, ToolType } from "./types";

export interface XyPoint {
    x: number;
    y: number;
}

/** One sample of the center-out spiral. Z is applied later by the drop cutter. */
export interface SpiralSample extends XyPoint {
    /**
     * Increases as the spiral walks outward. Restarts at 0 on the next split
     * component (`componentStart`), and does not decrease inside a component.
     */
    offsetIndex: number;
    component: number;
    componentStart: boolean;
}

export interface SpiralPlan {
    samples: SpiralSample[];
    warnings: string[];
    /** Bounding-box center the cutter plunges at. One point. */
    medial: XyPoint[];
    /** Clockwise outer loop of the component the cutter enters. */
    innermostRing: Point[];
    /** Straight plunge. No zigzag entry. */
    entry: XyPoint[];
    stepoverMm: number;
}

/** Measured on one center-out component, against the Windows spiral. */
export interface SpiralMeasure {
    laps: number;
    lengthMm: number;
    /** Median spacing of crossings along the short axis. */
    widthPitchMm: number;
    /** Median spacing of crossings along the long axis (toe and heel). */
    endPitchMm: number;
    clockwise: boolean;
    /**
     * Largest half-spacing between path crossings of lines across the width,
     * through the middle 60% of the length. The coarse toe/heel pitch is not
     * this number.
     */
    acrossWidthGapMm: number;
}

const PATH_SPACING_MM = 0.4;
const OFFSET_CHORD_MM = 0.15;

function ringWidth(loop: Point[]): number {
    const bb = bboxOf(loop);
    return Math.min(bb.maxX - bb.minX, bb.maxY - bb.minY);
}

function asCw(loop: Point[]): Point[] {
    const cw = ensureCw(loop);
    return resampleClosed(cw, PATH_SPACING_MM);
}

function bboxCenter(loop: Point[]): XyPoint {
    const bb = bboxOf(loop);
    return { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 };
}

/** Distance from `center` to `loop` along a unit direction. 0 when the ray misses. */
function rayDistance(center: XyPoint, loop: Point[], ux: number, uy: number): number {
    let best = 0;
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const det = ux * dy - uy * dx;
        if (Math.abs(det) < 1e-12) continue;
        const ox = a.x - center.x;
        const oy = a.y - center.y;
        const t = (ox * dy - oy * dx) / det;
        const s = (ox * uy - oy * ux) / det;
        if (t > best && s >= -1e-6 && s <= 1 + 1e-6) best = t;
    }
    return best;
}

function axialRadii(center: XyPoint, loop: Point[]): { rx: number; ry: number } {
    const bb = bboxOf(loop);
    const hx = Math.max(0.2, (bb.maxX - bb.minX) / 2);
    const hy = Math.max(0.2, (bb.maxY - bb.minY) / 2);
    const rx = Math.max(rayDistance(center, loop, 1, 0), rayDistance(center, loop, -1, 0));
    const ry = Math.max(rayDistance(center, loop, 0, 1), rayDistance(center, loop, 0, -1));
    return { rx: rx >= 0.2 ? rx : hx, ry: ry >= 0.2 ? ry : hy };
}

/**
 * One lap per geometric-mean radius of stepover.
 * `round`, not `ceil`: a gap of 1.4 mm is one lap, not two.
 * Pitch then scales with radius, so the short axis is tighter than the ends.
 */
function lapCount(rx: number, ry: number, step: number): number {
    const geom = Math.sqrt(Math.max(rx, 0.2) * Math.max(ry, 0.2));
    return Math.max(1, Math.round(geom / Math.max(0.2, step)));
}

/**
 * Heel-cup radial pitch cap. The homothety leaves ~2.4 mm at the ends.
 * A 10 mm ball's flat scallop there is ~0.15 mm, and the heel cup (the
 * min-X end) leaves more than the 0.25 mm stock gate. Extra arcs on that
 * end keep its pitch at or under this cap. The toe stays at the stretched pitch.
 */
const HEEL_RADIAL_CAP_MM = 1.4;
/** Fraction of the length, from the heel, that gets the extra arcs. */
const HEEL_CAP_FRACTION = 0.16;
/** Inner laps are the midfoot. The cup is the outer part of the spiral. */
const HEEL_CAP_FROM_SCALE = 0.72;

function pointAtFraction(loop: Point[], frac: number): XyPoint {
    const n = loop.length;
    if (n === 0) return { x: 0, y: 0 };
    const f = ((frac % 1) + 1) % 1;
    const pos = f * n;
    const i = Math.floor(pos) % n;
    const t = pos - Math.floor(pos);
    const a = loop[i]!;
    const b = loop[(i + 1) % n]!;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function pushSample(
    out: SpiralSample[],
    p: XyPoint,
    offsetIndex: number,
    component: number,
    componentStart: boolean,
): void {
    const prev = out[out.length - 1];
    if (
        prev &&
        !componentStart &&
        Math.hypot(prev.x - p.x, prev.y - p.y) < 1e-6 &&
        Math.abs(prev.offsetIndex - offsetIndex) < 1e-9
    ) {
        return;
    }
    out.push({ x: p.x, y: p.y, offsetIndex, component, componentStart });
}

function densifyOpen(pts: XyPoint[], maxChord: number): XyPoint[] {
    if (pts.length < 2) return pts.map((p) => ({ x: p.x, y: p.y }));
    const out: XyPoint[] = [{ x: pts[0]!.x, y: pts[0]!.y }];
    for (let i = 1; i < pts.length; i++) {
        const a = out[out.length - 1]!;
        const b = pts[i]!;
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        const n = Math.max(1, Math.ceil(dist / Math.max(0.05, maxChord)));
        for (let k = 1; k <= n; k++) {
            const t = k / n;
            out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        }
    }
    return out;
}

function linkSamples(
    from: XyPoint,
    to: XyPoint,
    offsetIndex: number,
    component: number,
    out: SpiralSample[],
): void {
    for (const p of densifyOpen([from, to], PATH_SPACING_MM)) {
        pushSample(out, p, offsetIndex, component, false);
    }
}

function acceptable(loop: Point[], step: number): boolean {
    return loop.length >= 8 && Math.abs(signedArea(loop)) > 0.5 && ringWidth(loop) >= step * 2;
}

/** Inward offsets. The first level that splits is returned; otherwise the original loop. */
function splitPieces(loop: Point[], step: number): Point[][] {
    let level = [loop];
    for (let depth = 0; depth < 48; depth++) {
        const next: Point[][] = [];
        for (const ring of level) {
            const kids = offsetClosedAll(ring, -step, OFFSET_CHORD_MM)
                .map((p) => asCw(p))
                .filter((p) => acceptable(p, step));
            if (kids.length > 1) return kids;
            next.push(...kids);
        }
        if (!next.length) break;
        level = next;
    }
    return [loop];
}

function coarseRuns(pieces: number[]): Array<{ start: number; len: number }> {
    const n = pieces.length;
    const runs: Array<{ start: number; len: number }> = [];
    const seen = new Array<boolean>(n).fill(false);
    for (let i = 0; i < n; i++) {
        if (pieces[i]! <= 1 || seen[i]) continue;
        if (pieces[(i - 1 + n) % n]! > 1) continue;
        let len = 0;
        while (len < n && pieces[(i + len) % n]! > 1) {
            seen[(i + len) % n] = true;
            len++;
        }
        runs.push({ start: i, len });
    }
    if (!runs.length && pieces.some((p) => p > 1)) runs.push({ start: 0, len: n });
    return runs;
}

/**
 * Clockwise homothety from the bounding-box center out to `loop`.
 * Scale grows linearly with angle, so the pitch at the toe and heel is wider
 * than the pitch across the width. Where the heel cup would exceed
 * {@link HEEL_RADIAL_CAP_MM}, extra arcs are cut before that sector's outer lap.
 */
function emitHomothety(
    loop: Point[],
    step: number,
    component: number,
    out: SpiralSample[],
): { center: XyPoint; ring: Point[] } {
    const cw = asCw(loop);
    const center = bboxCenter(cw);
    const radii = axialRadii(center, cw);
    const laps = lapCount(radii.rx, radii.ry, step);
    const per = Math.max(1e-6, perimeter(cw));
    const nAng = Math.max(24, Math.ceil(per / PATH_SPACING_MM));
    const bb = bboxOf(cw);
    const heelX = bb.minX + HEEL_CAP_FRACTION * (bb.maxX - bb.minX);
    const boundary: XyPoint[] = [];
    const pieces = new Array<number>(nAng).fill(1);
    for (let i = 0; i < nAng; i++) {
        const p = pointAtFraction(cw, i / nAng);
        boundary.push(p);
        const ray = Math.hypot(p.x - center.x, p.y - center.y);
        const heel = p.x <= heelX;
        const gap = ray / laps;
        if (heel && gap > HEEL_RADIAL_CAP_MM) {
            pieces[i] = Math.max(1, Math.ceil((gap - 1e-6) / HEEL_RADIAL_CAP_MM));
        }
    }
    // Start the angular walk on a side station so a heel run does not wrap.
    let rot = pieces.findIndex((p) => p === 1);
    if (rot < 0) rot = 0;
    if (rot > 0) {
        boundary.push(...boundary.splice(0, rot));
        pieces.push(...pieces.splice(0, rot));
    }
    const runs = coarseRuns(pieces);
    const runAt = new Map<number, { start: number; len: number }>();
    for (const run of runs) runAt.set(run.start, run);

    const emit = (i: number, s: number, clock: number) => {
        const b = boundary[i]!;
        pushSample(
            out,
            { x: center.x + (b.x - center.x) * s, y: center.y + (b.y - center.y) * s },
            clock,
            component,
            false,
        );
    };

    pushSample(out, center, 0, component, true);
    let clock = 0;
    const tick = 1 / nAng;
    for (let lap = 0; lap < laps; lap++) {
        const s0 = lap / laps;
        const s1 = (lap + 1) / laps;
        for (let k = 0; k < nAng; k++) {
            const run = lap / laps >= HEEL_CAP_FROM_SCALE ? runAt.get(k) : undefined;
            if (run) {
                let maxP = 1;
                for (let j = 0; j < run.len; j++) {
                    maxP = Math.max(maxP, pieces[(run.start + j) % nAng]!);
                }
                for (let sub = 1; sub < maxP; sub++) {
                    const s = s0 + ((s1 - s0) * sub) / maxP;
                    for (let j = 0; j < run.len; j++) {
                        clock += tick;
                        emit((run.start + j) % nAng, s, clock);
                    }
                }
            }
            clock += tick;
            emit(k, s1, clock);
        }
    }
    return { center, ring: cw };
}

/**
 * One clockwise center-out spiral per component, from that component's
 * bounding-box center. A waist that offsets into two loops is cut as two
 * spirals. The lap count is round(sqrt(rx*ry) / stepover), not ceil.
 */
export function planCenterSpiral(outline: Point[], profile: MillingProfile, toolType: ToolType): SpiralPlan {
    const step = stepoverMm(profile, toolType);
    const warnings: string[] = [];
    const outerRaw = offsetClosedAll(outline, profile.topOffsetMm, OFFSET_CHORD_MM);
    const outers = (outerRaw.length ? outerRaw : [outline]).map((p) => asCw(p)).filter((p) => p.length >= 8);
    if (outers.length === 0) {
        return { samples: [], warnings, medial: [], innermostRing: [], entry: [], stepoverMm: step };
    }
    if (outers.length > 1) {
        warnings.push(`offset split into ${outers.length} components; cutting each center-out`);
    }
    const pieces: Point[][] = [];
    for (const outer of outers) {
        const parts = splitPieces(outer, step);
        if (parts.length > 1) {
            warnings.push(`offset split into ${parts.length} components; cutting each center-out`);
        }
        pieces.push(...parts);
    }
    const samples: SpiralSample[] = [];
    let first: { center: XyPoint; ring: Point[] } | null = null;
    for (let i = 0; i < pieces.length; i++) {
        const piece = pieces[i]!;
        if (i > 0) {
            const prev = samples[samples.length - 1];
            if (prev) linkSamples(prev, bboxCenter(piece), prev.offsetIndex, prev.component, samples);
        }
        const emitted = emitHomothety(piece, step, i, samples);
        if (!first) first = emitted;
    }
    const center = first?.center ?? { x: 0, y: 0 };
    for (const w of warnings) console.warn(`[cnc] ${w}`);
    return {
        samples,
        warnings,
        medial: [center],
        innermostRing: first?.ring ?? [],
        entry: [],
        stepoverMm: step,
    };
}

export function spiralXy(outline: Point[], profile: MillingProfile, toolType: ToolType): XyPoint[] {
    return planCenterSpiral(outline, profile, toolType).samples.map((p) => ({ x: p.x, y: p.y }));
}

function crossingValues(pts: XyPoint[], axis: "x" | "y", at: number): number[] {
    const out: number[] = [];
    const coord = (p: XyPoint) => (axis === "x" ? p.x : p.y);
    const other = (p: XyPoint) => (axis === "x" ? p.y : p.x);
    for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        const d = coord(b) - coord(a);
        if (Math.abs(d) < 1e-12) continue;
        const t = (at - coord(a)) / d;
        if (t < 0 || t >= 1) continue;
        out.push(other(a) + (other(b) - other(a)) * t);
    }
    return out;
}

function medianPitch(values: number[]): number {
    const sorted = values.slice().sort((a, b) => a - b);
    const diffs: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
        const d = sorted[i]! - sorted[i - 1]!;
        if (d > 0.05) diffs.push(d);
    }
    if (!diffs.length) return 0;
    diffs.sort((a, b) => a - b);
    return diffs[Math.floor(diffs.length / 2)]!;
}

/**
 * Half-spacing of the spiral where it crosses the short axis through the
 * bounding-box center. Off-center stations mix the stretched end pitch into Y
 * and are not this measurement.
 */
export function acrossWidthGapMm(pts: XyPoint[], outline: Point[]): number {
    if (pts.length < 2 || outline.length < 3) return Infinity;
    const bb = bboxOf(outline);
    const longX = bb.maxX - bb.minX >= bb.maxY - bb.minY;
    const at = longX ? (bb.minX + bb.maxX) / 2 : (bb.minY + bb.maxY) / 2;
    const hits = longX ? crossingValues(pts, "x", at) : crossingValues(pts, "y", at);
    const axis = longX ? "x" : "y";
    for (const p of pts) {
        const c = axis === "x" ? p.x : p.y;
        if (Math.abs(c - at) <= 0.05) hits.push(axis === "x" ? p.y : p.x);
    }
    const kept = hits
        .filter((v) => {
            const x = longX ? at : v;
            const y = longX ? v : at;
            return pointInPoly(x, y, outline) || distToPoly(x, y, outline) <= 0.75;
        })
        .sort((a, b) => a - b);
    let worst = 0;
    let prev: number | undefined;
    for (const v of kept) {
        if (prev !== undefined && v - prev > 0.05) {
            const gap = (v - prev) / 2;
            if (gap > worst) worst = gap;
        }
        prev = v;
    }
    return worst;
}

/** Laps, path length, and axial pitch of one center-out spiral. */
export function measureSpiral(samples: XyPoint[], outline: Point[]): SpiralMeasure {
    const center = samples[0] ?? { x: 0, y: 0 };
    let lengthMm = 0;
    let wind = 0;
    let prevAng: number | null = null;
    for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1]!;
        const b = samples[i]!;
        lengthMm += Math.hypot(b.x - a.x, b.y - a.y);
        const dx = b.x - center.x;
        const dy = b.y - center.y;
        if (dx * dx + dy * dy < 0.25) continue;
        const ang = Math.atan2(dy, dx);
        if (prevAng !== null) {
            let d = ang - prevAng;
            while (d > Math.PI) d -= Math.PI * 2;
            while (d < -Math.PI) d += Math.PI * 2;
            wind += d;
        }
        prevAng = ang;
    }
    const bb = bboxOf(samples.length ? (samples as Point[]) : outline);
    const longX = bb.maxX - bb.minX >= bb.maxY - bb.minY;
    const yHits = crossingValues(samples, "x", center.x).filter((y) => y > center.y + 0.4);
    const xHits = crossingValues(samples, "y", center.y).filter((x) => x > center.x + 0.4);
    const yPitch = medianPitch(yHits);
    const xPitch = medianPitch(xHits);
    return {
        laps: Math.abs(wind) / (2 * Math.PI),
        lengthMm,
        widthPitchMm: longX ? yPitch : xPitch,
        endPitchMm: longX ? xPitch : yPitch,
        clockwise: wind < 0,
        acrossWidthGapMm: acrossWidthGapMm(samples, outline),
    };
}

export function zigzagXy(outline: Point[], profile: MillingProfile, toolType: ToolType): XyPoint[] {
    const step = stepoverMm(profile, toolType);
    const region = offsetClosedAll(outline, profile.topOffsetMm, profile.chordTolMm)[0];
    if (!region || region.length < 4) return [];
    const bb = bboxOf(region);
    const sample = Math.max(profile.sampleMm, 0.25);
    const pts: XyPoint[] = [];
    let even = true;
    for (let y = bb.minY; y <= bb.maxY; y += step) {
        const xs: number[] = [];
        for (let x = bb.minX; x <= bb.maxX; x += sample) {
            if (pointInPoly(x, y, region) || distToPoly(x, y, outline) <= profile.topOffsetMm) xs.push(x);
        }
        if (xs.length < 2) continue;
        if (!even) xs.reverse();
        for (const x of xs) pts.push({ x, y });
        even = !even;
    }
    return pts;
}

export function surfacePath(
    outline: Point[],
    profile: MillingProfile,
    dropMap: Heightmap,
    toolType: ToolType,
    _levelZ: number,
    skin: number,
): Point[] {
    const xy =
        profile.strategy === "zigzag"
            ? zigzagXy(outline, profile, toolType)
            : spiralXy(outline, profile, toolType);
    const out: Point[] = [];
    for (const p of xy) {
        const drop = sampleDrop(dropMap, p.x, p.y);
        if (!Number.isFinite(drop)) continue;
        out.push({ x: p.x, y: p.y, z: Math.max(drop, skin) });
    }
    return out;
}
