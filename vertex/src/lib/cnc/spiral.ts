// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { sampleDrop } from "./drop-cutter";
import {
    bboxOf,
    centroid,
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
    /** Medial polyline of the component the cutter enters, center in the middle. */
    medial: XyPoint[];
    /** Innermost kept ring of that same component. */
    innermostRing: XyPoint[];
    /** Closed-enough polyline the entry ramp repeats. Starts and ends at the center. */
    entry: XyPoint[];
    stepoverMm: number;
}

const PATH_SPACING_MM = 0.4;
const OFFSET_CHORD_MM = 0.15;
const MAX_RINGS = 160;

interface RingNode {
    ring: Point[];
    children: RingNode[];
}

function ringWidth(loop: Point[]): number {
    const bb = bboxOf(loop);
    return Math.min(bb.maxX - bb.minX, bb.maxY - bb.minY);
}

function asCw(loop: Point[]): Point[] {
    const cw = ensureCw(loop);
    return resampleClosed(cw, PATH_SPACING_MM);
}

function rotateTo(loop: Point[], target: XyPoint): Point[] {
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

function sampleArc(loop: Point[], n: number): Point[] {
    if (loop.length === 0 || n < 1) return [];
    const len = Math.max(1e-9, perimeter(loop));
    const out: Point[] = [];
    for (let k = 0; k < n; k++) {
        let s = (k / n) * len;
        for (let i = 0; i < loop.length; i++) {
            const a = loop[i]!;
            const b = loop[(i + 1) % loop.length]!;
            const d = Math.hypot(b.x - a.x, b.y - a.y);
            if (s <= d || i === loop.length - 1) {
                const t = d > 1e-12 ? Math.max(0, Math.min(1, s / d)) : 0;
                out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: 0 });
                break;
            }
            s -= d;
        }
    }
    return out;
}

function closestOnPolyline(p: XyPoint, poly: XyPoint[]): XyPoint {
    if (poly.length === 0) return { x: p.x, y: p.y };
    if (poly.length === 1) return { x: poly[0]!.x, y: poly[0]!.y };
    let bestX = poly[0]!.x;
    let bestY = poly[0]!.y;
    let bestD = Infinity;
    for (let i = 0; i < poly.length - 1; i++) {
        const a = poly[i]!;
        const b = poly[i + 1]!;
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const len2 = ex * ex + ey * ey;
        const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2)) : 0;
        const x = a.x + ex * t;
        const y = a.y + ey * t;
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bestD) {
            bestD = d;
            bestX = x;
            bestY = y;
        }
    }
    return { x: bestX, y: bestY };
}

function distToPolyline(p: XyPoint, poly: XyPoint[]): number {
    const c = closestOnPolyline(p, poly);
    return Math.hypot(p.x - c.x, p.y - c.y);
}

