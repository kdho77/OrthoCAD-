// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { BufferGeometry } from "three";

export type ShoeWidthId = "extra_narrow" | "narrow" | "medium" | "wide" | "extra_wide";

/**
 * Forefoot ball-width deltas (mm) vs Medium. Width only: length (X) is unchanged.
 * 2X Narrow −10, Narrow −5, Medium 0, Wide +5, 2X Wide +10.
 */
export const SHOE_WIDTH_BALL_DELTA_MM: Record<ShoeWidthId, number> = {
    extra_narrow: -10,
    narrow: -5,
    medium: 0,
    wide: 5,
    extra_wide: 10,
};

/** Heel may move at most this many mm from Medium. */
export const SHOE_WIDTH_HEEL_CAP_MM = 2;

export const SHOE_WIDTH_LABELS: Record<ShoeWidthId, string> = {
    extra_narrow: "2X Narrow",
    narrow: "Narrow",
    medium: "Medium",
    wide: "Wide",
    extra_wide: "2X Wide",
};

export function normalizeShoeWidth(id?: string | null): ShoeWidthId {
    if (id === "extra_narrow" || id === "narrow" || id === "wide" || id === "extra_wide") return id;
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
    const yMid = pts.reduce((s, p) => s + p.y, 0) / Math.max(1, pts.length);
    return pts.map((p) => {
        const y = shoeWidthAffineY(p.x, p.y, yMid, width, opts);
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
    let minX = opts.minX;
    let lengthMm = opts.lengthMm;
    if (minX == null || lengthMm == null || !Number.isFinite(lengthMm)) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < count; i++) {
            const x = pos.getX(i);
            lo = Math.min(lo, x);
            hi = Math.max(hi, x);
        }
        minX = lo;
        lengthMm = Math.max(1e-3, hi - lo);
    }
    let ySum = 0;
    for (let i = 0; i < count; i++) ySum += pos.getY(i);
    const yMid = ySum / Math.max(1, count);
    const affine: ShoeWidthAffineOpts = {
        ballWidthMm: opts.ballWidthMm,
        heelWidthMm: opts.heelWidthMm,
        minX,
        lengthMm,
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
