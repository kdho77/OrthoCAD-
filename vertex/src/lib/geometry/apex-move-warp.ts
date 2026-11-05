// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { smoothstep } from "@/lib/geometry/height-field";

/**
 * Stock-arch slide for the existing apex-move control.
 *
 * The height-field arch bump is multiplied by archHeightMm. When that delta is
 * non-zero, moving the apex already recenters the peak (Low/High + Flexible).
 * The extra slide is then 0. When the delta is 0, the bump does nothing, so
 * the whole apex move slides the stock arch (Standard + Flexible ≈ +4 mm).
 *
 * This branches on the arch delta, not on the Low/Standard/High name.
 * Heel (u ≤ 0.15) and forefoot (u ≥ 0.60) are left untouched. Only the
 * thickness axis is written, so the top outline does not translate.
 */

const WARP_U_HEEL = 0.15;
// Forefoot u > 0.60 stays put. The window is already 0 by 0.46 so the
// medial shoulder that folds a wall column is not resampled.
const WARP_U_TOE = 0.46;
const WARP_RISE_END = 0.28;
const WARP_FALL_START = 0.38;

export function apexWarpShiftMm(corrections: {
    archHeightMm?: number;
    archFillMm?: number;
    apexMoveMm?: number;
}): number {
    const archDelta = (corrections.archHeightMm ?? 0) + (corrections.archFillMm ?? 0);
    if (archDelta !== 0) return 0;
    const shift = corrections.apexMoveMm ?? 0;
    if (!Number.isFinite(shift) || shift === 0) return 0;
    return shift;
}

/** 0 outside the arch band, 1 across the stock crest. */
export function apexWarpWindow(u: number): number {
    if (u <= WARP_U_HEEL || u >= WARP_U_TOE) return 0;
    const rise = u >= WARP_RISE_END ? 1 : smoothstep(WARP_U_HEEL, WARP_RISE_END, u);
    const fall = u <= WARP_FALL_START ? 1 : smoothstep(WARP_U_TOE, WARP_FALL_START, u);
    return rise * fall;
}

type Axis = 0 | 1 | 2;

const CELL_MM = 6;

