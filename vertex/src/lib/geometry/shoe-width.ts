// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { BufferGeometry } from "three";

export type ShoeWidthId = "extra_narrow" | "narrow" | "medium" | "wide" | "extra_wide" | "xx_wide";

/**
 * Forefoot ball-width deltas (mm) vs Medium. Width only: length (X) is unchanged.
 * 2X Narrow −10, Narrow −5, Medium 0, Wide +5, Extra Wide +10, 2X Wide +15.
 */
export const SHOE_WIDTH_BALL_DELTA_MM: Record<ShoeWidthId, number> = {
    extra_narrow: -10,
    narrow: -5,
    medium: 0,
    wide: 5,
    extra_wide: 10,
    xx_wide: 15,
};

/** Heel may move at most this many mm from Medium. */
export const SHOE_WIDTH_HEEL_CAP_MM = 2;

export const SHOE_WIDTH_LABELS: Record<ShoeWidthId, string> = {
    extra_narrow: "2X Narrow",
    narrow: "Narrow",
    medium: "Medium",
    wide: "Wide",
    extra_wide: "Extra Wide",
    xx_wide: "2X Wide",
};

export function normalizeShoeWidth(id?: string | null): ShoeWidthId {
    if (id === "extra_narrow" || id === "narrow" || id === "wide" || id === "extra_wide" || id === "xx_wide")
        return id;
    return "medium";
}

/** scaleX = (ballWidth + delta) / ballWidth. Length is unchanged. */
export function shoeWidthBallScale(ballWidthMm: number, width: ShoeWidthId): number {
    const w = Math.max(1e-3, ballWidthMm);
    return (w + SHOE_WIDTH_BALL_DELTA_MM[width]) / w;
}

/**
 * Heel scale, capped at ±{@link SHOE_WIDTH_HEEL_CAP_MM} from Medium.
 * `heelOverrideMm` (corrections) replaces the width-class heel change.
 */
export function shoeWidthHeelScale(
    heelWidthMm: number,
    ballWidthMm: number,
    width: ShoeWidthId,
    heelOverrideMm?: number,
): { scale: number; deltaMm: number; capped: boolean } {
    const heel = Math.max(1e-3, heelWidthMm);
    if (heelOverrideMm != null && Number.isFinite(heelOverrideMm) && Math.abs(heelOverrideMm) > 1e-6) {
        return { scale: 1, deltaMm: 0, capped: false };
    }
    const ballScale = shoeWidthBallScale(ballWidthMm, width);
    const implied = heel * (ballScale - 1);
    const deltaMm = Math.max(-SHOE_WIDTH_HEEL_CAP_MM, Math.min(SHOE_WIDTH_HEEL_CAP_MM, implied));
    return {
        scale: (heel + deltaMm) / heel,
        deltaMm,
        capped: Math.abs(implied) > SHOE_WIDTH_HEEL_CAP_MM + 1e-6,
    };
}

function smoothstep01(e0: number, e1: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - e0) / Math.max(1e-9, e1 - e0)));
    return t * t * (3 - 2 * t);
}

/**
 * Planform Y-scale vs Medium. Heel is capped; full ball scale by midfoot (u≥0.48).
 */
export function shoeWidthScaleAtU(
    u: number,
    ballWidthMm: number,
    heelWidthMm: number,
    width: ShoeWidthId,
    heelOverrideMm?: number,
): number {
    const ball = shoeWidthBallScale(ballWidthMm, width);
    const heel = shoeWidthHeelScale(heelWidthMm, ballWidthMm, width, heelOverrideMm).scale;
    const t = smoothstep01(0.08, 0.48, u);
    return heel + (ball - heel) * t;
}

export interface ShoeWidthAffineOpts {
    ballWidthMm: number;
    heelWidthMm: number;
    minX: number;
    lengthMm: number;
    heelOverrideMm?: number;
    /**
     * Pivot the affine uses. Omit it and the pivot is the mean Y of the points
     * being scaled. The top mesh passes its own vertex mean so a second outline
     * does not scale about a different centre.
     */
    yMid?: number;
}

/** X span and Y pivot of the vertices {@link applyShoeWidthToGeometry} scales. */
export interface ShoeWidthFrame {
    minX: number;
    lengthMm: number;
    yMid: number;
}

/**
 * Stations where the affine is a constant scale, so a chord measured here
 * grows by exactly the width delta. u=0.70 is full ball scale (the forefoot).
 * u=0.05 is still the heel cap, before the taper begins at u=0.08.
 */
export const SHOE_WIDTH_FOREFOOT_U = 0.7;
export const SHOE_WIDTH_HEEL_U = 0.05;

