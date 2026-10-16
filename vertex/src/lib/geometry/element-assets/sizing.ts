// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import { getBaseFootprintFrame } from "@/lib/geometry/base-modifier";
import type { Side } from "@/types";
import type { ElementAssetSidecar } from "./types";
import { ELEMENT_SCALE_CLAMP_MAX, ELEMENT_SCALE_CLAMP_MIN } from "./types";

export function sidecarAnchorUV(sidecar: ElementAssetSidecar): { u: number; v: number } {
    return {
        u: sidecar.anchor?.u ?? sidecar.defaultAnchorU ?? 0.5,
        v: sidecar.anchor?.v ?? sidecar.defaultAnchorV ?? 0,
    };
}

/** Local planform width (mm) of a band of vertices around footprint u. */
export function localWidthAtU(base: BufferGeometry, side: Side, u: number, bandU = 0.012): number {
    const frame = getBaseFootprintFrame(base, side);
    const pos = base.getAttribute("position");
    if (!pos) return frame.widSize;
    const arr = pos.array as Float32Array;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < pos.count; i++) {
        const uu = (arr[i * 3 + frame.lengthAxis]! - frame.lenMin) / frame.lenSize;
        if (Math.abs(uu - u) > bandU) continue;
        const w = arr[i * 3 + frame.widthAxis]!;
        lo = Math.min(lo, w);
        hi = Math.max(hi, w);
    }
    if (!Number.isFinite(lo) || hi - lo < 1e-3) return frame.widSize;
    return hi - lo;
}

export function clampElementScale(value: number): { scale: number; clamped: boolean } {
    if (value < ELEMENT_SCALE_CLAMP_MIN) return { scale: ELEMENT_SCALE_CLAMP_MIN, clamped: true };
    if (value > ELEMENT_SCALE_CLAMP_MAX) return { scale: ELEMENT_SCALE_CLAMP_MAX, clamped: true };
    return { scale: value, clamped: false };
}

export interface ElementSizeScale {
    scaleAlong: number;
    scaleAcross: number;
    rawAlong: number;
    rawAcross: number;
    warning?: string;
}

/**
 * XY size vs the authored reference: along-foot L/refMeasuredLength,
 * across-foot local width ratio W/Wref at the sidecar anchor (post #184 affine).
 * Height is never sized here.
 */
export function elementSizeScale(
    base: BufferGeometry,
    side: Side,
    sidecar: ElementAssetSidecar,
    reference?: BufferGeometry | null,
): ElementSizeScale {
    const { u } = sidecarAnchorUV(sidecar);
    const frame = getBaseFootprintFrame(base, side);
    const L = frame.lenSize;
    const Lref =
        sidecar.refMeasuredLengthMm && sidecar.refMeasuredLengthMm > 1e-3 ? sidecar.refMeasuredLengthMm : L;
    const W = localWidthAtU(base, side, u);
    let Wref = sidecar.refWidthAtAnchorMm;
    if (!(Wref != null && Wref > 1e-3) && reference) {
        Wref = localWidthAtU(reference, side, u);
    }
    if (!(Wref != null && Wref > 1e-3)) {
        Wref = W * (Lref / Math.max(L, 1e-3));
    }
    const rawAlong = L / Lref;
    const rawAcross = W / Wref;
    const along = clampElementScale(rawAlong);
    const across = clampElementScale(rawAcross);
    let warning: string | undefined;
    if (along.clamped || across.clamped) {
        warning = `Met pad XY scale clamped to ${ELEMENT_SCALE_CLAMP_MIN}–${ELEMENT_SCALE_CLAMP_MAX} (along ${rawAlong.toFixed(3)}, across ${rawAcross.toFixed(3)}).`;
    }
    return {
        scaleAlong: along.scale,
        scaleAcross: across.scale,
        rawAlong,
        rawAcross,
        warning,
    };
}

/** Center-relative pose from sidecar (u, v) on the current (already-affined) top. */
export function anchorPositionFromSidecar(
    base: BufferGeometry,
    side: Side,
    sidecar: ElementAssetSidecar,
): { x: number; y: number; u: number; v: number } {
    const { u, v } = sidecarAnchorUV(sidecar);
    const frame = getBaseFootprintFrame(base, side);
    const halfW = localWidthAtU(base, side, u) / 2;
    const medialY = side === "left" ? 1 : -1;
    return {
        x: (u - 0.5) * frame.lenSize,
        y: v * halfW * medialY,
        u,
        v,
    };
}
