// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { heelLiftDeltaAt } from "@/lib/geometry/heel-lift";
import { heelCupDepthBowlDelta, heelCupWidthScaleFactor } from "@/lib/geometry/height-field";
import { archGrindPlantarRaiseAt } from "@/lib/geometry/shape-finish-modifiers";
import type { SideCorrections } from "@/types";
import type { PolyPoint } from "./curves";
import type { HermiteStation } from "./loft";
import type { DeviceTypePreset, LateralFlangeParams, StockWallModel } from "./types";

export interface ProceduralModifierInput {
    corrections?: SideCorrections;
    thicknessMm?: number;
    stockThicknessMm?: number;
    /** Device preset. Accommodative uses the same stock defaults as functional. */
    deviceType?: DeviceTypePreset;
    lateralFlange?: Partial<LateralFlangeParams>;
    /** Arch grind depth (mm) applied to the plantar sheet only. */
    archGrindDepthMm?: number;
    /** High-rim medial side. +1 = +Y. */
    medialYSign?: 1 | -1;
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
        if (c && c.heelCupWidthMm !== 0) {
            const scale = heelCupWidthScaleFactor(u, c.heelCupWidthMm);
            o.y = widCenter + (o.y - widCenter) * scale;
            t.y = widCenter + (t.y - widCenter) * scale;
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
        if (c && (c.rearfootPostingDeg || c.forefootPostingDeg)) {
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
export function postingZDelta(
    x: number,
    y: number,
    bounds: StockWallModel["bounds"],
    input: ProceduralModifierInput,
): number {
    const c = input.corrections;
    if (!c || (!c.rearfootPostingDeg && !c.forefootPostingDeg)) return 0;
    const minX = bounds.minX;
    const length = Math.max(1e-3, bounds.maxX - minX);
    const widCenter = (bounds.minY + bounds.maxY) * 0.5;
    const halfW = Math.max(1e-3, (bounds.maxY - bounds.minY) * 0.5);
    const u = Math.max(0, Math.min(1, (x - minX) / length));
    const vSigned = ((y - widCenter) / halfW) * (input.medialYSign ?? 1);
    let dz = 0;
    if (c.rearfootPostingDeg) {
        const heel = 1 - Math.max(0, Math.min(1, (u - 0.05) / 0.35));
        dz += Math.tan((c.rearfootPostingDeg * Math.PI) / 180) * vSigned * halfW * heel;
    }
    if (c.forefootPostingDeg) {
        const fore = Math.max(0, Math.min(1, (u - 0.62) / 0.28));
        dz += Math.tan((c.forefootPostingDeg * Math.PI) / 180) * vSigned * halfW * fore;
    }
    return dz;
}

/**
 * Bottom fields that may still offset the plantar sheet: zonal arch fill and
 * arch grind. Thickness, posting, and heel lift are top-only (bottom-stable).
 */
export function plantarZDelta(
    x: number,
    y: number,
    bounds: StockWallModel["bounds"],
    input: ProceduralModifierInput,
): number {
    const c = input.corrections;
    const minX = bounds.minX;
    const length = Math.max(1e-3, bounds.maxX - minX);
    const widCenter = (bounds.minY + bounds.maxY) * 0.5;
    const halfW = Math.max(1e-3, (bounds.maxY - bounds.minY) * 0.5);
    const u = Math.max(0, Math.min(1, (x - minX) / length));
    const vSigned = ((y - widCenter) / halfW) * (input.medialYSign ?? 1);
    const av = Math.abs(vSigned);
    let dz = 0;
    if (c && c.archFillMm) {
        const arch = Math.exp(-(((u - 0.42) / 0.16) ** 2));
        const across = 1 - Math.min(1, av);
        dz += c.archFillMm * arch * across;
    }
    if ((input.archGrindDepthMm ?? 0) > 0) {
        dz += archGrindPlantarRaiseAt(u, av, input.archGrindDepthMm!);
    }
    return dz;
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
