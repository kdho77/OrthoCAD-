// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { heelLiftDeltaAt } from "@/lib/geometry/heel-lift";
import {
    forefootWidthLongitudinalEnvelope,
    forefootWidthPerSideDeltaMm,
    heelCupDepthBowlDelta,
    heelCupWidthScaleFactor,
    smoothstep,
} from "@/lib/geometry/height-field";
import type { TrimlineCurve } from "@/lib/geometry/trimline";
import { wedgeDeltaAt } from "@/lib/geometry/wedge";
import type { Side, SideCorrections } from "@/types";
import type { PolyPoint } from "./curves";
import type { HermiteStation } from "./loft";
import type { DeviceTypePreset, LateralFlangeParams, StockWallModel } from "./types";

type PlanBounds = { minX: number; maxX: number; minY: number; maxY: number };

type SideUpper = (u: number) => { h: number; ny: number };

/**
 * Per-outline-point lateral offset (mm). X is unchanged.
 * Wide stations move the full `mm × envelope(u)`. Where the outline normal
 * turns toward the toe, the offset follows that normal so the two sides
 * cannot cross. `upper` is the per-side half-width and the normal at it.
 */
function rimLateralDeltas(
    rim: PolyPoint[],
    bounds: PlanBounds,
    forefootWidthMm: number,
): {
    dy: Float64Array;
    cy: number;
    uOf: (x: number) => number;
    upper: (sideSign: number, u: number) => { h: number; ny: number };
    silhouetteDy: (sideSign: number, u: number) => number;
} {
    const minX = bounds.minX;
    const length = Math.max(1e-3, bounds.maxX - minX);
    const cy = 0.5 * (bounds.minY + bounds.maxY);
    const n = rim.length;
    const uOf = (x: number) => Math.max(0, Math.min(1, (x - minX) / length));
    const ny = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const a = rim[(i - 1 + n) % n]!;
        const b = rim[(i + 1) % n]!;
        const tx = b.x - a.x;
        const ty = b.y - a.y;
        const len = Math.hypot(tx, ty) || 1;
        let oy = -tx / len;
        const side = rim[i]!.y - cy;
        if (oy * side < 0) oy = -oy;
        ny[i] = oy;
    }
    for (let pass = 0; pass < 2; pass++) {
        const next = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            next[i] = ny[(i - 1 + n) % n]! * 0.25 + ny[i]! * 0.5 + ny[(i + 1) % n]! * 0.25;
        }
        ny.set(next);
    }
    const upperOf = (sideSign: number): SideUpper => {
        const bins = new Map<number, { u: number; h: number; ny: number }>();
        const q = 0.004;
        for (let i = 0; i < n; i++) {
            const side = rim[i]!.y - cy;
            if (side * sideSign < 0) continue;
            const u = uOf(rim[i]!.x);
            const h = Math.abs(side);
            const k = Math.round(u / q);
            const prev = bins.get(k);
            if (!prev || h > prev.h) bins.set(k, { u, h, ny: Math.abs(ny[i]!) });
        }
        const arr = [...bins.values()].sort((a, b) => a.u - b.u);
        return (u: number) => {
            if (arr.length === 0) return { h: 1, ny: 0.5 };
            if (u <= arr[0]!.u) return arr[0]!;
            const last = arr[arr.length - 1]!;
            if (u >= last.u) return last;
            let lo = 0;
            let hi = arr.length - 1;
            while (hi - lo > 1) {
                const mid = (lo + hi) >> 1;
                if (arr[mid]!.u <= u) lo = mid;
                else hi = mid;
            }
            const a = arr[lo]!;
            const b = arr[hi]!;
            const span = b.u - a.u || 1;
            const t = (u - a.u) / span;
            return { h: a.h + (b.h - a.h) * t, ny: a.ny + (b.ny - a.ny) * t };
        };
    };
    const upperPos = upperOf(1);
    const upperNeg = upperOf(-1);
    const upper = (sideSign: number, u: number) => (sideSign >= 0 ? upperPos(u) : upperNeg(u));
    let maxHalf = 0;
    for (let i = 0; i < n; i++) {
        const u = uOf(rim[i]!.x);
        if (u < 0.6 || u > 0.92) continue;
        maxHalf = Math.max(maxHalf, Math.abs(rim[i]!.y - cy));
    }
    let sat = 0.75;
    if (maxHalf > 1) {
        let acc = 0;
        let satCount = 0;
        for (let i = 0; i < n; i++) {
            const u = uOf(rim[i]!.x);
            if (u < 0.6 || u > 0.92) continue;
            if (Math.abs(rim[i]!.y - cy) < maxHalf - 0.5) continue;
            acc += Math.abs(ny[i]!);
            satCount++;
        }
        if (satCount > 0) sat = acc / satCount;
    }
    sat = Math.min(0.99, Math.max(0.35, sat));
    const dy = new Float64Array(n);
    const signMm = Math.sign(forefootWidthMm);
    for (let i = 0; i < n; i++) {
        const u = uOf(rim[i]!.x);
        const env = forefootWidthLongitudinalEnvelope(u);
        if (env <= 0) continue;
        const side = rim[i]!.y - cy;
        const sideSign = side >= 0 ? 1 : -1;
        const exact = Math.abs(forefootWidthMm) * env;
        const lat = Math.max(0, Math.min(1, (ny[i]! * sideSign) / sat));
        const nyMag = lat * exact;
        // Full envelope through the gated stations. The toe cap follows the
        // outward normal so a full lateral move does not fold the wall.
        const hold = smoothstep(0.975, 0.955, u);
        const mag = nyMag + (exact - nyMag) * hold;
        dy[i] = sideSign * signMm * mag;
    }
    const orig = new Float64Array(dy);
    for (let pass = 0; pass < 6; pass++) {
        const next = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            const u = uOf(rim[i]!.x);
            if (u < 0.82) {
                next[i] = dy[i]!;
                continue;
            }
            const a = dy[(i - 1 + n) % n]!;
            const c = dy[(i + 1) % n]!;
            let smoothed = a * 0.25 + dy[i]! * 0.5 + c * 0.25;
            // Averaging across the toe centre must not flip a station's side.
            const src = orig[i]!;
            if (src !== 0 && smoothed * src < 0) {
                smoothed = Math.min(Math.abs(smoothed), Math.abs(src)) * Math.sign(src);
            }
            next[i] = smoothed;
        }
        dy.set(next);
    }
    for (let i = 0; i < n; i++) {
        const u = uOf(rim[i]!.x);
        const env = forefootWidthLongitudinalEnvelope(u);
        const exact = Math.abs(forefootWidthMm) * env;
        if (u <= 0.955 && Math.abs(orig[i]!) > Math.abs(dy[i]!) + 1e-4) dy[i] = orig[i]!;
        const room = Math.abs(rim[i]!.y - cy) - 0.35;
        if (forefootWidthMm < 0 && Math.abs(dy[i]!) > Math.max(0, room)) {
            dy[i] = Math.sign(dy[i]!) * Math.max(0, room);
        }
        if (exact > 0 && Math.abs(dy[i]!) > exact) dy[i] = Math.sign(dy[i]!) * exact;
    }
    const silhouetteDy = (sideSign: number, u: number): number => {
        const env = forefootWidthLongitudinalEnvelope(u);
        if (env <= 0) return 0;
        const exact = Math.abs(forefootWidthMm) * env;
        const lat = Math.max(0, Math.min(1, upper(sideSign, u).ny / sat));
        const hold = smoothstep(0.975, 0.955, u);
        const mag = lat * exact + (exact - lat * exact) * hold;
        return sideSign * signMm * mag;
    };
    return { dy, cy, uOf, upper, silhouetteDy };
}

