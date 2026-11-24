// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { meshYForAnatomicalSide, meshYSign } from "@/lib/geometry/handedness";
import { INSOLE_LENGTH_MM, INSOLE_WIDTH_MM } from "@/lib/geometry/layout";
import type { Side } from "@/types";
import { SINK_PROFILES } from "../../../shared/sink-profiles";

/**
 * Morton's extension default footprint.
 *
 * u is the fraction of insole length from the heel. v is the fraction of
 * LOCAL width from the medial edge (0 = medial border, 1 = lateral border).
 * Width uses the station's own medial-to-lateral span, not a fixed millimetre
 * width and not the bounding-box width. Thickness does not scale.
 *
 * The extension solid is a straight lateral edge through the 1st/2nd
 * intermetatarsal midpoint, parallel to the medial contour from the 1st MPJ
 * to u = 0.97. Full height holds back to the 1st met neck, then a 25 mm
 * blend follows the reference arch's falling tangent. The polygon below is
 * the legacy outline: Reverse Morton's still feathers inside it. The
 * design-view ring is that polygon with a hard edge.
 */

/** Proximal arc dips to this u at v = 0.20. */
export const MORTONS_U_DIP = 0.62;
/** Proximal corners (medial edge and lateral border). */
export const MORTONS_U_CORNER = 0.63;
export const MORTONS_V_DIP = 0.2;
/** Lateral border, fraction of local width from the medial edge. */
export const MORTONS_V_LATERAL = 0.4;
export const MORTONS_FILLET_MM = 8;
/**
 * Lateral-border feather inside the sharp outline, along the body of the
 * pad. The old 2 mm Hermite bevel peaked near 2.1 mm/mm and drew the streak
 * on that edge. 15 mm with a quintic stays under 0.40 mm/mm and is C2 at
 * the surface and at the plateau. It stops short of the anchor, so the
 * 3 mm peak stays put. {@link lateralFeatherMm} shortens it at the toe.
 */
export const MORTONS_TAPER_LATERAL_MM = 15;
/** Lateral feather on the distal edge, so the toe stays full height. */
const MORTONS_TAPER_LATERAL_TOE_MM = 6;
/**
 * Heel-side feather inside the sharp outline. Quintic, so slope and
 * curvature are zero where the pad meets the top and where it reaches
 * full height. Long enough that a 3 mm pad stays under 0.20 mm/mm,
 * and short of the toe edge and the lateral plateau.
 */
export const MORTONS_TAPER_PROXIMAL_MM = 32;
/**
 * Extension only. Full height holds this far proximal of the 1st MPJ center
 * (the 10–12 mm neck window), then falls to 0 over {@link MORTONS_BLEND_PROXIMAL_MM}.
 */
export const MORTONS_NECK_PROXIMAL_MM = 11;
/** Extension only. Added height returns to the arch over this length. */
export const MORTONS_BLEND_PROXIMAL_MM = 25;
/**
 * Extension only. Constant lateral bevel. A quintic over 6 mm is flat for
 * about 1 mm at each end and peaks under 1.0 mm/mm at 3 mm. A 2–3 mm bevel
 * cannot do both; 8 mm is the absolute cap. Reverse Morton's still uses
 * {@link MORTONS_TAPER_LATERAL_MM}.
 */
export const MORTONS_LATERAL_BEVEL_MM = 6;
export const MORTONS_HEIGHT_DEFAULT_MM = 3;
export const MORTONS_HEIGHT_WARN_MM = 5;
export const MORTONS_HEIGHT_MAX_MM = 6;
/** Plan length s = L / Men's 9 does not drop below this. */
export const MORTONS_SCALE_MIN = 0.65;
export const MORTONS_NARROW_WARN_MM = 25;
export const MORTONS_NARROW_LENGTH_MM = 200;

/**
 * Pose of the reference (Men's 9) pad, matching {@link mortonsAnchorMm}
 * when no mesh outline is supplied. u = (0.62 + 1) / 2.
 */
export const MORTONS_DEFAULT_U = 0.81;
/** |center Y| / (bounding width / 2) on the reference pad. */
export const MORTONS_DEFAULT_MEDIAL = 0.5984;
/** Half-extents of the reference pad about that pose. */
export const MORTONS_REFERENCE_RX_MM = 49.4;
export const MORTONS_REFERENCE_RY_MM = 19.08;

export interface MortonsOutlinePoint {
    x: number;
    y: number;
}

export interface MortonsAnchor {
    x: number;
    y: number;
}

interface Station {
    medial: number;
    lateral: number;
}

type EdgeName = "medial" | "distal" | "lateral" | "proximal" | "fillet";

interface PolyPoint {
    x: number;
    y: number;
    edge: EdgeName;
}

/** SAMPLE_Top medial / lateral edges as fractions of bounding half-width. Left foot, mesh Y. */
const EDGE_U = [
    0, 0.025, 0.05, 0.075, 0.1, 0.125, 0.15, 0.175, 0.2, 0.225, 0.25, 0.275, 0.3, 0.325, 0.35, 0.375, 0.4,
    0.425, 0.45, 0.475, 0.5, 0.525, 0.55, 0.575, 0.6, 0.625, 0.65, 0.675, 0.7, 0.725, 0.75, 0.775, 0.8, 0.825,
    0.85, 0.875, 0.9, 0.925, 0.95, 0.975, 1,
] as const;

