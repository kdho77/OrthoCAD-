// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { AmputationPoint, Side, SideAmputation } from "@/types";

export type { AmputationPoint, SideAmputation };

/**
 * Windows-parity amputation filler.
 *
 * Points live in a mirror-safe foot frame: x millimetres from the heel toward
 * the toe, y millimetres from the midline with medial positive. The same
 * points on the left and the right foot are the same anatomical cut.
 *
 * The drawn line is the step. The toe side of that line is a flat rise of
 * `height` millimetres. Fillet inside is the convex rounding of the top edge.
 * Fillet outside is the concave blend back into the insole. Interface fillet
 * off replaces that blend with about 1 mm of cleanup and a near-vertical step.
 */

export const AMPUTATION_HEIGHT_MM = 15;
export const AMPUTATION_FILLET_INSIDE_MM = 10;
export const AMPUTATION_FILLET_OUTSIDE_MM = 30;
/** Kendon: interface fillet off is a near-vertical step with ~1 mm of cleanup. */
export const AMPUTATION_INTERFACE_OFF_MM = 1;

export interface AmputationProfile {
    height: number;
    filletInside: number;
    filletOutside: number;
    interfaceFillet: boolean;
}

export function defaultSideAmputation(): SideAmputation {
    return {
        enabled: false,
        points: [],
        height: AMPUTATION_HEIGHT_MM,
        filletInside: AMPUTATION_FILLET_INSIDE_MM,
        filletOutside: AMPUTATION_FILLET_OUTSIDE_MM,
        interfaceFillet: true,
    };
}

export function normalizeSideAmputation(raw: Partial<SideAmputation> | null | undefined): SideAmputation {
    const base = defaultSideAmputation();
    if (!raw) return base;
    const points = Array.isArray(raw.points)
        ? raw.points
              .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
              .slice(0, 64)
              .map((p) => ({ x: p.x, y: p.y }))
        : [];
    return {
        enabled: raw.enabled === true,
        points,
        height: clampNum(raw.height, 0, 40, base.height),
        filletInside: clampNum(raw.filletInside, 0, 80, base.filletInside),
        filletOutside: clampNum(raw.filletOutside, 0, 80, base.filletOutside),
        interfaceFillet: raw.interfaceFillet !== false,
    };
}

