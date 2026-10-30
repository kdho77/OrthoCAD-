// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import type { BufferAttribute, BufferGeometry } from "three";
import { INSOLE_LENGTH_MM, INSOLE_WIDTH_MM } from "@/lib/geometry/layout";
import { effectiveOutlineHalfWidth, type TrimlineCurve } from "@/lib/geometry/trimline";
import type { PlacedElement, PlacedSink, Side, SinkKind, SinkMarkerRef, TextMarking } from "@/types";

/**
 * Elements > Sink. Two top-sheet terms, never a boolean and never the bottom:
 * forefoot thickness T (additive) then sink cut S (subtractive, applied last).
 * Empty / undefined sinks return before any work so exports stay byte-identical.
 *
 * Picked constants (Kendon brief v1) — change them here.
 */

/** Men's 9 reference length. Oval length scales by L / this. Depth and blend do not. */
export const SINK_REFERENCE_LENGTH_MM = INSOLE_LENGTH_MM;
/** Men's 9 reference width. Local width is compared with the M9 outline at the same u. */
export const SINK_REFERENCE_WIDTH_MM = INSOLE_WIDTH_MM;

export const SINK_DEFAULT_DEPTH_MM = 2;
/** Added on top of the deepest forefoot sink. Floor under that sink = current + this. */
export const FOREFOOT_THICKNESS_CLEARANCE_MM = 0.5;
/** Smootherstep length of the forefoot thickness ramp. */
export const BLEND_LEN_MM = 25;
/** Proximal margin between the oval+blend tip and full forefoot thickness. */
export const THICKNESS_PROXIMAL_MARGIN_MM = 5;
/** Styloid thickness blend, wider than the cut so the floor rises smoothly. */
export const STYLOID_EXT_BLEND_MM = 15;
/** Wall notch fades this far below the styloid floor. */
export const STYLOID_WALL_FADE_BELOW_FLOOR_MM = 4;
/** Minimum remaining top thickness after T − S. */
export const FLOOR_MIN_MM = 2.0;
/** Lateral wall crest must stay at least this far above the local top. */
export const LATERAL_WALL_MIN_MM = 3.0;
/** 5th MPJ cut fades out before the lateral rim. */
export const MPJ5_V_FADE_START = 0.88;
export const MPJ5_V_FADE_END = 0.95;
/** 1st MPJ cut fades out before the medial rim. Mirror of the 5th-MPJ band. */
export const MPJ1_V_FADE_START = 0.12;
export const MPJ1_V_FADE_END = 0.05;
/**
 * Where the wall guard holds the crest above the cut, the inboard top
 * cannot fall steeper than this. A vertex is never lifted above the
 * nearest guarded crest, so a tall neighbour cannot build a new ridge.
 */
export const RIM_LIP_MAX_DEG = 30;
const RIM_LIP_REACH_MM = 15;
export const MPJ1_PROXIMAL_SHIFT_MM = 3;
export const MPJ5_LATERAL_SHIFT_MM = 2;
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
    /** Deepest point shift toward the heel, mm. Not scaled. */
    deepestProximalMm: number;
    /** Deepest point shift toward lateral, mm. Not scaled. */
    deepestLateralMm: number;
    /** Long axis follows the lateral rim (5th met). */
    alongLateralRim: boolean;
    /** Keep the cut off the lateral wall. */
    lateralWallFade: boolean;
    /** Keep the cut off the medial wall. */
    medialWallFade: boolean;
    forefoot: boolean;
}

export const SINK_KIND_ORDER: readonly SinkKind[] = ["mpj1", "mpj2", "mpj3", "mpj4", "mpj5", "styloid"];

