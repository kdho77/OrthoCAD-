// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { BufferAttribute, BufferGeometry } from "three";
import { medialSign } from "@/lib/geometry/handedness";
import { INSOLE_LENGTH_MM, INSOLE_WIDTH_MM } from "@/lib/geometry/layout";
import { effectiveOutlineHalfWidth, type TrimlineCurve } from "@/lib/geometry/trimline";
import type { PlacedElement, PlacedSink, Side, SinkKind, SinkMarkerRef, TextMarking } from "@/types";

/**
 * Elements > Sink. Two top-sheet terms, never a boolean and never the bottom:
 * local forefoot thickness T (additive) then sink cut S (subtractive, applied last).
 * Empty / undefined sinks return before any work so exports stay byte-identical.
 *
 * Picked constants (Kendon brief v1) — change them here.
 */

/** Men's 9 reference length. Plan size scales by mesh length / this, clamped. Depth and blend do not. */
export const SINK_REFERENCE_LENGTH_MM = INSOLE_LENGTH_MM;
/** Men's 9 reference width. Used only when no mesh outline is available. */
export const SINK_REFERENCE_WIDTH_MM = INSOLE_WIDTH_MM;
/** Plan scale clamp. Same factor on length and width. Depth, taper, and the 3 mm wedge inset do not scale. */
export const SINK_SCALE_MIN = 0.8;
export const SINK_SCALE_MAX = 1.3;
/** Reverse kinetic wedge: medial edge of the oval, mm from the insole's medial edge. Not scaled. */
export const RKW_MEDIAL_INSET_MM = 3;
/**
 * Reverse kinetic wedge cut and thicken fade out over this distance from the
 * medial outline. Longer than the 6 mm taper so a 4 mm depth does not crease
 * the wall. The deepest point stays past this band.
 */
export const RKW_MEDIAL_FADE_MM = 12;
/** 5th MPJ body stays at least this far from the lateral edge. Blend is not included. */
export const MPJ5_BODY_CLEAR_MM = 4;

export const SINK_DEFAULT_DEPTH_MM = 2;
/** Added on top of the deepest forefoot sink. Floor under that sink = current + this. */
export const FOREFOOT_THICKNESS_CLEARANCE_MM = 0.5;
/** Local blend length of a forefoot sink's thickness addition. */
export const BLEND_LEN_MM = 25;
/** Wall notch fades this far below the styloid floor. */
export const STYLOID_WALL_FADE_BELOW_FLOOR_MM = 4;
/** Minimum remaining top thickness after T − S. */
export const FLOOR_MIN_MM = 2.0;
/** Lateral wall keeps at least this much thickness at a styloid relief. */
export const LATERAL_WALL_MIN_MM = 2.0;
/** 5th IPJ / styloid long-axis angle. Negative tips the distal end toward medial on a right foot. */
export const STYLOID_ROTATION_DEG = -15;
/**
 * Sub-0.05 mm thickness within this 3D distance of the loft outline is
 * dropped. The first wall triangle shares that edge. Thicker additions stay,
 * so the shell wall is not sheared.
 */
export const LOFT_RIM_HOLD_MM = 2;
/** Full-thickness material required between the styloid taper and the insole edge. */
export const STYLOID_RIM_CLEAR_MM = 4;
/** Below this clearance the styloid is not cut, unless a per-case override is set. */
export const STYLOID_RIM_HARD_MM = 3;
/** Override floor. A per-case override may sit closer than the hard-stop, but not under this. */
export const STYLOID_RIM_OVERRIDE_FLOOR_MM = 2;
/** 5th MPJ cut fades out before the lateral rim. */
export const MPJ5_V_FADE_START = 0.88;
export const MPJ5_V_FADE_END = 0.95;
/**
 * 1st MPJ cut fades only on the extreme medial rim. The centre sits at v 0.10,
 * so the band must stay below that or the circle would lose depth at its middle.
 */
export const MPJ1_V_FADE_START = 0.04;
export const MPJ1_V_FADE_END = 0;
/**
 * Where the wall guard holds the crest above the cut, the inboard top
 * cannot fall steeper than this. A vertex is never lifted above the
 * nearest guarded crest, so a tall neighbour cannot build a new ridge.
 */
export const RIM_LIP_MAX_DEG = 30;
const RIM_LIP_REACH_MM = 15;
export const ELLIPSE_NEWTON_ITERS = 4;

export interface SinkProfile {
    kind: SinkKind;
    label: string;
    /** Heel → toe, fraction of the outline. */
    u: number;
    /** Medial → lateral, fraction of the outline. */
    v: number;
    /** Oval length along the local outline tangent, mm at Men's 9. */
    lengthMm: number;
    /** Oval width across that tangent, mm at Men's 9. */
    widthMm: number;
    blendMm: number;
    defaultDepthMm: number;
    maxDepthMm: number;
    /** Deepest point shift toward the heel, mm. Not scaled. Zero keeps a true oval. */
    deepestProximalMm: number;
    /** Deepest point shift toward lateral, mm. Not scaled. Zero keeps a true oval. */
    deepestLateralMm: number;
    /**
     * Long-axis angle on a right foot, degrees from distal toward lateral.
     * Left feet use the opposite sign. Zero is a foot-axis oval (a circle when the axes match).
     */
    rotationDeg: number;
    /** Keep the cut off the lateral wall. */
    lateralWallFade: boolean;
    /** Keep the cut off the medial wall. */
    medialWallFade: boolean;
    forefoot: boolean;
}

export const SINK_KIND_ORDER: readonly SinkKind[] = [
    "mpj1",
    "mpj2",
    "mpj3",
    "mpj4",
    "mpj5",
    "rkw",
    "styloid",
];

export const SINK_PROFILES: Record<SinkKind, SinkProfile> = {
    mpj1: {
        kind: "mpj1",
        label: "1st MPJ",
        u: 0.69,
        v: 0.1,
        lengthMm: 20,
        widthMm: 20,
        blendMm: 8,
        defaultDepthMm: SINK_DEFAULT_DEPTH_MM,
        maxDepthMm: 4,
        deepestProximalMm: 0,
        deepestLateralMm: 0,
        rotationDeg: 0,
        lateralWallFade: false,
        medialWallFade: true,
        forefoot: true,
    },
    mpj2: {
        kind: "mpj2",
        label: "2nd MPJ",
        u: 0.705,
        v: 0.28,
        lengthMm: 14,
        widthMm: 14,
        blendMm: 6,
        defaultDepthMm: SINK_DEFAULT_DEPTH_MM,
        maxDepthMm: 3,
        deepestProximalMm: 0,
        deepestLateralMm: 0,
        rotationDeg: 0,
        lateralWallFade: false,
        medialWallFade: false,
        forefoot: true,
    },
    mpj3: {
        kind: "mpj3",
        label: "3rd MPJ",
        u: 0.705,
        v: 0.48,
        lengthMm: 14,
        widthMm: 14,
        blendMm: 6,
        defaultDepthMm: SINK_DEFAULT_DEPTH_MM,
        maxDepthMm: 3,
        deepestProximalMm: 0,
        deepestLateralMm: 0,
        rotationDeg: 0,
        lateralWallFade: false,
        medialWallFade: false,
        forefoot: true,
    },
    mpj4: {
        kind: "mpj4",
        label: "4th MPJ",
        u: 0.685,
        v: 0.67,
        lengthMm: 14,
        widthMm: 14,
        blendMm: 6,
        defaultDepthMm: SINK_DEFAULT_DEPTH_MM,
        maxDepthMm: 3,
        deepestProximalMm: 0,
        deepestLateralMm: 0,
        rotationDeg: 0,
        lateralWallFade: false,
        medialWallFade: false,
        forefoot: true,
    },
    mpj5: {
        kind: "mpj5",
        label: "5th MPJ",
        u: 0.65,
        v: 0.85,
        lengthMm: 16,
        widthMm: 16,
        blendMm: 6,
        defaultDepthMm: SINK_DEFAULT_DEPTH_MM,
        maxDepthMm: 4,
        deepestProximalMm: 0,
        deepestLateralMm: 0,
        rotationDeg: 0,
        lateralWallFade: true,
        medialWallFade: false,
        forefoot: true,
    },
    rkw: {
        kind: "rkw",
        label: "Reverse kinetic wedge",
        u: 0.68,
        /** Unused. The oval's medial edge is RKW_MEDIAL_INSET_MM from the medial outline. */
        v: 0,
        lengthMm: 40,
        widthMm: 23,
        blendMm: 6,
        defaultDepthMm: SINK_DEFAULT_DEPTH_MM,
        maxDepthMm: 4,
        deepestProximalMm: 3,
        deepestLateralMm: 0,
        rotationDeg: 0,
        lateralWallFade: false,
        // The 6 mm taper crosses the medial outline. Fade the cut on that rim
        // the same way the 1st MPJ does, so the wall is not sheared.
        medialWallFade: true,
        forefoot: true,
    },
    styloid: {
        kind: "styloid",
        label: "5th IPJ (Styloid)",
        u: 0.42,
        v: 0.92,
        lengthMm: 20,
        widthMm: 14,
        blendMm: 8,
        defaultDepthMm: SINK_DEFAULT_DEPTH_MM,
        maxDepthMm: 3,
        deepestProximalMm: 0,
        deepestLateralMm: 0,
        rotationDeg: STYLOID_ROTATION_DEG,
        lateralWallFade: false,
        medialWallFade: false,
        forefoot: false,
    },
};

