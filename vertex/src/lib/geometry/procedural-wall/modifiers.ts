// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import {
    buildWedgeStations,
    fallbackRimXY,
    fullLengthToeSampleU,
    fullLengthWedgeActive,
    fullLengthWedgeDeltaAt,
} from "@/lib/geometry/full-length-wedge";
import { heelLiftDeltaAt } from "@/lib/geometry/heel-lift";
import {
    forefootWidthLongitudinalEnvelope,
    forefootWidthPerSideDeltaMm,
    heelCupDepthBowlDelta,
    heelCupWidthScaleFactor,
} from "@/lib/geometry/height-field";
import { sinksActive, sinkThicknessAt, styloidWallReliefAt } from "@/lib/geometry/sink";
import type { TrimlineCurve } from "@/lib/geometry/trimline";
import { wedgeDeltaAt } from "@/lib/geometry/wedge";
import type { PlacedSink, Side, SideCorrections } from "@/types";
import type { PolyPoint } from "./curves";
import type { HermiteStation } from "./loft";
import type { DeviceTypePreset, LateralFlangeParams, StockWallModel } from "./types";

type PlanBounds = { minX: number; maxX: number; minY: number; maxY: number };

/** Plan rectangle translated by the forefoot offset at its vertex centroid. */
export interface ForefootRigidBox {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

/**
 * Width alone carries the forefoot rim offset through the toe so the tip
 * moves with the side. A full-length wedge instead eases
 * the plan onto {@link FOREFOOT_SHIFT_U_HOLD} so the ruled stations share
 * that station. X never moves, and a 0 mm width never reaches it.
 */
const TOE_FAIR_U0 = 0.955;
/**
 * Envelope hold ends here and its slope is 0. Widening keeps the rim offset
 * reached at this station. Falling with the envelope after it hooks the
 * shoulder where the top rim is sampled.
 */
const TOE_WIDEN_U0 = 0.95;
/** Half-width of the outline sample used for the gain plateau, in u. */
const FOREFOOT_ROOM_WINDOW_U = 0.004;
/** Station a full-length wedge freezes when a forefoot width shift is also on. */
export const FOREFOOT_SHIFT_U_HOLD = 0.985;
/** |dY/dy| cap. A ±10 mm step steeper than this crosses vertices on narrowing. */
const FOREFOOT_SHIFT_SLOPE_CAP = 0.75;
/** Plateau starts just inboard of the bottom outline so the outline is at full shift. */
const FOREFOOT_OUTLINE_ROOM_SCALE = 0.92;
/**
 * Smallest widened-toe knee. Below this the outline ring and the top vertex
 * half a millimetre apart disagree by more than 1 mm.
 */
const FOREFOOT_TIP_KNEE_FLOOR_MM = 8.5;

/**
 * Outer |y − centre| of one side of the bottom outline. The gain plateau
 * is 0.92× the widest sample within ±{@link FOREFOOT_ROOM_WINDOW_U}.
 * The window is taken on the linearly interpolated outline, so the half-width
 * is continuous. A discrete window steps where the toe narrows and that step
 * flips the wall/bottom slivers.
 */
export function forefootOutlineRoomMm(
    outline: ReadonlyArray<{ x: number; y: number }>,
    bounds: PlanBounds,
): (u: number, positive: boolean) => number {
    return outlineSides(outline, bounds).roomAt;
}

function outlineSides(
    outline: ReadonlyArray<{ x: number; y: number }>,
    bounds: PlanBounds,
): {
    roomAt: (u: number, positive: boolean) => number;
    halfAt: (u: number, positive: boolean) => number;
} {
    const cy = (bounds.minY + bounds.maxY) * 0.5;
    const length = Math.max(1e-3, bounds.maxX - bounds.minX);
    const side = (positive: boolean) => {
        const env: Array<{ u: number; d: number }> = [];
        for (const p of outline) {
            if (positive ? p.y < cy : p.y >= cy) continue;
            const u = Math.max(0, Math.min(1, (p.x - bounds.minX) / length));
            env.push({ u, d: Math.abs(p.y - cy) });
        }
        env.sort((a, b) => a.u - b.u);
        // A closed loop visits the same u twice. Keep the outer sample.
        const outer: Array<{ u: number; d: number }> = [];
        for (const s of env) {
            const prev = outer[outer.length - 1];
            if (prev && s.u <= prev.u + 1e-6) {
                if (s.d > prev.d) prev.d = s.d;
                continue;
            }
            outer.push(s);
        }
        const at = (u: number) => {
            if (outer.length === 0) return 0;
            if (u <= outer[0]!.u) return outer[0]!.d;
            const tail = outer[outer.length - 1]!;
            if (u >= tail.u) return tail.d;
            let lo = 0;
            let hi = outer.length - 1;
            while (hi - lo > 1) {
                const mid = (lo + hi) >> 1;
                if (outer[mid]!.u <= u) lo = mid;
                else hi = mid;
            }
            const a = outer[lo]!;
            const b = outer[hi]!;
            const t = (u - a.u) / Math.max(1e-9, b.u - a.u);
            return a.d + t * (b.d - a.d);
        };
        const room = (u: number) => {
            const loU = u - FOREFOOT_ROOM_WINDOW_U;
            const hiU = u + FOREFOOT_ROOM_WINDOW_U;
            let best = Math.max(at(loU), at(hiU));
            let lo = 0;
            let hi = outer.length;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (outer[mid]!.u < loU) lo = mid + 1;
                else hi = mid;
            }
            for (let i = lo; i < outer.length && outer[i]!.u <= hiU; i++) {
                if (outer[i]!.d > best) best = outer[i]!.d;
            }
            return best;
        };
        return { half: at, room };
    };
    const pos = side(true);
    const neg = side(false);
    return {
        roomAt: (u, positive) => (positive ? pos.room(u) : neg.room(u)),
        halfAt: (u, positive) => (positive ? pos.half(u) : neg.half(u)),
    };
}