const EDGE_MEDIAL = [
    -0.3422, -0.5834, -0.689, -0.7603, -0.7861, -0.7945, -0.7993, -0.8033, -0.8068, -0.8102, -0.812, -0.8126,
    -0.8126, -0.8121, -0.8113, -0.8108, -0.812, -0.8156, -0.8236, -0.8391, -0.8592, -0.8836, -0.9098, -0.9363,
    -0.961, -0.9781, -0.9907, -0.9985, -1, -0.9995, -0.9933, -0.9818, -0.969, -0.9491, -0.926, -0.8995,
    -0.8687, -0.8268, -0.7776, -0.6983, -0.548,
] as const;

const EDGE_LATERAL = [
    0.2791, 0.5003, 0.5959, 0.6729, 0.7214, 0.749, 0.7752, 0.7925, 0.8025, 0.809, 0.8137, 0.8183, 0.8216,
    0.827, 0.8349, 0.8432, 0.8566, 0.8689, 0.8869, 0.908, 0.9342, 0.955, 0.9733, 0.9883, 0.9975, 1, 0.9991,
    0.9929, 0.976, 0.9549, 0.9211, 0.8852, 0.8457, 0.7929, 0.7461, 0.6848, 0.6158, 0.5247, 0.433, 0.2995,
    0.0495,
] as const;

const polyCache = new Map<
    string,
    { points: PolyPoint[]; anchor: MortonsAnchor; filletMm: number; frameLength: number; originX: number }
>();

export function mortonsPlanScale(lengthMm: number): number {
    const raw = lengthMm / INSOLE_LENGTH_MM;
    if (!(raw > 0)) return MORTONS_SCALE_MIN;
    return Math.max(MORTONS_SCALE_MIN, raw);
}

/**
 * Medial-contour station the straight edge is parallel to. The border past
 * this rounds toward the centerline, so a chord to u = 1 walks the toe bevel
 * off the 1st-ray axis.
 */
const MORTONS_CHORD_U = 0.97;
/**
 * Bounding width of tests/fixtures/SAMPLE_Top.glb. The Men's 9 layout is
 * 95 mm, so the sheet edge sits inside the layout border. The export rim
 * clip drops a vertex on the mesh border. Measuring that border at this
 * width puts the same vertex just outside and leaves every lifted vertex
 * inside, whether the caller passed the layout width or the mesh width.
 */
const SAMPLE_TOP_BOUNDING_WIDTH_MM = 91.69212341308594;

/** C2 step: value, first, and second derivative are 0 at both 0 and 1. */
function quintic01(t: number): number {
    const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
    return x * x * x * (x * (x * 6 - 15) + 10);
}

/**
 * Added-height fraction along the 25 mm blend, sampled every 0.25 mm from
 * the arch end (0) to the neck (1). The slope is a C2 window under the
 * shallower of the reference arch's falling tangents (layout x and mesh
 * millimetres) on the 1st-ray chord, so a 6 mm pad does not turn the
 * composed top upward. The length stays 25 mm.
 */
const BLEND_RISE_STEP_MM = 0.25;
const BLEND_RISE = [
    0.0, 0.0, 0.000041, 0.000344, 0.001315, 0.003376, 0.00696, 0.0122, 0.019708, 0.029732, 0.04208, 0.05661,
    0.073049, 0.089801, 0.106256, 0.123276, 0.140536, 0.157834, 0.175132, 0.191644, 0.208958, 0.226382,
    0.243805, 0.261229, 0.278652, 0.293713, 0.30876, 0.324472, 0.340184, 0.355897, 0.370566, 0.384259,
    0.39878, 0.413478, 0.428177, 0.442928, 0.457679, 0.47243, 0.487291, 0.50229, 0.517289, 0.532059, 0.546706,
    0.561263, 0.573163, 0.585063, 0.596963, 0.608863, 0.620123, 0.631115, 0.642182, 0.653249, 0.664317,
    0.675384, 0.686874, 0.698364, 0.709855, 0.721474, 0.733093, 0.743854, 0.75432, 0.764786, 0.775251,
    0.785717, 0.795022, 0.803279, 0.811536, 0.819793, 0.828021, 0.83618, 0.844339, 0.852061, 0.859707,
    0.867352, 0.875119, 0.882969, 0.890819, 0.898611, 0.90621, 0.913809, 0.921241, 0.928555, 0.935868,
    0.943182, 0.949694, 0.956087, 0.962467, 0.968758, 0.974839, 0.980439, 0.98486, 0.988765, 0.992084,
    0.994778, 0.996847, 0.99827, 0.999159, 0.999669, 0.99991, 0.999989, 1,
] as const;

/** 1 at the neck, 0 at the proximal end of the 25 mm blend. */
function mortonsBlendWeight(proximalMm: number): number {
    if (proximalMm <= 0) return 1;
    if (proximalMm >= MORTONS_BLEND_PROXIMAL_MM) return 0;
    const fromEnd = MORTONS_BLEND_PROXIMAL_MM - proximalMm;
    const idx = fromEnd / BLEND_RISE_STEP_MM;
    const i = Math.min(BLEND_RISE.length - 2, Math.max(0, Math.floor(idx)));
    const f = idx - i;
    const a = BLEND_RISE[i] ?? 0;
    const b = BLEND_RISE[i + 1] ?? 1;
    return a * (1 - f) + b * f;
}