export const SINK_LABELS: Record<SinkKind, string> = {
    mpj1: SINK_PROFILES.mpj1.label,
    mpj2: SINK_PROFILES.mpj2.label,
    mpj3: SINK_PROFILES.mpj3.label,
    mpj4: SINK_PROFILES.mpj4.label,
    mpj5: SINK_PROFILES.mpj5.label,
    rkw: SINK_PROFILES.rkw.label,
    styloid: SINK_PROFILES.styloid.label,
};

export interface SinkOutlinePoint {
    x: number;
    y: number;
}

export interface SinkSurfaceContext {
    side: Side;
    lengthMm: number;
    widthMm: number;
    trimline?: TrimlineCurve | null;
    sinks?: PlacedSink[];
    /** Default false. Forefoot thickness only, unless this and a styloid sink are set. */
    sinkStyloidThicken?: boolean;
    sinkMarkers?: SinkMarkerRef[];
    /**
     * Mesh-frame outline (x along the foot, y the mesh width). When set, v is the
     * fraction from the medial edge to the lateral edge at that u, and plan size
     * uses this outline's length.
     */
    footOutline?: SinkOutlinePoint[] | null;
    /**
     * Which mesh-Y direction is medial. +1 means +Y is medial.
     * When omitted, {@link medialSign}: −1 on the left foot, +1 on the right.
     */
    medialYSign?: 1 | -1;
}

export interface SinkWarning {
    sinkId: string;
    code:
        | "depth-max"
        | "floor"
        | "lateral-wall"
        | "element-overlap"
        | "text-overlap"
        | "rim"
        | "rim-hard-stop";
    message: string;
}

export interface SinkCutSample {
    /** Clamped cut depth, mm. Overlap is the max, not the sum. */
    mm: number;
    sinkId?: string;
    /** Profile weight of the winning sink, after the medial and lateral rim fades. */
    weight: number;
}

export function sinksActive(sinks?: PlacedSink[] | null): boolean {
    return !!sinks && sinks.length > 0;
}

/** C1 smoothstep on [0, 1], clamped. Zero slope at both ends. */
export function smoothstep01(t: number): number {
    const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
    return x * x * (3 - 2 * x);
}

/** C2 smootherstep on [0, 1], clamped. */
export function smootherstep01(t: number): number {
    const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
    return x * x * x * (x * (x * 6 - 15) + 10);
}

export function clampSinkDepth(
    kind: SinkKind,
    depthMm: number,
): { depthMm: number; aboveMax: boolean; maxDepthMm: number } {
    const maxDepthMm = SINK_PROFILES[kind].maxDepthMm;
    if (!Number.isFinite(depthMm) || depthMm <= 0) return { depthMm: 0, aboveMax: false, maxDepthMm };
    if (depthMm > maxDepthMm) return { depthMm: maxDepthMm, aboveMax: true, maxDepthMm };
    return { depthMm, aboveMax: false, maxDepthMm };
}

export function sinkDepthWarnings(sinks?: PlacedSink[] | null): SinkWarning[] {
    if (!sinksActive(sinks)) return [];
    const out: SinkWarning[] = [];
    for (const sink of sinks!) {
        const clamped = clampSinkDepth(sink.kind, sink.depthMm);
        if (!clamped.aboveMax) continue;
        out.push({
            sinkId: sink.id,
            code: "depth-max",
            message: `${SINK_LABELS[sink.kind]} depth ${sink.depthMm} mm is above max ${clamped.maxDepthMm} mm; cut clamped to ${clamped.maxDepthMm} mm`,
        });
    }
    return out;
}

function localHalfWidthMm(u: number, ctx: SinkSurfaceContext): number {
    const uu = Math.max(0, Math.min(1, u));
    return effectiveOutlineHalfWidth(uu, ctx.lengthMm, ctx.widthMm, ctx.trimline) * (ctx.widthMm / 2);
}

/** M9 full width at the same u, from the reference outline (not the live insole). */
export function referenceWidthAtU(u: number): number {
    const uu = Math.max(0, Math.min(1, u));
    return (
        effectiveOutlineHalfWidth(uu, SINK_REFERENCE_LENGTH_MM, SINK_REFERENCE_WIDTH_MM, null) *
        SINK_REFERENCE_WIDTH_MM
    );
}

/** Plan scale shared by every sink axis. Depth, taper, and the wedge inset stay in millimetres. */
export function sinkPlanScale(lengthMm: number): number {
    const raw = lengthMm / SINK_REFERENCE_LENGTH_MM;
    if (!Number.isFinite(raw) || raw <= 0) return 1;
    return Math.min(SINK_SCALE_MAX, Math.max(SINK_SCALE_MIN, raw));
}

/**
 * Mesh width coordinate to anatomical +lateral (medial is the smaller value).
 * The default sign is {@link medialSign}: the left stock mesh has its arch
 * on −Y, and the right foot is that mesh mirrored onto +Y. Pass
 * `medialYSign` only when the arch was measured on this mesh.
 */
export function meshYToAnatomical(yMesh: number, side: Side, medialYSign?: 1 | -1): number {
    const sign = medialYSign ?? medialSign(side);
    return -sign * yMesh;
}

const EDGE_STATIONS = 64;
const edgeCache = new WeakMap<SinkOutlinePoint[], { side: Side; medialYSign: 1 | -1; edges: PlanEdges }>();

interface PlanEdges {
    originX: number;
    lengthMm: number;
    medialAt: (u: number) => number;
    lateralAt: (u: number) => number;
}

function ySpanAtX(points: SinkOutlinePoint[], x: number): { lo: number; hi: number } | null {
    const ys: number[] = [];
    const n = points.length;
    for (let i = 0; i < n; i++) {
        const a = points[i]!;
        const b = points[(i + 1) % n]!;
        const dx = b.x - a.x;
        if (Math.abs(dx) < 1e-8) {
            if (Math.abs(a.x - x) <= 1e-3) ys.push(a.y, b.y);
            continue;
        }
        const t = (x - a.x) / dx;
        if (t < -1e-4 || t > 1 + 1e-4) continue;
        const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
        ys.push(a.y + clamped * (b.y - a.y));
    }
    if (ys.length === 0) return null;
    let lo = ys[0]!;
    let hi = ys[0]!;
    for (const y of ys) {
        if (y < lo) lo = y;
        if (y > hi) hi = y;
    }
    return { lo, hi };
}

