// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import * as THREE from "three";
import { INSOLE_LENGTH_MM, INSOLE_WIDTH_MM } from "@/lib/geometry/layout";

/**
 * Orthotic footprint sizing.
 *
 * Systems (default **US**):
 * - **US** — Men's half-size key; labels combine Women's (+1.5) and Youth (≤7)
 * - **UK** — Adult UK size (same for M/W); Wikipedia: size ≈ 3×foot_in − 23
 * - **mm** — Direct Mondopoint-style foot length in millimetres
 *
 * Physical scale always comes from foot length vs the Men's 9 / 260×95 mm template.
 *
 * US:  foot_mm = (menSize + 22) × (25.4/3)
 * UK:  foot_mm = (ukSize + 23) × (25.4/3)  ⇒  UK ≈ US men − 1 at the same length
 */

export type ShoeSizeSystem = "us" | "uk" | "mm";

/** Reference US men's size matching {@link INSOLE_LENGTH_MM}. */
export const REFERENCE_US_MEN_SIZE = 9;

/** Default size for new designs. */
export const DEFAULT_US_MEN_SIZE = REFERENCE_US_MEN_SIZE;

/** Default sizing system (US shoe sizes). */
export const DEFAULT_SHOE_SIZE_SYSTEM: ShoeSizeSystem = "us";

/** Inclusive US men's half-size range offered in the dropdown. */
export const US_MEN_SIZE_MIN = 1;
export const US_MEN_SIZE_MAX = 16;

/** Inclusive UK adult half-size range. */
export const UK_SIZE_MIN = 1;
export const UK_SIZE_MAX = 15;

/** Youth / big-kid labels share the US men's number in this band. */
export const US_YOUTH_MEN_MAX = 7;

/** Mondopoint-style length picker (5 mm steps). */
export const FOOT_LENGTH_MM_MIN = 210;
export const FOOT_LENGTH_MM_MAX = 320;
export const FOOT_LENGTH_MM_STEP = 5;

const BARLEYCORN_MM = 25.4 / 3;

/** Brannock US men's foot length in millimetres. */
export function usMenFootLengthMm(menSize: number): number {
    // foot_length_in = (size + 22) / 3  ⇒  mm = (size + 22) × (25.4/3)
    return (menSize + 22) * BARLEYCORN_MM;
}

/** UK adult foot length in millimetres (Wikipedia: size ≈ 3×foot_in − 23). */
export function ukFootLengthMm(ukSize: number): number {
    return (ukSize + 23) * BARLEYCORN_MM;
}

/** Reference foot length for the Men's 9 / 260 mm template. */
export function referenceFootLengthMm(): number {
    return usMenFootLengthMm(REFERENCE_US_MEN_SIZE);
}

/** Snap to a supported half-size within the offered US range. */
export function normalizeUsMenSize(menSize: number): number {
    if (!Number.isFinite(menSize)) return DEFAULT_US_MEN_SIZE;
    const clamped = Math.min(US_MEN_SIZE_MAX, Math.max(US_MEN_SIZE_MIN, menSize));
    return Math.round(clamped * 2) / 2;
}

/** Snap to a supported UK half-size. */
export function normalizeUkSize(ukSize: number): number {
    if (!Number.isFinite(ukSize)) return usMenToUk(DEFAULT_US_MEN_SIZE);
    const clamped = Math.min(UK_SIZE_MAX, Math.max(UK_SIZE_MIN, ukSize));
    return Math.round(clamped * 2) / 2;
}

/** Snap foot length to the Mondopoint-style 5 mm grid. */
export function normalizeFootLengthMm(mm: number): number {
    if (!Number.isFinite(mm))
        return Math.round(referenceFootLengthMm() / FOOT_LENGTH_MM_STEP) * FOOT_LENGTH_MM_STEP;
    const clamped = Math.min(FOOT_LENGTH_MM_MAX, Math.max(FOOT_LENGTH_MM_MIN, mm));
    return Math.round(clamped / FOOT_LENGTH_MM_STEP) * FOOT_LENGTH_MM_STEP;
}

export function normalizeShoeSizeSystem(system: string | undefined | null): ShoeSizeSystem {
    if (system === "uk" || system === "mm") return system;
    return "us";
}

/** All selectable US men's sizes (half steps). */
export function listUsMenSizes(): number[] {
    const out: number[] = [];
    for (let s = US_MEN_SIZE_MIN; s <= US_MEN_SIZE_MAX + 1e-9; s += 0.5) {
        out.push(normalizeUsMenSize(s));
    }
    return out;
}