function clampNum(value: unknown, min: number, max: number, fallback: number): number {
    const n = typeof value === "number" ? value : Number.NaN;
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

/** Enabled, with a real cut and a positive rise. Anything else adds 0 mm. */
export function amputationFillerActive(amp?: SideAmputation | null): boolean {
    if (!amp?.enabled) return false;
    if (!(amp.height > 0)) return false;
    return amp.points.length >= 3;
}

interface ProfileGeom {
    theta: number;
    outRun: number;
    inRun: number;
    straightRun: number;
    vOut: number;
    height: number;
    filletInside: number;
    filletOutside: number;
}

/**
 * Two circular fillets meeting at the drawn line.
 * Overlapping radii (their quarter-circles would stack past `height`) drop the
 * straight wall and meet at the sweep whose rises sum to `height` — the min
 * envelope of the two arcs. Interface fillet off caps the outside radius at
 * ~1 mm and lets the step go near-vertical.
 */
function profileGeom(spec: AmputationProfile): ProfileGeom {
    const height = Math.max(0, spec.height);
    const filletInside = Math.max(0, spec.filletInside);
    const filletOutside = spec.interfaceFillet
        ? Math.max(0, spec.filletOutside)
        : Math.min(Math.max(0, spec.filletOutside), AMPUTATION_INTERFACE_OFF_MM);
    const thetaCap = spec.interfaceFillet ? (55 * Math.PI) / 180 : (82 * Math.PI) / 180;
    const sum = filletInside + filletOutside;
    if (!(height > 0) || sum < 1e-9) {
        return {
            theta: 0,
            outRun: 0,
            inRun: 0,
            straightRun: 0,
            vOut: 0,
            height,
            filletInside,
            filletOutside,
        };
    }
    const need = 1 - height / sum;
    const cosCap = Math.cos(thetaCap);
    let theta: number;
    if (need >= 1) theta = 0;
    else if (need <= cosCap) theta = thetaCap;
    else theta = Math.acos(need);
    const vOut = filletOutside * (1 - Math.cos(theta));
    const vIn = filletInside * (1 - Math.cos(theta));
    const straightV = Math.max(0, height - vOut - vIn);
    const straightRun = theta < 1e-8 ? 0 : straightV / Math.tan(theta);
    return {
        theta,
        outRun: filletOutside * Math.sin(theta),
        inRun: filletInside * Math.sin(theta),
        straightRun,
        vOut,
        height,
        filletInside,
        filletOutside,
    };
}

/** Rise (mm) from signed distance to the cut. Positive distance is the toe side. */
export function amputationRiseMm(signedMm: number, spec: AmputationProfile): number {
    const g = profileGeom(spec);
    if (!(g.height > 0)) return 0;
    if (signedMm <= -g.outRun) return 0;
    if (signedMm >= g.straightRun + g.inRun) return g.height;
    if (signedMm <= 0) {
        if (g.filletOutside < 1e-9 || g.outRun < 1e-9) return 0;
        const sinPhi = (signedMm + g.outRun) / g.filletOutside;
        const phi = Math.asin(Math.min(1, Math.max(0, sinPhi)));
        return g.filletOutside * (1 - Math.cos(phi));
    }
    if (signedMm <= g.straightRun) {
        const vIn = g.filletInside * (1 - Math.cos(g.theta));
        const straightV = Math.max(0, g.height - g.vOut - vIn);
        const t = g.straightRun <= 1e-9 ? 1 : signedMm / g.straightRun;
        return g.vOut + t * straightV;
    }
    const local = signedMm - g.straightRun;
    if (g.filletInside < 1e-9) return g.height;
    const sinPhi = Math.sin(g.theta) - local / g.filletInside;
    const phi = Math.asin(Math.min(1, Math.max(0, sinPhi)));
    return g.height - g.filletInside * (1 - Math.cos(phi));
}

/** How far heel-ward of the line the outside fillet still adds height. */
export function amputationOutsideReachMm(spec: AmputationProfile): number {
    return profileGeom(spec).outRun;
}

export interface OutlineSample {
    x: number;
    y: number;
}

/** Closed outline in the medial frame. Medial (positive y) then lateral, heel to toe. */
export function footOutlineMedial(
    lengthMm: number,
    widthMm: number,
    halfWidthMm: (u: number) => number,
    samples = 72,
): OutlineSample[] {
    const pts: OutlineSample[] = [];
    const n = Math.max(8, samples);
    for (let i = 0; i <= n; i++) {
        const u = i / n;
        pts.push({ x: u * lengthMm, y: halfWidthMm(u) });
    }
    for (let i = n - 1; i >= 1; i--) {
        const u = i / n;
        pts.push({ x: u * lengthMm, y: -halfWidthMm(u) });
    }
    return pts;
}

function segCross(a: AmputationPoint, b: AmputationPoint, c: AmputationPoint, d: AmputationPoint): boolean {
    const d1 = cross(b.x - a.x, b.y - a.y, c.x - a.x, c.y - a.y);
    const d2 = cross(b.x - a.x, b.y - a.y, d.x - a.x, d.y - a.y);
    const d3 = cross(d.x - c.x, d.y - c.y, a.x - c.x, a.y - c.y);
    const d4 = cross(d.x - c.x, d.y - c.y, b.x - c.x, b.y - c.y);
    return d1 * d2 < -1e-12 && d3 * d4 < -1e-12;
}

function cross(ax: number, ay: number, bx: number, by: number): number {
    return ax * by - ay * bx;
}

function polylineCrosses(points: AmputationPoint[]): boolean {
    for (let i = 0; i < points.length - 1; i++) {
        for (let j = i + 2; j < points.length - 1; j++) {
            if (i === 0 && j === points.length - 2) continue;
            if (segCross(points[i]!, points[i + 1]!, points[j]!, points[j + 1]!)) return true;
        }
    }
    return false;
}

/** Drop clicks that make the cut cross itself. Keeps a simple prefix-plus-tail. */
export function clipSelfCrossingLine(points: AmputationPoint[]): {
    points: AmputationPoint[];
    clipped: boolean;
} {
    if (points.length < 4) return { points: points.map((p) => ({ ...p })), clipped: false };
    const out: AmputationPoint[] = [{ ...points[0]! }];
    let clipped = false;
    for (let i = 1; i < points.length; i++) {
        const next = points[i]!;
        let crosses = false;
        for (let j = 0; j < out.length - 2; j++) {
            if (segCross(out[j]!, out[j + 1]!, out[out.length - 1]!, next)) {
                crosses = true;
                break;
            }
        }
        if (crosses) {
            clipped = true;
            continue;
        }
        out.push({ ...next });
    }
    return { points: out, clipped };
}

function nearestOnOutline(p: AmputationPoint, outline: OutlineSample[]): AmputationPoint {
    let best = outline[0] ?? p;
    let bestD = Infinity;
    for (let i = 0; i < outline.length; i++) {
        const a = outline[i]!;
        const b = outline[(i + 1) % outline.length]!;
        const hit = projectSeg(p, a, b);
        const d = (hit.x - p.x) ** 2 + (hit.y - p.y) ** 2;
        if (d < bestD) {
            bestD = d;
            best = hit;
        }
    }
    return best;
}

function projectSeg(p: AmputationPoint, a: OutlineSample, b: OutlineSample): AmputationPoint {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    if (len2 < 1e-12) return { x: a.x, y: a.y };
    let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
    t = Math.max(0, Math.min(1, t));
    return { x: a.x + abx * t, y: a.y + aby * t };
}

function pointInOutline(p: AmputationPoint, outline: OutlineSample[]): boolean {
    let wind = 0;
    for (let i = 0; i < outline.length; i++) {
        const a = outline[i]!;
        const b = outline[(i + 1) % outline.length]!;
        if (a.y <= p.y) {
            if (b.y > p.y && cross(b.x - a.x, b.y - a.y, p.x - a.x, p.y - a.y) > 0) wind++;
        } else if (b.y <= p.y && cross(b.x - a.x, b.y - a.y, p.x - a.x, p.y - a.y) < 0) wind--;
    }
    return wind !== 0;
}

function catmullRom(points: AmputationPoint[], stepsPerSpan: number): AmputationPoint[] {
    if (points.length < 2) return points.map((p) => ({ ...p }));
    if (points.length === 2) return densify(points[0]!, points[1]!, stepsPerSpan);
    const out: AmputationPoint[] = [];
    const n = points.length;
    for (let i = 0; i < n - 1; i++) {
        const p0 = points[Math.max(0, i - 1)]!;
        const p1 = points[i]!;
        const p2 = points[i + 1]!;
        const p3 = points[Math.min(n - 1, i + 2)]!;
        for (let s = 0; s < stepsPerSpan; s++) {
            out.push(centripetal(p0, p1, p2, p3, s / stepsPerSpan));
        }
    }
    out.push({ ...points[n - 1]! });
    return out;
}

function densify(a: AmputationPoint, b: AmputationPoint, steps: number): AmputationPoint[] {
    const out: AmputationPoint[] = [];
    const n = Math.max(1, steps);
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
    return out;
}

function centripetal(
    p0: AmputationPoint,
    p1: AmputationPoint,
    p2: AmputationPoint,
    p3: AmputationPoint,
    t: number,
): AmputationPoint {
    const alpha = 0.5;
    const t0 = 0;
    const t1 = knot(t0, p0, p1, alpha);
    const t2 = knot(t1, p1, p2, alpha);
    const t3 = knot(t2, p2, p3, alpha);
    const u = t1 + (t2 - t1) * t;
    const a1 = lerpKnot(p0, p1, t0, t1, u);
    const a2 = lerpKnot(p1, p2, t1, t2, u);
    const a3 = lerpKnot(p2, p3, t2, t3, u);
    const b1 = lerpKnot(a1, a2, t0, t2, u);
    const b2 = lerpKnot(a2, a3, t1, t3, u);
    return lerpKnot(b1, b2, t1, t2, u);
}

function knot(ti: number, a: AmputationPoint, b: AmputationPoint, alpha: number): number {
    return ti + Math.max(1e-4, Math.hypot(b.x - a.x, b.y - a.y)) ** alpha;
}

function lerpKnot(
    a: AmputationPoint,
    b: AmputationPoint,
    ta: number,
    tb: number,
    u: number,
): AmputationPoint {
    const den = tb - ta;
    if (Math.abs(den) < 1e-9) return { x: a.x, y: a.y };
    const f = (u - ta) / den;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

export interface AmputationDrawResult {
    points: AmputationPoint[];
    /** Dense cut used by the height field, after the outline closure is applied. */
    spline: AmputationPoint[];
    clipped: boolean;
    rejected: boolean;
    reason?: string;
}

/**
 * Click points → clip to the outline, drop self-crossings, fit a smooth spline.
 * Endpoints land on the outline. The toe side closes along that outline.
 */
export function confirmAmputationDraw(
    raw: readonly AmputationPoint[],
    lengthMm: number,
    widthMm: number,
    halfWidthMm: (u: number) => number,
): AmputationDrawResult {
    const outline = footOutlineMedial(lengthMm, widthMm, halfWidthMm);
    let clipped = false;
    const finite = raw.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).map((p) => ({ ...p }));
    if (finite.length < 3) {
        return {
            points: finite,
            spline: [],
            clipped: false,
            rejected: true,
            reason: "Draw at least three points.",
        };
    }
    const parked = finite.map((p) => {
        if (pointInOutline(p, outline)) return p;
        clipped = true;
        return nearestOnOutline(p, outline);
    });
    const ends = parked.slice();
    ends[0] = nearestOnOutline(ends[0]!, outline);
    ends[ends.length - 1] = nearestOnOutline(ends[ends.length - 1]!, outline);
    if (ends[0]!.x !== parked[0]!.x || ends[0]!.y !== parked[0]!.y) clipped = true;
    const simple = clipSelfCrossingLine(ends);
    if (simple.clipped) clipped = true;
    if (simple.points.length < 3) {
        return {
            points: simple.points,
            spline: [],
            clipped,
            rejected: true,
            reason: "That line crosses itself. Draw a single U from the medial edge to the lateral edge.",
        };
    }
    let spline = catmullRom(simple.points, 6);
    spline = spline.map((p) => {
        if (pointInOutline(p, outline)) return p;
        clipped = true;
        return nearestOnOutline(p, outline);
    });
    if (polylineCrosses(spline)) {
        spline = simple.points.flatMap((p, i) =>
            i === simple.points.length - 1 ? [p] : densify(p, simple.points[i + 1]!, 4).slice(0, -1),
        );
        spline.push(simple.points[simple.points.length - 1]!);
        clipped = true;
    }
    return { points: simple.points, spline, clipped, rejected: false };
}

interface PreparedCut {
    key: string;
    spline: AmputationPoint[];
    polygon: AmputationPoint[];
    spec: AmputationProfile;
}

const preparedCache = new WeakMap<SideAmputation, PreparedCut>();

function prepareCut(
    amp: SideAmputation,
    lengthMm: number,
    widthMm: number,
    halfWidthMm: (u: number) => number,
): PreparedCut | null {
    if (!amputationFillerActive(amp)) return null;
    const outlineKey = [0, 0.25, 0.5, 0.75, 1].map((u) => halfWidthMm(u).toFixed(3)).join(",");
    const pointKey = amp.points.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(";");
    const key = [
        lengthMm.toFixed(3),
        widthMm.toFixed(3),
        amp.height,
        amp.filletInside,
        amp.filletOutside,
        amp.interfaceFillet ? 1 : 0,
        outlineKey,
        pointKey,
    ].join("|");
    const hit = preparedCache.get(amp);
    if (hit && hit.key === key) return hit;
    const draw = confirmAmputationDraw(amp.points, lengthMm, widthMm, halfWidthMm);
    if (draw.rejected || draw.spline.length < 2) return null;
    const outline = footOutlineMedial(lengthMm, widthMm, halfWidthMm);
    const polygon = closeAlongOutline(draw.spline, outline);
    const prep: PreparedCut = {
        key,
        spline: draw.spline,
        polygon,
        spec: {
            height: amp.height,
            filletInside: amp.filletInside,
            filletOutside: amp.filletOutside,
            interfaceFillet: amp.interfaceFillet,
        },
    };
    preparedCache.set(amp, prep);
    return prep;
}

function closeAlongOutline(spline: AmputationPoint[], outline: OutlineSample[]): AmputationPoint[] {
    if (spline.length < 2 || outline.length < 4) return spline.map((p) => ({ ...p }));
    const start = nearestOutlineIndex(spline[0]!, outline);
    const end = nearestOutlineIndex(spline[spline.length - 1]!, outline);
    const toe = outline.reduce((best, p, i) => (p.x > outline[best]!.x ? i : best), 0);
    const forward = arcIndices(end, start, outline.length);
    const back = arcIndices(end, start, outline.length, true);
    const use = forward.includes(toe) ? forward : back;
    const arc = use.map((i) => ({ x: outline[i]!.x, y: outline[i]!.y }));
    return spline.map((p) => ({ ...p })).concat(arc);
}

function nearestOutlineIndex(p: AmputationPoint, outline: OutlineSample[]): number {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < outline.length; i++) {
        const d = (outline[i]!.x - p.x) ** 2 + (outline[i]!.y - p.y) ** 2;
        if (d < bestD) {
            bestD = d;
            best = i;
        }
    }
    return best;
}