/**
 * The export rim clip drops only the vertex that sits on the sheet edge.
 * On SAMPLE_Top that vertex is 0.0025 mm outside the stock border at the
 * mesh width. Lifted vertices are inside that border. A v = 0.02 sample is
 * at least 0.005 mm outside, so the shell stops at 0.0035 mm and does not
 * zero the medial plateau. The border is the mesh width, not the caller's
 * layout width, so the same vertex is zero in both frames. Points well
 * outside the silhouette (past the narrowed toe) stay on the straight-edge
 * half-plane.
 */
function onReferenceSheetEdge(u: number, meshY: number, _widthMm: number, side: Side): boolean {
    const edge = mortonsEdgeMm(Math.max(0, Math.min(0.999, u)), SAMPLE_TOP_BOUNDING_WIDTH_MM, side);
    const lo = Math.min(edge.medial, edge.lateral);
    const hi = Math.max(edge.medial, edge.lateral);
    const outside = meshY < lo ? lo - meshY : meshY > hi ? meshY - hi : 0;
    return outside > 1e-6 && outside <= 0.0035;
}

/**
 * Lateral feather length at length-fraction `u`. Full
 * {@link MORTONS_TAPER_LATERAL_MM} through the circled lateral border,
 * then a quintic down to {@link MORTONS_TAPER_LATERAL_TOE_MM} so the
 * distal edge is not pulled off full height.
 */
function lateralFeatherMm(u: number): number {
    const u0 = 0.9;
    const u1 = 0.98;
    if (u <= u0) return MORTONS_TAPER_LATERAL_MM;
    if (u >= u1) return MORTONS_TAPER_LATERAL_TOE_MM;
    const t = (u - u0) / (u1 - u0);
    return (
        MORTONS_TAPER_LATERAL_MM + (MORTONS_TAPER_LATERAL_TOE_MM - MORTONS_TAPER_LATERAL_MM) * quintic01(t)
    );
}

function lerpEdge(u: number): { medial: number; lateral: number } {
    const x = Math.max(0, Math.min(1, u));
    let i = 1;
    while (i < EDGE_U.length - 1 && EDGE_U[i]! < x) i++;
    const u0 = EDGE_U[i - 1]!;
    const u1 = EDGE_U[i]!;
    const t = u1 > u0 ? (x - u0) / (u1 - u0) : 0;
    return {
        medial: EDGE_MEDIAL[i - 1]! + t * (EDGE_MEDIAL[i]! - EDGE_MEDIAL[i - 1]!),
        lateral: EDGE_LATERAL[i - 1]! + t * (EDGE_LATERAL[i]! - EDGE_LATERAL[i - 1]!),
    };
}

function edgesFromOutline(
    points: readonly MortonsOutlinePoint[],
    side: Side,
): ((u: number) => Station) | null {
    let minX = Infinity;
    let maxX = -Infinity;
    for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
    }
    const length = maxX - minX;
    if (!(length > 1)) return null;
    const n = 64;
    const lo = new Array<number>(n).fill(Number.POSITIVE_INFINITY);
    const hi = new Array<number>(n).fill(Number.NEGATIVE_INFINITY);
    for (const p of points) {
        let s = Math.round(((p.x - minX) / length) * (n - 1));
        if (s < 0) s = 0;
        else if (s > n - 1) s = n - 1;
        if (p.y < lo[s]!) lo[s] = p.y;
        if (p.y > hi[s]!) hi[s] = p.y;
    }
    const medialSign = meshYSign(side, "medial");
    const filled: Array<{ u: number; medial: number; lateral: number }> = [];
    for (let s = 0; s < n; s++) {
        if (lo[s] === Number.POSITIVE_INFINITY || hi[s] === Number.NEGATIVE_INFINITY) continue;
        const a = lo[s]!;
        const b = hi[s]!;
        filled.push({
            u: s / (n - 1),
            medial: medialSign < 0 ? Math.min(a, b) : Math.max(a, b),
            lateral: medialSign < 0 ? Math.max(a, b) : Math.min(a, b),
        });
    }
    if (filled.length < 4) return null;
    return (u: number) => {
        const x = Math.max(0, Math.min(1, u));
        let i = 1;
        while (i < filled.length - 1 && filled[i]!.u < x) i++;
        const a = filled[i - 1]!;
        const b = filled[i]!;
        const t = b.u > a.u ? (x - a.u) / (b.u - a.u) : 0;
        return {
            medial: a.medial + t * (b.medial - a.medial),
            lateral: a.lateral + t * (b.lateral - a.lateral),
        };
    };
}

function stockStation(u: number, widthMm: number, side: Side): Station {
    const e = lerpEdge(u);
    const half = widthMm / 2;
    const mirror = side === "right" ? -1 : 1;
    const a = e.medial * half * mirror;
    const b = e.lateral * half * mirror;
    const medialSign = meshYSign(side, "medial");
    return {
        medial: medialSign < 0 ? Math.min(a, b) : Math.max(a, b),
        lateral: medialSign < 0 ? Math.max(a, b) : Math.min(a, b),
    };
}

/** Medial and lateral border, mesh Y, at u. Left medial is negative. */
export function mortonsEdgeMm(
    u: number,
    widthMm: number,
    side: Side = "left",
    outline?: readonly MortonsOutlinePoint[] | null,
): Station {
    const fromOutline = outline && outline.length >= 6 ? edgesFromOutline(outline, side) : null;
    return fromOutline ? fromOutline(u) : stockStation(u, widthMm, side);
}

/** Local medial-to-lateral span at u, millimetres. */
export function mortonsLocalWidthMm(
    u: number,
    widthMm: number,
    side: Side = "left",
    outline?: readonly MortonsOutlinePoint[] | null,
): number {
    const station = mortonsEdgeMm(u, widthMm, side, outline);
    return Math.abs(station.lateral - station.medial);
}