/** Default-mesh widths the shared 1D scale is taken from. */
export interface ShoeWidthReference {
    ballWidthMm: number;
    heelWidthMm: number;
    frame: ShoeWidthFrame;
    forefootU: number;
    heelU: number;
}

/**
 * Lateral chord (max Y − min Y) of vertices near `u`. X is the length axis.
 * The window stays inside a constant-scale region so the chord is the width
 * the affine multiplies.
 */
function planformChordAtU(geometry: BufferGeometry, frame: ShoeWidthFrame, u: number): number {
    const pos = geometry.getAttribute("position");
    if (!pos || pos.count === 0) return 1e-3;
    const x0 = frame.minX + u * frame.lengthMm;
    let half = Math.max(1, frame.lengthMm * 0.012);
    let minY = Infinity;
    let maxY = -Infinity;
    let n = 0;
    const take = (windowMm: number) => {
        minY = Infinity;
        maxY = -Infinity;
        n = 0;
        for (let i = 0; i < pos.count; i++) {
            if (Math.abs(pos.getX(i) - x0) > windowMm) continue;
            const y = pos.getY(i);
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            n++;
        }
    };
    take(half);
    if (n < 2) {
        half = Math.max(half * 3, frame.lengthMm * 0.04);
        take(half);
    }
    if (n < 2 || !(maxY > minY)) return 1e-3;
    return maxY - minY;
}

/**
 * The 1D width scale of this mesh's own Medium planform.
 * Forefoot chord + the width-class delta, divided by that chord, is the full
 * forefoot scale. The heel chord is the other end of the taper. Top and bottom
 * both pass this reference so they share one scale.
 */
export function shoeWidthReferenceOfGeometry(geometry: BufferGeometry): ShoeWidthReference {
    const frame = shoeWidthFrameOfGeometry(geometry);
    return {
        ballWidthMm: planformChordAtU(geometry, frame, SHOE_WIDTH_FOREFOOT_U),
        heelWidthMm: planformChordAtU(geometry, frame, SHOE_WIDTH_HEEL_U),
        frame,
        forefootU: SHOE_WIDTH_FOREFOOT_U,
        heelU: SHOE_WIDTH_HEEL_U,
    };
}

/** Same minX / length / vertex-mean Y that {@link applyShoeWidthToGeometry} uses. */
export function shoeWidthFrameOfGeometry(geometry: BufferGeometry): ShoeWidthFrame {
    const pos = geometry.getAttribute("position");
    if (!pos || pos.count === 0) return { minX: 0, lengthMm: 1e-3, yMid: 0 };
    let minX = Infinity;
    let maxX = -Infinity;
    let ySum = 0;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        ySum += pos.getY(i);
    }
    if (!Number.isFinite(minX)) return { minX: 0, lengthMm: 1e-3, yMid: 0 };
    return { minX, lengthMm: Math.max(1e-3, maxX - minX), yMid: ySum / pos.count };
}

/**
 * Plan X span of the points the width affine scales.
 * Non-finite X is ignored. An empty span stays a tiny positive length so u is finite.
 */
export function shoeWidthExtentOfPoints(pts: readonly { x: number }[]): { minX: number; lengthMm: number } {
    let minX = Infinity;
    let maxX = -Infinity;
    for (const p of pts) {
        if (!Number.isFinite(p.x)) continue;
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
    }
    if (!Number.isFinite(minX)) return { minX: 0, lengthMm: 1e-3 };
    return { minX, lengthMm: Math.max(1e-3, maxX - minX) };
}

/** True when the width class or a heel-override actually changes Y. */
export function shoeWidthAffineActive(width: ShoeWidthId, heelOverrideMm?: number): boolean {
    return width !== "medium" || (heelOverrideMm != null && Math.abs(heelOverrideMm) > 1e-6);
}

/**
 * Same affine as {@link applyShoeWidthToPoints}: Y' = yMid + (Y − yMid) · s(u).
 * Length (X) is unchanged. Heel is capped; full ball scale by u ≥ 0.48.
 */
export function shoeWidthAffineY(
    x: number,
    y: number,
    yMid: number,
    width: ShoeWidthId,
    opts: ShoeWidthAffineOpts,
): number {
    const u = (x - opts.minX) / Math.max(1e-3, opts.lengthMm);
    const s = shoeWidthScaleAtU(u, opts.ballWidthMm, opts.heelWidthMm, width, opts.heelOverrideMm);
    return yMid + (y - yMid) * s;
}

