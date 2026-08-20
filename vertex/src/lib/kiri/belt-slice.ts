// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import { classifyBeltRings, stitchBeltLoops } from "./belt-stitch";
import {
    edgeNormal,
    extractTriangles,
    infillSegments,
    type Move,
    type Pt,
    type SliceOptions,
    sliceLayerSegments,
} from "./slicer";

export type BeltPathRole = "WALL-OUTER" | "WALL-INNER" | "FILL";

export interface BeltMove extends Move {
    role: BeltPathRole;
}

export interface BeltSliceOptions extends SliceOptions {
    beltGantryAngleDeg: number;
    onOpenChains?: (planeZ: number, count: number) => void;
}

const BELT_ON_EPS = 1e-6;
const NEAR = 1e-4;

/**
 * Winding-aware edge offset: positive `d` moves every edge toward the polygon
 * interior. Belt-plane edges (`beltY` set and both endpoints on the plane) are
 * offset by 0 so their centreline stays at gantry 0; new vertices are
 * intersections of consecutive offset lines (Cura-style clip, not vertex pin).
 */
export function insetLoop(loop: Pt[], d: number, beltY?: number): Pt[] {
    const ring = closedRing(loop);
    const n = ring.length;
    if (n < 3) return ring.slice();
    let sign = signedArea(ring) >= 0 ? 1 : -1;
    const probe = edgeNormal(ring[0], ring[1]);
    const mid: Pt = [
        (ring[0][0] + ring[1][0]) / 2 + probe[0] * sign * 1e-3,
        (ring[0][1] + ring[1][1]) / 2 + probe[1] * sign * 1e-3,
    ];
    if (!pointInPoly(ring, mid)) sign = -sign;

    const lines: { p: Pt; dir: Pt }[] = [];
    for (let i = 0; i < n; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % n];
        const nn = edgeNormal(a, b);
        const onBelt =
            beltY !== undefined &&
            Math.abs(a[1] - beltY) <= BELT_ON_EPS &&
            Math.abs(b[1] - beltY) <= BELT_ON_EPS;
        const dist = onBelt ? 0 : d * sign;
        lines.push({
            p: [a[0] + nn[0] * dist, a[1] + nn[1] * dist],
            dir: [b[0] - a[0], b[1] - a[1]],
        });
    }

    const out: Pt[] = [];
    const miter = Math.max(4 * d, 1e-3);
    for (let i = 0; i < n; i++) {
        const prev = lines[(i - 1 + n) % n];
        const cur = lines[i];
        const hit = intersectLines(prev.p, prev.dir, cur.p, cur.dir);
        if (hit && Math.hypot(hit[0] - ring[i][0], hit[1] - ring[i][1]) <= miter) {
            out.push(hit);
        } else {
            out.push([cur.p[0], cur.p[1]]);
        }
    }
    return closedRing(out);
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
        const stitched = stitchBeltLoops(segs, { beltY });
        if (stitched.open.length > 0) opts.onOpenChains?.(z, stitched.open.length);
        const loops = classifyBeltRings(
            stitched.closed.map((loop) => clipLoopToBelt(loop, beltY)).filter((l) => l.length >= 3),
        );
        for (const ringInfo of loops) {
            const loop = ringInfo.loop;
            let ring = clipLoopToBelt(insetLoop(loop, w / 2, beltY), beltY);
            if (ring.length < 3) continue;
            pushRing(moves, ring, z, "WALL-OUTER");
            for (let p = 1; p < opts.perimeters; p++) {
                const next = tryInset(ring, w, beltY);
                if (!next) break;
                ring = next;
                pushRing(moves, ring, z, "WALL-INNER");
            }
        }

        if (opts.infillDensity > 0 && loops.length > 0) {
            const infillLoops = loops
                .map((ringInfo) => {
                    let ring = clipLoopToBelt(insetLoop(ringInfo.loop, w / 2, beltY), beltY);
                    for (let p = 1; p < opts.perimeters; p++) {
                        const next = tryInset(ring, w, beltY);
                        if (!next) return [];
                        ring = next;
                    }
                    return tryInset(ring, w / 2, beltY) ?? [];
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

/** Drop an inset that inverts or crosses the belt — the wall does not fit in this sliver. */
function tryInset(ring: Pt[], d: number, beltY: number): Pt[] | null {
    const next = insetLoop(ring, d);
    if (next.length < 3) return null;
    if (signedArea(next) * signedArea(ring) <= 0) return null;
    if (next.some((p) => p[1] > beltY + BELT_ON_EPS)) return null;
    return next;
}

function pushRing(moves: BeltMove[], ring: Pt[], z: number, role: BeltPathRole): void {
    moves.push({ type: "travel", x: ring[0][0], y: ring[0][1], z, role });
    for (let i = 1; i < ring.length; i++) {
        moves.push({ type: "extrude", x: ring[i][0], y: ring[i][1], z, role });
    }
    moves.push({ type: "extrude", x: ring[0][0], y: ring[0][1], z, role });
}

/** Sutherland–Hodgman clip against the half-plane y ≤ beltY (gantry ≥ 0). */
export function clipLoopToBelt(loop: Pt[], beltY: number): Pt[] {
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

function intersectLines(p1: Pt, d1: Pt, p2: Pt, d2: Pt): Pt | null {
    const cross = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(cross) < 1e-12) return null;
    const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / cross;
    return [p1[0] + t * d1[0], p1[1] + t * d1[1]];
}

function pointInPoly(loop: Pt[], p: Pt): boolean {
    let inside = false;
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
        const a = loop[i];
        const b = loop[j];
        const hit =
            a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0];
        if (hit) inside = !inside;
    }
    return inside;
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
