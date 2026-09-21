// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { clampPostFilletMm, DEFAULT_POST_FILLET_MM } from "@/lib/geometry/track4-shared";

function smoothstep(e0: number, e1: number, x: number): number {
    if (e0 === e1) return x < e0 ? 0 : 1;
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
}

/**
 * Shared M–L perimeter falloff for intrinsic free-edges, posting blocks, shell rim.
 * Full strength inboard of fillet inset; eases to 0 at the trimline (av → 1).
 */
export function postPerimeterFalloffFromAv(av: number, widthMm: number, postFilletMm?: number): number {
    const fillet = clampPostFilletMm(postFilletMm ?? DEFAULT_POST_FILLET_MM);
    const halfW = Math.max(widthMm / 2, 1e-6);
    const insetAv = Math.max(0, Math.min(0.98, 1 - fillet / halfW));
    return 1 - smoothstep(insetAv, 1, av);
}

/** Rim band mask: 0 inboard of fillet inset → 1 at the trimline (shell edge #5). */
export function postRimBandFromAv(av: number, widthMm: number, postFilletMm?: number): number {
    const fillet = clampPostFilletMm(postFilletMm ?? DEFAULT_POST_FILLET_MM);
    const halfW = Math.max(widthMm / 2, 1e-6);
    const insetAv = Math.max(0, Math.min(0.98, 1 - fillet / halfW));
    return smoothstep(insetAv, 1, av);
}

/** Coronal QC sample |vSigned| inset from the lateral trim by `postFilletMm`. */
export function postSectionVSignedInset(medial: boolean, widthMm: number, postFilletMm?: number): number {
    const fillet = clampPostFilletMm(postFilletMm ?? DEFAULT_POST_FILLET_MM);
    const halfW = Math.max(widthMm / 2, 1e-6);
    const inset = Math.max(0.35, Math.min(0.95, (halfW - fillet) / halfW));
    return medial ? inset : -inset;
}