function buildOutlineEdges(points: SinkOutlinePoint[], side: Side, medialYSign?: 1 | -1): PlanEdges | null {
    let minX = Infinity;
    let maxX = -Infinity;
    for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
    }
    const lengthMm = maxX - minX;
    if (!(lengthMm > 1)) return null;
    const medial = new Float64Array(EDGE_STATIONS);
    const lateral = new Float64Array(EDGE_STATIONS);
    let prevMed = 0;
    let prevLat = 0;
    let have = false;
    for (let i = 0; i < EDGE_STATIONS; i++) {
        const u = i / (EDGE_STATIONS - 1);
        const span = ySpanAtX(points, minX + u * lengthMm);
        if (!span) {
            medial[i] = prevMed;
            lateral[i] = prevLat;
            continue;
        }
        const a = meshYToAnatomical(span.lo, side, medialYSign);
        const b = meshYToAnatomical(span.hi, side, medialYSign);
        prevMed = Math.min(a, b);
        prevLat = Math.max(a, b);
        medial[i] = prevMed;
        lateral[i] = prevLat;
        have = true;
    }
    if (!have) return null;
    for (let i = EDGE_STATIONS - 2; i >= 0; i--) {
        if (medial[i] === 0 && lateral[i] === 0 && !(medial[i + 1] === 0 && lateral[i + 1] === 0)) {
            medial[i] = medial[i + 1]!;
            lateral[i] = lateral[i + 1]!;
        }
    }
    const at = (samples: Float64Array, u: number) => {
        const x = Math.max(0, Math.min(1, u)) * (EDGE_STATIONS - 1);
        const i = Math.floor(x);
        const f = x - i;
        const j = Math.min(EDGE_STATIONS - 1, i + 1);
        return samples[i]! * (1 - f) + samples[j]! * f;
    };
    return {
        originX: minX,
        lengthMm,
        medialAt: (u) => at(medial, u),
        lateralAt: (u) => at(lateral, u),
    };
}

function planEdges(ctx: SinkSurfaceContext): PlanEdges {
    const outline = ctx.footOutline;
    if (outline && outline.length >= 6) {
        const medialYSign = ctx.medialYSign ?? medialSign(ctx.side);
        const cached = edgeCache.get(outline);
        if (cached && cached.side === ctx.side && cached.medialYSign === medialYSign) return cached.edges;
        const built = buildOutlineEdges(outline, ctx.side, medialYSign);
        if (built) {
            edgeCache.set(outline, { side: ctx.side, medialYSign, edges: built });
            return built;
        }
    }
    return {
        originX: 0,
        lengthMm: Math.max(ctx.lengthMm, 1e-6),
        medialAt: (u) => -localHalfWidthMm(u, ctx),
        lateralAt: (u) => localHalfWidthMm(u, ctx),
    };
}

function vWasExplicit(sink: PlacedSink, markers?: SinkMarkerRef[]): boolean {
    if (Number.isFinite(sink.v)) return true;
    if (!sink.markerId || !markers) return false;
    return markers.some((m) => m.id === sink.markerId && Number.isFinite(m.v));
}

/** Closed medial/lateral loop from a position buffer. x is the length axis, y the width axis. */
export function footOutlineFromPositions(
    positions: ArrayLike<number>,
    count: number,
    lengthAxis = 0,
    widthAxis = 1,
): SinkOutlinePoint[] | null {
    if (count < 3) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < count; i++) {
        const x = positions[i * 3 + lengthAxis]!;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
    }
    const length = maxX - minX;
    if (!(length > 1e-3)) return null;
    const n = 32;
    const lo = new Float64Array(n);
    const hi = new Float64Array(n);
    lo.fill(Number.POSITIVE_INFINITY);
    hi.fill(Number.NEGATIVE_INFINITY);
    for (let i = 0; i < count; i++) {
        const x = positions[i * 3 + lengthAxis]!;
        const y = positions[i * 3 + widthAxis]!;
        let s = Math.round(((x - minX) / length) * (n - 1));
        if (s < 0) s = 0;
        else if (s > n - 1) s = n - 1;
        if (y < lo[s]!) lo[s] = y;
        if (y > hi[s]!) hi[s] = y;
    }
    const idx: number[] = [];
    for (let s = 0; s < n; s++) if (lo[s]! !== Number.POSITIVE_INFINITY) idx.push(s);
    if (idx.length < 3) return null;
    const pts: SinkOutlinePoint[] = [];
    for (const s of idx) pts.push({ x: minX + (s / (n - 1)) * length, y: lo[s]! });
    for (let k = idx.length - 1; k >= 0; k--) {
        const s = idx[k]!;
        pts.push({ x: minX + (s / (n - 1)) * length, y: hi[s]! });
    }
    return pts;
}

export function footOutlineFromGeometry(
    geometry: BufferGeometry,
    lengthAxis = 0,
    widthAxis = 1,
    count?: number,
): SinkOutlinePoint[] | null {
    const pos = geometry.getAttribute("position") as BufferAttribute | undefined;
    if (!pos) return null;
    const n = count && count > 0 ? Math.min(count, pos.count) : pos.count;
    return footOutlineFromPositions(pos.array as ArrayLike<number>, n, lengthAxis, widthAxis);
}

/** Attach a mesh outline so later samples use the same edges as the vertices. */
export function sinkContextForMesh(
    ctx: SinkSurfaceContext,
    positions: ArrayLike<number>,
    count: number,
    lengthAxis = 0,
    widthAxis = 1,
): SinkSurfaceContext {
    if (ctx.footOutline && ctx.footOutline.length >= 6) return ctx;
    const outline = footOutlineFromPositions(positions, count, lengthAxis, widthAxis);
    return outline ? { ...ctx, footOutline: outline } : ctx;
}

function resolveUV(sink: PlacedSink, markers?: SinkMarkerRef[]): { u: number; v: number } {
    if (sink.markerId && markers) {
        const hit = markers.find((m) => m.id === sink.markerId);
        if (hit && Number.isFinite(hit.u) && Number.isFinite(hit.v)) return { u: hit.u, v: hit.v };
    }
    const profile = SINK_PROFILES[sink.kind];
    return {
        u: Number.isFinite(sink.u) ? sink.u! : profile.u,
        v: Number.isFinite(sink.v) ? sink.v! : profile.v,
    };
}

/** Spec v (0 medial → 1 lateral) from a height-field vSigned. */
export function specVFromVSigned(vSigned: number, side: Side): number {
    const m = -(vSigned * medialSign(side));
    return (1 - m) / 2;
}

/** Height-field vSigned of a spec v. ±1 lies on the local outline. */
export function vSignedFromSpecV(v: number, side: Side): number {
    return medialSign(side) * (2 * v - 1);
}

export interface SinkOvalFrame {
    kind: SinkKind;
    sinkId: string;
    u: number;
    v: number;
    /** Anatomical centre, mm. x from the heel, y +lateral. */
    cx: number;
    cy: number;
    /** Unit tangent, +distal. */
    tx: number;
    ty: number;
    /** Unit across, +lateral. */
    nx: number;
    ny: number;
    /** Scaled half-length (distal / proximal outer boundary is this from the anatomical centre). */
    halfLengthMm: number;
    halfWidthMm: number;
    blendMm: number;
    depthMm: number;
    aboveMax: boolean;
    forefoot: boolean;
    lateralWallFade: boolean;
    medialWallFade: boolean;
    /** Medial fade length in mm. 0 uses the shared 1st-MPJ v band. */
    medialFadeMm: number;
    /** Half-axes of the egg measured from the shifted deepest point. */
    aProx: number;
    aDist: number;
    bMed: number;
    bLat: number;
    /** Deepest point, mm, anatomical. */
    dx: number;
    dy: number;
    /** Signed long-axis angle, degrees. Left is the mirror of right. */
    rotationDeg: number;
    /** Full-thickness gap from the outer taper to the lateral edge. Infinity off the styloid. */
    rimMarginMm: number;
    /** Medial shift applied so the taper is not clipped by the edge. */
    rimShiftMm: number;
    /** Hard-stop: the oval would break the rim floor, so the cut is not applied. */
    rimBlocked: boolean;
    rimWarning?: SinkWarning;
}

/** Right-foot angle, mirrored on the left so the oval is the mirror image. */
export function signedSinkRotationDeg(rotationDeg: number, side: Side): number {
    return side === "left" ? -rotationDeg : rotationDeg;
}

function frameAxes(theta: number): { tx: number; ty: number; nx: number; ny: number } {
    return {
        tx: Math.cos(theta),
        ty: Math.sin(theta),
        nx: -Math.sin(theta),
        ny: Math.cos(theta),
    };
}

/** How far the oval reaches toward lateral, measured from its centre. Blend is separate. */
export function ovalLateralSupportMm(halfLengthMm: number, halfWidthMm: number, theta: number): number {
    return Math.hypot(halfLengthMm * Math.sin(theta), halfWidthMm * Math.cos(theta));
}

