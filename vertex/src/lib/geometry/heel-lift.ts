// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

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
 */

/** Forward end of the linear taper, as a fraction of insole length (heel = 0, toe = 1). */
export const HEEL_LIFT_TAPER_END = 0.75;

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