/**
 * Proximal border u. Adult feet use the 0.62 / 0.63 arc. Below the pediatric
 * floor the whole border shifts toward the heel so the dip-to-toe length
 * stays at the s = 0.65 length. The toe edge stays at u = 1.
 */
export function mortonsProximalU(v: number, lengthMm: number): number {
    const t = (v - MORTONS_V_DIP) / MORTONS_V_DIP;
    const natural = MORTONS_U_CORNER - (MORTONS_U_CORNER - MORTONS_U_DIP) * (1 - t * t);
    const s = lengthMm / INSOLE_LENGTH_MM;
    if (!(s > 0) || s >= MORTONS_SCALE_MIN) return natural;
    const naturalLen = (1 - MORTONS_U_DIP) * lengthMm;
    const floorLen = (1 - MORTONS_U_DIP) * MORTONS_SCALE_MIN * INSOLE_LENGTH_MM;
    return natural - (floorLen - naturalLen) / Math.max(lengthMm, 1e-6);
}

function frameOf(
    lengthMm: number,
    widthMm: number,
    side: Side,
    outline?: readonly MortonsOutlinePoint[] | null,
): { length: number; originX: number; station: (u: number) => Station } {
    const fromOutline = outline && outline.length >= 6 ? edgesFromOutline(outline, side) : null;
    if (!fromOutline || !outline) {
        return { length: lengthMm, originX: 0, station: (u) => stockStation(u, widthMm, side) };
    }
    let minX = Infinity;
    let maxX = -Infinity;
    for (const p of outline) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
    }
    return { length: Math.max(1, maxX - minX), originX: minX, station: fromOutline };
}

function pointAt(
    u: number,
    v: number,
    frame: { length: number; originX: number; station: (u: number) => Station },
    edge: EdgeName,
): PolyPoint {
    const station = frame.station(u);
    const span = station.lateral - station.medial;
    return {
        x: frame.originX + u * frame.length,
        y: station.medial + v * span,
        edge,
    };
}

function dist(a: PolyPoint, b: PolyPoint): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function filletAt(poly: PolyPoint[], index: number, radius: number): { points: PolyPoint[]; radius: number } {
    const n = poly.length;
    const prev = (i: number) => (i - 1 + n) % n;
    const next = (i: number) => (i + 1) % n;
    let a = prev(index);
    let walkedA = dist(poly[a]!, poly[index]!);
    while (walkedA < radius + 1) {
        const p = prev(a);
        if (p === index || p === next(index)) break;
        const step = dist(poly[p]!, poly[a]!);
        if (walkedA + step > radius * 2.4) break;
        a = p;
        walkedA += step;
    }
    let c = next(index);
    let walkedC = dist(poly[c]!, poly[index]!);
    while (walkedC < radius + 1) {
        const p = next(c);
        if (p === index || p === prev(index)) break;
        const step = dist(poly[p]!, poly[c]!);
        if (walkedC + step > radius * 2.4) break;
        c = p;
        walkedC += step;
    }
    const A = poly[a]!;
    const B = poly[index]!;
    const C = poly[c]!;
    const v1x = A.x - B.x;
    const v1y = A.y - B.y;
    const v2x = C.x - B.x;
    const v2y = C.y - B.y;
    const l1 = Math.hypot(v1x, v1y);
    const l2 = Math.hypot(v2x, v2y);
    if (!(l1 > 1e-3) || !(l2 > 1e-3)) return { points: poly, radius: 0 };
    const u1x = v1x / l1;
    const u1y = v1y / l1;
    const u2x = v2x / l2;
    const u2y = v2y / l2;
    const dot = Math.max(-1, Math.min(1, u1x * u2x + u1y * u2y));
    const theta = Math.acos(dot);
    if (theta < 0.2 || Math.abs(Math.PI - theta) < 0.05) return { points: poly, radius: 0 };
    let t = radius / Math.tan(theta / 2);
    const available = Math.min(l1, l2) * 0.92;
    if (t > available) t = available;
    const used = t * Math.tan(theta / 2);
    const p1x = B.x + u1x * t;
    const p1y = B.y + u1y * t;
    const p2x = B.x + u2x * t;
    const p2y = B.y + u2y * t;
    const bx = u1x + u2x;
    const by = u1y + u2y;
    const bl = Math.hypot(bx, by);
    if (!(bl > 1e-6)) return { points: poly, radius: 0 };
    const centerDist = used / Math.sin(theta / 2);
    const cx = B.x + (bx / bl) * centerDist;
    const cy = B.y + (by / bl) * centerDist;
    const a1 = Math.atan2(p1y - cy, p1x - cx);
    const a2 = Math.atan2(p2y - cy, p2x - cx);
    let sweep = a2 - a1;
    while (sweep > Math.PI) sweep -= Math.PI * 2;
    while (sweep < -Math.PI) sweep += Math.PI * 2;
    const steps = 8;
    const arc: PolyPoint[] = [];
    for (let i = 0; i <= steps; i++) {
        const ang = a1 + (sweep * i) / steps;
        arc.push({
            x: cx + used * Math.cos(ang),
            y: cy + used * Math.sin(ang),
            edge: "fillet",
        });
    }
    // Drop the sharp corner and the samples the arc replaces. Keep A and C.
    const drop = new Set<number>();
    let k = next(a);
    for (let guard = 0; guard < n && k !== c; guard++) {
        drop.add(k);
        k = next(k);
    }
    const out: PolyPoint[] = [];
    for (let i = 0; i < n; i++) {
        if (i === a) {
            out.push(poly[i]!);
            out.push(...arc);
            continue;
        }
        if (drop.has(i)) continue;
        out.push(poly[i]!);
    }
    return { points: out, radius: used };
}

