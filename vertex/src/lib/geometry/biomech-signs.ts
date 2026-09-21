// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Bio LOCKED clinical sign conventions (OrthoCAD biomechanics tables).
 * Change only when Bio explicitly revises the table — do not infer from CAD.
 */

/**
 * Track 4 — Intrinsic post (mm): +mm = medial high (varus; increases supination
 * moment / resists pronation); −mm = lateral high.
 */
export const BIO_INTRINSIC_POST_SIGN_POSITIVE_MM_MEDIAL_HIGH = 1;

/**
 * Track 5 — Arch Grind Depth (mm): +mm deepens the **bottom** plantar surface
 * (CNC/lab grind), NOT a top/contact sink. Wire in Track 5 / sibling PR.
 */
export const BIO_ARCH_GRIND_POSITIVE_MM_BOTTOM_DEEPEN = 1;