export function applyDefaultArchApexWarp(args: {
    positions: Float32Array;
    original: ArrayLike<number>;
    index: ArrayLike<number>;
    lengthAxis: Axis;
    widthAxis: Axis;
    thickAxis: Axis;
    lenMin: number;
    lenSize: number;
    /** First N vertices are the top sheet. 0 means the whole mesh is the top. */
    topVertexCount: number;
    shiftMm: number;
}): void {
    const shift = args.shiftMm;
    if (!Number.isFinite(shift) || shift === 0 || args.lenSize <= 1e-6) return;
    const { positions, original, index, lengthAxis, widthAxis, thickAxis, lenMin, lenSize } = args;
    const count = (positions.length / 3) | 0;
    const topEnd = args.topVertexCount > 0 ? Math.min(args.topVertexCount, count) : count;
    if (topEnd < 3 || index.length < 3) return;

    const buckets = new Map<number, number[]>();
    const cellKey = (ix: number, iy: number) => iy * 4096 + ix;
    const triCount = (index.length / 3) | 0;
    for (let t = 0; t < triCount; t++) {
        const a = index[t * 3]!;
        const b = index[t * 3 + 1]!;
        const c = index[t * 3 + 2]!;
        if (a >= topEnd || b >= topEnd || c >= topEnd) continue;
        const al = original[a * 3 + lengthAxis]!;
        const aw = original[a * 3 + widthAxis]!;
        const bl = original[b * 3 + lengthAxis]!;
        const bw = original[b * 3 + widthAxis]!;
        const cl = original[c * 3 + lengthAxis]!;
        const cw = original[c * 3 + widthAxis]!;
        const minL = Math.min(al, bl, cl);
        const maxL = Math.max(al, bl, cl);
        const minW = Math.min(aw, bw, cw);
        const maxW = Math.max(aw, bw, cw);
        const i0 = Math.floor(minL / CELL_MM);
        const i1 = Math.floor(maxL / CELL_MM);
        const j0 = Math.floor(minW / CELL_MM);
        const j1 = Math.floor(maxW / CELL_MM);
        for (let ix = i0; ix <= i1; ix++) {
            for (let iy = j0; iy <= j1; iy++) {
                const key = cellKey(ix, iy);
                let list = buckets.get(key);
                if (!list) {
                    list = [];
                    buckets.set(key, list);
                }
                list.push(t);
            }
        }
    }

    const sample = (len: number, wid: number): number | null => {
        const ix = Math.floor(len / CELL_MM);
        const iy = Math.floor(wid / CELL_MM);
        for (let ring = 0; ring <= 1; ring++) {
            for (let dx = -ring; dx <= ring; dx++) {
                for (let dy = -ring; dy <= ring; dy++) {
                    if (ring > 0 && Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
                    const list = buckets.get(cellKey(ix + dx, iy + dy));
                    if (!list) continue;
                    for (const t of list) {
                        const a = index[t * 3]!;
                        const b = index[t * 3 + 1]!;
                        const c = index[t * 3 + 2]!;
                        const al = original[a * 3 + lengthAxis]!;
                        const aw = original[a * 3 + widthAxis]!;
                        const bl = original[b * 3 + lengthAxis]!;
                        const bw = original[b * 3 + widthAxis]!;
                        const cl = original[c * 3 + lengthAxis]!;
                        const cw = original[c * 3 + widthAxis]!;
                        const v0x = bl - al;
                        const v0y = bw - aw;
                        const v1x = cl - al;
                        const v1y = cw - aw;
                        const v2x = len - al;
                        const v2y = wid - aw;
                        const den = v0x * v1y - v1x * v0y;
                        if (Math.abs(den) < 1e-10) continue;
                        const za0 = original[a * 3 + thickAxis]!;
                        const zb0 = original[b * 3 + thickAxis]!;
                        const zc0 = original[c * 3 + thickAxis]!;
                        const e0 = Math.hypot(v0x, v0y, zb0 - za0);
                        const e1 = Math.hypot(v1x, v1y, zc0 - za0);
                        // Skip rim-wall slivers. Their plan area is tiny, and
                        // sampling them spikes the medial shoulder.
                        if (Math.abs(den) < 0.2 * e0 * e1) continue;
                        const bv = (v2x * v1y - v1x * v2y) / den;
                        const bwgt = (v0x * v2y - v2x * v0y) / den;
                        const bu = 1 - bv - bwgt;
                        if (bu < -1e-4 || bv < -1e-4 || bwgt < -1e-4) continue;
                        const za = original[a * 3 + thickAxis]!;
                        const zb = original[b * 3 + thickAxis]!;
                        const zc = original[c * 3 + thickAxis]!;
                        return bu * za + bv * zb + bwgt * zc;
                    }
                }
            }
        }
        return null;
    };

    const delta = new Float32Array(topEnd);
    const uOf = (i: number) => (original[i * 3 + lengthAxis]! - lenMin) / lenSize;
    for (let i = 0; i < topEnd; i++) {
        const w = apexWarpWindow(uOf(i));
        if (w === 0) continue;
        const behind = sample(original[i * 3 + lengthAxis]! - shift, original[i * 3 + widthAxis]!);
        if (behind === null) continue;
        delta[i] = w * (behind - original[i * 3 + thickAxis]!);
    }

    // The loft builds the wall from the top rim. Corners are not always
    // index-welded, so the rim is the position-welded boundary. Leave it on
    // the stock surface so a moved rim cannot fold a column back on itself.
    const quant = 1e-3;
    const groupOf = new Int32Array(topEnd);
    const groupKey = new Map<string, number>();
    let groupCount = 0;
    const coord = (i: number, axis: Axis) => original[i * 3 + axis]!;
    for (let i = 0; i < topEnd; i++) {
        const key = [
            Math.round(coord(i, lengthAxis) / quant),
            Math.round(coord(i, widthAxis) / quant),
            Math.round(coord(i, thickAxis) / quant),
        ].join(",");
        let g = groupKey.get(key);
        if (g === undefined) {
            g = groupCount++;
            groupKey.set(key, g);
        }
        groupOf[i] = g;
    }
    const edgeUses = new Map<string, number>();
    for (let t = 0; t < triCount; t++) {
        const tri = [index[t * 3]!, index[t * 3 + 1]!, index[t * 3 + 2]!];
        if (tri[0]! >= topEnd || tri[1]! >= topEnd || tri[2]! >= topEnd) continue;
        for (let e = 0; e < 3; e++) {
            const p = groupOf[tri[e]!]!;
            const q = groupOf[tri[(e + 1) % 3]!]!;
            if (p === q) continue;
            const key = p < q ? `${p},${q}` : `${q},${p}`;
            edgeUses.set(key, (edgeUses.get(key) ?? 0) + 1);
        }
    }
    const boundary = new Uint8Array(groupCount);
    for (const [key, uses] of edgeUses) {
        if (uses !== 1) continue;
        const comma = key.indexOf(",");
        boundary[Number(key.slice(0, comma))] = 1;
        boundary[Number(key.slice(comma + 1))] = 1;
    }
    // The arch crest is on this rim. Sampling the interior at the same Y
    // pulls rim vertices onto the dome and the wall column folds back.
    // Shift each rim vertex toward the rim point  `shift` mm posterior.
    const rimVerts: number[] = [];
    const seenGroup = new Uint8Array(groupCount);
    for (let i = 0; i < topEnd; i++) {
        const g = groupOf[i]!;
        if (boundary[g] !== 1 || seenGroup[g] === 1) continue;
        seenGroup[g] = 1;
        rimVerts.push(i);
    }
    for (let i = 0; i < topEnd; i++) {
        if (boundary[groupOf[i]!] !== 1) continue;
        const w = apexWarpWindow(uOf(i));
        if (w === 0) {
            delta[i] = 0;
            continue;
        }
        const len = original[i * 3 + lengthAxis]!;
        const wid = original[i * 3 + widthAxis]!;
        const target = len - shift;
        let best = i;
        let bestD = Infinity;
        for (let k = 0; k < rimVerts.length; k++) {
            const j = rimVerts[k]!;
            const dl = original[j * 3 + lengthAxis]! - target;
            const dw = original[j * 3 + widthAxis]! - wid;
            const d2 = dl * dl + dw * dw;
            if (d2 < bestD) {
                bestD = d2;
                best = j;
            }
        }
        delta[i] = w * (original[best * 3 + thickAxis]! - original[i * 3 + thickAxis]!);
    }

    for (let i = 0; i < topEnd; i++) {
        if (delta[i] === 0) continue;
        positions[i * 3 + thickAxis] += delta[i]!;
    }
}