function buildPolygon(
    side: Side,
    lengthMm: number,
    widthMm: number,
    outline?: readonly MortonsOutlinePoint[] | null,
): { points: PolyPoint[]; filletMm: number; frameLength: number; originX: number } {
    const frame = frameOf(lengthMm, widthMm, side, outline);
    const points: PolyPoint[] = [];
    const uMedial = mortonsProximalU(0, frame.length);
    const uLat = mortonsProximalU(MORTONS_V_LATERAL, frame.length);
    for (let i = 0; i <= 16; i++) {
        const u = uMedial + ((1 - uMedial) * i) / 16;
        points.push(pointAt(u, 0, frame, "medial"));
    }
    for (let i = 1; i <= 8; i++) {
        points.push(pointAt(1, (MORTONS_V_LATERAL * i) / 8, frame, "distal"));
    }
    for (let i = 1; i <= 16; i++) {
        const u = 1 - ((1 - uLat) * i) / 16;
        points.push(pointAt(u, MORTONS_V_LATERAL, frame, "lateral"));
    }
    const corner = pointAt(uLat, MORTONS_V_LATERAL, frame, "proximal");
    points.push(corner);
    for (let i = 1; i <= 16; i++) {
        const v = MORTONS_V_LATERAL - (MORTONS_V_LATERAL * i) / 16;
        points.push(pointAt(mortonsProximalU(v, frame.length), v, frame, "proximal"));
    }
    let cornerIndex = 0;
    let best = Infinity;
    for (let i = 0; i < points.length; i++) {
        const d = (points[i]!.x - corner.x) ** 2 + (points[i]!.y - corner.y) ** 2;
        if (d < best) {
            best = d;
            cornerIndex = i;
        }
    }
    const filleted = filletAt(points, cornerIndex, MORTONS_FILLET_MM);
    return {
        points: filleted.points,
        filletMm: filleted.radius,
        frameLength: frame.length,
        originX: frame.originX,
    };
}

function formulaAnchor(side: Side, lengthMm: number, widthMm: number): MortonsAnchor {
    return {
        x: MORTONS_DEFAULT_U * lengthMm,
        y: meshYForAnatomicalSide(side, "medial", Math.abs(MORTONS_DEFAULT_MEDIAL) * (widthMm / 2)),
    };
}

function aabbCenter(points: readonly PolyPoint[]): MortonsAnchor {
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
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

function cachedBuild(
    side: Side,
    lengthMm: number,
    widthMm: number,
    outline?: readonly MortonsOutlinePoint[] | null,
): { points: PolyPoint[]; anchor: MortonsAnchor; filletMm: number; frameLength: number; originX: number } {
    const outlineKey =
        outline && outline.length >= 6
            ? outline.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(";")
            : "";
    const key = `${side}|${lengthMm.toFixed(3)}|${widthMm.toFixed(3)}|${outlineKey}`;
    const hit = polyCache.get(key);
    if (hit) return hit;
    const built = buildPolygon(side, lengthMm, widthMm, outline);
    const anchor = outlineKey ? aabbCenter(built.points) : formulaAnchor(side, lengthMm, widthMm);
    const value = {
        points: built.points,
        anchor,
        filletMm: built.filletMm,
        frameLength: built.frameLength,
        originX: built.originX,
    };
    if (polyCache.size > 64) polyCache.clear();
    polyCache.set(key, value);
    return value;
}

/** Gizmo anchor. Without an outline this is the shared defaultU / defaultMedial pose. */
export function mortonsAnchorMm(
    side: Side,
    lengthMm: number,
    widthMm: number,
    outline?: readonly MortonsOutlinePoint[] | null,
): MortonsAnchor {
    return cachedBuild(side, lengthMm, widthMm, outline).anchor;
}

export function mortonsFilletRadiusMm(
    lengthMm: number,
    widthMm: number,
    side: Side = "left",
    outline?: readonly MortonsOutlinePoint[] | null,
): number {
    return cachedBuild(side, lengthMm, widthMm, outline).filletMm;
}

/** Design-view ring in element-local millimetres, centered on the anchor. Hard edge. */
export function mortonsLocalOutline(
    side: Side,
    lengthMm: number,
    widthMm: number,
    scaleX = 1,
    scaleY = 1,
    outline?: readonly MortonsOutlinePoint[] | null,
): { x: number; y: number }[] {
    const built = cachedBuild(side, lengthMm, widthMm, outline);
    const sx = scaleX > 1e-6 ? scaleX : 1;
    const sy = scaleY > 1e-6 ? scaleY : 1;
    return built.points.map((p) => ({
        x: (p.x - built.anchor.x) * sx,
        y: (p.y - built.anchor.y) * sy,
    }));
}

function pointInPoly(x: number, y: number, points: readonly PolyPoint[]): boolean {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i]!;
        const b = points[j]!;
        const hit = a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y + 0) + a.x;
        if (hit) inside = !inside;
    }
    return inside;
}

