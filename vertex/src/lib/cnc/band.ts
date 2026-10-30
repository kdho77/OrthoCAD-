// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { bboxOf, distToPoly, ensureCcw, offsetClosed } from "./polygon";
import { skinZ, toolRadiusMm } from "./profile";
import type { MillingProfile, Point } from "./types";

/** Knife-line vs closed-outline deviation that counts as an uncut corner. */
export const UNCUT_CORNER_TOL_MM = 0.05;

export interface UncutCorner {
    /** Max deviation of this inner-edge span from the outline, mm. */
    deviationMm: number;
    points: Point[];
}

/**
 * Contour band from one outline. Centreline, inner edge, and outer edge are
 * Clipper round-joins of that polygon — the visualizer and the G-code generator
 * both call {@link ballBandGeometry}.
 */
export interface BallBandGeometry {
    radiusMm: number;
    /** Outline. The box knife follows this, not the slot bottom. */
    knifeLine: Point[];
    /** Ball centre: outline offset +R. */
    centreline: Point[];
    /** Outline offset +2R. */
    outerEdge: Point[];
    /** Outline closed by R (offset +R, then −R). */
    innerEdge: Point[];
    /** Horizontal overrun, outline offset +topOffset. Empty when topOffset is 0. */
    overrunEdge: Point[];
    uncutCorners: UncutCorner[];
    maxUncutMm: number;
}

/** Cleared half-width about the ball centre at height z. Skin ≤ z ≤ skin+R. */
export function ballHalfWidthMm(z: number, radiusMm: number, skinMm: number): number {
    const radial = radiusMm - (z - skinMm);
    return Math.sqrt(Math.max(0, radiusMm * radiusMm - radial * radial));
}

/** Remaining stock under a ball whose tip is at skin and whose centre is `dist` away. */
export function ballProfileZ(distFromCentreMm: number, radiusMm: number, skinMm: number): number {
    if (distFromCentreMm >= radiusMm - 1e-9) return skinMm + radiusMm;
    const d = distFromCentreMm;
    return skinMm + radiusMm - Math.sqrt(Math.max(0, radiusMm * radiusMm - d * d));
}

function copyLoop(pts: Point[]): Point[] {
    return pts.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 }));
}

/**
 * Toe end of the flat lateral edge (min Y). The widest point sits further back;
 * Windows starts where that edge turns into the toe, near X215.7 Y10.4 on the
 * left and X195.8 Y140.6 on the right. 0.8 mm is the rise at those spots.
 */
const LATERAL_FLAT_RISE_MM = 0.8;

function toeLateralTarget(loop: Point[]): Point {
    const bb = bboxOf(loop);
    let best: Point | null = null;
    for (const p of loop) {
        if (p.y > bb.minY + LATERAL_FLAT_RISE_MM) continue;
        if (!best || p.x > best.x) best = p;
    }
    return best ?? { x: bb.minX + 0.69 * (bb.maxX - bb.minX), y: bb.minY, z: 0 };
}

function rotateToClosest(loop: Point[], target: Point): Point[] {
    if (loop.length === 0) return [];
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < loop.length; i++) {
        const p = loop[i]!;
        const d = Math.hypot(p.x - target.x, p.y - target.y);
        if (d < bestD) {
            bestD = d;
            best = i;
        }
    }
    return loop.slice(best).concat(loop.slice(0, best));
}

function uncutSpans(inner: Point[], outline: Point[], tol: number): { spans: UncutCorner[]; maxMm: number } {
    const n = inner.length;
    if (n < 3 || outline.length < 3) return { spans: [], maxMm: 0 };
    const dist = inner.map((p) => distToPoly(p.x, p.y, outline));
    let maxMm = 0;
    for (const d of dist) if (d > maxMm) maxMm = d;
    for (const p of outline) {
        const d = distToPoly(p.x, p.y, inner);
        if (d > maxMm) maxMm = d;
    }
    const far = dist.map((d) => d > tol);
    const spans: UncutCorner[] = [];
    if (!far.some(Boolean)) {
        if (maxMm > tol) spans.push({ deviationMm: maxMm, points: copyLoop(inner) });
        return { spans, maxMm };
    }
    const start = far.findIndex((flag) => !flag);
    if (start < 0) {
        return { spans: [{ deviationMm: Math.max(...dist), points: copyLoop(inner) }], maxMm };
    }
    let current: Point[] | null = null;
    let dev = 0;
    for (let k = 0; k <= n; k++) {
        const i = (start + k) % n;
        const p = inner[i];
        if (!p) continue;
        if (far[i]) {
            if (!current) {
                const prev = inner[(i + n - 1) % n] ?? p;
                current = [{ x: prev.x, y: prev.y }];
                dev = 0;
            }
            current.push({ x: p.x, y: p.y });
            dev = Math.max(dev, dist[i] ?? 0);
        } else if (current?.length) {
            current.push({ x: p.x, y: p.y });
            spans.push({ deviationMm: dev, points: current });
            current = null;
            dev = 0;
        }
    }
    return { spans, maxMm };
}

/**
 * Round-join band of one outline.
 * C = outline + R, outer = outline + 2R, inner = close(outline, R).
 */
export function ballBandGeometry(
    outline: Point[],
    radiusMm: number,
    chordTolMm = 0.01,
    topOffsetMm = 0,
): BallBandGeometry {
    const chord = Math.max(1e-4, chordTolMm);
    const knifeLine = ensureCcw(copyLoop(outline));
    const radius = Math.max(0.1, radiusMm);
    const centreRaw = offsetClosed(knifeLine, radius, chord);
    const centreline =
        centreRaw.length >= 3 ? rotateToClosest(centreRaw, toeLateralTarget(centreRaw)) : centreRaw;
    const outerEdge = offsetClosed(knifeLine, radius * 2, chord);
    const innerEdge = centreline.length >= 3 ? offsetClosed(centreline, -radius, chord) : copyLoop(knifeLine);
    const closed = innerEdge.length >= 3 ? innerEdge : copyLoop(knifeLine);
    const overrunEdge = topOffsetMm > 1e-6 ? offsetClosed(knifeLine, topOffsetMm, chord) : [];
    const { spans, maxMm } = uncutSpans(closed, knifeLine, UNCUT_CORNER_TOL_MM);
    return {
        radiusMm: radius,
        knifeLine,
        centreline,
        outerEdge,
        innerEdge: closed,
        overrunEdge,
        uncutCorners: spans,
        maxUncutMm: maxMm,
    };
}

export function hausdorffClosed(a: Point[], b: Point[]): number {
    if (a.length === 0 || b.length === 0) return Infinity;
    let max = 0;
    for (const p of a) {
        const d = distToPoly(p.x, p.y, b);
        if (d > max) max = d;
    }
    for (const p of b) {
        const d = distToPoly(p.x, p.y, a);
        if (d > max) max = d;
    }
    return max;
}

/** Mill legend. Idaho 10 mm ball reads the approved sentence exactly. */
export function contourLegend(profile: MillingProfile): string {
    const r = toolRadiusMm(profile.contourCutter.diameterMm);
    const skin = skinZ(profile);
    const label = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3));
    if (profile.contourCutter.type !== "ball") {
        return `${profile.contourCutter.diameterMm} mm flat: vertical wall at the knife line. ${label(skin)} mm skin.`;
    }
    const zWall = skin + r;
    return `R${label(r)} ball: wall vertical down to Z ${label(zWall)}, filleted in the lowest ${label(r)} mm. ${label(skin)} mm skin.`;
}