/** Local outline half-width and the gain-plateau room, from one pass over the loop. */
export function forefootOutlineMetrics(
    outline: ReadonlyArray<{ x: number; y: number }>,
    bounds: PlanBounds,
): {
    roomAt: (u: number, positive: boolean) => number;
    halfAt: (u: number, positive: boolean) => number;
} {
    return outlineSides(outline, bounds);
}

/** Additive outline shift (mm) at one station. Slope cap stays off the toe. */
function forefootBodyShiftMm(
    u: number,
    dist: number,
    positive: boolean,
    absWidthMm: number,
    roomAt: (u: number, positive: boolean) => number,
): number {
    const env = forefootWidthLongitudinalEnvelope(u);
    if (env <= 0 || dist <= 0) return 0;
    const outlineHalf = roomAt(u, positive);
    const capRoom = Math.max(1, outlineHalf * FOREFOOT_OUTLINE_ROOM_SCALE);
    const envShift = absWidthMm * env;
    const applied = Math.min(envShift, FOREFOOT_SHIFT_SLOPE_CAP * capRoom);
    const gain = dist >= capRoom ? 1 : dist / capRoom;
    return applied * gain;
}

type HalfFn = (u: number, positive: boolean) => number;

/**
 * Toe shift. Widening holds the rim amount from {@link TOE_WIDEN_U0}, where
 * the envelope slope is 0, so the shoulder keeps the base curve's turn.
 * The gain knee tracks the local outline and is floored at the tip so the
 * top rim and the outline ring stay within a millimetre. A knee frozen at
 * the join lies on the narrowing rim and corners it. Narrowing keeps that
 * frozen field — a live knee there folds the sheet — and cannot cross the centre.
 */
function toeArcShiftMm(
    u: number,
    y: number,
    cy: number,
    widthMm: number,
    roomAt: HalfFn,
    halfAt: HalfFn,
): number {
    const dist = Math.abs(y - cy);
    if (dist <= 0) return 0;
    const positive = y >= cy;
    const absMm = Math.abs(widthMm);
    if (widthMm < 0) {
        let shift = forefootBodyShiftMm(TOE_FAIR_U0, dist, positive, absMm, roomAt);
        if (shift > 0.95 * dist) shift = 0.95 * dist;
        return shift;
    }
    // Probe past the knee so this is the rim amount, constant in u.
    const applied = forefootBodyShiftMm(TOE_WIDEN_U0, dist + 1e6, positive, absMm, roomAt);
    const outer = Math.max(roomAt(u, positive), halfAt(u, positive));
    const rawKnee = Math.max(1, outer * FOREFOOT_OUTLINE_ROOM_SCALE);
    // Floor a collapsed tip knee so the outline ring and the top vertex,
    // half a millimetre apart, stay within 1 mm. The shoulder is wider
    // than the floor and stays on the full offset.
    const knee = Math.max(rawKnee, FOREFOOT_TIP_KNEE_FLOOR_MM, applied * 0.85);
    if (dist >= knee) return applied;
    const linear = dist / knee;
    // Hand the linear ramp to the plateau with a flat slope, so the rim
    // does not corner where it crosses the floor. Inboard of the join the
    // ramp is unchanged.
    const join = knee * 0.4;
    if (dist <= join) return applied * linear;
    const span = knee - join;
    const s = (dist - join) / span;
    const g0 = join / knee;
    const slope = span / knee;
    const target = 1 - g0 - slope;
    const b = -slope - 2 * target;
    const a = target - b;
    const gain = g0 + slope * s + a * s * s + b * s * s * s;
    return applied * gain;
}