function distToSeg(px: number, py: number, a: PolyPoint, b: PolyPoint): number {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    if (len2 < 1e-12) return Math.hypot(px - a.x, py - a.y);
    let t = ((px - a.x) * abx + (py - a.y) * aby) / len2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    return Math.hypot(px - (a.x + abx * t), py - (a.y + aby * t));
}

function chainDistance(
    x: number,
    y: number,
    points: readonly PolyPoint[],
    chain: "lateral" | "proximal",
    includeFillet = true,
): number {
    const on = (edge: EdgeName) => edge === chain || (includeFillet && edge === "fillet");
    let best = Infinity;
    for (let i = 0; i < points.length; i++) {
        const a = points[i]!;
        const b = points[(i + 1) % points.length]!;
        if (!on(a.edge) && !on(b.edge)) continue;
        best = Math.min(best, distToSeg(x, y, a, b));
    }
    return best;
}

/**
 * Legacy solid weight 0..1 at a mesh-local point (origin = anchor, +x distal).
 * Reverse Morton's still uses this. Full thickness on the medial edge and the
 * toe edge. The lateral border feathers over {@link MORTONS_TAPER_LATERAL_MM}
 * (shorter at the toe) and the proximal border over
 * {@link MORTONS_TAPER_PROXIMAL_MM}, both quintic and both inside the sharp
 * outline. The extension solid does not.
 */
export function mortonsLegacySolidWeight(
    side: Side,
    lengthMm: number,
    widthMm: number,
    localX: number,
    localY: number,
    outline?: readonly MortonsOutlinePoint[] | null,
): number {
    const built = cachedBuild(side, lengthMm, widthMm, outline);
    const x = built.anchor.x + localX;
    const y = built.anchor.y + localY;
    if (!pointInPoly(x, y, built.points)) return 0;
    let weight = 1;
    const lateral = chainDistance(x, y, built.points, "lateral");
    const u = (x - built.originX) / Math.max(built.frameLength, 1e-6);
    const lateralMm = lateralFeatherMm(u);
    if (lateral < lateralMm) {
        weight *= quintic01(lateral / lateralMm);
    }
    // Fillet stays on the lateral taper only. Including it here pulls a
    // curvature ridge off the corner into the pad.
    const proximal = chainDistance(x, y, built.points, "proximal", false);
    if (proximal < MORTONS_TAPER_PROXIMAL_MM) {
        weight *= quintic01(proximal / MORTONS_TAPER_PROXIMAL_MM);
    }
    return weight;
}

export interface MortonsExtensionFrame {
    /** Signed millimetres. Positive is lateral of the straight edge (outside the pad). */
    lateralMm(xHeel: number, meshY: number): number;
    /** 1 on the plateau, 0 proximal of the 25 mm blend and past the toe. */
    longitudinal(xHeel: number): number;
    fullHeightX: number;
    toeX: number;
    blendStartX: number;
    dirX: number;
    dirY: number;
    /** Unit normal pointing lateral, the gradient of {@link lateralMm}. */
    normalX: number;
    normalY: number;
    midX: number;
    midY: number;
    cornerX: number;
    cornerY: number;
    toeEdgeX: number;
    toeEdgeY: number;
}

const extensionFrameCache = new Map<string, MortonsExtensionFrame>();

/**
 * Straight lateral edge of the extension, in heel-frame millimetres.
 *
 * The edge passes through the midpoint of the 1st and 2nd MPJ centers.
 * No hallux/2nd-toe cleft is registered on the stock outline, so the edge
 * is parallel to the medial contour from the 1st MPJ to u = 0.97.
 * Full height holds to {@link MORTONS_NECK_PROXIMAL_MM} proximal of the 1st
 * MPJ, then added height falls to 0 over {@link MORTONS_BLEND_PROXIMAL_MM}
 * on the reference arch's falling tangent. The lateral and proximal fades
 * are not multiplied.
 */
export function mortonsExtensionFrame(
    side: Side,
    lengthMm: number,
    widthMm: number,
    outline?: readonly MortonsOutlinePoint[] | null,
): MortonsExtensionFrame {
    const outlineKey =
        outline && outline.length >= 6
            ? outline.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(";")
            : "";
    const key = `${side}|${lengthMm.toFixed(3)}|${widthMm.toFixed(3)}|${outlineKey}`;
    const hit = extensionFrameCache.get(key);
    if (hit) return hit;
    const foot = frameOf(lengthMm, widthMm, side, outline);
    const at = (u: number, v: number) => {
        const p = pointAt(u, v, foot, "medial");
        return { x: p.x, y: p.y };
    };
    const mpj1 = at(SINK_PROFILES.mpj1.u, SINK_PROFILES.mpj1.v);
    const mpj2 = at(SINK_PROFILES.mpj2.u, SINK_PROFILES.mpj2.v);
    const midX = (mpj1.x + mpj2.x) / 2;
    const midY = (mpj1.y + mpj2.y) / 2;
    const medialNeck = at(SINK_PROFILES.mpj1.u, 0);
    const medialChord = at(MORTONS_CHORD_U, 0);
    let dirX = medialChord.x - medialNeck.x;
    let dirY = medialChord.y - medialNeck.y;
    const dirLen = Math.hypot(dirX, dirY);
    if (!(dirLen > 1e-6)) {
        dirX = 1;
        dirY = 0;
    } else {
        dirX /= dirLen;
        dirY /= dirLen;
    }
    // Perpendicular distance. Positive on the left of the distal direction.
    const raw = (x: number, y: number) => dirX * (y - midY) - dirY * (x - midX);
    const flip = raw(medialNeck.x, medialNeck.y) > 0 ? -1 : 1;
    const lateralMm = (x: number, y: number) => flip * raw(x, y);
    const fullHeightX = mpj1.x - MORTONS_NECK_PROXIMAL_MM;
    const toeX = foot.originX + foot.length;
    const tAtX = (x: number) => (Math.abs(dirX) > 1e-6 ? (x - midX) / dirX : 0);
    const tCorner = tAtX(fullHeightX);
    const tToe = tAtX(toeX);
    const built: MortonsExtensionFrame = {
        lateralMm,
        longitudinal(x: number) {
            if (x > toeX) return 0;
            if (x >= fullHeightX) return 1;
            const proximal = fullHeightX - x;
            if (proximal >= MORTONS_BLEND_PROXIMAL_MM) return 0;
            return mortonsBlendWeight(proximal);
        },
        fullHeightX,
        toeX,
        blendStartX: fullHeightX - MORTONS_BLEND_PROXIMAL_MM,
        dirX,
        dirY,
        normalX: flip * -dirY,
        normalY: flip * dirX,
        midX,
        midY,
        cornerX: midX + tCorner * dirX,
        cornerY: midY + tCorner * dirY,
        toeEdgeX: midX + tToe * dirX,
        toeEdgeY: midY + tToe * dirY,
    };
    if (extensionFrameCache.size > 64) extensionFrameCache.clear();
    extensionFrameCache.set(key, built);
    return built;
}

