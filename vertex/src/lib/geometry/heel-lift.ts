// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BuildLength } from "@/types";

/**
 * Heel lift system (longitudinal ramp).
 *
 * A heel lift raises the plantar (top/foot-contact) surface under the
 * center/back of the heel and tapers it forward to nothing under the
 * metatarsal heads. It is the classic correction for a leg-length
 * discrepancy or a tight gastroc/soleus complex.
 *
 * Behaviour (per spec):
 *  - `heelLiftMm = N` raises the surface at the heel (u = 0) by exactly N mm.
 *  - The raise tapers **linearly** to 0 by `HEEL_LIFT_TAPER_END` of the insole
 *    length (≈ the metatarsal heads), and is 0 from there to the toe.
 *  - It is a purely longitudinal ramp (no medial/lateral bias), applied across
 *    the full width — stylistically the longitudinal analogue of the
 *    medial/lateral {@link wedgeDeltaAt} cross-section ramp.
 *
 * Composition / stability:
 *  - The contribution is **additive** on the top surface only. The height-field
 *    model keeps the bottom on the flat z = 0 plane, so adding a positive lift
 *    raises the top while the print/mill base stays flat — i.e. bottom-stable on
 *    solid prints by construction.
 *
 * u-axis convention (confirmed): **heel = 0, toe = 1** throughout.
 */

/** Forward end of the linear taper, as a fraction of insole length (heel = 0, toe = 1). */
export const HEEL_LIFT_TAPER_END = 0.75;

/**
 * Shell clearance proximal to first metatarsal head (literature-informed defaults).
 * Kendon will validate/adjust against physical prints — keep these named and tunable.
 */
export const MIN_ARCH_MARGIN_MM = 10;
export const MAX_ARCH_MARGIN_MM = 25;

/**
 * Distal offset past archEndU for sulcus-length builds (mm along length).
 * PLACEHOLDER — not literature-verified to the same standard as arch margin;
 * Kendon intends to validate/adjust via physical testing.
 */
export const SULCUS_OFFSET_MM = 15;

/**
 * Proximal boundary of the bottom-pattern lock zone (normalized u, heel=0 → toe=1).
 * archEndU = HEEL_LIFT_TAPER_END − margin/length, margin clamped to [MIN, MAX] arch margins.
 */
export function archEndU(insoleLengthMm: number): number {
    const L = Math.max(1e-6, insoleLengthMm);
    const marginMm = Math.min(MAX_ARCH_MARGIN_MM, Math.max(MIN_ARCH_MARGIN_MM, 0.06 * L));
    return HEEL_LIFT_TAPER_END - marginMm / L;
}

/**
 * Distal (anterior) extent for a build-length class, as normalized u (heel=0 → toe=1).
 * three_quarter terminates at archEndU (near-zero lock zone by design).
 */
export function anteriorU(buildLength: BuildLength, insoleLengthMm: number): number {
    const end = archEndU(insoleLengthMm);
    if (buildLength === "full") return 1;
    if (buildLength === "three_quarter") return end;
    // sulcus
    const L = Math.max(1e-6, insoleLengthMm);
    return Math.min(1, end + SULCUS_OFFSET_MM / L);
}

/**
 * Lock-zone interval [archEndU, anteriorU]. Empty when anteriorU ≤ archEndU
 * (expected for three_quarter) — callers must treat as no lock.
 */
export function lockZoneURange(
    buildLength: BuildLength,
    insoleLengthMm: number,
): { archEnd: number; anterior: number; active: boolean } {
    const archEnd = archEndU(insoleLengthMm);
    const anterior = anteriorU(buildLength, insoleLengthMm);
    return { archEnd, anterior, active: anterior > archEnd + 1e-6 };
}

/**
 * Additive height contribution (mm, positive = raise) of the heel lift at a
 * normalized longitudinal coordinate `u` (0 = heel, 1 = toe).
 *
 * @param u           Normalized length coordinate in [0, 1].
 * @param heelLiftMm  Lift height at the heel (mm). Values ≤ 0 contribute nothing.
 */
export function heelLiftDeltaAt(u: number, heelLiftMm: number): number {
    if (heelLiftMm <= 0) return 0;
    // Linear ramp: full lift at the heel, 0 at (and beyond) the taper end.
    const t = Math.max(0, Math.min(1, 1 - u / HEEL_LIFT_TAPER_END));
    return heelLiftMm * t;
}