/** Lateral shift (mm) at a plan point. X and Z stay put. 0 below the ramp. */
export function forefootPlanShiftMm(
    x: number,
    y: number,
    bounds: PlanBounds,
    forefootWidthMm: number,
    roomAt: HalfFn,
    halfAt?: HalfFn,
    fairToeHold = false,
): number {
    if (!forefootWidthMm) return 0;
    const length = Math.max(1e-3, bounds.maxX - bounds.minX);
    const cy = (bounds.minY + bounds.maxY) * 0.5;
    if (y === cy) return 0;
    const uRaw = Math.max(0, Math.min(1, (x - bounds.minX) / length));
    // A full-length wedge samples the body law at the held station so the
    // ruled tilt and the plan share one toe. Width alone scales the arc.
    const u = fairToeHold ? fullLengthToeSampleU(uRaw, FOREFOOT_SHIFT_U_HOLD) : uRaw;
    const positive = y >= cy;
    const dist = Math.abs(y - cy);
    const halfFn = halfAt ?? roomAt;
    const toeFrom = forefootWidthMm < 0 ? TOE_FAIR_U0 : TOE_WIDEN_U0;
    const mag =
        fairToeHold || uRaw <= toeFrom
            ? forefootBodyShiftMm(u, dist, positive, Math.abs(forefootWidthMm), roomAt)
            : toeArcShiftMm(uRaw, y, cy, forefootWidthMm, roomAt, halfFn);
    if (mag === 0) return 0;
    return Math.sign(y - cy) * Math.sign(forefootWidthMm) * mag;
}

/**
 * One lateral envelope on both sides. Full amount at the rim and the bottom
 * outline, 0 on the centreline, 0 below the ramp. The taper is the inboard
 * of the outline (slope-capped) so a ±10 mm narrowing cannot fold the sheet.
 */
export function forefootWidthPlanDy(
    x: number,
    y: number,
    bounds: PlanBounds,
    forefootWidthMm: number,
    roomAt?: HalfFn,
    halfAt?: HalfFn,
    fairToeHold = false,
): number {
    if (!forefootWidthMm) return 0;
    const half = Math.max(1e-3, (bounds.maxY - bounds.minY) * 0.5);
    const fallback = roomAt ?? (() => half);
    return forefootPlanShiftMm(x, y, bounds, forefootWidthMm, fallback, halfAt ?? fallback, fairToeHold);
}

/** Met pads and text move rigidly; every other vertex uses the envelope. */
export function applyForefootPlanShift(
    positions: { readonly length: number; [index: number]: number },
    bounds: PlanBounds,
    forefootWidthMm: number,
    boxes?: readonly ForefootRigidBox[],
    outline?: ReadonlyArray<{ x: number; y: number }>,
    fairToeHold = false,
): void {
    if (!forefootWidthMm) return;
    const metrics = outline && outline.length >= 8 ? forefootOutlineMetrics(outline, bounds) : undefined;
    const count = Math.floor(positions.length / 3);
    const dy = new Float64Array(count);
    for (let i = 0; i < count; i++) {
        dy[i] = forefootWidthPlanDy(
            positions[i * 3]!,
            positions[i * 3 + 1]!,
            bounds,
            forefootWidthMm,
            metrics?.roomAt,
            metrics?.halfAt,
            fairToeHold,
        );
    }
    if (boxes) {
        for (const box of boxes) {
            const ids: number[] = [];
            for (let i = 0; i < count; i++) {
                const x = positions[i * 3]!;
                const y = positions[i * 3 + 1]!;
                if (x < box.minX || x > box.maxX || y < box.minY || y > box.maxY) continue;
                ids.push(i);
            }
            if (ids.length === 0) continue;
            // Feature centroid, not the mesh-vertex average (density would bias it).
            const cx = (box.minX + box.maxX) * 0.5;
            const cyBox = (box.minY + box.maxY) * 0.5;
            const hx = Math.max(1e-3, (box.maxX - box.minX) * 0.5);
            const hy = Math.max(1e-3, (box.maxY - box.minY) * 0.5);
            const rigid = forefootWidthPlanDy(
                cx,
                cyBox,
                bounds,
                forefootWidthMm,
                metrics?.roomAt,
                metrics?.halfAt,
                fairToeHold,
            );
            for (const i of ids) {
                const x = positions[i * 3]!;
                const y = positions[i * 3 + 1]!;
                const edge = Math.max(Math.abs(x - cx) / hx, Math.abs(y - cyBox) / hy);
                // Core stays rigid. The outer margin blends back to the field so the
                // box edge is not a step the boolean rejects.
                const w = edge <= 0.7 ? 1 : Math.max(0, (1 - edge) / 0.3);
                dy[i] = rigid * w + dy[i]! * (1 - w);
            }
        }
    }
    for (let i = 0; i < count; i++) {
        const add = dy[i]!;
        if (add !== 0) positions[i * 3 + 1] = positions[i * 3 + 1]! + add;
    }
}