function polylineLength(pts: XyPoint[]): number {
    let l = 0;
    for (let i = 1; i < pts.length; i++)
        l += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
    return l;
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

function segmentInside(a: XyPoint, b: XyPoint, ring: Point[]): boolean {
    for (let s = 1; s <= 4; s++) {
        const t = s / 5;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        if (!pointInPoly(x, y, ring) && distToPoly(x, y, ring) > 0.05) return false;
    }
    return true;
}

/** Medial-axis polyline of a small ring: midpoints of opposite boundary samples, ordered on the long axis. */
export function medialAxis(ring: Point[]): XyPoint[] {
    if (ring.length < 3) {
        const c = centroid(ring.length ? ring : [{ x: 0, y: 0 }]);
        return [{ x: c.x, y: c.y }];
    }
    const pts = resampleClosed(ring, 0.6);
    const c = centroid(pts);
    let xx = 0;
    let yy = 0;
    let xy = 0;
    for (const p of pts) {
        const dx = p.x - c.x;
        const dy = p.y - c.y;
        xx += dx * dx;
        yy += dy * dy;
        xy += dx * dy;
    }
    const ang = 0.5 * Math.atan2(2 * xy, xx - yy);
    const ax = Math.cos(ang);
    const ay = Math.sin(ang);
    const n = pts.length;
    const minSep = Math.max(3, Math.floor(n * 0.18));
    const mids: Array<{ t: number; x: number; y: number }> = [];
    const stride = Math.max(1, Math.floor(n / 80));
    for (let i = 0; i < n; i += stride) {
        const pi = pts[i]!;
        let bestJ = -1;
        let bestD = Infinity;
        for (let j = 0; j < n; j++) {
            const sep = Math.min(Math.abs(i - j), n - Math.abs(i - j));
            if (sep < minSep) continue;
            const pj = pts[j]!;
            const d = Math.hypot(pj.x - pi.x, pj.y - pi.y);
            if (d < bestD) {
                bestD = d;
                bestJ = j;
            }
        }
        if (bestJ < 0) continue;
        const pj = pts[bestJ]!;
        if (!segmentInside(pi, pj, pts)) continue;
        const mx = (pi.x + pj.x) / 2;
        const my = (pi.y + pj.y) / 2;
        if (!pointInPoly(mx, my, pts) && distToPoly(mx, my, pts) > 0.2) continue;
        mids.push({ t: (mx - c.x) * ax + (my - c.y) * ay, x: mx, y: my });
    }
    if (mids.length < 2) return [{ x: c.x, y: c.y }];
    mids.sort((a, b) => a.t - b.t);
    const span = mids[mids.length - 1]!.t - mids[0]!.t;
    if (span < 0.2) return [{ x: c.x, y: c.y }];
    const bins = Math.max(2, Math.ceil(span / 0.45));
    const poly: XyPoint[] = [];
    for (let b = 0; b < bins; b++) {
        const t0 = mids[0]!.t + (span * b) / bins;
        const t1 = mids[0]!.t + (span * (b + 1)) / bins;
        let sx = 0;
        let sy = 0;
        let cnt = 0;
        for (const m of mids) {
            const last = b === bins - 1;
            if (m.t >= t0 && (m.t < t1 || (last && m.t <= t1 + 1e-9))) {
                sx += m.x;
                sy += m.y;
                cnt++;
            }
        }
        if (!cnt) continue;
        const x = sx / cnt;
        const y = sy / cnt;
        if (pointInPoly(x, y, pts) || distToPoly(x, y, pts) <= 0.3) poly.push({ x, y });
    }
    if (poly.length < 2) return [{ x: c.x, y: c.y }];
    return poly;
}

/** Center → end A → end B → center, so the first point lies on the segment. */
export function medialOutAndBack(medial: XyPoint[]): XyPoint[] {
    if (medial.length === 0) return [];
    if (medial.length === 1) return [{ x: medial[0]!.x, y: medial[0]!.y }];
    const mid = Math.floor((medial.length - 1) / 2);
    const path: XyPoint[] = [];
    for (let i = mid; i >= 0; i--) path.push({ x: medial[i]!.x, y: medial[i]!.y });
    for (let i = 1; i < medial.length; i++) path.push({ x: medial[i]!.x, y: medial[i]!.y });
    for (let i = medial.length - 2; i >= mid; i--) path.push({ x: medial[i]!.x, y: medial[i]!.y });
    return path;
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

function loopGap(inner: Point[], outer: Point[]): number {
    const a = resampleClosed(inner, 1.5);
    const b = resampleClosed(outer, 1.5);
    let maxD = 0;
    for (const p of a) maxD = Math.max(maxD, distToPoly(p.x, p.y, b));
    for (const p of b) maxD = Math.max(maxD, distToPoly(p.x, p.y, a));
    return maxD + 0.25;
}

/**
 * Clockwise laps from `inner` onto `outer`, starts matched and both loops
 * parameterized by arc length. When a trimmed offset leaves the loops farther
 * apart than one stepover, extra laps keep the radial pitch at the stepover.
 */
function blendLoops(
    inner: Point[],
    outer: Point[],
    index0: number,
    step: number,
    component: number,
    out: SpiralSample[],
): number {
    if (inner.length < 3 || outer.length < 3) return index0;
    const outerAligned = rotateTo(ensureCw(outer), inner[0]!);
    const per = Math.max(perimeter(inner), perimeter(outerAligned));
    const n = Math.max(12, Math.ceil(per / PATH_SPACING_MM));
    const a = sampleArc(inner, n);
    const b = sampleArc(outerAligned, n);
    const gap = Math.max(loopGap(inner, outerAligned), step);
    const laps = Math.max(1, Math.ceil((gap - 1e-6) / Math.max(0.2, step)));
    for (let lap = 0; lap < laps; lap++) {
        for (let k = 0; k <= n; k++) {
            const u = (lap + k / n) / laps;
            const p = a[k % n]!;
            const q = b[k % n]!;
            pushSample(
                out,
                { x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u },
                index0 + u * laps,
                component,
                false,
            );
        }
    }
    return index0 + laps;
}

/**
 * Open the medial segment out to `ring` over enough laps that the radial pitch
 * stays at the stepover. Clipper is not asked for rings narrower than 2× stepover;
 * this morph is the connection from the medial segment onto the last kept ring.
 */
function morphMedialToRing(
    medial: XyPoint[],
    ring: Point[],
    step: number,
    index0: number,
    component: number,
    out: SpiralSample[],
): number {
    const aligned = rotateTo(ring, closestOnPolyline(medialCenter(medial), ring));
    let maxD = 0;
    for (const p of aligned) maxD = Math.max(maxD, distToPolyline(p, medial));
    const laps = Math.max(1, Math.ceil((maxD - 1e-6) / Math.max(0.2, step)));
    const n = Math.max(12, Math.ceil(perimeter(aligned) / PATH_SPACING_MM));
    const samples = sampleArc(aligned, n);
    let bestI = 0;
    let bestD = Infinity;
    const center = medialCenter(medial);
    for (let i = 0; i < samples.length; i++) {
        const c = closestOnPolyline(samples[i]!, medial);
        const d = Math.hypot(c.x - center.x, c.y - center.y);
        if (d < bestD) {
            bestD = d;
            bestI = i;
        }
    }
    const ordered = samples.slice(bestI).concat(samples.slice(0, bestI));
    const start = closestOnPolyline(ordered[0]!, medial);
    if (Math.hypot(start.x - center.x, start.y - center.y) > 1e-4) {
        for (const p of densifyOpen([center, start], PATH_SPACING_MM)) {
            pushSample(out, p, index0, component, false);
        }
    }
    for (let lap = 0; lap < laps; lap++) {
        for (let k = 0; k <= n; k++) {
            const u = (lap + k / n) / laps;
            const q = ordered[k % n]!;
            const c = closestOnPolyline(q, medial);
            pushSample(
                out,
                { x: c.x + (q.x - c.x) * u, y: c.y + (q.y - c.y) * u },
                index0 + u * laps,
                component,
                false,
            );
        }
    }
    return index0 + laps;
}

function medialCenter(medial: XyPoint[]): XyPoint {
    if (medial.length === 0) return { x: 0, y: 0 };
    return medial[Math.floor((medial.length - 1) / 2)]!;
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

function emitLeaf(
    ring: Point[],
    into: Point[] | null,
    index0: number,
    component: number,
    componentStart: boolean,
    step: number,
    out: SpiralSample[],
): { endIndex: number; endPoint: XyPoint; medial: XyPoint[]; ring: Point[] } {
    const medial = medialAxis(ring);
    const travel = medialOutAndBack(medial);
    let started = componentStart;
    for (const p of travel) {
        pushSample(out, p, index0, component, started);
        started = false;
    }
    const endIndex = morphMedialToRing(medial, ring, step, index0, component, out);
    const endPoint = out[out.length - 1] ?? medialCenter(medial);
    if (into && into.length >= 3) {
        const fromLoop = rotateTo(ring, endPoint);
        const blended = blendLoops(fromLoop, into, endIndex, step, component, out);
        return {
            endIndex: blended,
            endPoint: out[out.length - 1] ?? endPoint,
            medial,
            ring,
        };
    }
    return { endIndex, endPoint: out[out.length - 1] ?? endPoint, medial, ring };
}

function sortedKids(node: RingNode): RingNode[] {
    return node.children.slice().sort((a, b) => {
        const ca = centroid(a.ring);
        const cb = centroid(b.ring);
        return ca.x - cb.x || ca.y - cb.y;
    });
}

function entryOf(node: RingNode): XyPoint {
    if (node.children.length === 0) return medialCenter(medialAxis(node.ring));
    return entryOf(sortedKids(node)[0]!);
}

function emitNode(
    node: RingNode,
    into: Point[] | null,
    index0: number,
    component: number,
    componentStart: boolean,
    step: number,
    warnings: string[],
    out: SpiralSample[],
): { endIndex: number; endPoint: XyPoint; component: number; medial: XyPoint[]; ring: Point[] } {
    if (node.children.length === 0) {
        const leaf = emitLeaf(node.ring, into, index0, component, componentStart, step, out);
        return { ...leaf, component };
    }
    const kids = sortedKids(node);
    if (kids.length > 1) {
        warnings.push(`offset split into ${kids.length} components; cutting each center-out`);
    }
    let comp = component;
    let flag = componentStart;
    let endIndex = index0;
    let endPoint: XyPoint = centroid(node.ring);
    let firstMedial: XyPoint[] | null = null;
    let firstRing: Point[] | null = null;
    for (let i = 0; i < kids.length; i++) {
        const child = emitNode(kids[i]!, node.ring, index0, comp, flag, step, warnings, out);
        if (!firstMedial) {
            firstMedial = child.medial;
            firstRing = child.ring;
        }
        endIndex = child.endIndex;
        endPoint = child.endPoint;
        comp = child.component;
        if (i < kids.length - 1) {
            const next = entryOf(kids[i + 1]!);
            linkSamples(endPoint, next, endIndex, comp, out);
            comp += 1;
            flag = true;
        }
    }
    if (into && into.length >= 3) {
        const fromLoop = rotateTo(node.ring, endPoint);
        endIndex = blendLoops(fromLoop, into, endIndex, step, comp, out);
        endPoint = out[out.length - 1] ?? endPoint;
    }
    return {
        endIndex,
        endPoint,
        component: comp,
        medial: firstMedial ?? medialAxis(node.ring),
        ring: firstRing ?? node.ring,
    };
}

function acceptable(loop: Point[], step: number): boolean {
    return loop.length >= 8 && Math.abs(signedArea(loop)) > 0.5 && ringWidth(loop) >= step * 2;
}

function grow(loop: Point[], step: number, depth: number): RingNode {
    if (depth >= MAX_RINGS) return { ring: loop, children: [] };
    const next = offsetClosedAll(loop, -step, OFFSET_CHORD_MM)
        .map((p) => asCw(p))
        .filter((p) => acceptable(p, step));
    return { ring: loop, children: next.map((p) => grow(p, step, depth + 1)) };
}

function rampCircuit(medial: XyPoint[], ring: Point[]): XyPoint[] {
    const travel = densifyOpen(medialOutAndBack(medial), 0.8);
    if (polylineLength(travel) >= 12 && travel.length >= 2) return travel;
    if (ring.length < 3) return travel.length ? travel : medial.slice();
    const center = medialCenter(medial);
    const start = rotateTo(ring, center)[0] ?? center;
    const around = rotateTo(ring, start);
    const circuit: XyPoint[] = [
        center,
        ...around.map((p) => ({ x: p.x, y: p.y })),
        { x: start.x, y: start.y },
        center,
    ];
    return densifyOpen(circuit, 0.8);
}

/**
 * One clockwise center-out spiral per component.
 * Rings are successive inward offsets. Offsetting stops when the next ring is
 * empty or its bbox is narrower than 2× stepover. The innermost element is that
 * last ring's medial segment, travelled out and back, then morphed onto the ring.
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
    const roots = outers.map((ring) => grow(ring, step, 0));
    roots.sort((a, b) => centroid(a.ring).x - centroid(b.ring).x || centroid(a.ring).y - centroid(b.ring).y);
    const samples: SpiralSample[] = [];
    let component = 0;
    let first: { medial: XyPoint[]; ring: Point[] } | null = null;
    for (let i = 0; i < roots.length; i++) {
        const emitted = emitNode(roots[i]!, null, 0, component, true, step, warnings, samples);
        if (!first) first = { medial: emitted.medial, ring: emitted.ring };
        component = emitted.component + 1;
        if (i < roots.length - 1) {
            const next = entryOf(roots[i + 1]!);
            linkSamples(emitted.endPoint, next, emitted.endIndex, emitted.component, samples);
        }
    }
    const medial = first?.medial ?? [];
    const innermostRing = first?.ring ?? [];
    for (const w of warnings) console.warn(`[cnc] ${w}`);
    return {
        samples,
        warnings,
        medial,
        innermostRing,
        entry: rampCircuit(medial, innermostRing),
        stepoverMm: step,
    };
}

export function spiralXy(outline: Point[], profile: MillingProfile, toolType: ToolType): XyPoint[] {
    return planCenterSpiral(outline, profile, toolType).samples.map((p) => ({ x: p.x, y: p.y }));
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