function placeStyloidRim(
    sink: PlacedSink,
    cy: number,
    lateral: number,
    medial: number,
    supportMm: number,
    blendMm: number,
): { cy: number; marginMm: number; shiftMm: number; blocked: boolean; warning?: SinkWarning } {
    const outer = supportMm + blendMm;
    const marginAt = (y: number) => lateral - y - outer;
    const targetCy = lateral - STYLOID_RIM_CLEAR_MM - outer;
    const minCy = medial + outer;
    let next = cy;
    if (cy > targetCy) next = Math.max(minCy, targetCy);
    if (next > cy) next = cy;
    const marginMm = marginAt(next);
    const hard = sink.rimOverride ? STYLOID_RIM_OVERRIDE_FLOOR_MM : STYLOID_RIM_HARD_MM;
    const blocked = marginMm < hard - 1e-6;
    let warning: SinkWarning | undefined;
    if (blocked) {
        warning = {
            sinkId: sink.id,
            code: "rim-hard-stop",
            message: `${SINK_LABELS.styloid} rim clearance ${marginMm.toFixed(1)} mm is below ${hard.toFixed(1)} mm; sink not cut`,
        };
    } else if (marginMm < STYLOID_RIM_CLEAR_MM - 1e-6) {
        warning = {
            sinkId: sink.id,
            code: "rim",
            message: `${SINK_LABELS.styloid} rim clearance ${marginMm.toFixed(1)} mm is below ${STYLOID_RIM_CLEAR_MM.toFixed(1)} mm`,
        };
    }
    return { cy: next, marginMm, shiftMm: cy - next, blocked, warning };
}

export function sinkFrame(sink: PlacedSink, ctx: SinkSurfaceContext): SinkOvalFrame | null {
    const profile = SINK_PROFILES[sink.kind];
    if (!profile) return null;
    const clamped = clampSinkDepth(sink.kind, sink.depthMm);
    const uv = resolveUV(sink, ctx.sinkMarkers);
    const edges = planEdges(ctx);
    const scale = sinkPlanScale(edges.lengthMm);
    const halfLengthMm = (profile.lengthMm / 2) * scale;
    const halfWidthMm = (profile.widthMm / 2) * scale;
    const rotationDeg = signedSinkRotationDeg(profile.rotationDeg, ctx.side);
    const theta = (rotationDeg * Math.PI) / 180;
    const axes = frameAxes(theta);
    const medial = edges.medialAt(uv.u);
    const lateral = edges.lateralAt(uv.u);
    const span = lateral - medial;
    const cx = edges.originX + uv.u * edges.lengthMm;
    let cy = medial + uv.v * span;
    let v = uv.v;
    if (sink.kind === "rkw" && !vWasExplicit(sink, ctx.sinkMarkers)) {
        const minCy = medial + halfWidthMm;
        const maxCy = lateral - halfWidthMm;
        cy = medial + RKW_MEDIAL_INSET_MM + halfWidthMm;
        if (maxCy >= minCy - 1e-6) cy = Math.min(maxCy, Math.max(minCy, cy));
        else cy = (medial + lateral) / 2;
        v = span > 1e-6 ? (cy - medial) / span : 0.5;
    }
    if (sink.kind === "mpj5" && span > 1e-6) {
        const clearance = lateral - cy - halfWidthMm;
        if (clearance < MPJ5_BODY_CLEAR_MM) {
            const target = lateral - MPJ5_BODY_CLEAR_MM - halfWidthMm;
            cy = Math.max(medial + halfWidthMm, Math.min(cy, target));
            v = (cy - medial) / span;
        }
    }
    const support = ovalLateralSupportMm(halfLengthMm, halfWidthMm, theta);
    let rimMarginMm = Number.POSITIVE_INFINITY;
    let rimShiftMm = 0;
    let rimBlocked = false;
    let rimWarning: SinkWarning | undefined;
    if (sink.kind === "styloid" && span > 1e-6) {
        const placed = placeStyloidRim(sink, cy, lateral, medial, support, profile.blendMm);
        cy = placed.cy;
        v = (cy - medial) / span;
        rimMarginMm = placed.marginMm;
        rimShiftMm = placed.shiftMm;
        rimBlocked = placed.blocked;
        rimWarning = placed.warning;
    }
    const prox = Math.min(profile.deepestProximalMm, halfLengthMm * 0.49);
    const lat = Math.min(profile.deepestLateralMm, halfWidthMm * 0.49);
    const aProx = Math.max(0.5, halfLengthMm - prox);
    const aDist = halfLengthMm + prox;
    const bLat = Math.max(0.5, halfWidthMm - lat);
    const bMed = halfWidthMm + lat;
    const dx = cx - axes.tx * prox + axes.nx * lat;
    const dy = cy - axes.ty * prox + axes.ny * lat;
    return {
        kind: sink.kind,
        sinkId: sink.id,
        u: uv.u,
        v,
        cx,
        cy,
        tx: axes.tx,
        ty: axes.ty,
        nx: axes.nx,
        ny: axes.ny,
        halfLengthMm,
        halfWidthMm,
        blendMm: profile.blendMm,
        depthMm: clamped.depthMm,
        aboveMax: clamped.aboveMax,
        forefoot: profile.forefoot,
        lateralWallFade: profile.lateralWallFade,
        medialWallFade: profile.medialWallFade,
        medialFadeMm: sink.kind === "rkw" ? RKW_MEDIAL_FADE_MM : 0,
        aProx,
        aDist,
        bMed,
        bLat,
        dx,
        dy,
        rotationDeg,
        rimMarginMm,
        rimShiftMm,
        rimBlocked,
        rimWarning,
    };
}

const ellipseCache = new Map<string, number>();

/** Exact distance from a point outside an axis-aligned ellipse to the ellipse. 0 inside. */
export function ellipseOffsetDistance(px: number, py: number, a: number, b: number): number {
    if (!(a > 1e-6) || !(b > 1e-6)) return 0;
    const ax = Math.abs(px);
    const ay = Math.abs(py);
    const r = Math.hypot(ax / a, ay / b);
    if (r <= 1) return 0;
    const key = `${a.toFixed(3)}|${b.toFixed(3)}|${ax.toFixed(2)}|${ay.toFixed(2)}`;
    const hit = ellipseCache.get(key);
    if (hit !== undefined) return hit;
    let mu = Math.max(a, b) * (r - 1) * Math.max(a, b);
    const a2 = a * a;
    const b2 = b * b;
    for (let i = 0; i < ELLIPSE_NEWTON_ITERS; i++) {
        const da = mu + a2;
        const db = mu + b2;
        const fa = (a * ax) / da;
        const fb = (b * ay) / db;
        const f = fa * fa + fb * fb - 1;
        const df = (-2 * a2 * ax * ax) / (da * da * da) - (2 * b2 * ay * ay) / (db * db * db);
        if (!(Math.abs(df) > 1e-14)) break;
        const next = mu - f / df;
        mu = next > 0 ? next : 0;
    }
    const da = mu + a2;
    const db = mu + b2;
    const x = (a2 * ax) / da;
    const y = (b2 * ay) / db;
    const dist = Math.hypot(ax - x, ay - y);
    if (ellipseCache.size > 8192) ellipseCache.clear();
    ellipseCache.set(key, dist);
    return dist;
}

function eggWeight(frame: SinkOvalFrame, x: number, y: number, blendMm: number): number {
    const rx = x - frame.dx;
    const ry = y - frame.dy;
    const lx = rx * frame.tx + ry * frame.ty;
    const ly = rx * frame.nx + ry * frame.ny;
    const a = lx >= 0 ? frame.aDist : frame.aProx;
    const b = ly >= 0 ? frame.bLat : frame.bMed;
    const r = Math.hypot(lx / a, ly / b);
    if (r <= 1) return 1;
    const dist = ellipseOffsetDistance(lx, ly, a, b);
    if (blendMm <= 1e-9) return 0;
    return 1 - smootherstep01(dist / blendMm);
}

function pointMm(u: number, vSigned: number, ctx: SinkSurfaceContext): { x: number; y: number; v: number } {
    const v = specVFromVSigned(vSigned, ctx.side);
    const edges = planEdges(ctx);
    const uu = Math.max(0, Math.min(1, u));
    const medial = edges.medialAt(uu);
    const lateral = edges.lateralAt(uu);
    return { x: edges.originX + uu * edges.lengthMm, y: medial + v * (lateral - medial), v };
}

interface PreparedSink {
    frame: SinkOvalFrame;
}