const FEATURE_HALF_MM: Record<string, { x: number; y: number }> = {
    met_pad: { x: 34, y: 28 },
    met_bar: { x: 16, y: 44 },
    toe_crest: { x: 18, y: 24 },
};

/**
 * Axis-aligned plan boxes for features that must not be sheared by the
 * midline taper. Sized from the nominal footprint, padded so the feather
 * stays inside, and kept clear of the rim.
 */
export function forefootFeatureBoxes(
    bounds: PlanBounds,
    features: {
        lengthMm?: number;
        elements?: ReadonlyArray<{
            position: { x: number; y: number };
            scale?: { x: number; y: number };
            kind?: string;
        }>;
        text?: {
            text?: string;
            placementU?: number;
            capHeightMm?: number;
            nudgeAlongMm?: number;
            nudgeAcrossMm?: number;
        } | null;
    },
): ForefootRigidBox[] {
    const boxes: ForefootRigidBox[] = [];
    const cx0 = (bounds.minX + bounds.maxX) * 0.5;
    const cy0 = (bounds.minY + bounds.maxY) * 0.5;
    const lengthScale = Math.max(0.75, (features.lengthMm ?? 260) / 260);
    for (const el of features.elements ?? []) {
        const half = FEATURE_HALF_MM[el.kind ?? ""] ?? { x: 24, y: 20 };
        const sx = Math.max(0.5, el.scale?.x ?? 1) * lengthScale * 1.2;
        const sy = Math.max(0.5, el.scale?.y ?? 1) * lengthScale * 1.2;
        const cx = cx0 + el.position.x;
        const cy = cy0 + el.position.y;
        boxes.push({
            minX: cx - half.x * sx,
            maxX: cx + half.x * sx,
            minY: cy - half.y * sy,
            maxY: cy + half.y * sy,
        });
    }
    const text = features.text;
    const label = text?.text?.trim() ?? "";
    if (label) {
        const length = Math.max(1e-3, bounds.maxX - bounds.minX);
        const u = Math.max(0, Math.min(1, text?.placementU ?? 0.68));
        const cap = Math.max(4, text?.capHeightMm ?? 6);
        const cx = bounds.minX + u * length + (text?.nudgeAlongMm ?? 0);
        const cy = cy0 + (text?.nudgeAcrossMm ?? 0);
        boxes.push({
            minX: cx - Math.max(16, cap * label.length * 0.85),
            maxX: cx + Math.max(16, cap * label.length * 0.85),
            minY: cy - Math.max(8, cap),
            maxY: cy + Math.max(8, cap),
        });
    }
    return boxes;
}

/** Lateral part of the envelope at a query. X never moves. */
export function forefootLateralOffsetFn(
    rim: PolyPoint[],
    bounds: PlanBounds,
    forefootWidthMm: number,
): (x: number, y: number) => number {
    if (!forefootWidthMm || rim.length < 3) return () => 0;
    const metrics = forefootOutlineMetrics(rim, bounds);
    return (x: number, y: number) =>
        forefootWidthPlanDy(x, y, bounds, forefootWidthMm, metrics.roomAt, metrics.halfAt);
}