/** All selectable UK sizes (half steps). */
export function listUkSizes(): number[] {
    const out: number[] = [];
    for (let s = UK_SIZE_MIN; s <= UK_SIZE_MAX + 1e-9; s += 0.5) {
        out.push(normalizeUkSize(s));
    }
    return out;
}

/** Mondopoint length options (5 mm steps). */
export function listFootLengthMmOptions(): number[] {
    const out: number[] = [];
    for (let mm = FOOT_LENGTH_MM_MIN; mm <= FOOT_LENGTH_MM_MAX + 1e-9; mm += FOOT_LENGTH_MM_STEP) {
        out.push(mm);
    }
    return out;
}

/** Women's US label for the same physical shoe (retail +1.5). */
export function usWomenFromMen(menSize: number): number {
    return normalizeUsMenSize(menSize) + 1.5;
}

/** UK adult size for the same foot length as a US men's size (≈ US − 1). */
export function usMenToUk(menSize: number): number {
    return normalizeUkSize(normalizeUsMenSize(menSize) - 1);
}

/** Nearest US men's size for a UK adult size. */
export function ukToUsMen(ukSize: number): number {
    return normalizeUsMenSize(normalizeUkSize(ukSize) + 1);
}

/** Nearest US men's size for a foot length in mm. */
export function footLengthMmToUsMen(mm: number): number {
    const size = mm / BARLEYCORN_MM - 22;
    return normalizeUsMenSize(size);
}

/** Nearest UK size for a foot length in mm. */
export function footLengthMmToUk(mm: number): number {
    const size = mm / BARLEYCORN_MM - 23;
    return normalizeUkSize(size);
}