export const SINK_PROFILES: Record<SinkKind, SinkProfile> = {
    mpj1: {
        kind: "mpj1",
        label: "1st MPJ",
        u: 0.71,
        v: 0.15,
        lengthMm: 22,
        widthMm: 20,
        blendMm: 8,
        defaultDepthMm: SINK_DEFAULT_DEPTH_MM,
        maxDepthMm: 4,
        deepestProximalMm: MPJ1_PROXIMAL_SHIFT_MM,
        deepestLateralMm: 0,
        alongLateralRim: false,
        lateralWallFade: false,
        medialWallFade: true,
        forefoot: true,
    },
    mpj2: {
        kind: "mpj2",
        label: "2nd MPJ",
        u: 0.73,
        v: 0.32,
        lengthMm: 16,
        widthMm: 14,
        blendMm: 6,
        defaultDepthMm: SINK_DEFAULT_DEPTH_MM,
        maxDepthMm: 3,
        deepestProximalMm: 0,
        deepestLateralMm: 0,
        alongLateralRim: false,
        lateralWallFade: false,
        medialWallFade: false,
        forefoot: true,
    },
    mpj3: {
        kind: "mpj3",
        label: "3rd MPJ",
        u: 0.71,
        v: 0.47,
        lengthMm: 16,
        widthMm: 14,
        blendMm: 6,
        defaultDepthMm: SINK_DEFAULT_DEPTH_MM,
        maxDepthMm: 3,
        deepestProximalMm: 0,
        deepestLateralMm: 0,
        alongLateralRim: false,
        lateralWallFade: false,
        medialWallFade: false,
        forefoot: true,
    },
    mpj4: {
        kind: "mpj4",
        label: "4th MPJ",
        u: 0.68,
        v: 0.63,
        lengthMm: 16,
        widthMm: 14,
        blendMm: 6,
        defaultDepthMm: SINK_DEFAULT_DEPTH_MM,
        maxDepthMm: 3,
        deepestProximalMm: 0,
        deepestLateralMm: 0,
        alongLateralRim: false,
        lateralWallFade: false,
        medialWallFade: false,
        forefoot: true,
    },
    mpj5: {
        kind: "mpj5",
        label: "5th MPJ",
        u: 0.64,
        v: 0.82,
        lengthMm: 18,
        widthMm: 16,
        blendMm: 6,
        defaultDepthMm: SINK_DEFAULT_DEPTH_MM,
        maxDepthMm: 4,
        deepestProximalMm: 0,
        deepestLateralMm: MPJ5_LATERAL_SHIFT_MM,
        alongLateralRim: false,
        lateralWallFade: true,
        medialWallFade: false,
        forefoot: true,
    },
    styloid: {
        kind: "styloid",
        label: "5th Met Base (Styloid)",
        u: 0.42,
        v: 0.95,
        lengthMm: 20,
        widthMm: 14,
        blendMm: 8,
        defaultDepthMm: SINK_DEFAULT_DEPTH_MM,
        maxDepthMm: 3,
        deepestProximalMm: 0,
        deepestLateralMm: 0,
        alongLateralRim: true,
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
    styloid: SINK_PROFILES.styloid.label,
};

export interface SinkSurfaceContext {
    side: Side;
    lengthMm: number;
    widthMm: number;
    trimline?: TrimlineCurve | null;
    sinks?: PlacedSink[];
    /** Default false. Forefoot thickness only, unless this and a styloid sink are set. */
    sinkStyloidThicken?: boolean;
    sinkMarkers?: SinkMarkerRef[];
}

export interface SinkWarning {
    sinkId: string;
    code: "depth-max" | "floor" | "lateral-wall" | "element-overlap" | "text-overlap";
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
    const medialSign = side === "left" ? -1 : 1;
    const m = -(vSigned * medialSign);
    return (1 - m) / 2;
}

/** Height-field vSigned of a spec v. ±1 lies on the local outline. */
export function vSignedFromSpecV(v: number, side: Side): number {
    const medialSign = side === "left" ? -1 : 1;
    return medialSign * (2 * v - 1);
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
    /** Half-axes of the egg measured from the shifted deepest point. */
    aProx: number;
    aDist: number;
    bMed: number;
    bLat: number;
    /** Deepest point, mm, anatomical. */
    dx: number;
    dy: number;
}

function outlineTangent(u: number, lateral: boolean, ctx: SinkSurfaceContext): { tx: number; ty: number } {
    const du = 1 / Math.max(ctx.lengthMm, 1);
    const u0 = Math.max(0, u - du);
    const u1 = Math.min(1, u + du);
    const y0 = (lateral ? 1 : -1) * localHalfWidthMm(u0, ctx);
    const y1 = (lateral ? 1 : -1) * localHalfWidthMm(u1, ctx);
    let tx = (u1 - u0) * ctx.lengthMm;
    let ty = y1 - y0;
    if (tx < 0) {
        tx = -tx;
        ty = -ty;
    }
    const len = Math.hypot(tx, ty) || 1;
    return { tx: tx / len, ty: ty / len };
}

function acrossFromTangent(tx: number, ty: number): { nx: number; ny: number } {
    // Rotate +distal 90° so the across axis points +lateral (roughly +y).
    let nx = -ty;
    let ny = tx;
    if (ny < 0) {
        nx = -nx;
        ny = -ny;
    }
    const len = Math.hypot(nx, ny) || 1;
    return { nx: nx / len, ny: ny / len };
}

export function sinkFrame(sink: PlacedSink, ctx: SinkSurfaceContext): SinkOvalFrame | null {
    const profile = SINK_PROFILES[sink.kind];
    if (!profile) return null;
    const clamped = clampSinkDepth(sink.kind, sink.depthMm);
    const uv = resolveUV(sink, ctx.sinkMarkers);
    const lengthScale = ctx.lengthMm / SINK_REFERENCE_LENGTH_MM;
    const localW = localHalfWidthMm(uv.u, ctx) * 2;
    const refW = Math.max(1e-6, referenceWidthAtU(uv.u));
    const widthScale = localW / refW;
    const halfLengthMm = (profile.lengthMm / 2) * lengthScale;
    const halfWidthMm = (profile.widthMm / 2) * widthScale;
    const lateralRim = profile.alongLateralRim || uv.v >= 0.5;
    const tangent = outlineTangent(uv.u, lateralRim, ctx);
    const across = acrossFromTangent(tangent.tx, tangent.ty);
    const half = localHalfWidthMm(uv.u, ctx);
    const cx = uv.u * ctx.lengthMm;
    const cy = (2 * uv.v - 1) * half;
    const prox = Math.min(profile.deepestProximalMm, halfLengthMm * 0.49);
    const lat = Math.min(profile.deepestLateralMm, halfWidthMm * 0.49);
    // Outer boundary stays put: the deep point slides, the far half-axis grows.
    const aProx = Math.max(0.5, halfLengthMm - prox);
    const aDist = halfLengthMm + prox;
    const bLat = Math.max(0.5, halfWidthMm - lat);
    const bMed = halfWidthMm + lat;
    const dx = cx - tangent.tx * prox + across.nx * lat;
    const dy = cy - tangent.ty * prox + across.ny * lat;
    return {
        kind: sink.kind,
        sinkId: sink.id,
        u: uv.u,
        v: uv.v,
        cx,
        cy,
        tx: tangent.tx,
        ty: tangent.ty,
        nx: across.nx,
        ny: across.ny,
        halfLengthMm,
        halfWidthMm,
        blendMm: profile.blendMm,
        depthMm: clamped.depthMm,
        aboveMax: clamped.aboveMax,
        forefoot: profile.forefoot,
        lateralWallFade: profile.lateralWallFade,
        medialWallFade: profile.medialWallFade,
        aProx,
        aDist,
        bMed,
        bLat,
        dx,
        dy,
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
    return 1 - smoothstep01(dist / blendMm);
}

function pointMm(u: number, vSigned: number, ctx: SinkSurfaceContext): { x: number; y: number; v: number } {
    const v = specVFromVSigned(vSigned, ctx.side);
    const half = localHalfWidthMm(u, ctx);
    return { x: u * ctx.lengthMm, y: (2 * v - 1) * half, v };
}

interface PreparedSink {
    frame: SinkOvalFrame;
    /** Forefoot thickness uses the oval extended by this blend (styloid switch). */
    extBlendMm: number;
}

function prepare(ctx: SinkSurfaceContext): PreparedSink[] {
    if (!sinksActive(ctx.sinks)) return [];
    const out: PreparedSink[] = [];
    for (const sink of ctx.sinks!) {
        const frame = sinkFrame(sink, ctx);
        if (!frame || frame.depthMm <= 0) continue;
        out.push({ frame, extBlendMm: frame.kind === "styloid" ? STYLOID_EXT_BLEND_MM : frame.blendMm });
    }
    return out;
}

function proximalTipX(frame: SinkOvalFrame): number {
    const reach = frame.halfLengthMm + frame.blendMm;
    return frame.cx - frame.tx * reach;
}

export interface ForefootThicknessPlan {
    /** max(forefoot depth) + 0.5 mm. 0 when there is no forefoot sink. */
    A: number;
    /** Full thickness from this heel-origin x (mm). */
    xFull: number;
    /** Ramp starts here. T = 0 for x <= x0. */
    x0: number;
}

export function forefootThicknessPlan(ctx: SinkSurfaceContext): ForefootThicknessPlan | null {
    const prepared = prepare(ctx).filter((p) => p.frame.forefoot);
    if (!prepared.length) return null;
    let A = 0;
    let tip = Number.POSITIVE_INFINITY;
    for (const p of prepared) {
        A = Math.max(A, p.frame.depthMm + FOREFOOT_THICKNESS_CLEARANCE_MM);
        tip = Math.min(tip, proximalTipX(p.frame));
    }
    const xFull = tip - THICKNESS_PROXIMAL_MARGIN_MM;
    return { A, xFull, x0: xFull - BLEND_LEN_MM };
}

/** Forefoot (and optional styloid) thickness addition at a height-field sample. 0 when no sinks. */
export function sinkThicknessAt(u: number, vSigned: number, ctx: SinkSurfaceContext): number {
    if (!sinksActive(ctx.sinks)) return 0;
    const plan = forefootThicknessPlan(ctx);
    const pt = pointMm(u, vSigned, ctx);
    let t = 0;
    if (plan && plan.A > 0) {
        const span = BLEND_LEN_MM;
        t = plan.A * smootherstep01((pt.x - plan.x0) / span);
    }
    if (ctx.sinkStyloidThicken) {
        for (const p of prepare(ctx)) {
            if (p.frame.kind !== "styloid") continue;
            const w = eggWeight(p.frame, pt.x, pt.y, STYLOID_EXT_BLEND_MM);
            const local = (p.frame.depthMm + FOREFOOT_THICKNESS_CLEARANCE_MM) * w;
            if (local > t) t = local;
        }
    }
    return t;
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
    const u = x / Math.max(ctx.lengthMm, 1e-6);
    const v =
        vKnown ??
        (() => {
            const half = localHalfWidthMm(u, ctx);
            return half > 1e-6 ? (yLateral / half + 1) / 2 : 0.5;
        })();
    let best = 0;
    let sinkId: string | undefined;
    let weight = 0;
    for (const p of prepare(ctx)) {
        let w = eggWeight(p.frame, x, yLateral, p.frame.blendMm);
        if (p.frame.lateralWallFade)
            w *= 1 - smoothstep01((v - MPJ5_V_FADE_START) / (MPJ5_V_FADE_END - MPJ5_V_FADE_START));
        if (p.frame.medialWallFade)
            w *= 1 - smoothstep01((MPJ1_V_FADE_START - v) / (MPJ1_V_FADE_START - MPJ1_V_FADE_END));
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
    const warnings: SinkWarning[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < pos.count; i++) {
        if (topFactors && topFactors[i]! < 0.5) continue;
        const lenCoord = base[i * 3 + lengthAxis]!;
        const widCoord = base[i * 3 + widthAxis]!;
        const u = Math.max(0, Math.min(1, (lenCoord - lenMin) / lenSize));
        const vSigned = Math.max(-1, Math.min(1, (widthSign * (widCoord - widCenter)) / (widSize / 2)));
        const sample = sinkCutAt(u, vSigned, ctx);
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
    const merged = mergeSinkWarnings(sinkDepthWarnings(ctx.sinks), warnings);
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
    for (let i = 0; i < limit; i++) {
        if (topFactors && !(topCount && topCount > 0) && topFactors[i]! < 0.5) continue;
        const u = Math.max(0, Math.min(1, (arr[i * 3 + lengthAxis]! - lenMin) / lenSize));
        const vSigned = Math.max(
            -1,
            Math.min(1, (widthSign * (arr[i * 3 + widthAxis]! - widCenter)) / (widSize / 2)),
        );
        const t = sinkThicknessAt(u, vSigned, ctx);
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
        const medialSign = ctx.side === "left" ? -1 : 1;
        const vSigned = Math.max(-1, Math.min(1, -m * medialSign));
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
    return mergeSinkWarnings(sinkDepthWarnings(ctx.sinks), warnings);
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
    const medialSign = side === "left" ? -1 : 1;
    const vSigned = Math.max(-1, Math.min(1, -mMesh * medialYSign * medialSign));
    const t = sinkThicknessAt(u, vSigned, ctx);
    const cut = sinkCutAt(u, vSigned, ctx);
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
        const medialSign = input.side === "left" ? -1 : 1;
        const vSigned = Math.max(-1, Math.min(1, -m * medialSign));
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
    const ctx: SinkSurfaceContext = {
        side: input.side,
        lengthMm: length,
        widthMm: width,
        sinks: input.sinks,
        sinkStyloidThicken: input.sinkStyloidThicken,
    };
    const widCenter = (input.bounds.minY + input.bounds.maxY) * 0.5;
    const halfW = width / 2;
    const medialSign = input.side === "left" ? -1 : 1;
    const sampleAt = (x: number, y: number) => {
        const u = Math.max(0, Math.min(1, (x - input.bounds.minX) / length));
        const mMesh = (y - widCenter) / halfW;
        const m = mMesh * input.medialYSign;
        const vSigned = Math.max(-1, Math.min(1, -m * medialSign));
        return { u, vSigned };
    };
    const rimH = new Float64Array(input.nS);
    const rimT = new Float64Array(input.nS);
    const rimR = new Float64Array(input.nS);
    const rimCut = new Float64Array(input.nS);
    const topCount = Math.min(input.topCount, input.positions.length / 3);
    for (let s = 0; s < input.nS; s++) {
        const vi = input.vertAt(0, s);
        const x = input.positions[vi * 3]!;
        const y = input.positions[vi * 3 + 1]!;
        rimH[s] = input.positions[vi * 3 + 2]!;
        const at = sampleAt(x, y);
        rimT[s] = sinkThicknessAt(at.u, at.vSigned, ctx);
        const cut = sinkCutAt(at.u, at.vSigned, ctx);
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
        const at = sampleAt(input.positions[i * 3]!, input.positions[i * 3 + 1]!);
        const t = sinkThicknessAt(at.u, at.vSigned, ctx);
        const cut = sinkCutAt(at.u, at.vSigned, ctx);
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
    return mergeSinkWarnings(sinkDepthWarnings(input.sinks), warnings);
}