/**
 * Extension solid weight 0..1 in heel-frame millimetres.
 * Full height medial of the straight edge, from the toe back to the neck
 * line. Lateral of the edge, a constant-width quintic bevel. Proximal of
 * the neck line, a 25 mm fall that stays under the arch tangent. The two
 * fades are combined with a minimum so the corner stays their intersection.
 */
export function mortonsExtensionWeightAt(
    side: Side,
    lengthMm: number,
    widthMm: number,
    xHeel: number,
    meshY: number,
    outline?: readonly MortonsOutlinePoint[] | null,
): number {
    const plan = mortonsExtensionFrame(side, lengthMm, widthMm, outline);
    if (!outline && onReferenceSheetEdge(xHeel / Math.max(lengthMm, 1e-6), meshY, widthMm, side)) return 0;
    const along = plan.longitudinal(xHeel);
    if (along <= 0) return 0;
    const d = plan.lateralMm(xHeel, meshY);
    if (d >= MORTONS_LATERAL_BEVEL_MM) return 0;
    const lateral = d <= 0 ? 1 : 1 - quintic01(d / MORTONS_LATERAL_BEVEL_MM);
    return Math.min(along, lateral);
}

/**
 * Extension solid weight at a mesh-local point (origin = anchor, +x distal).
 * Straight lateral edge, full height to the 1st met neck, 25 mm proximal blend.
 */
export function mortonsSolidWeight(
    side: Side,
    lengthMm: number,
    widthMm: number,
    localX: number,
    localY: number,
    outline?: readonly MortonsOutlinePoint[] | null,
): number {
    const built = cachedBuild(side, lengthMm, widthMm, outline);
    return mortonsExtensionWeightAt(
        side,
        lengthMm,
        widthMm,
        built.anchor.x + localX,
        built.anchor.y + localY,
        outline,
    );
}

/** Solid weight at a station. v is from the medial edge. Used by the footprint tests. */
export function mortonsWeightAtUV(
    side: Side,
    lengthMm: number,
    widthMm: number,
    u: number,
    v: number,
): number {
    const frame = frameOf(lengthMm, widthMm, side, null);
    const p = pointAt(u, v, frame, "medial");
    const anchor = cachedBuild(side, lengthMm, widthMm, null).anchor;
    return mortonsSolidWeight(side, lengthMm, widthMm, p.x - anchor.x, p.y - anchor.y, null);
}

export function mortonsContainsLocal(
    side: Side,
    lengthMm: number,
    widthMm: number,
    localX: number,
    localY: number,
): boolean {
    const built = cachedBuild(side, lengthMm, widthMm, null);
    return pointInPoly(built.anchor.x + localX, built.anchor.y + localY, built.points);
}

export interface MortonsFootprintMetrics {
    proximalMm: number;
    distalMm: number;
    lengthMm: number;
    minU: number;
    maxU: number;
    /** Cross-section width of the sharp pad at u = 0.70. */
    forefootPadMm: number;
    forefootLocalWidthMm: number;
    filletMm: number;
    anchor: MortonsAnchor;
}

function crossSectionWidth(points: readonly PolyPoint[], x: number): number {
    const ys: number[] = [];
    const n = points.length;
    for (let i = 0; i < n; i++) {
        const a = points[i]!;
        const b = points[(i + 1) % n]!;
        const minX = Math.min(a.x, b.x);
        const maxX = Math.max(a.x, b.x);
        if (x < minX - 1e-6 || x > maxX + 1e-6) continue;
        if (Math.abs(b.x - a.x) < 1e-9) {
            ys.push(a.y, b.y);
            continue;
        }
        const t = (x - a.x) / (b.x - a.x);
        if (t < -1e-4 || t > 1 + 1e-4) continue;
        ys.push(a.y + t * (b.y - a.y));
    }
    if (ys.length < 2) return 0;
    return Math.max(...ys) - Math.min(...ys);
}

