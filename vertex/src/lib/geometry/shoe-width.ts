// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export type ShoeWidthId = "narrow" | "medium" | "wide" | "extra_wide";

/** Forefoot ball-width deltas (mm) vs Medium. */
export const SHOE_WIDTH_BALL_DELTA_MM: Record<ShoeWidthId, number> = {
    narrow: -5,
    medium: 0,
    wide: 5,
    extra_wide: 10,
};

/** Heel may move at most this many mm from Medium. */
export const SHOE_WIDTH_HEEL_CAP_MM = 2;

export const SHOE_WIDTH_LABELS: Record<ShoeWidthId, string> = {
    narrow: "Narrow",
    medium: "Medium",
    wide: "Wide",
    extra_wide: "Extra Wide",
};

export function normalizeShoeWidth(id?: string | null): ShoeWidthId {
    if (id === "narrow" || id === "wide" || id === "extra_wide") return id;
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

export function applyShoeWidthToPoints<T extends { x: number; y: number }>(
    pts: T[],
    width: ShoeWidthId,
    opts: {
        ballWidthMm: number;
        heelWidthMm: number;
        minX: number;
        lengthMm: number;
        heelOverrideMm?: number;
    },
): T[] {
    if (width === "medium" && !(opts.heelOverrideMm && Math.abs(opts.heelOverrideMm) > 1e-6)) return pts;
    const yMid = pts.reduce((s, p) => s + p.y, 0) / Math.max(1, pts.length);
    return pts.map((p) => {
        const u = (p.x - opts.minX) / Math.max(1e-3, opts.lengthMm);
        const s = shoeWidthScaleAtU(u, opts.ballWidthMm, opts.heelWidthMm, width, opts.heelOverrideMm);
        return { ...p, y: yMid + (p.y - yMid) * s };
    });
}

export function shoeWidthHint(width: ShoeWidthId): string {
    const d = SHOE_WIDTH_BALL_DELTA_MM[width];
    const heel = d === 0 ? 0 : d > 0 ? SHOE_WIDTH_HEEL_CAP_MM : -SHOE_WIDTH_HEEL_CAP_MM;
    const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
    if (width === "medium") return "Medium: 0 mm forefoot, 0 mm heel";
    return `${SHOE_WIDTH_LABELS[width]}: ${sign(d)} mm forefoot, ${sign(heel)} mm heel`;
}