/**
 * Lateral part of a pure outward-normal offset of the rim. X never moves.
 * A query copies the nearest same-side rim point, so a loop vertex translates
 * with that station instead of shearing across |v|.
 */
export function forefootLateralOffsetFn(
    rim: PolyPoint[],
    bounds: PlanBounds,
    forefootWidthMm: number,
): (x: number, y: number) => number {
    if (!forefootWidthMm || rim.length < 3) return () => 0;
    const built = rimLateralDeltas(rim, bounds, forefootWidthMm);
    const pos: number[] = [];
    const neg: number[] = [];
    for (let i = 0; i < rim.length; i++) (rim[i]!.y >= built.cy ? pos : neg).push(i);
    return (x: number, y: number) => {
        const pool = y >= built.cy ? pos : neg;
        if (pool.length === 0) return 0;
        let best = Infinity;
        let bestDy = 0;
        for (const i of pool) {
            const p = rim[i]!;
            const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
            if (d < best) {
                best = d;
                bestDy = built.dy[i]!;
            }
        }
        return bestDy;
    };
}

/** Pure lateral normal offset of a closed plan loop. X is unchanged. */
export function offsetPlanLoopForefootWidthMm(
    loop: PolyPoint[],
    bounds: PlanBounds,
    forefootWidthMm: number,
): PolyPoint[] {
    if (!forefootWidthMm || loop.length < 3) return loop;
    const dyAt = forefootLateralOffsetFn(loop, bounds, forefootWidthMm);
    return loop.map((p) => ({ x: p.x, y: p.y + dyAt(p.x, p.y), z: p.z }));
}