export function applyShoeWidthToPoints<T extends { x: number; y: number }>(
    pts: T[],
    width: ShoeWidthId,
    opts: ShoeWidthAffineOpts,
): T[] {
    if (!Array.isArray(pts) || pts.length === 0) return pts;
    if (!shoeWidthAffineActive(width, opts.heelOverrideMm)) return pts;
    // A missing extent (BaseBounds has no minX) makes every u NaN and every Y NaN.
    // The trimline tube then indexes an undefined Catmull-Rom point. Finite hints
    // are used unchanged so widths that already scaled stay on the same frame.
    const affine =
        Number.isFinite(opts.minX) && Number.isFinite(opts.lengthMm)
            ? opts
            : { ...opts, ...shoeWidthExtentOfPoints(pts) };
    // A caller-supplied pivot is the mesh vertex mean. Falling back to the
    // loop's own mean is the pre-#459 outline behaviour and stays in place
    // for callers that do not have the mesh.
    const yMid =
        opts.yMid != null && Number.isFinite(opts.yMid)
            ? opts.yMid
            : pts.reduce((s, p) => s + p.y, 0) / Math.max(1, pts.length);
    return pts.map((p) => {
        const y = shoeWidthAffineY(p.x, p.y, yMid, width, affine);
        const clone = (p as { clone?: () => T }).clone;
        if (typeof clone === "function") {
            const next = clone.call(p);
            (next as { y: number }).y = y;
            return next;
        }
        return { ...p, y };
    });
}

/**
 * Apply the viewer shoe-width affine to every vertex of a top mesh.
 * Same s(u) / yMid formula as {@link applyShoeWidthToPoints}.
 */
export function applyShoeWidthToGeometry(
    geometry: BufferGeometry,
    width: ShoeWidthId,
    opts: {
        ballWidthMm: number;
        heelWidthMm: number;
        minX?: number;
        lengthMm?: number;
        heelOverrideMm?: number;
    },
): BufferGeometry {
    const pos = geometry.getAttribute("position");
    if (!pos) return geometry.clone();
    if (!shoeWidthAffineActive(width, opts.heelOverrideMm)) return geometry.clone();
    const count = pos.count;
    const frame = shoeWidthFrameOfGeometry(geometry);
    const minX = opts.minX != null && Number.isFinite(opts.minX) ? opts.minX : frame.minX;
    const lengthMm = opts.lengthMm != null && Number.isFinite(opts.lengthMm) ? opts.lengthMm : frame.lengthMm;
    const yMid = frame.yMid;
    const affine: ShoeWidthAffineOpts = {
        ballWidthMm: opts.ballWidthMm,
        heelWidthMm: opts.heelWidthMm,
        minX,
        lengthMm,
        yMid,
        heelOverrideMm: opts.heelOverrideMm,
    };
    const out = geometry.clone();
    const dst = out.getAttribute("position");
    if (!dst) return out;
    const arr = dst.array as Float32Array;
    for (let i = 0; i < count; i++) {
        const x = arr[i * 3]!;
        const y = arr[i * 3 + 1]!;
        arr[i * 3 + 1] = shoeWidthAffineY(x, y, yMid, width, affine);
    }
    dst.needsUpdate = true;
    out.computeBoundingBox();
    out.computeBoundingSphere();
    return out;
}

export function shoeWidthHint(width: ShoeWidthId): string {
    const d = SHOE_WIDTH_BALL_DELTA_MM[width];
    const heel = d === 0 ? 0 : d > 0 ? SHOE_WIDTH_HEEL_CAP_MM : -SHOE_WIDTH_HEEL_CAP_MM;
    const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
    if (width === "medium") return "Medium: 0 mm forefoot, 0 mm heel";
    return `${SHOE_WIDTH_LABELS[width]}: ${sign(d)} mm forefoot, ${sign(heel)} mm heel`;
}

export function hasHeelWidthOverride(mm?: number | null): boolean {
    return mm != null && Number.isFinite(mm) && Math.abs(mm) > 1e-6;
}

export interface ShoeWidthDesignSlice {
    shoeWidth?: string | null;
    shoeWidthBySide?: { left?: string | null; right?: string | null };
    corrections?: { linked?: boolean };
}

export function shoeWidthForSide(design: ShoeWidthDesignSlice, side: "left" | "right"): ShoeWidthId {
    if (design.corrections?.linked !== false) return normalizeShoeWidth(design.shoeWidth);
    return normalizeShoeWidth(design.shoeWidthBySide?.[side] ?? design.shoeWidth);
}

/** Linked: one label. Unlocked with different L/R: "L Wide / R Medium". */
export function formatShoeWidthSummary(design: ShoeWidthDesignSlice): string {
    const left = shoeWidthForSide(design, "left");
    const right = shoeWidthForSide(design, "right");
    if (design.corrections?.linked !== false || left === right) return SHOE_WIDTH_LABELS[left];
    return `L ${SHOE_WIDTH_LABELS[left]} / R ${SHOE_WIDTH_LABELS[right]}`;
}