export function formatHalfSize(size: number): string {
    const n = Math.round(size * 2) / 2;
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

export function formatUkShoeSizeLabel(ukSize: number): string {
    return `UK ${formatHalfSize(normalizeUkSize(ukSize))}`;
}

export function formatFootLengthLabel(mm: number): string {
    const n = normalizeFootLengthMm(mm);
    return `${n} mm`;
}

export interface InsoleLayout {
    sizeSystem: ShoeSizeSystem;
    /** Equivalent US men's size (always filled for cross-system display). */
    usMenSize: number;
    /** Equivalent UK size when applicable. */
    ukSize: number;
    /** Foot length used for scaling (Mondopoint-style mm). */
    footLengthMm: number;
    lengthMm: number;
    widthMm: number;
    /** Uniform XY scale vs the Men's 9 reference template. */
    scale: number;
}

/** Build layout from an absolute foot length vs the Men's 9 template. */
export function insoleLayoutForFootLengthMm(
    footLengthMm: number,
    sizeSystem: ShoeSizeSystem = "mm",
): InsoleLayout {
    const foot = Math.max(1, footLengthMm);
    const scale = foot / referenceFootLengthMm();
    const usMenSize = footLengthMmToUsMen(foot);
    return {
        sizeSystem,
        usMenSize,
        ukSize: footLengthMmToUk(foot),
        footLengthMm: sizeSystem === "mm" ? normalizeFootLengthMm(foot) : foot,
        lengthMm: INSOLE_LENGTH_MM * scale,
        widthMm: INSOLE_WIDTH_MM * scale,
        scale,
    };
}

/** Footprint dimensions for a US men's size, scaled from the Men's 9 template. */
export function insoleLayoutForUsMenSize(menSize: number): InsoleLayout {
    const usMenSize = normalizeUsMenSize(menSize);
    return insoleLayoutForFootLengthMm(usMenFootLengthMm(usMenSize), "us");
}

/** Footprint dimensions for a UK adult size. */
export function insoleLayoutForUkSize(ukSize: number): InsoleLayout {
    const uk = normalizeUkSize(ukSize);
    return insoleLayoutForFootLengthMm(ukFootLengthMm(uk), "uk");
}

/** Design fields that drive footprint sizing. */
export interface ShoeSizingDesign {
    sizeSystem?: ShoeSizeSystem;
    usMenSize?: number;
    ukSize?: number;
    footLengthMm?: number;
}

/** Resolve layout from design state (missing ⇒ US Men's 9). */
export function insoleLayoutFromDesign(design?: ShoeSizingDesign | null): InsoleLayout {
    const system = normalizeShoeSizeSystem(design?.sizeSystem);
    if (system === "mm") {
        const mm =
            design?.footLengthMm ??
            (design?.usMenSize != null
                ? usMenFootLengthMm(normalizeUsMenSize(design.usMenSize))
                : referenceFootLengthMm());
        return insoleLayoutForFootLengthMm(mm, "mm");
    }
    if (system === "uk") {
        const uk =
            design?.ukSize ??
            (design?.usMenSize != null ? usMenToUk(design.usMenSize) : usMenToUk(DEFAULT_US_MEN_SIZE));
        return insoleLayoutForUkSize(uk);
    }
    return insoleLayoutForUsMenSize(design?.usMenSize ?? DEFAULT_US_MEN_SIZE);
}

/**
 * Convert the current footprint length into the nearest value for a target system,
 * preserving physical size when switching US ↔ UK ↔ mm.
 */
export function convertSizingToSystem(
    design: ShoeSizingDesign | null | undefined,
    nextSystem: ShoeSizeSystem,
): Required<Pick<ShoeSizingDesign, "sizeSystem" | "usMenSize" | "ukSize" | "footLengthMm">> {
    const current = insoleLayoutFromDesign(design);
    const foot = current.footLengthMm;
    if (nextSystem === "mm") {
        const footLengthMm = normalizeFootLengthMm(foot);
        return {
            sizeSystem: "mm",
            footLengthMm,
            usMenSize: footLengthMmToUsMen(footLengthMm),
            ukSize: footLengthMmToUk(footLengthMm),
        };
    }
    if (nextSystem === "uk") {
        const ukSize = footLengthMmToUk(foot);
        return {
            sizeSystem: "uk",
            ukSize,
            usMenSize: ukToUsMen(ukSize),
            footLengthMm: ukFootLengthMm(ukSize),
        };
    }
    const usMenSize = footLengthMmToUsMen(foot);
    return {
        sizeSystem: "us",
        usMenSize,
        ukSize: usMenToUk(usMenSize),
        footLengthMm: usMenFootLengthMm(usMenSize),
    };
}

export interface UsShoeSizeOption {
    menSize: number;
    label: string;
    lengthMm: number;
    widthMm: number;
}

export interface UkShoeSizeOption {
    ukSize: number;
    label: string;
    lengthMm: number;
    widthMm: number;
}

export interface FootLengthOption {
    footLengthMm: number;
    label: string;
    lengthMm: number;
    widthMm: number;
}

/** Options for the US size dropdown. */
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

/** Options for the UK size dropdown. */
export function ukShoeSizeOptions(): UkShoeSizeOption[] {
    return listUkSizes().map((ukSize) => {
        const layout = insoleLayoutForUkSize(ukSize);
        return {
            ukSize,
            label: formatUkShoeSizeLabel(ukSize),
            lengthMm: layout.lengthMm,
            widthMm: layout.widthMm,
        };
    });
}

/** Options for the millimetre length dropdown. */
export function footLengthMmOptions(): FootLengthOption[] {
    return listFootLengthMmOptions().map((footLengthMm) => {
        const layout = insoleLayoutForFootLengthMm(footLengthMm, "mm");
        return {
            footLengthMm,
            label: formatFootLengthLabel(footLengthMm),
            lengthMm: layout.lengthMm,
            widthMm: layout.widthMm,
        };
    });
}

/** XY map from a native footprint bbox onto a target insole length/width. */
export type FootprintScale = {
    sx: number;
    sy: number;
    x0: number;
    yMid: number;
};

/** Same XY map used by {@link scaleGeometryToInsoleSize}. */
export function footprintScaleFromNativeBBox(
    nativeBox: { min: THREE.Vector3; max: THREE.Vector3 },
    lengthMm: number,
    widthMm: number,
): FootprintScale | null {
    const nativeLen = nativeBox.max.x - nativeBox.min.x;
    const nativeW = nativeBox.max.y - nativeBox.min.y;
    if (!(nativeLen > 1e-6) || !(nativeW > 1e-6)) return null;
    if (!(lengthMm > 1e-6) || !(widthMm > 1e-6)) return null;
    return {
        sx: lengthMm / nativeLen,
        sy: widthMm / nativeW,
        x0: nativeBox.min.x,
        yMid: (nativeBox.min.y + nativeBox.max.y) / 2,
    };
}

export function footprintScaleFromNativeGeometry(
    geometry: THREE.BufferGeometry,
    lengthMm: number,
    widthMm: number,
): FootprintScale | null {
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box) return null;
    return footprintScaleFromNativeBBox(box, lengthMm, widthMm);
}

export function scalePointToInsoleSize(p: THREE.Vector3, scale: FootprintScale): THREE.Vector3 {
    return new THREE.Vector3((p.x - scale.x0) * scale.sx, (p.y - scale.yMid) * scale.sy, p.z);
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

    const scale = footprintScaleFromNativeBBox(box, lengthMm, widthMm);
    if (!scale) return g;

    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        pos.setX(i, (x - scale.x0) * scale.sx);
        pos.setY(i, (y - scale.yMid) * scale.sy);
    }
    pos.needsUpdate = true;
    g.computeBoundingBox();
    g.computeBoundingSphere();
    g.computeVertexNormals();
    return g;
}