function arcIndices(from: number, to: number, n: number, reverse = false): number[] {
    const out: number[] = [];
    let i = from;
    for (let guard = 0; guard <= n; guard++) {
        out.push(i);
        if (i === to) break;
        i = reverse ? (i - 1 + n) % n : (i + 1) % n;
    }
    return out;
}

function pointInPoly(p: AmputationPoint, poly: AmputationPoint[]): boolean {
    let wind = 0;
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i]!;
        const b = poly[(i + 1) % poly.length]!;
        if (a.y <= p.y) {
            if (b.y > p.y && cross(b.x - a.x, b.y - a.y, p.x - a.x, p.y - a.y) > 0) wind++;
        } else if (b.y <= p.y && cross(b.x - a.x, b.y - a.y, p.x - a.x, p.y - a.y) < 0) wind--;
    }
    return wind !== 0;
}

function distToPolyline(p: AmputationPoint, line: AmputationPoint[]): number {
    let best = Infinity;
    for (let i = 0; i < line.length - 1; i++) {
        const hit = projectSeg(p, line[i]!, line[i + 1]!);
        const d = Math.hypot(hit.x - p.x, hit.y - p.y);
        if (d < best) best = d;
    }
    return best;
}

/**
 * Added top height at a normalized footprint sample.
 * `vSigned` is the mesh width coordinate (−1..1). Medial is derived from `side`,
 * so a left foot and a right foot with the same points rise together.
 */
