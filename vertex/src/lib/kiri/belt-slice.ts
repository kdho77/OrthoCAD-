// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import { type BeltShellPair, classifyBeltRings, stitchBeltLoops } from "./belt-stitch";
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
        if (stitched.shellPairs.length > 0) {
            for (const pair of stitched.shellPairs) emitShellPair(moves, pair, z, beltY, w, opts.perimeters);
            if (stitched.closed.length === 0) {
                for (const chain of stitched.open) {
                    const poly = clipOpenToBelt(chain, beltY);
                    if (poly.length >= 2) pushOpen(moves, poly, z, "WALL-OUTER");
                }
                layerIndex++;
                continue;
            }
        }
        const loops = classifyBeltRings(
            stitched.closed.map((loop) => clipLoopToBelt(loop, beltY)).filter((l) => l.length >= 3),
        );
        if (loops.length === 0) {
            for (const chain of stitched.open) {
                const poly = clipOpenToBelt(chain, beltY);
                if (poly.length >= 2) pushOpen(moves, poly, z, "WALL-OUTER");
            }
            layerIndex++;
            continue;
        }
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
    clampTo(next, aabbOf(ring));
    return next;
}

/** Ribbon threshold: a wall thinner than two beads cannot take an area inset. */
export const RIBBON_WIDTH_BEADS = 2;

export function shellPairWidthMm(pair: BeltShellPair): number {
    const samples: number[] = [];
    const step = Math.max(1, Math.floor(pair.a.length / 40));
    for (let i = 0; i < pair.a.length; i += step) samples.push(distToPolyline(pair.a[i], pair.b));
    samples.sort((x, y) => x - y);
    return samples[Math.floor(samples.length / 2)] ?? 0;
}

/**
 * Offset an open surface chain toward the opposite shell face. Belt-plane
 * vertices stay put (same pin as insetLoop). Not an area inset — used only
 * for thin-shell ribbons.
 */
export function offsetOpenToward(chain: Pt[], d: number, toward: Pt[], beltY?: number): Pt[] {
    if (chain.length < 2) return chain.slice();
    const out: Pt[] = [];
    for (let i = 0; i < chain.length; i++) {
        const prev = chain[Math.max(0, i - 1)];
        const cur = chain[i];
        const next = chain[Math.min(chain.length - 1, i + 1)];
        const n1 = i === 0 ? edgeNormal(cur, next) : edgeNormal(prev, cur);
        const n2 = i === chain.length - 1 ? n1 : edgeNormal(cur, next);
        let nx = n1[0] + n2[0];
        let ny = n1[1] + n2[1];
        const len = Math.hypot(nx, ny) || 1;
        nx /= len;
        ny /= len;
        const q = nearestOnPolyline(cur, toward);
        if (nx * (q[0] - cur[0]) + ny * (q[1] - cur[1]) < 0) {
            nx = -nx;
            ny = -ny;
        }
        const onBelt = beltY !== undefined && Math.abs(cur[1] - beltY) <= BELT_ON_EPS;
        const dist = onBelt ? 0 : d;
        out.push([cur[0] + nx * dist, cur[1] + ny * dist]);
    }
    return out;
}

function emitShellPair(
    moves: BeltMove[],
    pair: BeltShellPair,
    z: number,
    beltY: number,
    w: number,
    perimeters: number,
): void {
    const aOn = pair.a.some((p) => Math.abs(p[1] - beltY) <= BELT_ON_EPS);
    const bOn = pair.b.some((p) => Math.abs(p[1] - beltY) <= BELT_ON_EPS);
    const outer = aOn === bOn ? (xSpan(pair.a) >= xSpan(pair.b) ? pair.a : pair.b) : aOn ? pair.a : pair.b;
    const other = outer === pair.a ? pair.b : pair.a;
    const width = shellPairWidthMm(pair);
    const ring = clipOpenToBelt(offsetOpenToward(outer, w / 2, other, beltY), beltY);
    if (ring.length < 2) return;
    pushOpen(moves, ring, z, "WALL-OUTER");
    if (width <= RIBBON_WIDTH_BEADS * w) return;
    for (let p = 1; p < perimeters; p++) {
        // No belt pin: the inner bead must leave gantry 0 (same as tryInset).
        const next = clipOpenToBelt(offsetOpenToward(outer, w / 2 + p * w, other), beltY);
        if (next.length < 2) break;
        pushOpen(moves, next, z, "WALL-INNER");
    }
}

