// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

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

/** Notch centre in authored asset mm (centroid origin, +X medial, +Y toe). */
export function notchAssetMm(sidecar: ElementAssetSidecar): { x: number; y: number } | null {
    const n = sidecar.notch;
    if (!n) return null;
    if (n.centerAssetMm && Number.isFinite(n.centerAssetMm.x) && Number.isFinite(n.centerAssetMm.y)) {
        return { x: n.centerAssetMm.x, y: n.centerAssetMm.y };
    }
    if (n.centerAuthoredMm && sidecar.anchorMm) {
        return {
            x: n.centerAuthoredMm.x - sidecar.anchorMm.x,
            y: n.centerAuthoredMm.y - sidecar.anchorMm.y,
        };
    }
    return null;
}

/**
 * Notch offset in app footprint mm (after authored→app, before LEFT Y-flip).
 * Uses mm coordinates — never the stale sidecar `centerUV.v`.
 */
export function notchOffsetAppMm(sidecar: ElementAssetSidecar): { x: number; y: number } | null {
    const asset = notchAssetMm(sidecar);
    if (!asset) return null;
    // Authored (+X medial, +Y toe) → app (+X toe, +Y left-medial) without LEFT flip.
    return { x: asset.y, y: -asset.x };
}

/**
 * Notch (u, v) from mm. `u = (authoredY+1)/refSizeMm`.
 * `v` is medial fraction of local half-width at that u — stored `centerUV.v` is ignored.
 */
export function notchUvFromMm(
    base: BufferGeometry,
    side: Side,
    sidecar: ElementAssetSidecar,
): { u: number; v: number } | null {
    const n = sidecar.notch;
    if (!n) return null;
    const Lref = sidecar.refSizeMm && sidecar.refSizeMm > 1e-3 ? sidecar.refSizeMm : 260;
    const authored = n.centerAuthoredMm;
    const asset = notchAssetMm(sidecar);
    let u: number;
    if (authored && Number.isFinite(authored.y)) {
        u = (authored.y + 1) / Lref;
    } else if (asset) {
        const { u: uAnchor } = sidecarAnchorUV(sidecar);
        u = uAnchor + asset.y / Lref;
    } else {
        return null;
    }
    const halfW = localWidthAtU(base, side, u) / 2;
    const { v: vAnchor } = sidecarAnchorUV(sidecar);
    const xMed = asset?.x ?? 0;
    // The sidecar's +X is medial on the authored right foot. In the app's
    // center-relative width axis, medial is +Y on the left and −Y on the right.
    const medialSign = side === "left" ? 1 : -1;
    return { u, v: vAnchor + (medialSign * xMed) / Math.max(halfW, 1e-3) };
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
 * XY size vs the authored reference insole (refSizeMm, 260): along-foot L/260,
 * across-foot local width ratio W/Wref at the sidecar anchor (post #184 affine).
 * refMeasuredLengthMm is informational only. Height is never sized here.
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
    const Lref = sidecar.refSizeMm && sidecar.refSizeMm > 1e-3 ? sidecar.refSizeMm : 260;
    const W = localWidthAtU(base, side, u);
    let Wref = sidecar.refWidthAtAnchorMm;
    const useSampleTopWidth = Boolean(sidecar.widthBasis && /SAMPLE_Top/i.test(sidecar.widthBasis));
    if (useSampleTopWidth && reference) {
        const Wsample = localWidthAtU(reference, side, u);
        const Lsample = getBaseFootprintFrame(reference, side).lenSize;
        Wref = Wsample * (Lref / Math.max(Lsample, 1e-3));
    } else if (!(Wref != null && Wref > 1e-3) && reference) {
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
    const medialY = (side === "left" ? 1 : -1) * (sidecar.kind === "cluffy_wedge" ? -1 : 1);
    return {
        x: (u - 0.5) * frame.lenSize,
        y: v * halfW * medialY,
        u,
        v,
    };
}