export function amputationDeltaMm(
    u: number,
    vSigned: number,
    side: Side,
    lengthMm: number,
    widthMm: number,
    amp: SideAmputation,
    halfWidthMm: (uu: number) => number,
): number {
    const prep = prepareCut(amp, lengthMm, widthMm, halfWidthMm);
    if (!prep) return 0;
    const x = u * lengthMm;
    const medialSign = side === "left" ? -1 : 1;
    const medial = -(vSigned * medialSign);
    const y = medial * (widthMm / 2);
    const p = { x, y };
    const dist = distToPolyline(p, prep.spline);
    const inside = pointInPoly(p, prep.polygon);
    const signed = inside ? dist : -dist;
    return amputationRiseMm(signed, prep.spec);
}

/**
 * Add the plateau to the lofted top sheet. The rim vertices are in this range,
 * so the walls grow taller with the toe and can be subdivided afterwards.
 * Runs only when the filler is active.
 */
export function applyAmputationRiseToTop(args: {
    positions: number[];
    topCount: number;
    side: Side;
    amp: SideAmputation;
    lengthMm: number;
    widthMm: number;
    minX: number;
    lenSize: number;
    vSignedAt: (y: number) => number;
    halfWidthMm: (u: number) => number;
}): void {
    const { positions, topCount, side, amp, lengthMm, widthMm, minX, lenSize, vSignedAt, halfWidthMm } = args;
    if (!amputationFillerActive(amp) || !(lenSize > 1e-6)) return;
    const n = Math.min(topCount, (positions.length / 3) | 0);
    const riseOf: number[] = [];
    const origZ: number[] = [];
    for (let i = 0; i < n; i++) {
        const x = positions[i * 3] ?? 0;
        const y = positions[i * 3 + 1] ?? 0;
        const z = positions[i * 3 + 2] ?? 0;
        origZ[i] = z;
        const u = Math.max(0, Math.min(1, (x - minX) / lenSize));
        const rise = amputationDeltaMm(u, vSignedAt(y), side, lengthMm, widthMm, amp, halfWidthMm);
        riseOf[i] = rise;
        if (rise !== 0) positions[i * 3 + 2] = z + rise;
    }
}