function xSpan(chain: Pt[]): number {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of chain) {
        if (p[0] < lo) lo = p[0];
        if (p[0] > hi) hi = p[0];
    }
    return hi - lo;
}

function distToPolyline(p: Pt, chain: Pt[]): number {
    if (chain.length === 0) return Infinity;
    if (chain.length === 1) return Math.hypot(p[0] - chain[0][0], p[1] - chain[0][1]);
    let best = Infinity;
    for (let i = 0; i < chain.length - 1; i++) {
        const d = distToSeg(p, chain[i], chain[i + 1]);
        if (d < best) best = d;
    }
    return best;
}

function nearestOnPolyline(p: Pt, chain: Pt[]): Pt {
    if (chain.length === 0) return p;
    if (chain.length === 1) return chain[0];
    let best = chain[0];
    let bestD = Infinity;
    for (let i = 0; i < chain.length - 1; i++) {
        const q = projectOnSeg(p, chain[i], chain[i + 1]);
        const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
        if (d < bestD) {
            bestD = d;
            best = q;
        }
    }
    return best;
}

function projectOnSeg(p: Pt, a: Pt, b: Pt): Pt {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const den = dx * dx + dy * dy;
    if (den < 1e-24) return a;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / den));
    return [a[0] + t * dx, a[1] + t * dy];
}

function distToSeg(p: Pt, a: Pt, b: Pt): number {
    const q = projectOnSeg(p, a, b);
    return Math.hypot(p[0] - q[0], p[1] - q[1]);
}

function aabbOf(loop: Pt[]): { minX: number; maxX: number; minY: number; maxY: number } {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of loop) {
        if (p[0] < minX) minX = p[0];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[1] > maxY) maxY = p[1];
    }
    return { minX, maxX, minY, maxY };
}

function clampTo(loop: Pt[], box: { minX: number; maxX: number; minY: number; maxY: number }): void {
    for (const p of loop) {
        if (p[0] < box.minX) p[0] = box.minX;
        if (p[0] > box.maxX) p[0] = box.maxX;
        if (p[1] < box.minY) p[1] = box.minY;
        if (p[1] > box.maxY) p[1] = box.maxY;
    }
}

function pushRing(moves: BeltMove[], ring: Pt[], z: number, role: BeltPathRole): void {
    moves.push({ type: "travel", x: ring[0][0], y: ring[0][1], z, role });
    for (let i = 1; i < ring.length; i++) {
        moves.push({ type: "extrude", x: ring[i][0], y: ring[i][1], z, role });
    }
    moves.push({ type: "extrude", x: ring[0][0], y: ring[0][1], z, role });
}

/** Trace an open chain. Never passed to insetLoop. */
function pushOpen(moves: BeltMove[], poly: Pt[], z: number, role: BeltPathRole): void {
    moves.push({ type: "travel", x: poly[0][0], y: poly[0][1], z, role });
    for (let i = 1; i < poly.length; i++) {
        moves.push({ type: "extrude", x: poly[i][0], y: poly[i][1], z, role });
    }
}

/** Polyline clip against y ≤ beltY. */
function clipOpenToBelt(chain: Pt[], beltY: number): Pt[] {
    if (chain.length === 0) return [];
    const out: Pt[] = [];
    const inside = (p: Pt) => p[1] <= beltY + 1e-6;
    for (let i = 0; i < chain.length - 1; i++) {
        const s = chain[i];
        const e = chain[i + 1];
        const sIn = inside(s);
        const eIn = inside(e);
        if (sIn && out.length === 0) out.push(s);
        if (sIn && eIn) out.push(e);
        else if (sIn && !eIn) out.push(intersectBelt(s, e, beltY));
        else if (!sIn && eIn) {
            out.push(intersectBelt(s, e, beltY));
            out.push(e);
        }
    }
    return out;
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
