// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

/**
 * Heel lift system (longitudinal ramp).
 *
 * A heel lift raises the plantar (top/foot-contact) surface under the
 * center/back of the heel and tapers it forward to nothing under the
 * metatarsal heads. It is the classic correction for a leg-length
 * discrepancy or a tight gastroc/soleus complex.
 *
 * Behaviour (per spec):
 *  - `heelLiftMm = N` raises the heel cup by exactly N mm. The full amount is
 *    held from the posterior edge through the cup (seat, walls, and rim), so
 *    the lowest point of the heel seat — the cup center — rises by N and the
 *    cup depth does not change.
 *  - Forward of that hold the raise tapers **linearly** to 0 by the configured
 *    taper endpoint (fraction of insole length), and is 0 from there to the toe.
 *  - It is a purely longitudinal ramp (no medial/lateral bias), applied across
 *    the full width — stylistically the longitudinal analogue of the
 *    medial/lateral {@link wedgeDeltaAt} cross-section ramp.
 *
 * Composition / stability:
 *  - The contribution is **additive** on the top surface only. The height-field
 *    model keeps the bottom on the flat z = 0 plane, so adding a positive lift
 *    raises the top while the print/mill base stays flat — i.e. bottom-stable on
 *    solid prints by construction.
 */

/**
 * Full lift is held through this normalized station (heel = 0, toe = 1).
 *
 * 0.28 is the anterior edge of the existing heel-cup longitudinal mask
 * (`bump(u, 0.10, 0.18)`). The stock SAMPLE_Top cup center, the lowest
 * heel-seat point, sits near u = 0.12, inside the hold. Seat, cup walls,
 * and rim in that zone therefore move by the same amount. The linear taper
 * to {@link HEEL_LIFT_TAPER_END_DEFAULT_U} starts at this station.
 */
export const HEEL_LIFT_FULL_HOLD_U = 0.28;

/** Default forward end of the linear taper (met heads region). */
export const HEEL_LIFT_TAPER_END_DEFAULT_U = 0.75;

export const HEEL_LIFT_TAPER_END_MIN_U = 0.45;
export const HEEL_LIFT_TAPER_END_MAX_U = 0.9;

export type HeelLiftTaperPreset = "midfoot" | "metHeads" | "sulcus" | "custom";

/** Bio enum → normalized u (heel = 0, toe = 1). */
export const HEEL_LIFT_TAPER_PRESET_U: Record<Exclude<HeelLiftTaperPreset, "custom">, number> = {
    midfoot: 0.55,
    metHeads: 0.75,
    sulcus: 0.9,
};

export const HEEL_LIFT_CUSTOM_TAPER_PCT_AP_DEFAULT = 45;
export const HEEL_LIFT_CUSTOM_TAPER_PCT_AP_MIN = 25;
export const HEEL_LIFT_CUSTOM_TAPER_PCT_AP_MAX = 75;

/**
 * @deprecated Use {@link resolveHeelLiftTaperEndU} — kept for callers that import the constant.
 */
export const HEEL_LIFT_TAPER_END = HEEL_LIFT_TAPER_END_DEFAULT_U;

export interface HeelLiftTaperOptions {
    preset?: HeelLiftTaperPreset;
    /** Explicit endpoint u; overrides preset when set. */
    endU?: number;
    /** Custom %AP (25–75) when preset === custom. */
    customPctAp?: number;
}

export function clampHeelLiftTaperEndU(u: number): number {
    return Math.max(HEEL_LIFT_TAPER_END_MIN_U, Math.min(HEEL_LIFT_TAPER_END_MAX_U, u));
}

export function resolveHeelLiftTaperEndU(options?: HeelLiftTaperOptions): number {
    if (options?.endU !== undefined && Number.isFinite(options.endU)) {
        return clampHeelLiftTaperEndU(options.endU);
    }
    const preset = options?.preset ?? "metHeads";
    if (preset === "custom") {
        const pct = options?.customPctAp ?? HEEL_LIFT_CUSTOM_TAPER_PCT_AP_DEFAULT;
        const clamped = Math.max(
            HEEL_LIFT_CUSTOM_TAPER_PCT_AP_MIN,
            Math.min(HEEL_LIFT_CUSTOM_TAPER_PCT_AP_MAX, pct),
        );
        return clampHeelLiftTaperEndU(clamped / 100);
    }
    return clampHeelLiftTaperEndU(HEEL_LIFT_TAPER_PRESET_U[preset]);
}

/**
 * Additive height contribution (mm, positive = raise) of the heel lift at a
 * normalized longitudinal coordinate `u` (0 = heel, 1 = toe).
 */
export function heelLiftDeltaAt(u: number, heelLiftMm: number, taper?: HeelLiftTaperOptions): number {
    if (heelLiftMm <= 0) return 0;
    const endU = resolveHeelLiftTaperEndU(taper);
    // Posterior of the cup center, and the rest of the heel cup, stay at the
    // full amount. A ramp that peaks only at u = 0 leaves the lowest seat
    // point short of H and lets a more anterior rim rise less than the seat.
    if (u <= HEEL_LIFT_FULL_HOLD_U) return heelLiftMm;
    if (!(endU > HEEL_LIFT_FULL_HOLD_U) || u >= endU) return 0;
    return (heelLiftMm * (endU - u)) / (endU - HEEL_LIFT_FULL_HOLD_U);
}
