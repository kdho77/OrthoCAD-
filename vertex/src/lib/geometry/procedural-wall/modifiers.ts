// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

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
 * Toe fairing starts just past the u = 0.95 gate sample. Through the
 * collapsed tip the shift used to freeze at u = 0.985, which chopped a
 * nonzero slope, then the slope cap tracked the outline and folded the wall.
 * Past this station the envelope eases to 0 with a matched tangent.
 */
const TOE_FAIR_U0 = 0.955;
/** Half-width of the outline sample used for the gain plateau, in u. */
const FOREFOOT_ROOM_WINDOW_U = 0.004;
/** |dY/dy| cap. A ±10 mm step steeper than this crosses vertices on narrowing. */
const FOREFOOT_SHIFT_SLOPE_CAP = 0.75;
/** Plateau starts just inboard of the bottom outline so the outline is at full shift. */
const FOREFOOT_OUTLINE_ROOM_SCALE = 0.92;

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
        return (u: number) => {
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
    };
    const pos = side(true);
    const neg = side(false);
    return (u, positive) => (positive ? pos(u) : neg(u));
}

/**
 * C1 ease from the live envelope at {@link TOE_FAIR_U0} down to 0 at the
 * tip. Zero slope at u = 1, same value and slope as the live envelope at
 * the join, so the rim offset does not hook where the toe collapses.
 */
function fairedToeEnvelope(u: number): number {
    const live = forefootWidthLongitudinalEnvelope(u);
    if (u <= TOE_FAIR_U0) return live;
    const e0 = forefootWidthLongitudinalEnvelope(TOE_FAIR_U0);
    const h = 1e-4;
    const de0 = (e0 - forefootWidthLongitudinalEnvelope(TOE_FAIR_U0 - h)) / h;
    const span = 1 - TOE_FAIR_U0;
    const t = Math.min(1, (u - TOE_FAIR_U0) / span);
    const h00 = (2 * t - 3) * t * t + 1;
    const h10 = t * t * t - 2 * t * t + t;
    const h01 = (3 - 2 * t) * t * t;
    return Math.max(0, h00 * e0 + h10 * de0 * span + h01 * 0);
}

/** Lateral shift (mm) at a plan point. X and Z stay put. 0 below the ramp. */
export function forefootPlanShiftMm(
    x: number,
    y: number,
    bounds: PlanBounds,
    forefootWidthMm: number,
    roomAt: (u: number, positive: boolean) => number,
): number {
    if (!forefootWidthMm) return 0;
    const length = Math.max(1e-3, bounds.maxX - bounds.minX);
    const cy = (bounds.minY + bounds.maxY) * 0.5;
    if (y === cy) return 0;
    const u = Math.max(0, Math.min(1, (x - bounds.minX) / length));
    const toe = u > TOE_FAIR_U0;
    const env = toe ? fairedToeEnvelope(u) : forefootWidthLongitudinalEnvelope(u);
    if (env <= 0) return 0;
    const positive = y >= cy;
    const outlineHalf = roomAt(u, positive);
    const capRoom = Math.max(1, outlineHalf * FOREFOOT_OUTLINE_ROOM_SCALE);
    const envShift = Math.abs(forefootWidthMm) * env;
    const roomCap = FOREFOOT_SHIFT_SLOPE_CAP * capRoom;
    // In the toe the faired envelope already falls to 0. Tracking the
    // collapsing outline with the slope cap hooks the rim and folds the wall.
    const applied = toe ? envShift : Math.min(envShift, roomCap);
    const dist = Math.abs(y - cy);
    const gain = dist >= capRoom ? 1 : dist / capRoom;
    return Math.sign(y - cy) * Math.sign(forefootWidthMm) * applied * gain;
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
    roomAt?: (u: number, positive: boolean) => number,
): number {
    if (!forefootWidthMm) return 0;
    const half = Math.max(1e-3, (bounds.maxY - bounds.minY) * 0.5);
    const fallback = roomAt ?? (() => half);
    return forefootPlanShiftMm(x, y, bounds, forefootWidthMm, fallback);
}

/** Met pads and text move rigidly; every other vertex uses the envelope. */
export function applyForefootPlanShift(
    positions: { readonly length: number; [index: number]: number },
    bounds: PlanBounds,
    forefootWidthMm: number,
    boxes?: readonly ForefootRigidBox[],
    outline?: ReadonlyArray<{ x: number; y: number }>,
): void {
    if (!forefootWidthMm) return;
    const roomAt = outline && outline.length >= 8 ? forefootOutlineRoomMm(outline, bounds) : undefined;
    const count = Math.floor(positions.length / 3);
    const dy = new Float64Array(count);
    for (let i = 0; i < count; i++) {
        dy[i] = forefootWidthPlanDy(
            positions[i * 3]!,
            positions[i * 3 + 1]!,
            bounds,
            forefootWidthMm,
            roomAt,
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
            const rigid = forefootWidthPlanDy(cx, cyBox, bounds, forefootWidthMm, roomAt);
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
    return (x: number, y: number) => forefootWidthPlanDy(x, y, bounds, forefootWidthMm);
}

/** Pure lateral offset of a closed plan loop. X is unchanged. */
export function offsetPlanLoopForefootWidthMm(
    loop: PolyPoint[],
    bounds: PlanBounds,
    forefootWidthMm: number,
): PolyPoint[] {
    if (!forefootWidthMm || loop.length < 3) return loop;
    return loop.map((p) => ({
        x: p.x,
        y: p.y + forefootWidthPlanDy(p.x, p.y, bounds, forefootWidthMm),
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
    const roomAt = forefootOutlineRoomMm(points, box);
    return points.map((p) => ({
        ...p,
        y: p.y + forefootWidthPlanDy(p.x, p.y, box, forefootWidthMm, roomAt),
    }));
}

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
        if (c && (c.rearfootWedge || c.forefootWedge)) {
            t.z += postingZDelta(o.x, o.y, model.bounds, input);
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
    if (!c || (!c.rearfootWedge && !c.forefootWedge)) return 0;
    const minX = bounds.minX;
    const length = Math.max(1e-3, bounds.maxX - minX);
    const widthMm = Math.max(1e-3, bounds.maxY - bounds.minY);
    const u = Math.max(0, Math.min(1, (x - minX) / length));
    const side = input.side ?? ((input.medialYSign ?? 1) < 0 ? "right" : "left");
    const vSigned = footprintVSignedFromMeshY(y, bounds, side, input.medialYSign ?? 1);
    return wedgeDeltaAt(u, vSigned, side, c, {
        lengthMm: length,
        widthMm,
        trimline: input.trimline ?? null,
    });
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
