import type { BufferGeometry } from "three";
import type { Move } from "./slicer";

// 3-axis CNC surface-following raster toolpath. Samples the top surface of the
// solid on a grid and rasters along X, stepping over in Y, retracting to a
// clearance plane between passes. Suitable for milling an orthotic from a blank.

export interface CncOptions {
    toolDiameterMm: number;
    stepoverFraction: number; // 0..1 of tool diameter
    clearanceMm: number; // safe Z above stock
    sampleMm: number; // raster point spacing along X
}

interface Tri2 {
    ax: number; ay: number; az: number;
    bx: number; by: number; bz: number;
    cx: number; cy: number; cz: number;
}

function extract(geometry: BufferGeometry): Tri2[] {
    const pos = geometry.getAttribute("position");
    const index = geometry.getIndex();
    const count = index ? index.count : pos.count;
    const at = (i: number) => (index ? index.getX(i) : i);
    const tris: Tri2[] = [];
    for (let i = 0; i < count; i += 3) {
        const a = at(i), b = at(i + 1), c = at(i + 2);
        tris.push({
            ax: pos.getX(a), ay: pos.getY(a), az: pos.getZ(a),
            bx: pos.getX(b), by: pos.getY(b), bz: pos.getZ(b),
            cx: pos.getX(c), cy: pos.getY(c), cz: pos.getZ(c),
        });
    }
    return tris;
}

/** Top surface height at (x, y); returns -Infinity outside the part. */
function topZ(tris: Tri2[], x: number, y: number): number {
    let z = -Infinity;
    for (const t of tris) {
        const d = (t.by - t.cy) * (t.ax - t.cx) + (t.cx - t.bx) * (t.ay - t.cy);
        if (Math.abs(d) < 1e-9) continue;
        const a = ((t.by - t.cy) * (x - t.cx) + (t.cx - t.bx) * (y - t.cy)) / d;
        const b = ((t.cy - t.ay) * (x - t.cx) + (t.ax - t.cx) * (y - t.cy)) / d;
        const c = 1 - a - b;
        if (a >= -1e-6 && b >= -1e-6 && c >= -1e-6) {
            const zi = a * t.az + b * t.bz + c * t.cz;
            if (zi > z) z = zi;
        }
    }
    return z;
}

export function cncToolpath(geometry: BufferGeometry, opts: CncOptions): Move[] {
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    if (!bb) return [];
    const tris = extract(geometry);
    const moves: Move[] = [];
    const clearance = bb.max.z + opts.clearanceMm;
    const stepover = Math.max(0.2, opts.toolDiameterMm * opts.stepoverFraction);

    moves.push({ type: "travel", x: bb.min.x, y: bb.min.y, z: clearance });

    let rowEven = true;
    for (let y = bb.min.y; y <= bb.max.y; y += stepover) {
        const xs: number[] = [];
        for (let x = bb.min.x; x <= bb.max.x; x += opts.sampleMm) xs.push(x);
        if (!rowEven) xs.reverse();

        let cutting = false;
        for (const x of xs) {
            const z = topZ(tris, x, y);
            if (z === -Infinity) {
                // Outside the part — retract and rapid.
                if (cutting) {
                    moves.push({ type: "travel", x, y, z: clearance });
                    cutting = false;
                }
                continue;
            }
            if (!cutting) {
                moves.push({ type: "travel", x, y, z: clearance });
                moves.push({ type: "cut", x, y, z });
                cutting = true;
            } else {
                moves.push({ type: "cut", x, y, z });
            }
        }
        if (cutting) moves.push({ type: "travel", x: xs[xs.length - 1], y, z: clearance });
        rowEven = !rowEven;
    }
    return moves;
}
