// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { binaryStlBounds, binaryStlTriangleCount } from "@/lib/geometry/leader-block";
import type { Side } from "@/types";

const STAMP_PREFIX = "OrthoCAD single-foot ";

/** Header only. Triangle bytes stay the manufacturing mesh plus one leader. */
export function stampSingleFootStl(stl: ArrayBuffer, side: Side): ArrayBuffer {
    const copy = stl.slice(0);
    const bytes = new Uint8Array(copy);
    bytes.fill(0, 0, 80);
    const encoded = new TextEncoder().encode(`${STAMP_PREFIX}${side}`);
    bytes.set(encoded.subarray(0, 79), 0);
    return copy;
}

export function readSingleFootStamp(stl: ArrayBuffer): Side | null {
    if (stl.byteLength < 80) return null;
    const text = new TextDecoder().decode(new Uint8Array(stl, 0, 80)).replace(/\0[\s\S]*$/, "");
    if (text === `${STAMP_PREFIX}left`) return "left";
    if (text === `${STAMP_PREFIX}right`) return "right";
    return null;
}

export interface PrinterFootStlFacts {
    side: Side | null;
    triangleCount: number;
    bounds: ReturnType<typeof binaryStlBounds>;
    ySpan: number;
}

export function printerFootStlFacts(stl: ArrayBuffer): PrinterFootStlFacts {
    const bounds = binaryStlBounds(stl);
    return {
        side: readSingleFootStamp(stl),
        triangleCount: binaryStlTriangleCount(stl),
        bounds,
        ySpan: bounds.maxY - bounds.minY,
    };
}

/**
 * Two printer uploads are isolated when each is stamped for its own foot,
 * the bytes differ, and neither mesh is wide enough to be the Y-shifted pair.
 * `pairYSpan` is the paired aggregate's width. A single foot stays well under it.
 */
export function isolatedPrinterFootStls(
    left: ArrayBuffer,
    right: ArrayBuffer,
    pairYSpan: number,
): { ok: true } | { ok: false; reason: string } {
    const a = printerFootStlFacts(left);
    const b = printerFootStlFacts(right);
    if (sameBytes(left, right)) return { ok: false, reason: "left and right uploads are the same bytes" };
    if (a.side !== "left") return { ok: false, reason: "left upload is not stamped single-foot left" };
    if (b.side !== "right") return { ok: false, reason: "right upload is not stamped single-foot right" };
    if (!(a.ySpan < pairYSpan * 0.75)) {
        return { ok: false, reason: `left Y span ${a.ySpan} is the paired aggregate` };
    }
    if (!(b.ySpan < pairYSpan * 0.75)) {
        return { ok: false, reason: `right Y span ${b.ySpan} is the paired aggregate` };
    }
    if (a.triangleCount <= 0 || b.triangleCount <= 0) {
        return { ok: false, reason: "empty manufacturing STL" };
    }
    return { ok: true };
}

function sameBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
    if (a.byteLength !== b.byteLength) return false;
    const left = new Uint8Array(a);
    const right = new Uint8Array(b);
    for (let i = 0; i < left.length; i++) {
        if (left[i] !== right[i]) return false;
    }
    return true;
}