/**
 * After main's station pipeline: the rim and the bottom each take the
 * envelope at their own station. The sheet scales that amount linearly
 * out to the outline so a cross-section stays affine.
 */
export function applyForefootNormalOffset(
    positions: number[],
    stations: Array<{ rim: PolyPoint; outline: PolyPoint }>,
    bounds: PlanBounds,
    forefootWidthMm: number,
): void {
    if (!forefootWidthMm || stations.length < 3) return;
    const rim = stations.map((s) => s.rim);
    const built = rimLateralDeltas(rim, bounds, forefootWidthMm);
    const rimX = new Float64Array(stations.length);
    const rimY = new Float64Array(stations.length);
    for (let s = 0; s < stations.length; s++) {
        rimX[s] = rim[s]!.x;
        rimY[s] = rim[s]!.y;
    }
    const signMm = Math.sign(forefootWidthMm);
    for (let s = 0; s < stations.length; s++) {
        const st = stations[s]!;
        st.rim.y += built.dy[s]!;
        const sideB = st.outline.y - built.cy;
        if (Math.abs(sideB) < 1e-6) continue;
        const uB = built.uOf(st.outline.x);
        const envB = forefootWidthLongitudinalEnvelope(uB);
        if (envB <= 0 && built.dy[s] === 0) continue;
        let mag = Math.abs(forefootWidthMm) * envB;
        if (forefootWidthMm < 0) mag = Math.min(mag, Math.max(0, Math.abs(sideB) - 0.35));
        const own = Math.sign(sideB) * signMm * mag;
        // Past the gated stations the rim follows its outward normal so the
        // wall does not fold. The paired outline has to take that same shift;
        // a full lateral move there swings the column chord.
        const uR = built.uOf(rimX[s]!);
        const followRim = smoothstep(0.955, 0.975, uR);
        st.outline.y += own * (1 - followRim) + built.dy[s]! * followRim;
    }
    const count = Math.floor(positions.length / 3);
    const vertDy = new Float64Array(count);
    for (let i = 0; i < count; i++) {
        const x = positions[i * 3]!;
        const y = positions[i * 3 + 1]!;
        const side = y - built.cy;
        if (Math.abs(side) < 1e-6) continue;
        const u = built.uOf(x);
        const env = forefootWidthLongitudinalEnvelope(u);
        if (env <= 0) continue;
        // Freeze the scale past the last gated station so the toe cap, a
        // Y-strip, does not pick up an extra slope from the envelope fade.
        const uScale = Math.min(u, 0.975);
        const half = Math.max(1, built.upper(side > 0 ? 1 : -1, uScale).h);
        const t = Math.min(1, Math.abs(side) / half);
        // Same silhouette law as the stations, scaled in to the centre.
        // A full-envelope affine next to a normal-reduced station flips the
        // toe rim triangles.
        vertDy[i] = built.silhouetteDy(side > 0 ? 1 : -1, uScale) * t;
    }
    // A vertex on a station, and any coincident duplicate, takes that
    // station's offset. The wall is lofted from those stations.
    for (let i = 0; i < count; i++) {
        const x = positions[i * 3]!;
        const y = positions[i * 3 + 1]!;
        let best = 0.35;
        let bestDy = 0;
        let hit = false;
        for (let s = 0; s < stations.length; s++) {
            const d = Math.hypot(x - rimX[s]!, y - rimY[s]!);
            if (d < best) {
                best = d;
                bestDy = built.dy[s]!;
                hit = true;
            }
        }
        if (hit) vertDy[i] = bestDy;
    }
    for (let i = 0; i < count; i++) {
        positions[i * 3 + 1] = positions[i * 3 + 1]! + vertDy[i]!;
    }
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
            o.y += forefootWidthPerSideDeltaMm(u, o.y - widCenter, foreW);
            t.y += forefootWidthPerSideDeltaMm(u, t.y - widCenter, foreW);
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
