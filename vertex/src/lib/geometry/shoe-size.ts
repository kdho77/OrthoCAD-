// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type * as THREE from "three";
import { INSOLE_LENGTH_MM, INSOLE_WIDTH_MM } from "@/lib/geometry/layout";

/**
 * US shoe sizing for orthotic footprint scaling.
 *
 * Canonical key is **US Men's** size (half-size steps). Labels combine the
 * equivalent Women's (+1.5) and Youth (same number, sizes 1–7) retail markings
 * that share one physical length — e.g. "M 12 / W 13.5", "M 5.5 / W 7 / Youth 5.5".
 *
 * Length uses the Brannock / customary US men's foot-length formula:
 *   foot_length_in = (menSize + 22) / 3
 *   foot_length_mm = foot_length_in × 25.4
 *
 * The stock parametric template (260 × 95 mm) is treated as Men's 9; other sizes
 * scale uniformly from that reference so existing geometry stays consistent.
 */

/** Reference US men's size matching {@link INSOLE_LENGTH_MM}. */
export const REFERENCE_US_MEN_SIZE = 9;

/** Default size for new designs. */
export const DEFAULT_US_MEN_SIZE = REFERENCE_US_MEN_SIZE;

/** Inclusive US men's half-size range offered in the dropdown. */
export const US_MEN_SIZE_MIN = 1;
export const US_MEN_SIZE_MAX = 16;

/** Youth / big-kid labels share the men's number in this band. */
export const US_YOUTH_MEN_MAX = 7;

const BARLEYCORN_MM = 25.4 / 3;

/** Brannock US men's foot length in millimetres. */
export function usMenFootLengthMm(menSize: number): number {
    // foot_length_in = (size + 22) / 3  ⇒  mm = (size + 22) × (25.4/3)
    return (menSize + 22) * BARLEYCORN_MM;
}

/** Snap to a supported half-size within the offered range. */
export function normalizeUsMenSize(menSize: number): number {
    if (!Number.isFinite(menSize)) return DEFAULT_US_MEN_SIZE;
    const clamped = Math.min(US_MEN_SIZE_MAX, Math.max(US_MEN_SIZE_MIN, menSize));
    return Math.round(clamped * 2) / 2;
}

/** All selectable US men's sizes (half steps). */
export function listUsMenSizes(): number[] {
    const out: number[] = [];
    for (let s = US_MEN_SIZE_MIN; s <= US_MEN_SIZE_MAX + 1e-9; s += 0.5) {
        out.push(normalizeUsMenSize(s));
    }
    return out;
}

/** Women's US label for the same physical shoe (retail +1.5). */
export function usWomenFromMen(menSize: number): number {
    return normalizeUsMenSize(menSize) + 1.5;
}

export function formatHalfSize(size: number): string {
    const n = normalizeUsMenSize(size);
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * Dropdown label: "M 12 / W 13.5" or "M 5.5 / W 7 / Youth 5.5".
 */
export function formatUsShoeSizeLabel(menSize: number): string {
    const m = normalizeUsMenSize(menSize);
    const parts = [`M ${formatHalfSize(m)}`, `W ${formatHalfSize(usWomenFromMen(m))}`];
    if (m <= US_YOUTH_MEN_MAX) {
        parts.push(`Youth ${formatHalfSize(m)}`);
    }
    return parts.join(" / ");
}

export interface InsoleLayout {
    /** Canonical US men's size driving this layout. */
    usMenSize: number;
    lengthMm: number;
    widthMm: number;
    /** Uniform XY scale vs the Men's 9 reference template. */
    scale: number;
}

/** Footprint dimensions for a US men's size, scaled from the Men's 9 template. */
export function insoleLayoutForUsMenSize(menSize: number): InsoleLayout {
    const usMenSize = normalizeUsMenSize(menSize);
    const scale = usMenFootLengthMm(usMenSize) / usMenFootLengthMm(REFERENCE_US_MEN_SIZE);
    return {
        usMenSize,
        lengthMm: INSOLE_LENGTH_MM * scale,
        widthMm: INSOLE_WIDTH_MM * scale,
        scale,
    };
}

/** Resolve layout from design state (missing size ⇒ Men's 9). */
export function insoleLayoutFromDesign(design?: { usMenSize?: number } | null): InsoleLayout {
    return insoleLayoutForUsMenSize(design?.usMenSize ?? DEFAULT_US_MEN_SIZE);
}

export interface UsShoeSizeOption {
    menSize: number;
    label: string;
    lengthMm: number;
    widthMm: number;
}

/** Options for the size dropdown. */
export function usShoeSizeOptions(): UsShoeSizeOption[] {
    return listUsMenSizes().map((menSize) => {
        const layout = insoleLayoutForUsMenSize(menSize);
        return {
            menSize,
            label: formatUsShoeSizeLabel(menSize),
            lengthMm: layout.lengthMm,
            widthMm: layout.widthMm,
        };
    });
}

/**
 * Scale a footprint-frame geometry (X = length 0..L, Y = width centered) so its
 * bounding box matches the target insole length/width. Z (height) is unchanged.
 */
export function scaleGeometryToInsoleSize(
    geometry: THREE.BufferGeometry,
    lengthMm: number,
    widthMm: number,
): THREE.BufferGeometry {
    const g = geometry.clone();
    g.computeBoundingBox();
    const box = g.boundingBox;
    const pos = g.getAttribute("position");
    if (!box || !pos) return g;

    const nativeLen = box.max.x - box.min.x;
    const nativeW = box.max.y - box.min.y;
    if (!(nativeLen > 1e-6) || !(nativeW > 1e-6)) return g;

    const sx = lengthMm / nativeLen;
    const sy = widthMm / nativeW;
    const x0 = box.min.x;
    const yMid = (box.min.y + box.max.y) / 2;

    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        pos.setX(i, (x - x0) * sx);
        pos.setY(i, (y - yMid) * sy);
    }
    pos.needsUpdate = true;
    g.computeBoundingBox();
    g.computeBoundingSphere();
    g.computeVertexNormals();
    return g;
}