/** Pure lateral offset of a closed plan loop. X is unchanged. */
export function offsetPlanLoopForefootWidthMm(
    loop: PolyPoint[],
    bounds: PlanBounds,
    forefootWidthMm: number,
): PolyPoint[] {
    if (!forefootWidthMm || loop.length < 3) return loop;
    const metrics = forefootOutlineMetrics(loop, bounds);
    return loop.map((p) => ({
        x: p.x,
        y: p.y + forefootWidthPlanDy(p.x, p.y, bounds, forefootWidthMm, metrics.roomAt, metrics.halfAt),
        z: p.z,
    }));
}

/** Axis-aligned plan bounds of a position buffer (x, y, z triplets). */
export function forefootPlanBoundsOfPositions(positions: ArrayLike<number>): PlanBounds {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const count = Math.floor(positions.length / 3);
    for (let i = 0; i < count; i++) {
        const x = positions[i * 3] ?? 0;
        const y = positions[i * 3 + 1] ?? 0;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    if (!Number.isFinite(minX)) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    return { minX, maxX, minY, maxY };
}

function forefootPlanBoundsOfPoints(points: ReadonlyArray<{ x: number; y: number }>): PlanBounds {
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
    if (!Number.isFinite(minX)) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    return { minX, maxX, minY, maxY };
}

/**
 * Display-only copy of the export outline shift. Stored curves stay anatomical;
 * the viewer adds this while the slider moves. 0 mm returns the same points.
 */
export function shiftClosedLoopForefoot<T extends { x: number; y: number }>(
    points: readonly T[],
    forefootWidthMm: number,
    bounds?: PlanBounds,
): T[] {
    if (!forefootWidthMm || points.length < 3) return points.map((p) => ({ ...p }));
    const box = bounds ?? forefootPlanBoundsOfPoints(points);
    const metrics = forefootOutlineMetrics(points, box);
    return points.map((p) => ({
        ...p,
        y: p.y + forefootWidthPlanDy(p.x, p.y, box, forefootWidthMm, metrics.roomAt, metrics.halfAt),
    }));
}

let loggedRectFallback = false;
let rectRimCache: { key: string; rim: { x: number; y: number }[] } | null = null;

/** Print-step grinding dropdown → wall mid-style. */
export type ProceduralWallStyle = "straight" | "round" | "hybrid";

export interface ProceduralModifierInput {
    corrections?: SideCorrections;
    thicknessMm?: number;
    stockThicknessMm?: number;
    /** Device preset. Accommodative uses the same stock defaults as functional. */
    deviceType?: DeviceTypePreset;
    lateralFlange?: Partial<LateralFlangeParams>;
    /**
     * Legacy grind depth. Plantar stay at z=0; the Print-step grinding
     * dropdown now selects {@link wallStyle}.
     */
    archGrindDepthMm?: number;
    /** Wall mid-style (straight / round / hybrid). */
    wallStyle?: ProceduralWallStyle;
    /** High-rim medial side. +1 = +Y. */
    medialYSign?: 1 | -1;
    /** Foot side for wedge math (independent of mesh Y flip). */
    side?: Side;
    trimline?: TrimlineCurve | null;
    /** MPJ / styloid sinks. Absent ⇒ curve T is not evaluated. */
    sinks?: PlacedSink[];
    sinkStyloidThicken?: boolean;
    /** Real top-rim polyline in mesh XY. Unordered clouds set {@link fullLengthRimOrdered} false. */
    fullLengthRimXY?: ReadonlyArray<{ x: number; y: number }>;
    fullLengthRimOrdered?: boolean;
    /**
     * When set, the ruled tilt eases onto this u ahead of the toe corner.
     * Used only with a forefoot plan shift, which holds the same station.
     */
    fullLengthToeHoldU?: number;
    /**
     * Whole-insole width scale (1 = unchanged). Same factor and medial-lateral
     * centre as the top. Heel widen uses heelCupWidthMm + follow=1 instead.
     */
    insoleWidthScale?: number;
}

export interface ModifiedCurves {
    trim: PolyPoint[];
    outline: PolyPoint[];
}

function clonePoly(pts: PolyPoint[]): PolyPoint[] {
    return pts.map((p) => ({ ...p }));
}

/**
 * Widen and cup depth move only TrimCurve / BottomOutline. Nothing deforms
 * wall vertices — the wall is regenerated from the moved curves.
 *
 * Thickness, heel lift, and posting raise the trim (top) only. The plantar
 * outline and B stay on the print bed (z = 0).
 */
export function applyCurveModifiers(
    model: StockWallModel,
    input: ProceduralModifierInput = {},
): ModifiedCurves {
    const trim = clonePoly(model.trim.spline.controls);
    const outline = clonePoly(model.outline.spline.controls);
    const c = input.corrections;
    const minX = model.bounds.minX;
    const length = Math.max(1e-3, model.bounds.maxX - model.bounds.minX);
    const widCenter = (model.bounds.minY + model.bounds.maxY) * 0.5;
    const dThick = (input.thicknessMm ?? 0) - (input.stockThicknessMm ?? input.thicknessMm ?? 0);

    const n = Math.min(trim.length, outline.length);
    for (let i = 0; i < n; i++) {
        const o = outline[i]!;
        const t = trim[i]!;
        const u = Math.max(0, Math.min(1, (o.x - minX) / length));
        const heelW = c?.heelCupWidthMm ?? 0;
        const foreW = c?.forefootWidthMm ?? 0;
        if (c && heelW !== 0) {
            const scale = heelCupWidthScaleFactor(u, heelW);
            o.y = widCenter + (o.y - widCenter) * scale;
            t.y = widCenter + (t.y - widCenter) * scale;
        }
        if (c && foreW !== 0) {
            const halfW = Math.max(1e-3, (model.bounds.maxY - model.bounds.minY) * 0.5);
            o.y += forefootWidthPerSideDeltaMm(u, (o.y - widCenter) / halfW, foreW);
            t.y += forefootWidthPerSideDeltaMm(u, (t.y - widCenter) / halfW, foreW);
        }
        const whole = input.insoleWidthScale ?? 1;
        if (Number.isFinite(whole) && Math.abs(whole - 1) > 1e-12) {
            o.y = widCenter + (o.y - widCenter) * whole;
            t.y = widCenter + (t.y - widCenter) * whole;
        }
        if (c && c.heelCupDepthMm > 0) {
            const halfW = Math.max(1e-3, (model.bounds.maxY - model.bounds.minY) * 0.5);
            const av = Math.abs((t.y - widCenter) / halfW);
            t.z += heelCupDepthBowlDelta(u, Math.min(1, av), c.heelCupDepthMm);
        }
        if (c && c.heelLiftMm > 0) {
            t.z += heelLiftDeltaAt(u, c.heelLiftMm);
        }
    }
    // Full-length stations use the outline after the forefoot-width shift.
    // Built only when that wedge is on, so the off path keeps main's posting call.
    let postingInput = input;
    if (c && fullLengthWedgeActive(c)) {
        const rim: { x: number; y: number }[] = [];
        for (let i = 0; i < n; i++) {
            const o = outline[i]!;
            rim.push({ x: o.x, y: o.y });
        }
        postingInput = { ...input, fullLengthRimXY: rim, fullLengthRimOrdered: true };
    }
    for (let i = 0; i < n; i++) {
        const o = outline[i]!;
        const t = trim[i]!;
        const u = Math.max(0, Math.min(1, (o.x - minX) / length));
        if (c && (c.rearfootWedge || c.forefootWedge || fullLengthWedgeActive(c))) {
            t.z += postingZDelta(o.x, o.y, model.bounds, postingInput);
        }
        if (sinksActive(input.sinks)) {
            const length = Math.max(1e-3, model.bounds.maxX - model.bounds.minX);
            const widthMm = Math.max(1e-3, model.bounds.maxY - model.bounds.minY);
            const side = input.side ?? ((input.medialYSign ?? 1) < 0 ? "right" : "left");
            const vSigned = footprintVSignedFromMeshY(o.y, model.bounds, side, input.medialYSign ?? 1);
            t.z += sinkThicknessAt(u, vSigned, {
                side,
                lengthMm: length,
                widthMm,
                sinks: input.sinks,
                sinkStyloidThicken: input.sinkStyloidThicken,
                trimline: input.trimline,
            });
        }
        if (dThick) t.z += dThick;
    }
    return { trim, outline };
}

/**
 * Rearfoot / forefoot wedge on the top sheet. Never applied to the plantar or B —
 * the print bed stays flat and the walls span top → z = 0.
 */
/** Mesh Y width coordinate → height-field vSigned (matches heightAt / base-modifier). */
export function footprintVSignedFromMeshY(
    y: number,
    bounds: Pick<StockWallModel["bounds"], "minY" | "maxY">,
    side: Side,
    medialYSign: 1 | -1 = 1,
): number {
    const widCenter = (bounds.minY + bounds.maxY) * 0.5;
    const halfW = Math.max(1e-3, (bounds.maxY - bounds.minY) * 0.5);
    const mMesh = (y - widCenter) / halfW;
    const m = mMesh * medialYSign;
    const medialSign = side === "left" ? -1 : 1;
    return Math.max(-1, Math.min(1, -m * medialSign));
}

export function postingZDelta(
    x: number,
    y: number,
    bounds: StockWallModel["bounds"],
    input: ProceduralModifierInput,
): number {
    const c = input.corrections;
    const fl = !!c && fullLengthWedgeActive(c);
    if (!c || (!c.rearfootWedge && !c.forefootWedge && !fl)) return 0;
    const minX = bounds.minX;
    const length = Math.max(1e-3, bounds.maxX - minX);
    const widthMm = Math.max(1e-3, bounds.maxY - bounds.minY);
    const u = Math.max(0, Math.min(1, (x - minX) / length));
    const side = input.side ?? ((input.medialYSign ?? 1) < 0 ? "right" : "left");
    const vSigned = footprintVSignedFromMeshY(y, bounds, side, input.medialYSign ?? 1);
    let d = 0;
    if (c.rearfootWedge || c.forefootWedge) {
        d += wedgeDeltaAt(u, vSigned, side, c, {
            lengthMm: length,
            widthMm,
            trimline: input.trimline ?? null,
        });
    }
    if (fl) {
        const medialPositiveY = (input.medialYSign ?? 1) > 0;
        let rim = input.fullLengthRimXY;
        let ordered = input.fullLengthRimOrdered !== false;
        if (!rim || rim.length < 4) {
            if (!loggedRectFallback) {
                loggedRectFallback = true;
                console.warn("[full-length-wedge] no real rim; using effectiveOutlineHalfWidth fallback");
            }
            const midY = (bounds.minY + bounds.maxY) * 0.5;
            const key = `${minX}|${length}|${midY}|${widthMm}|${c.fullLengthWedge?.side}|${c.fullLengthWedge?.value}|${c.fullLengthWedge?.unit}`;
            if (!rectRimCache || rectRimCache.key !== key) {
                rectRimCache = {
                    key,
                    rim: fallbackRimXY(length, () => widthMm / 2).map((p) => ({
                        x: p.x + minX,
                        y: p.y + midY,
                    })),
                };
            }
            rim = rectRimCache.rim;
            ordered = true;
        }
        const stations = buildWedgeStations(rim, side, c.fullLengthWedge, {
            originX: minX,
            lengthMm: length,
            medialPositiveY,
            ordered,
        });
        d += fullLengthWedgeDeltaAt(x, y, stations, input.fullLengthToeHoldU);
    }
    return d;
}

/**
 * Plantar stays at z = 0. Grind and arch fill used to raise the sole; they
 * now select wall style instead of offsetting the bottom.
 */
/**
 * Styloid lateral-wall z term. Pre-relief vertex height `z` on a wall whose rim
 * height is `rimHeight`. Returns 0 when the rim is not lowered.
 * XY is never modified by the caller — this is a pure dz.
 */
export function styloidWallZDelta(
    z: number,
    rimHeight: number,
    styloidDepthMm: number,
    rimLoweringMm: number,
): number {
    return styloidWallReliefAt(z, rimHeight, styloidDepthMm, rimLoweringMm);
}

export function plantarZDelta(
    _x: number,
    _y: number,
    _bounds: StockWallModel["bounds"],
    _input: ProceduralModifierInput,
): number {
    return 0;
}

export interface XYZ {
    x: number;
    y: number;
    z: number;
}

export interface PostingClamp {
    station: number;
    u: number;
    droppedMm: number;
}

/** Finite-difference n_plantar of the posted sheet z = z0 + zDelta. */
export function plantarNormalAt(
    x: number,
    y: number,
    zDelta: (x: number, y: number) => number,
    eps = 0.5,
): XYZ {
    const h = Math.max(1e-3, eps);
    const zx = (zDelta(x + h, y) - zDelta(x - h, y)) / (2 * h);
    const zy = (zDelta(x, y + h) - zDelta(x, y - h)) / (2 * h);
    let nx = -zx;
    let ny = -zy;
    let nz = 1;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    if (nz < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
    }
    return { x: nx, y: ny, z: nz };
}

/**
 * Undo downward posting only, so top.z − 0 ≥ minWall + r1 + r2.
 * Thin stock / lift / thickness edges are left alone. `droppedMm` is the
 * posting that was refused. Interior verts inherit the nearest rim raise.
 */
export function clampPostingOnTopSheet(
    topPos: Float32Array,
    rimLocal: number[],
    r1: number,
    r2: number,
    minWallMm: number,
    bounds?: { minX: number; maxX: number },
    postingAt: (x: number, y: number) => number = () => 0,
): PostingClamp[] {
    const n = rimLocal.length;
    if (n < 1) return [];
    const need = minWallMm + r1 + r2;
    const raise = new Array<number>(n).fill(0);
    const postingClamps: PostingClamp[] = [];
    const length = bounds ? Math.max(1e-3, bounds.maxX - bounds.minX) : 1;
    for (let i = 0; i < n; i++) {
        const vi = rimLocal[i]!;
        const x = topPos[vi * 3]!;
        const y = topPos[vi * 3 + 1]!;
        const z = topPos[vi * 3 + 2]!;
        const postingDz = postingAt(x, y);
        if (postingDz >= -1e-9 || z >= need - 1e-9) continue;
        const droppedMm = Math.min(need - z, -postingDz);
        if (droppedMm <= 1e-9) continue;
        raise[i] = droppedMm;
        const u = bounds ? Math.max(0, Math.min(1, (x - bounds.minX) / length)) : i / n;
        postingClamps.push({ station: i, u, droppedMm });
    }
    if (!postingClamps.length) return [];
    const count = (topPos.length / 3) | 0;
    for (let v = 0; v < count; v++) {
        const x = topPos[v * 3]!;
        const y = topPos[v * 3 + 1]!;
        let best = 0;
        let bestD = Number.POSITIVE_INFINITY;
        for (let i = 0; i < n; i++) {
            const vi = rimLocal[i]!;
            const dx = topPos[vi * 3]! - x;
            const dy = topPos[vi * 3 + 1]! - y;
            const d = dx * dx + dy * dy;
            if (d < bestD) {
                bestD = d;
                best = i;
            }
        }
        const add = raise[best]!;
        if (add > 0) topPos[v * 3 + 2] += add;
    }
    return postingClamps;
}

/**
 * Legacy plantar-raise cap. Reconstruct clamps posting on the top sheet instead
 * ({@link clampPostingOnTopSheet}); B stays at z = 0.
 */
export function clampPostingOnStations(
    stations: HermiteStation[],
    zDelta: (x: number, y: number) => number,
    r1: number,
    r2: number,
    minWallMm: number,
    extraNeedMm: ReadonlyArray<{ station: number; extraMm: number }> = [],
): { zDelta: (x: number, y: number) => number; postingClamps: PostingClamp[] } {
    if (stations.length < 1) return { zDelta, postingClamps: [] };
    const extra = new Array(stations.length).fill(0);
    for (const e of extraNeedMm) {
        if (e.station >= 0 && e.station < extra.length) {
            extra[e.station] = Math.max(extra[e.station]!, e.extraMm);
        }
    }
    const need = minWallMm + r1 + r2;
    const postingClamps: PostingClamp[] = [];
    const capDz: number[] = stations.map((st, i) => {
        const dz = zDelta(st.outline.x, st.outline.y);
        const maxDz = st.rim.z - st.outline.z - need - extra[i]!;
        if ((dz > 0 && dz > maxDz + 1e-9) || extra[i]! > 1e-9) {
            const cap = extra[i]! > 1e-9 ? Math.min(dz, Math.max(0, maxDz)) : Math.max(0, maxDz);
            postingClamps.push({
                station: i,
                u: st.u,
                droppedMm: Math.max(0, dz - cap),
            });
            return cap;
        }
        return Number.POSITIVE_INFINITY;
    });
    if (!postingClamps.length) return { zDelta, postingClamps };
    const wrapped = (x: number, y: number): number => {
        const dz = zDelta(x, y);
        let best = 0;
        let bestD = Number.POSITIVE_INFINITY;
        for (let i = 0; i < stations.length; i++) {
            const p = stations[i]!.outline;
            const d = (p.x - x) ** 2 + (p.y - y) ** 2;
            if (d < bestD) {
                bestD = d;
                best = i;
            }
        }
        return Math.min(dz, capDz[best]!);
    };
    return { zDelta: wrapped, postingClamps };
}