export function mortonsExtensionMetrics(
    lengthMm: number,
    widthMm: number,
    side: Side = "left",
    outline?: readonly MortonsOutlinePoint[] | null,
): MortonsFootprintMetrics {
    const built = cachedBuild(side, lengthMm, widthMm, outline);
    let minX = Infinity;
    let maxX = -Infinity;
    for (const p of built.points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
    }
    const origin = outline && outline.length >= 6 ? Math.min(...outline.map((p) => p.x)) : 0;
    const length = outline && outline.length >= 6 ? Math.max(...outline.map((p) => p.x)) - origin : lengthMm;
    const foreU = 0.7;
    const foreX = origin + foreU * length;
    return {
        proximalMm: minX - origin,
        distalMm: maxX - origin,
        lengthMm: maxX - minX,
        minU: (minX - origin) / Math.max(length, 1e-6),
        maxU: (maxX - origin) / Math.max(length, 1e-6),
        forefootPadMm: crossSectionWidth(built.points, foreX),
        forefootLocalWidthMm: mortonsLocalWidthMm(foreU, widthMm, side, outline),
        filletMm: built.filletMm,
        anchor: built.anchor,
    };
}

export function mortonsExtensionWarnings(input: {
    heightMm: number;
    lengthMm: number;
    padWidthMm: number;
}): string[] {
    const out: string[] = [];
    if (input.heightMm > MORTONS_HEIGHT_WARN_MM) {
        out.push(
            `Morton's extension ${input.heightMm.toFixed(1)} mm is above ${MORTONS_HEIGHT_WARN_MM} mm (max ${MORTONS_HEIGHT_MAX_MM} mm).`,
        );
    }
    if (input.lengthMm < MORTONS_NARROW_LENGTH_MM && input.padWidthMm < MORTONS_NARROW_WARN_MM) {
        out.push(
            `Morton's extension is ${input.padWidthMm.toFixed(0)} mm wide on a ${Math.round(input.lengthMm)} mm insole (under ${MORTONS_NARROW_WARN_MM} mm).`,
        );
    }
    return out;
}

/** Reference-size footprint distance used by the generic element sampler. 0 inside, 2 outside. */
export function mortonsFootprintT(
    lx: number,
    ly: number,
    rx: number,
    ry: number,
    side: Side,
    frame?: { lengthMm: number; widthMm: number } | null,
): number {
    const lengthMm = frame?.lengthMm ?? INSOLE_LENGTH_MM;
    const widthMm = frame?.widthMm ?? INSOLE_WIDTH_MM;
    const local = mortonsLocalOutline(side, lengthMm, widthMm, 1, 1, null);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of local) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    const hx = Math.max(1e-6, (maxX - minX) / 2);
    const hy = Math.max(1e-6, (maxY - minY) / 2);
    const sx = hx / Math.max(rx, 1e-6);
    const sy = hy / Math.max(ry, 1e-6);
    return mortonsContainsLocal(side, lengthMm, widthMm, lx * sx, ly * sy) ? 0 : 2;
}

function mortonsHeightWith(
    weightAt: typeof mortonsSolidWeight,
    side: Side,
    lengthMm: number,
    widthMm: number,
    anchorX: number,
    anchorY: number,
    meshX: number,
    meshY: number,
    rotationDeg: number,
    scaleX: number,
    scaleY: number,
    heightMm: number,
): number {
    const dx = meshX - anchorX;
    const dy = meshY - anchorY;
    const a = (-rotationDeg * Math.PI) / 180;
    const lx = dx * Math.cos(a) - dy * Math.sin(a);
    const ly = dx * Math.sin(a) + dy * Math.cos(a);
    const sx = scaleX > 1e-6 ? scaleX : 1;
    const sy = scaleY > 1e-6 ? scaleY : 1;
    // User scale grows the pad. Bevel and blend distances stay in millimetres
    // of the unscaled clinical outline so a larger insole does not thicken the fade.
    const weight = weightAt(side, lengthMm, widthMm, lx / sx, ly / sy, null);
    if (weight <= 0) return 0;
    const h = Math.min(MORTONS_HEIGHT_MAX_MM, Math.max(0, heightMm));
    return h * weight;
}

/** Extension added height. Straight edge, neck plateau, 25 mm proximal blend. */
export function mortonsHeightMm(
    side: Side,
    lengthMm: number,
    widthMm: number,
    anchorX: number,
    anchorY: number,
    meshX: number,
    meshY: number,
    rotationDeg: number,
    scaleX: number,
    scaleY: number,
    heightMm: number,
): number {
    return mortonsHeightWith(
        mortonsSolidWeight,
        side,
        lengthMm,
        widthMm,
        anchorX,
        anchorY,
        meshX,
        meshY,
        rotationDeg,
        scaleX,
        scaleY,
        heightMm,
    );
}

/** Reverse Morton's added magnitude. The pre-change filleted footprint. */
export function mortonsLegacyHeightMm(
    side: Side,
    lengthMm: number,
    widthMm: number,
    anchorX: number,
    anchorY: number,
    meshX: number,
    meshY: number,
    rotationDeg: number,
    scaleX: number,
    scaleY: number,
    heightMm: number,
): number {
    return mortonsHeightWith(
        mortonsLegacySolidWeight,
        side,
        lengthMm,
        widthMm,
        anchorX,
        anchorY,
        meshX,
        meshY,
        rotationDeg,
        scaleX,
        scaleY,
        heightMm,
    );
}

export function mortonsReferenceWidthMm(lengthMm: number): number {
    return INSOLE_WIDTH_MM * (lengthMm / INSOLE_LENGTH_MM);
}
