// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import {
    edgeNormal,
    extractTriangles,
    infillSegments,
    type Move,
    type Pt,
    type SliceOptions,
    sliceLayerSegments,
    stitchLoops,
} from "./slicer";

export type BeltPathRole = "WALL-OUTER" | "WALL-INNER" | "FILL";

export interface BeltMove extends Move {
    role: BeltPathRole;
}

export interface BeltSliceOptions extends SliceOptions {
    beltGantryAngleDeg: number;
}

const BELT_ON_EPS = 1e-6;
const NEAR = 1e-4;

/**
 * Winding-aware inset: positive `d` always moves toward the polygon interior.
 * Vertices matching `pin` stay put (belt-plane contact edge is not half-width inset).
 */
export function insetLoop(loop: Pt[], d: number, pin?: (p: Pt) => boolean): Pt[] {
    const ring = closedRing(loop);
    const n = ring.length;
    if (n < 3) return ring.slice();
    const towardInterior = signedArea(ring) >= 0 ? 1 : -1;
    const out: Pt[] = [];
    for (let i = 0; i < n; i++) {
        const prev = ring[(i - 1 + n) % n];
        const cur = ring[i];
        const next = ring[(i + 1) % n];
        if (pin?.(cur)) {
            out.push([cur[0], cur[1]]);
            continue;
        }
        const n1 = edgeNormal(prev, cur);
        const n2 = edgeNormal(cur, next);
        let nx = (n1[0] + n2[0]) * towardInterior;
        let ny = (n1[1] + n2[1]) * towardInterior;
        const len = Math.hypot(nx, ny) || 1;
        nx /= len;
        ny /= len;
        out.push([cur[0] + nx * d, cur[1] + ny * d]);
    }
    return out;
}

export function sliceBeltFdm(geometry: BufferGeometry, opts: BeltSliceOptions): BeltMove[] {
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    if (!bb) return [];
    const tris = extractTriangles(geometry);
    const moves: BeltMove[] = [];
    const spacing = opts.extrusionWidthMm / Math.max(0.05, Math.min(1, opts.infillDensity));
    const tan = Math.tan((opts.beltGantryAngleDeg * Math.PI) / 180);
    const w = opts.extrusionWidthMm;

    let layerIndex = 0;
    for (let z = opts.layerHeightMm; z <= bb.max.z; z += opts.layerHeightMm) {
        const segs = sliceLayerSegments(tris, z);
        if (segs.length === 0) {
            layerIndex++;
            continue;
        }
        const beltY = z / tan;
        const loops = stitchLoops(segs)
            .map((loop) => clipLoopToBelt(loop, beltY))
            .filter((l) => l.length >= 3);
        const onBelt = (p: Pt) => Math.abs(p[1] - beltY) <= BELT_ON_EPS;

        for (const loop of loops) {
            let ring = insetLoop(loop, w / 2, onBelt);
            if (ring.length < 3) continue;
            pushRing(moves, ring, z, "WALL-OUTER");
            for (let p = 1; p < opts.perimeters; p++) {
                ring = insetLoop(ring, w);
                if (ring.length < 3) break;
                pushRing(moves, ring, z, "WALL-INNER");
            }
        }

        if (opts.infillDensity > 0 && loops.length > 0) {
            const infillLoops = loops
                .map((loop) => {
                    let ring = insetLoop(loop, w / 2, onBelt);
                    for (let p = 1; p < opts.perimeters; p++) ring = insetLoop(ring, w);
                    return insetLoop(ring, w / 2);
                })
                .filter((l) => l.length >= 3);
            const fill = infillSegments(infillLoops, z, spacing, layerIndex % 2 === 0);
            for (const [a, b] of fill) {
                moves.push({ type: "travel", x: a[0], y: a[1], z, role: "FILL" });
                moves.push({ type: "extrude", x: b[0], y: b[1], z, role: "FILL" });
            }
        }
        layerIndex++;
    }
    return moves;
}

function pushRing(moves: BeltMove[], ring: Pt[], z: number, role: BeltPathRole): void {
    moves.push({ type: "travel", x: ring[0][0], y: ring[0][1], z, role });
    for (let i = 1; i < ring.length; i++) {
        moves.push({ type: "extrude", x: ring[i][0], y: ring[i][1], z, role });
    }
    moves.push({ type: "extrude", x: ring[0][0], y: ring[0][1], z, role });
}

/** Sutherland–Hodgman clip against the half-plane y ≤ beltY (gantry ≥ 0). */
function clipLoopToBelt(loop: Pt[], beltY: number): Pt[] {
    const pts = closedRing(loop);
    if (pts.length < 3) return [];
    const inside = (p: Pt) => p[1] <= beltY + BELT_ON_EPS;
    const out: Pt[] = [];
    for (let i = 0; i < pts.length; i++) {
        const s = pts[i];
        const e = pts[(i + 1) % pts.length];
        const sIn = inside(s);
        const eIn = inside(e);
        if (eIn) {
            if (!sIn) out.push(intersectBelt(s, e, beltY));
            out.push(e);
        } else if (sIn) {
            out.push(intersectBelt(s, e, beltY));
        }
    }
    return closedRing(out);
}

function intersectBelt(s: Pt, e: Pt, beltY: number): Pt {
    const dy = e[1] - s[1];
    const t = Math.abs(dy) < 1e-12 ? 0 : (beltY - s[1]) / dy;
    return [s[0] + (e[0] - s[0]) * t, beltY];
}

function closedRing(loop: Pt[]): Pt[] {
    const pts: Pt[] = [];
    for (const p of loop) {
        const last = pts[pts.length - 1];
        if (last && near(last, p)) continue;
        pts.push(p);
    }
    if (pts.length >= 2 && near(pts[0], pts[pts.length - 1])) pts.pop();
    return pts;
}

function near(a: Pt, b: Pt): boolean {
    return Math.abs(a[0] - b[0]) < NEAR && Math.abs(a[1] - b[1]) < NEAR;
}

function signedArea(loop: Pt[]): number {
    let a = 0;
    for (let i = 0; i < loop.length; i++) {
        const p = loop[i];
        const q = loop[(i + 1) % loop.length];
        a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
}