/**
 * Split steep wall edges so a toe rim raised by the filler does not fail the
 * aspect gate. No-op unless the caller has an active filler. New edges are
 * half of an edge that was already the long side of its face, so the mesh
 * minimum edge does not get shorter.
 */
export function subdivideTallWalls(positions: number[], indices: number[]): number {
    const ASPECT = 8;
    const MIN_HALF_MM = 1.2;
    let splits = 0;
    for (let pass = 0; pass < 6; pass++) {
        const facesOf = new Map<string, number[]>();
        const triCount = (indices.length / 3) | 0;
        for (let f = 0; f < triCount; f++) {
            const a = indices[f * 3]!;
            const b = indices[f * 3 + 1]!;
            const c = indices[f * 3 + 2]!;
            for (const [i, j] of [
                [a, b],
                [b, c],
                [c, a],
            ] as const) {
                const k = i < j ? `${i},${j}` : `${j},${i}`;
                const list = facesOf.get(k);
                if (list) list.push(f);
                else facesOf.set(k, [f]);
            }
        }
        const used = new Set<number>();
        const jobs: Array<{ ia: number; ib: number; f0: number; f1: number }> = [];
        for (let f = 0; f < triCount; f++) {
            if (used.has(f)) continue;
            const a = indices[f * 3]!;
            const b = indices[f * 3 + 1]!;
            const c = indices[f * 3 + 2]!;
            if (positions[a * 3 + 2]! < 0.4 && positions[b * 3 + 2]! < 0.4 && positions[c * 3 + 2]! < 0.4) {
                continue;
            }
            const edges: Array<[number, number, number]> = [
                [a, b, dist3(positions, a, b)],
                [b, c, dist3(positions, b, c)],
                [c, a, dist3(positions, c, a)],
            ];
            edges.sort((p, q) => q[2] - p[2]);
            const longest = edges[0]!;
            const shortest = edges[2]![2];
            if (!(shortest > 1e-6) || longest[2] / shortest <= ASPECT) continue;
            if (longest[2] < 8 || longest[2] * 0.5 < MIN_HALF_MM) continue;
            const dz = Math.abs(positions[longest[0] * 3 + 2]! - positions[longest[1] * 3 + 2]!);
            // Only the near-vertical wall edges. Splitting a diagonal can fold a quad.
            if (dz < 0.85 * longest[2]) continue;
            const k = longest[0] < longest[1] ? `${longest[0]},${longest[1]}` : `${longest[1]},${longest[0]}`;
            const share = facesOf.get(k);
            if (!share || share.length !== 2) continue;
            const [f0, f1] = share;
            if (f0 == null || f1 == null || used.has(f0) || used.has(f1)) continue;
            used.add(f0);
            used.add(f1);
            jobs.push({ ia: longest[0], ib: longest[1], f0, f1 });
        }
        if (jobs.length === 0) break;
        for (const job of jobs) {
            splitSharedEdge(positions, indices, job.ia, job.ib, job.f0, job.f1);
            splits++;
        }
    }
    return splits;
}