function prepare(ctx: SinkSurfaceContext): PreparedSink[] {
    if (!sinksActive(ctx.sinks)) return [];
    const out: PreparedSink[] = [];
    for (const sink of ctx.sinks!) {
        const frame = sinkFrame(sink, ctx);
        if (!frame || frame.depthMm <= 0 || frame.rimBlocked) continue;
        out.push({ frame });
    }
    return out;
}

export interface ForefootThicknessPlan {
    /** Deepest forefoot sink + 0.5 mm. Each sink thickens only around itself. */
    A: number;
    /** Heel-origin x (mm) where the most proximal local blend reaches full addition. */
    xFull: number;
    /** Heel-origin x (mm) where that blend starts. T = 0 for x well below x0. */
    x0: number;
}

export function forefootThicknessPlan(ctx: SinkSurfaceContext): ForefootThicknessPlan | null {
    const prepared = prepare(ctx).filter((p) => p.frame.forefoot);
    if (!prepared.length) return null;
    let A = 0;
    let tip = Number.POSITIVE_INFINITY;
    for (const p of prepared) {
        A = Math.max(A, p.frame.depthMm + FOREFOOT_THICKNESS_CLEARANCE_MM);
        tip = Math.min(tip, p.frame.cx - p.frame.halfLengthMm - BLEND_LEN_MM);
    }
    return { A, xFull: tip + BLEND_LEN_MM, x0: tip };
}

/**
 * Local thickness at a height-field sample. Each forefoot sink adds its own
 * depth + 0.5 mm inside the oval and blends that to 0 over 25 mm. Overlap is
 * the max, not the sum. 0 when no sinks.
 */
/** Local thickness at an anatomical millimetre. Overlap is the max, not the sum. */
function specVAt(x: number, yLateral: number, ctx: SinkSurfaceContext): { v: number; span: number } {
    const edges = planEdges(ctx);
    const u = Math.max(0, Math.min(1, (x - edges.originX) / Math.max(edges.lengthMm, 1e-6)));
    const medial = edges.medialAt(u);
    const span = Math.max(0, edges.lateralAt(u) - medial);
    return { v: span > 1e-6 ? (yLateral - medial) / span : 0.5, span };
}

/** Keep a sink's cut and its local thicken off the wall. 1 in the interior. */
function wallFadeFactor(frame: SinkOvalFrame, v: number, spanMm: number): number {
    let factor = 1;
    if (frame.lateralWallFade) {
        factor *= 1 - smoothstep01((v - MPJ5_V_FADE_START) / (MPJ5_V_FADE_END - MPJ5_V_FADE_START));
    }
    if (frame.medialWallFade) {
        const startV =
            frame.medialFadeMm > 0 && spanMm > 1e-6
                ? Math.min(0.49, frame.medialFadeMm / spanMm)
                : MPJ1_V_FADE_START;
        factor *= 1 - smoothstep01((startV - v) / Math.max(startV, 1e-6));
    }
    return factor;
}

export function sinkThicknessMm(x: number, yLateral: number, ctx: SinkSurfaceContext): number {
    if (!sinksActive(ctx.sinks)) return 0;
    const at = specVAt(x, yLateral, ctx);
    let t = 0;
    for (const p of prepare(ctx)) {
        const localOk = p.frame.forefoot || (ctx.sinkStyloidThicken && p.frame.kind === "styloid");
        if (!localOk) continue;
        const w = eggWeight(p.frame, x, yLateral, BLEND_LEN_MM) * wallFadeFactor(p.frame, at.v, at.span);
        const local = (p.frame.depthMm + FOREFOOT_THICKNESS_CLEARANCE_MM) * w;
        if (local > t) t = local;
    }
    return t;
}

export function sinkThicknessAt(u: number, vSigned: number, ctx: SinkSurfaceContext): number {
    if (!sinksActive(ctx.sinks)) return 0;
    const pt = pointMm(u, vSigned, ctx);
    return sinkThicknessMm(pt.x, pt.y, ctx);
}

/** Styloid rim warnings, including a hard-stop that refuses the cut. */
export function sinkRimWarnings(ctx: SinkSurfaceContext): SinkWarning[] {
    if (!sinksActive(ctx.sinks)) return [];
    const out: SinkWarning[] = [];
    for (const sink of ctx.sinks!) {
        if (sink.kind !== "styloid") continue;
        const frame = sinkFrame(sink, ctx);
        if (frame?.rimWarning) out.push(frame.rimWarning);
    }
    return out;
}

/** Subtractive cut at a height-field sample. Overlap = max. 0 when no sinks. */
export function sinkCutAt(u: number, vSigned: number, ctx: SinkSurfaceContext): SinkCutSample {
    if (!sinksActive(ctx.sinks)) return { mm: 0, weight: 0 };
    const pt = pointMm(u, vSigned, ctx);
    return sinkCutMm(pt.x, pt.y, ctx, pt.v);
}

export function sinkCutMm(
    x: number,
    yLateral: number,
    ctx: SinkSurfaceContext,
    vKnown?: number,
): SinkCutSample {
    if (!sinksActive(ctx.sinks)) return { mm: 0, weight: 0 };
    const at = specVAt(x, yLateral, ctx);
    const v = vKnown ?? at.v;
    let best = 0;
    let sinkId: string | undefined;
    let weight = 0;
    for (const p of prepare(ctx)) {
        const w = eggWeight(p.frame, x, yLateral, p.frame.blendMm) * wallFadeFactor(p.frame, v, at.span);
        const d = p.frame.depthMm * w;
        if (d > best) {
            best = d;
            sinkId = p.frame.sinkId;
            weight = w;
        }
    }
    return { mm: best, sinkId, weight };
}

/** Anatomical mm of the deepest point (shifted centre). */
export function sinkDeepestMm(sink: PlacedSink, ctx: SinkSurfaceContext): { x: number; y: number } | null {
    const frame = sinkFrame(sink, ctx);
    if (!frame) return null;
    return { x: frame.dx, y: frame.dy };
}

export function applyFloorGuard(
    topZ: number,
    cutMm: number,
    sinkId: string | undefined,
): { cutMm: number; warning?: SinkWarning } {
    if (cutMm <= 0) return { cutMm: 0 };
    const remain = topZ - cutMm;
    if (remain >= FLOOR_MIN_MM - 1e-9) return { cutMm };
    const allowed = Math.max(0, topZ - FLOOR_MIN_MM);
    return {
        cutMm: allowed,
        warning: {
            sinkId: sinkId ?? "sink",
            code: "floor",
            message: `Sink ${sinkId ?? ""} floor held at ${FLOOR_MIN_MM.toFixed(1)} mm (cut reduced)`,
        },
    };
}

/**
 * Rim lowering guard. The crest must stay LATERAL_WALL_MIN_MM above localTop.
 * localTop is the footbed under the wall; pass 0 to require an absolute crest height.
 */
export function guardedRimLowering(
    rimHeight: number,
    requested: number,
    localTop = 0,
): { lowering: number; warning: boolean } {
    const minCrest = localTop + LATERAL_WALL_MIN_MM;
    const maxLower = rimHeight - minCrest;
    if (requested <= maxLower + 1e-9) return { lowering: Math.max(0, requested), warning: false };
    return { lowering: Math.max(0, maxLower), warning: true };
}

/** dz for one wall vertex. z and rimHeight are the pre-relief heights. Negative lowers the wall. */
export function styloidWallReliefAt(
    z: number,
    rimHeight: number,
    depthMm: number,
    rimLowering: number,
): number {
    if (rimLowering <= 1e-9 || rimHeight <= 1e-6) return 0;
    const zFloor = rimHeight - depthMm - STYLOID_WALL_FADE_BELOW_FLOOR_MM;
    const span = rimHeight - zFloor;
    if (span <= 1e-6) return 0;
    const t = (z - zFloor) / span;
    return -rimLowering * smoothstep01(t);
}