function dist3(positions: number[], i: number, j: number): number {
    const dx = positions[i * 3]! - positions[j * 3]!;
    const dy = positions[i * 3 + 1]! - positions[j * 3 + 1]!;
    const dz = positions[i * 3 + 2]! - positions[j * 3 + 2]!;
    return Math.hypot(dx, dy, dz);
}

function splitSharedEdge(
    positions: number[],
    indices: number[],
    ia: number,
    ib: number,
    faceA: number,
    faceB: number,
): void {
    const m = positions.length / 3;
    positions.push(
        (positions[ia * 3]! + positions[ib * 3]!) * 0.5,
        (positions[ia * 3 + 1]! + positions[ib * 3 + 1]!) * 0.5,
        (positions[ia * 3 + 2]! + positions[ib * 3 + 2]!) * 0.5,
    );
    splitOneFace(indices, faceA, ia, ib, m);
    splitOneFace(indices, faceB, ia, ib, m);
}

/** Keep the original winding: e0 → m → opposite and m → e1 → opposite. */
function splitOneFace(indices: number[], face: number, ia: number, ib: number, m: number): void {
    const base = face * 3;
    const a = indices[base]!;
    const b = indices[base + 1]!;
    const c = indices[base + 2]!;
    let e0: number;
    let e1: number;
    let opp: number;
    if (a !== ia && a !== ib) {
        opp = a;
        e0 = b;
        e1 = c;
    } else if (b !== ia && b !== ib) {
        opp = b;
        e0 = c;
        e1 = a;
    } else {
        opp = c;
        e0 = a;
        e1 = b;
    }
    indices[base] = e0;
    indices[base + 1] = m;
    indices[base + 2] = opp;
    indices.push(m, e1, opp);
}