export function mergeSinkWarnings(...groups: Array<SinkWarning[] | undefined>): SinkWarning[] {
    const out: SinkWarning[] = [];
    const seen = new Set<string>();
    for (const group of groups) {
        if (!group) continue;
        for (const w of group) {
            const key = `${w.code}|${w.sinkId}|${w.message}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(w);
        }
    }
    return out;
}

function elementCenterV(el: PlacedElement, ctx: SinkSurfaceContext): { u: number; vSigned: number } | null {
    if (el.side !== ctx.side) return null;
    const u = (ctx.lengthMm / 2 + el.position.x) / ctx.lengthMm;
    const half = localHalfWidthMm(u, ctx);
    if (half < 1e-6) return null;
    // Element y matches parametric mesh y (vSigned * local half).
    const vSigned = el.position.y / half;
    return { u, vSigned };
}

export function sinkOverlapWarnings(
    ctx: SinkSurfaceContext,
    elements?: PlacedElement[] | null,
    text?: TextMarking | null,
): SinkWarning[] {
    if (!sinksActive(ctx.sinks)) return [];
    const out: SinkWarning[] = [];
    for (const el of elements ?? []) {
        const at = elementCenterV(el, ctx);
        if (!at) continue;
        const cut = sinkCutAt(at.u, at.vSigned, ctx);
        if (cut.weight <= 0) continue;
        out.push({
            sinkId: cut.sinkId ?? "sink",
            code: "element-overlap",
            message: `sink overlaps element ${el.id}`,
        });
    }
    if (text && text.text.trim()) {
        const u = Math.max(0, Math.min(1, text.placementU + text.nudgeAlongMm / Math.max(ctx.lengthMm, 1)));
        let v = 0.5;
        if (text.surface === "wall") v = 0.98;
        else if (text.surface === "medial") v = 0.02;
        else v = 0.5 + text.nudgeAcrossMm / Math.max(ctx.widthMm, 1);
        const cut = sinkCutAt(u, vSignedFromSpecV(v, ctx.side), ctx);
        if (cut.weight > 0) {
            out.push({
                sinkId: cut.sinkId ?? "sink",
                code: "text-overlap",
                message: `Text overlaps sink ${cut.sinkId ?? ""}`,
            });
        }
    }
    return out;
}

export interface SinkMeshCutResult {
    warnings: SinkWarning[];
}

/**
 * Subtract S from top-sheet vertices. XY is unchanged. Bottom vertices (factor < 0.5) stay put.
 * Missing factors treat every vertex as top (open top sheet).
 */
export function applySinkCutToGeometry(
    geometry: BufferGeometry,
    reference: BufferGeometry,
    ctx: SinkSurfaceContext,
    frame?: {
        lengthAxis: 0 | 1 | 2;
        widthAxis: 0 | 1 | 2;
        thickAxis: 0 | 1 | 2;
        lenMin: number;
        lenSize: number;
        widCenter: number;
        widSize: number;
        widthSign: number;
    },
    topFactors?: Float32Array | null,
): SinkMeshCutResult {
    if (!sinksActive(ctx.sinks)) return { warnings: [] };
    const pos = geometry.getAttribute("position") as BufferAttribute | undefined;
    const ref = reference.getAttribute("position");
    if (!pos || !ref) return { warnings: [] };
    const arr = pos.array as Float32Array;
    const base = ref.array as Float32Array;
    const lengthAxis = frame?.lengthAxis ?? 0;
    const widthAxis = frame?.widthAxis ?? 1;
    const thickAxis = frame?.thickAxis ?? 2;
    const lenMin = frame?.lenMin ?? 0;
    const lenSize = frame?.lenSize || ctx.lengthMm || 1;
    const widCenter = frame?.widCenter ?? 0;
    const widSize = frame?.widSize || ctx.widthMm || 1;
    const widthSign = frame?.widthSign ?? 1;
    const cutCtx = sinkContextForMesh(ctx, base, pos.count, lengthAxis, widthAxis);
    const useMesh = !!cutCtx.footOutline && cutCtx.footOutline.length >= 6;
    const warnings: SinkWarning[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < pos.count; i++) {
        if (topFactors && topFactors[i]! < 0.5) continue;
        const lenCoord = base[i * 3 + lengthAxis]!;
        const widCoord = base[i * 3 + widthAxis]!;
        const sample = useMesh
            ? sinkCutMm(lenCoord, meshYToAnatomical(widCoord, ctx.side, cutCtx.medialYSign), cutCtx)
            : sinkCutAt(
                  Math.max(0, Math.min(1, (lenCoord - lenMin) / lenSize)),
                  Math.max(-1, Math.min(1, (widthSign * (widCoord - widCenter)) / (widSize / 2))),
                  ctx,
              );
        if (sample.mm <= 0) continue;
        const z = arr[i * 3 + thickAxis]!;
        const guarded = applyFloorGuard(z, sample.mm, sample.sinkId);
        if (guarded.warning && !seen.has(guarded.warning.sinkId)) {
            seen.add(guarded.warning.sinkId);
            warnings.push(guarded.warning);
        }
        arr[i * 3 + thickAxis] = z - guarded.cutMm;
    }
    pos.needsUpdate = true;
    const merged = mergeSinkWarnings(sinkDepthWarnings(ctx.sinks), sinkRimWarnings(ctx), warnings);
    (geometry.userData as { sinkWarnings?: SinkWarning[] }).sinkWarnings = merged;
    return { warnings: merged };
}

/** Add T to top vertices. No-op (no writes) when sinks are absent. */
export function applySinkThicknessToGeometry(
    geometry: BufferGeometry,
    _reference: BufferGeometry,
    ctx: SinkSurfaceContext,
    frame?: {
        lengthAxis: 0 | 1 | 2;
        widthAxis: 0 | 1 | 2;
        thickAxis: 0 | 1 | 2;
        lenMin: number;
        lenSize: number;
        widCenter: number;
        widSize: number;
        widthSign: number;
    },
    topFactors?: Float32Array | null,
): void {
    if (!sinksActive(ctx.sinks)) return;
    const pos = geometry.getAttribute("position") as BufferAttribute | undefined;
    if (!pos) return;
    const arr = pos.array as Float32Array;
    const lengthAxis = frame?.lengthAxis ?? 0;
    const widthAxis = frame?.widthAxis ?? 1;
    const thickAxis = frame?.thickAxis ?? 2;
    const lenMin = frame?.lenMin ?? 0;
    const lenSize = frame?.lenSize || ctx.lengthMm || 1;
    const widCenter = frame?.widCenter ?? 0;
    const widSize = frame?.widSize || ctx.widthMm || 1;
    const widthSign = frame?.widthSign ?? 1;
    const topCount = (geometry.userData as { topVertexCount?: number }).topVertexCount;
    const limit = topCount && topCount > 0 ? topCount : pos.count;
    const thickCtx = sinkContextForMesh(ctx, arr, limit, lengthAxis, widthAxis);
    const useMesh = !!thickCtx.footOutline && thickCtx.footOutline.length >= 6;
    for (let i = 0; i < limit; i++) {
        if (topFactors && !(topCount && topCount > 0) && topFactors[i]! < 0.5) continue;
        const lenCoord = arr[i * 3 + lengthAxis]!;
        const widCoord = arr[i * 3 + widthAxis]!;
        const t = useMesh
            ? sinkThicknessMm(lenCoord, meshYToAnatomical(widCoord, ctx.side, thickCtx.medialYSign), thickCtx)
            : sinkThicknessAt(
                  Math.max(0, Math.min(1, (lenCoord - lenMin) / lenSize)),
                  Math.max(-1, Math.min(1, (widthSign * (widCoord - widCenter)) / (widSize / 2))),
                  ctx,
              );
        if (t !== 0) arr[i * 3 + thickAxis] = arr[i * 3 + thickAxis]! + t;
    }
    pos.needsUpdate = true;
}

/**
 * Procedural top sheet (x length, y width, z up). XY unchanged.
 * vSigned is the bbox fraction used by the wall modifiers, mapped through the
 * same side convention as heightAt.
 */
export function applySinkCutToProceduralPositions(
    pos: Float32Array,
    bounds: { minX: number; maxX: number; minY: number; maxY: number },
    ctx: SinkSurfaceContext,
    medialYSign: 1 | -1,
): SinkWarning[] {
    if (!sinksActive(ctx.sinks)) return [];
    const length = Math.max(1e-3, bounds.maxX - bounds.minX);
    const width = Math.max(1e-3, bounds.maxY - bounds.minY);
    const meshCtx: SinkSurfaceContext = { ...ctx, lengthMm: length, widthMm: width };
    const widCenter = (bounds.minY + bounds.maxY) * 0.5;
    const halfW = width / 2;
    const warnings: SinkWarning[] = [];
    const seen = new Set<string>();
    const count = pos.length / 3;
    for (let i = 0; i < count; i++) {
        const x = pos[i * 3]!;
        const y = pos[i * 3 + 1]!;
        const u = Math.max(0, Math.min(1, (x - bounds.minX) / length));
        const mMesh = (y - widCenter) / halfW;
        const m = mMesh * medialYSign;
        const vSigned = Math.max(-1, Math.min(1, -m * medialSign(ctx.side)));
        const sample = sinkCutAt(u, vSigned, meshCtx);
        if (sample.mm <= 0) continue;
        const z = pos[i * 3 + 2]!;
        const guarded = applyFloorGuard(z, sample.mm, sample.sinkId);
        if (guarded.warning && !seen.has(guarded.warning.sinkId)) {
            seen.add(guarded.warning.sinkId);
            warnings.push(guarded.warning);
        }
        pos[i * 3 + 2] = z - guarded.cutMm;
    }
    return mergeSinkWarnings(sinkDepthWarnings(ctx.sinks), sinkRimWarnings(ctx), warnings);
}

export interface StyloidWallReliefInput {
    positions: number[];
    nS: number;
    nJ: number;
    vertAt: (row: number, station: number) => number;
    rimZ: (station: number) => number;
    rimXY: (station: number) => { x: number; y: number };
    bounds: { minX: number; maxX: number; minY: number; maxY: number };
    medialYSign: 1 | -1;
    side: Side;
    sinks?: PlacedSink[];
    sinkStyloidThicken?: boolean;
    /** Rim z is already the post-cut height, so the original crest is rimZ + R. */
    rimAlreadyLowered: boolean;
}

const INBOARD_MIN_MM = 1.5;
const INBOARD_MAX_MM = 40;
/** Vertices this close to the crest are the rim shoulder, not the local footbed. */
const RIM_SHOULDER_MM = 2;

/** Nearest inboard top-sheet vertex that sits on the footbed, not the rim flare. */
function sampleInboardFootbed(
    positions: number[],
    rimX: number,
    rimY: number,
    rimZ: number,
    centerY: number,
    searchCount: number,
): { x: number; y: number; z: number } | null {
    const toward = centerY - rimY;
    if (Math.abs(toward) < 1e-6) return null;
    const min2 = INBOARD_MIN_MM * INBOARD_MIN_MM;
    const max2 = INBOARD_MAX_MM * INBOARD_MAX_MM;
    const n = Math.min(searchCount, Math.floor(positions.length / 3));
    let bestFoot = max2;
    let bestAny = max2;
    let foot: { x: number; y: number; z: number } | null = null;
    let any: { x: number; y: number; z: number } | null = null;
    for (let i = 0; i < n; i++) {
        const x = positions[i * 3]!;
        const y = positions[i * 3 + 1]!;
        const dy = y - rimY;
        if (dy * toward <= 0) continue;
        const dx = x - rimX;
        const d2 = dx * dx + dy * dy;
        if (d2 < min2 || d2 >= max2) continue;
        const z = positions[i * 3 + 2]!;
        if (d2 < bestAny) {
            bestAny = d2;
            any = { x, y, z };
        }
        if (z > rimZ - RIM_SHOULDER_MM) continue;
        if (d2 < bestFoot) {
            bestFoot = d2;
            foot = { x, y, z };
        }
    }
    return foot ?? any;
}

/**
 * Footbed under the wall after T−S. The crest must stay LATERAL_WALL_MIN_MM
 * above this, not above z=0. Returns 0 only when the sheet has no inboard sample.
 */
function localTopSurfaceZ(
    positions: number[],
    searchCount: number,
    rimX: number,
    rimY: number,
    rimZ: number,
    centerY: number,
    bounds: { minX: number; maxX: number; minY: number; maxY: number },
    medialYSign: 1 | -1,
    side: Side,
    ctx: SinkSurfaceContext,
    alreadyDisplaced: boolean,
): number {
    const foot = sampleInboardFootbed(positions, rimX, rimY, rimZ, centerY, searchCount);
    if (!foot) return 0;
    if (alreadyDisplaced) return foot.z;
    const length = Math.max(1e-3, bounds.maxX - bounds.minX);
    const width = Math.max(1e-3, bounds.maxY - bounds.minY);
    const u = Math.max(0, Math.min(1, (foot.x - bounds.minX) / length));
    const mMesh = (foot.y - centerY) / (width / 2);
    const vSigned = Math.max(-1, Math.min(1, -mMesh * medialYSign * medialSign(side)));
    const outlined = !!ctx.footOutline && ctx.footOutline.length >= 6;
    const t = outlined
        ? sinkThicknessMm(foot.x, meshYToAnatomical(foot.y, side, ctx.medialYSign), ctx)
        : sinkThicknessAt(u, vSigned, ctx);
    const cut = outlined
        ? sinkCutMm(foot.x, meshYToAnatomical(foot.y, side, ctx.medialYSign), ctx)
        : sinkCutAt(u, vSigned, ctx);
    const guarded = applyFloorGuard(foot.z + t, cut.mm, cut.sinkId);
    return foot.z + t - guarded.cutMm;
}

/** Lateral-wall z notch for the styloid. XY is not written. No-op without a styloid sink. */
export function applyStyloidWallRelief(input: StyloidWallReliefInput): SinkWarning[] {
    if (!sinksActive(input.sinks)) return [];
    const styloid = input.sinks!.find((s) => s.kind === "styloid");
    if (!styloid) return [];
    const depth = clampSinkDepth("styloid", styloid.depthMm).depthMm;
    if (depth <= 0) return [];
    const length = Math.max(1e-3, input.bounds.maxX - input.bounds.minX);
    const width = Math.max(1e-3, input.bounds.maxY - input.bounds.minY);
    const ctx: SinkSurfaceContext = {
        side: input.side,
        lengthMm: length,
        widthMm: width,
        sinks: input.sinks,
        sinkStyloidThicken: input.sinkStyloidThicken,
    };
    const widCenter = (input.bounds.minY + input.bounds.maxY) * 0.5;
    const halfW = width / 2;
    const warnings: SinkWarning[] = [];
    let warned = false;
    const touched = new Set<number>();
    for (let s = 0; s < input.nS; s++) {
        const rim = input.rimXY(s);
        const u = Math.max(0, Math.min(1, (rim.x - input.bounds.minX) / length));
        const mMesh = (rim.y - widCenter) / halfW;
        const m = mMesh * input.medialYSign;
        const vSigned = Math.max(-1, Math.min(1, -m * medialSign(input.side)));
        const v = specVFromVSigned(vSigned, input.side);
        if (v < 0.5) continue;
        const sample = sinkCutAt(u, vSigned, ctx);
        if (sample.mm <= 1e-6) continue;
        const rimNow = input.rimZ(s);
        const H = input.rimAlreadyLowered ? rimNow + sample.mm : rimNow;
        const localTop = localTopSurfaceZ(
            input.positions,
            input.positions.length / 3,
            rim.x,
            rim.y,
            H,
            widCenter,
            input.bounds,
            input.medialYSign,
            input.side,
            ctx,
            input.rimAlreadyLowered,
        );
        const guard = guardedRimLowering(H, sample.mm, localTop);
        if (guard.warning && !warned) {
            warned = true;
            warnings.push({
                sinkId: styloid.id,
                code: "lateral-wall",
                message: `Styloid wall relief reduced so the lateral wall stays >= ${LATERAL_WALL_MIN_MM.toFixed(1)} mm`,
            });
        }
        const R = guard.lowering;
        if (R <= 1e-6) continue;
        for (let row = 0; row < input.nJ; row++) {
            if (row === 0) continue;
            const vi = input.vertAt(row, s);
            if (touched.has(vi)) continue;
            const z = input.positions[vi * 3 + 2]!;
            if (z <= 1e-4) continue;
            touched.add(vi);
            const zPre = input.rimAlreadyLowered && rimNow > 1e-3 ? (z / rimNow) * H : z;
            const dz = styloidWallReliefAt(zPre, H, depth, R);
            const zWant = input.rimAlreadyLowered ? zPre + dz : z + dz;
            input.positions[vi * 3 + 2] = zWant;
        }
    }
    return warnings;
}

export interface AnalyticSinkLoftInput {
    positions: number[];
    /** Vertex count of the top sheet copied in before the wall rows. */
    topCount: number;
    nS: number;
    nJ: number;
    vertAt: (row: number, station: number) => number;
    bounds: { minX: number; maxX: number; minY: number; maxY: number };
    medialYSign: 1 | -1;
    side: Side;
    sinks?: PlacedSink[];
    sinkStyloidThicken?: boolean;
}

/**
 * A guarded crest stays above the cut. Raise the inboard top, not the crest,
 * so that step is a ramp instead of a lip. Rim stations are left alone.
 */
function raiseInboardOfGuardedRim(
    input: AnalyticSinkLoftInput,
    rimStation: Map<number, number>,
    rimCut: Float64Array,
    rimR: Float64Array,
): void {
    const slope = Math.tan((RIM_LIP_MAX_DEG * Math.PI) / 180);
    const reach2 = RIM_LIP_REACH_MM * RIM_LIP_REACH_MM;
    const lips: Array<{ x: number; y: number; z: number }> = [];
    for (let s = 0; s < input.nS; s++) {
        if (rimR[s]! + 0.05 >= rimCut[s]!) continue;
        const vi = input.vertAt(0, s);
        lips.push({
            x: input.positions[vi * 3]!,
            y: input.positions[vi * 3 + 1]!,
            z: input.positions[vi * 3 + 2]!,
        });
    }
    if (!lips.length) return;
    const topCount = Math.min(input.topCount, input.positions.length / 3);
    for (let i = 0; i < topCount; i++) {
        if (rimStation.has(i)) continue;
        const x = input.positions[i * 3]!;
        const y = input.positions[i * 3 + 1]!;
        const z = input.positions[i * 3 + 2]!;
        let floor = z;
        let nearest = Number.POSITIVE_INFINITY;
        let nearestZ = z;
        for (const lip of lips) {
            const dx = x - lip.x;
            const dy = y - lip.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > reach2) continue;
            const dist = Math.sqrt(d2);
            if (dist < nearest) {
                nearest = dist;
                nearestZ = lip.z;
            }
            const allowed = lip.z - dist * slope;
            if (allowed > floor) floor = allowed;
        }
        if (floor > nearestZ) floor = nearestZ;
        if (floor > z) input.positions[i * 3 + 2] = floor;
    }
}

/**
 * T, then S, then a vertical wall stretch and styloid notch.
 * The loft has already been built from the unsunk rim, so only z is written.
 */
export function applyAnalyticSinkToLoftedSolid(input: AnalyticSinkLoftInput): SinkWarning[] {
    if (!sinksActive(input.sinks)) return [];
    const length = Math.max(1e-3, input.bounds.maxX - input.bounds.minX);
    const width = Math.max(1e-3, input.bounds.maxY - input.bounds.minY);
    const topCount = Math.min(input.topCount, input.positions.length / 3);
    const ctx: SinkSurfaceContext = sinkContextForMesh(
        {
            side: input.side,
            lengthMm: length,
            widthMm: width,
            sinks: input.sinks,
            sinkStyloidThicken: input.sinkStyloidThicken,
            medialYSign: input.medialYSign,
        },
        input.positions,
        topCount,
        0,
        1,
    );
    const widCenter = (input.bounds.minY + input.bounds.maxY) * 0.5;
    const halfW = width / 2;
    const useMesh = !!ctx.footOutline && ctx.footOutline.length >= 6;
    const sampleAt = (x: number, y: number): { t: number; cut: SinkCutSample } => {
        if (useMesh) {
            const yAnat = meshYToAnatomical(y, input.side, input.medialYSign);
            return { t: sinkThicknessMm(x, yAnat, ctx), cut: sinkCutMm(x, yAnat, ctx) };
        }
        const u = Math.max(0, Math.min(1, (x - input.bounds.minX) / length));
        const mMesh = (y - widCenter) / halfW;
        const vSigned = Math.max(-1, Math.min(1, -(mMesh * input.medialYSign) * medialSign(input.side)));
        return { t: sinkThicknessAt(u, vSigned, ctx), cut: sinkCutAt(u, vSigned, ctx) };
    };
    const rimH = new Float64Array(input.nS);
    const rimT = new Float64Array(input.nS);
    const rimR = new Float64Array(input.nS);
    const rimCut = new Float64Array(input.nS);
    const rimXY: Array<{ x: number; y: number; z: number }> = [];
    for (let s = 0; s < input.nS; s++) {
        const vi = input.vertAt(0, s);
        rimXY.push({
            x: input.positions[vi * 3]!,
            y: input.positions[vi * 3 + 1]!,
            z: input.positions[vi * 3 + 2]!,
        });
    }
    const hold2 = LOFT_RIM_HOLD_MM * LOFT_RIM_HOLD_MM;
    const nearRim = (x: number, y: number, z: number): boolean => {
        for (const p of rimXY) {
            const dx = x - p.x;
            const dy = y - p.y;
            const dz = z - p.z;
            if (dx * dx + dy * dy + dz * dz <= hold2) return true;
        }
        return false;
    };
    // A sub-0.05 mm tail on the shared top/wall edge self-intersects. Real
    // thickness is kept so the shell wall is not sheared off the outline.
    const loftThickness = (x: number, y: number, z: number): number => {
        const raw = sampleAt(x, y).t;
        if (raw >= 0.05) return raw;
        if (raw <= 0 || nearRim(x, y, z)) return 0;
        return raw;
    };
    for (let s = 0; s < input.nS; s++) {
        const vi = input.vertAt(0, s);
        const x = input.positions[vi * 3]!;
        const y = input.positions[vi * 3 + 1]!;
        rimH[s] = input.positions[vi * 3 + 2]!;
        rimT[s] = loftThickness(x, y, rimH[s]!);
        const cut = sampleAt(x, y).cut;
        const floor = applyFloorGuard(rimH[s]! + rimT[s]!, cut.mm, cut.sinkId);
        const localTop = localTopSurfaceZ(
            input.positions,
            topCount,
            x,
            y,
            rimH[s]!,
            widCenter,
            input.bounds,
            input.medialYSign,
            input.side,
            ctx,
            false,
        );
        const lowering = guardedRimLowering(rimH[s]! + rimT[s]!, floor.cutMm, localTop).lowering;
        rimR[s] = lowering;
        rimCut[s] = floor.cutMm;
    }
    const warnings: SinkWarning[] = [];
    const seen = new Set<string>();
    const rimStation = new Map<number, number>();
    for (let s = 0; s < input.nS; s++) rimStation.set(input.vertAt(0, s), s);
    for (let i = 0; i < topCount; i++) {
        const x = input.positions[i * 3]!;
        const y = input.positions[i * 3 + 1]!;
        const z0 = input.positions[i * 3 + 2]!;
        const sampled = sampleAt(x, y);
        const t = loftThickness(x, y, z0);
        const cut = sampled.cut;
        const z = input.positions[i * 3 + 2]! + t;
        const guarded = applyFloorGuard(z, cut.mm, cut.sinkId);
        if (guarded.warning && !seen.has(guarded.warning.sinkId)) {
            seen.add(guarded.warning.sinkId);
            warnings.push(guarded.warning);
        }
        const station = rimStation.get(i);
        if (station !== undefined) {
            input.positions[i * 3 + 2] = rimH[station]! + rimT[station]! - rimR[station]!;
            continue;
        }
        if (t !== 0 || guarded.cutMm !== 0) input.positions[i * 3 + 2] = Math.max(0, z - guarded.cutMm);
    }
    raiseInboardOfGuardedRim(input, rimStation, rimCut, rimR);
    const styloid = input.sinks!.find((s) => s.kind === "styloid");
    const depth = styloid ? clampSinkDepth("styloid", styloid.depthMm).depthMm : 0;
    const touched = new Set<number>();
    for (let s = 0; s < input.nS; s++) {
        const T = rimT[s]!;
        const R = rimR[s]!;
        if (T <= 1e-8 && R <= 1e-8) continue;
        const H = rimH[s]!;
        const crest = H + T;
        for (let row = 1; row < input.nJ; row++) {
            const vi = input.vertAt(row, s);
            if (vi < topCount || touched.has(vi)) continue;
            const z = input.positions[vi * 3 + 2]!;
            if (z <= 1e-4) continue;
            touched.add(vi);
            const zS = H > 1e-3 ? (z / H) * crest : z;
            const dz = depth > 0 && R > 1e-8 ? styloidWallReliefAt(zS, crest, depth, R) : 0;
            input.positions[vi * 3 + 2] = Math.max(0, zS + dz);
        }
    }
    return mergeSinkWarnings(sinkDepthWarnings(input.sinks), sinkRimWarnings(ctx), warnings);
}
