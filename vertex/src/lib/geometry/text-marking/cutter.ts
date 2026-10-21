// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import Constrainautor from "@kninnug/constrainautor";
import { triangulateD } from "clipper2-ts";
import Delaunator from "delaunator";
import { BufferAttribute, BufferGeometry } from "three";
import { minDistToLoopXY, pointInPoly } from "@/lib/geometry/procedural-wall/cdt-band";
import type { PolyPoint } from "@/lib/geometry/procedural-wall/curves";
import {
    TEXT_CDT_MAX_AREA_MM2,
    TEXT_CDT_MAX_EDGE_MM,
    TEXT_CDT_MIN_ANGLE_DEG,
    TEXT_CDT_STEINER_MM,
    TEXT_CUTTER_MAX_EDGE_MM,
    TEXT_CUTTER_SIDEWALL_RINGS,
    TEXT_CUTTER_STEINER_MM,
    TEXT_FEATURE_CORNER_DEG,
} from "./constants";
import { resampleGlyphAdaptive } from "./contours";
import type { MapTextPoint, TextGlyphGroup, TextXy } from "./types";

function asPoly(pts: TextXy[]): PolyPoint[] {
    return pts.map((p) => ({ x: p.x, y: p.y, z: 0 }));
}

function dist2(a: TextXy, b: TextXy): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
}

function edgeKey(a: number, b: number): string {
    return a < b ? `${a},${b}` : `${b},${a}`;
}

function orient2(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function inGlyph(x: number, y: number, outer: TextXy[], holes: TextXy[][]): boolean {
    if (!pointInPoly(x, y, asPoly(outer))) return false;
    for (const hole of holes) {
        if (hole.length >= 3 && pointInPoly(x, y, asPoly(hole))) return false;
    }
    return true;
}

function gridSteiner(outer: TextXy[], holes: TextXy[][], step: number): TextXy[] {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of outer) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    const keep = step * 0.32;
    const out: TextXy[] = [];
    const startX = minX + step * 0.5;
    const startY = minY + step * 0.5;
    for (let y = startY; y <= maxY - step * 0.4; y += step) {
        for (let x = startX; x <= maxX - step * 0.4; x += step) {
            if (!inGlyph(x, y, outer, holes)) continue;
            if (minDistToLoopXY(x, y, asPoly(outer)) < keep) continue;
            let inHoleKeep = false;
            for (const hole of holes) {
                if (hole.length >= 3 && minDistToLoopXY(x, y, asPoly(hole)) < keep) {
                    inHoleKeep = true;
                    break;
                }
            }
            if (inHoleKeep) continue;
            out.push({ x, y });
        }
    }
    return out;
}

function nearExisting(p: TextXy, pts: TextXy[], tol2: number): boolean {
    for (const q of pts) if (dist2(p, q) < tol2) return true;
    return false;
}

export interface GlyphCap {
    points: TextXy[];
    faces: Array<[number, number, number]>;
    loops: number[][];
    /** Point indices of tagged glyph corners (turning > 30°). */
    feature: number[];
}

function cdtWithHoles(outer: TextXy[], holes: TextXy[][], extra: TextXy[]): GlyphCap | null {
    const points: TextXy[] = [];
    const loops: number[][] = [];
    const pushLoop = (loop: TextXy[]): number[] => {
        const idx: number[] = [];
        for (const p of loop) {
            idx.push(points.length);
            points.push({ x: p.x, y: p.y });
        }
        loops.push(idx);
        return idx;
    };
    const outerIdx = pushLoop(outer);
    const nOuter = outerIdx.length;
    if (nOuter < 3) return null;
    const extraEdges: Array<[number, number]> = [];
    for (const hole of holes) {
        if (hole.length < 3) continue;
        const idx = pushLoop(hole);
        for (let i = 0; i < idx.length; i++) extraEdges.push([idx[i]!, idx[(i + 1) % idx.length]!]);
    }
    const keep2 = 0.08 * 0.08;
    for (const s of extra) {
        if (nearExisting(s, points, keep2)) continue;
        points.push({ x: s.x, y: s.y });
    }
    if (points.length < 3) return null;

    const coords = new Float64Array(points.length * 2);
    for (let i = 0; i < points.length; i++) {
        coords[i * 2] = points[i]!.x;
        coords[i * 2 + 1] = points[i]!.y;
    }
    let del: Delaunator<Float64Array>;
    try {
        del = new Delaunator(coords);
    } catch {
        return null;
    }
    const barrier = new Set<string>();
    for (let i = 0; i < nOuter; i++) barrier.add(edgeKey(i, (i + 1) % nOuter));
    for (const e of extraEdges) barrier.add(edgeKey(e[0], e[1]));
    try {
        const con = new Constrainautor(del);
        const outerEdges: Array<[number, number]> = [];
        for (let i = 0; i < nOuter; i++) outerEdges.push([i, (i + 1) % nOuter]);
        con.constrainAll(outerEdges);
        for (const e of extraEdges) {
            try {
                con.constrainAll([e]);
            } catch {
                /* skip a leftover hole edge that still crosses a constraint */
            }
        }
    } catch {
        return null;
    }

    const all: Array<[number, number, number]> = [];
    const edgeFaces = new Map<string, number[]>();
    const tri = del.triangles;
    for (let t = 0; t < tri.length; t += 3) {
        const a = tri[t]!;
        const b = tri[t + 1]!;
        const c = tri[t + 2]!;
        const A = points[a]!;
        const B = points[b]!;
        const C = points[c]!;
        const oriented: [number, number, number] =
            orient2(A.x, A.y, B.x, B.y, C.x, C.y) > 0 ? [a, b, c] : [a, c, b];
        const fi = all.length;
        all.push(oriented);
        for (const [p, q] of [
            [oriented[0], oriented[1]],
            [oriented[1], oriented[2]],
            [oriented[2], oriented[0]],
        ] as const) {
            const k = edgeKey(p, q);
            let list = edgeFaces.get(k);
            if (!list) {
                list = [];
                edgeFaces.set(k, list);
            }
            list.push(fi);
        }
    }
    let seed = -1;
    for (let i = 0; i < all.length; i++) {
        const f = all[i]!;
        const A = points[f[0]!]!;
        const B = points[f[1]!]!;
        const C = points[f[2]!]!;
        if (inGlyph((A.x + B.x + C.x) / 3, (A.y + B.y + C.y) / 3, outer, holes)) {
            seed = i;
            break;
        }
    }
    if (seed < 0) return null;
    const seen = new Set<number>([seed]);
    const stack = [seed];
    while (stack.length) {
        const fi = stack.pop()!;
        const f = all[fi]!;
        for (const [p, q] of [
            [f[0]!, f[1]!],
            [f[1]!, f[2]!],
            [f[2]!, f[0]!],
        ] as const) {
            const k = edgeKey(p, q);
            if (barrier.has(k)) continue;
            for (const n of edgeFaces.get(k) ?? []) {
                if (seen.has(n)) continue;
                seen.add(n);
                stack.push(n);
            }
        }
    }
    const faces = [...seen]
        .map((i) => all[i]!)
        .filter((f) => {
            const A = points[f[0]!]!;
            const B = points[f[1]!]!;
            const C = points[f[2]!]!;
            return inGlyph((A.x + B.x + C.x) / 3, (A.y + B.y + C.y) / 3, outer, holes);
        });
    if (faces.length < 1) return null;
    return { points, faces, loops, feature: [] };
}

function inTri(
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
): boolean {
    const o0 = orient2(ax, ay, bx, by, px, py);
    const o1 = orient2(bx, by, cx, cy, px, py);
    const o2 = orient2(cx, cy, ax, ay, px, py);
    return o0 >= -1e-9 && o1 >= -1e-9 && o2 >= -1e-9;
}

function insertSteiner(cap: GlyphCap, p: TextXy): boolean {
    const { points, faces } = cap;
    for (let i = 0; i < faces.length; i++) {
        const [a, b, c] = faces[i]!;
        const A = points[a]!;
        const B = points[b]!;
        const C = points[c]!;
        if (!inTri(p.x, p.y, A.x, A.y, B.x, B.y, C.x, C.y)) continue;
        const v = points.length;
        points.push({ x: p.x, y: p.y });
        const o = orient2(A.x, A.y, B.x, B.y, C.x, C.y) > 0;
        faces.splice(i, 1);
        if (o) faces.push([a, b, v], [b, c, v], [c, a, v]);
        else faces.push([a, v, b], [b, v, c], [c, v, a]);
        return true;
    }
    return false;
}

function fallbackCap(outer: TextXy[], holes: TextXy[][], extra: TextXy[]): GlyphCap | null {
    const paths = [
        outer.map((p) => ({ x: p.x, y: p.y })),
        ...holes.map((h) => h.map((p) => ({ x: p.x, y: p.y }))),
    ];
    const { solution } = triangulateD(paths, 4, true);
    const points: TextXy[] = [];
    const keyOf = (p: TextXy): number => {
        for (let i = 0; i < points.length; i++) if (dist2(points[i]!, p) < 1e-16) return i;
        points.push({ x: p.x, y: p.y });
        return points.length - 1;
    };
    const faces: Array<[number, number, number]> = [];
    for (const tri of solution) {
        if (tri.length < 3) continue;
        const a = keyOf({ x: tri[0]!.x, y: tri[0]!.y });
        const b = keyOf({ x: tri[1]!.x, y: tri[1]!.y });
        const c = keyOf({ x: tri[2]!.x, y: tri[2]!.y });
        if (a === b || b === c || c === a) continue;
        const A = points[a]!;
        const B = points[b]!;
        const C = points[c]!;
        faces.push(orient2(A.x, A.y, B.x, B.y, C.x, C.y) > 0 ? [a, b, c] : [a, c, b]);
    }
    if (!faces.length) return null;
    const loops: number[][] = [];
    const indexLoop = (loop: TextXy[]): void => {
        const idx: number[] = [];
        for (const p of loop) idx.push(keyOf(p));
        if (idx.length >= 3) loops.push(idx);
    };
    indexLoop(outer);
    for (const h of holes) indexLoop(h);
    const cap: GlyphCap = { points, faces, loops, feature: [] };
    for (const s of extra) insertSteiner(cap, s);
    return cap;
}

function loopSignedArea(points: TextXy[], idx: number[]): number {
    let s = 0;
    const n = idx.length;
    for (let i = 0; i < n; i++) {
        const a = points[idx[i]!]!;
        const b = points[idx[(i + 1) % n]!]!;
        s += a.x * b.y - b.x * a.y;
    }
    return 0.5 * s;
}

/**
 * A refine midpoint can land on an existing edge and leave a zero-area face
 * (edges d, d, 2d). Dropping that face opens the cap. Split the long edge at
 * the midpoint instead, and insert the midpoint into the outline loop when
 * the edge is constrained so the wall strip uses the same vertices.
 */
function exciseCollinearFaces(cap: GlyphCap, splitLoops = true): void {
    const cross2 = (a: TextXy, b: TextXy, c: TextXy) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const flat = (a: TextXy, b: TextXy, c: TextXy) => {
        const longest = Math.sqrt(Math.max(dist2(a, b), dist2(b, c), dist2(c, a)));
        if (longest < 1e-8) return true;
        return Math.abs(cross2(a, b, c)) / longest < 1e-5;
    };
    const loopEdge = new Set<string>();
    if (!splitLoops) {
        for (const loop of cap.loops) {
            for (let i = 0; i < loop.length; i++) {
                loopEdge.add(edgeKey(loop[i]!, loop[(i + 1) % loop.length]!));
            }
        }
    }
    const onLoop = (a: number, b: number, c: number): boolean => {
        if (splitLoops) return false;
        const A = cap.points[a]!;
        const B = cap.points[b]!;
        const C = cap.points[c]!;
        const lab = dist2(A, B);
        const lbc = dist2(B, C);
        const lca = dist2(C, A);
        let u = a;
        let v = b;
        let long = lab;
        if (lbc > long) {
            u = b;
            v = c;
            long = lbc;
        }
        if (lca > long) {
            u = c;
            v = a;
        }
        return loopEdge.has(edgeKey(u, v));
    };
    const flatFace = cap.faces.map((f) => {
        const A = cap.points[f[0]!]!;
        const B = cap.points[f[1]!]!;
        const C = cap.points[f[2]!]!;
        return flat(A, B, C);
    });
    const edgeFaces = new Map<string, number[]>();
    for (let i = 0; i < cap.faces.length; i++) {
        const f = cap.faces[i]!;
        for (const [u, v] of [
            [f[0]!, f[1]!],
            [f[1]!, f[2]!],
            [f[2]!, f[0]!],
        ] as const) {
            const k = edgeKey(u, v);
            let list = edgeFaces.get(k);
            if (!list) {
                list = [];
                edgeFaces.set(k, list);
            }
            list.push(i);
        }
    }
    const longEdge = (f: [number, number, number]): [number, number] => {
        const A = cap.points[f[0]!]!;
        const B = cap.points[f[1]!]!;
        const C = cap.points[f[2]!]!;
        const lab = dist2(A, B);
        const lbc = dist2(B, C);
        const lca = dist2(C, A);
        if (lbc >= lab && lbc >= lca) return [f[1]!, f[2]!];
        if (lca >= lab) return [f[2]!, f[0]!];
        return [f[0]!, f[1]!];
    };
    const kept: Array<[number, number, number]> = [];
    const dead: Array<[number, number, number]> = [];
    for (let i = 0; i < cap.faces.length; i++) {
        const f = cap.faces[i]!;
        if (!flatFace[i] || onLoop(f[0]!, f[1]!, f[2]!)) {
            kept.push(f);
            continue;
        }
        const [u, v] = longEdge(f);
        const mate = (edgeFaces.get(edgeKey(u, v)) ?? []).find((j) => j !== i && !flatFace[j]);
        if (mate == null) kept.push(f);
        else dead.push(f);
    }
    if (!dead.length) return;
    const faces = kept;
    const spliceLoop = (u: number, v: number, m: number) => {
        for (const loop of cap.loops) {
            for (let i = 0; i < loop.length; i++) {
                const p = loop[i]!;
                const q = loop[(i + 1) % loop.length]!;
                if (p === m || q === m) continue;
                if ((p === u && q === v) || (p === v && q === u)) {
                    loop.splice(i + 1, 0, m);
                    return;
                }
            }
        }
    };
    for (const [a, b, c] of dead) {
        const A = cap.points[a]!;
        const B = cap.points[b]!;
        const C = cap.points[c]!;
        const lab = dist2(A, B);
        const lbc = dist2(B, C);
        const lca = dist2(C, A);
        let u = a;
        let v = b;
        let m = c;
        let long = lab;
        if (lbc > long) {
            u = b;
            v = c;
            m = a;
            long = lbc;
        }
        if (lca > long) {
            u = c;
            v = a;
            m = b;
        }
        spliceLoop(u, v, m);
        for (let i = 0; i < faces.length; i++) {
            const f = faces[i]!;
            const posU = f.indexOf(u);
            if (posU < 0 || !f.includes(v)) continue;
            const next = f[(posU + 1) % 3]!;
            const w = f[(posU + 2) % 3]!;
            if (next === v) {
                faces[i] = [u, m, w];
                faces.push([m, v, w]);
            } else if (w === v) {
                faces[i] = [u, next, m];
                faces.push([m, next, v]);
            }
        }
    }
    cap.faces = faces;
}

function orientLoops(cap: GlyphCap): void {
    for (let i = 0; i < cap.loops.length; i++) {
        const idx = cap.loops[i]!;
        const area = loopSignedArea(cap.points, idx);
        const wantCcw = i === 0;
        if (wantCcw === area > 0) continue;
        cap.loops[i] = idx.slice().reverse();
    }
}

function refineMaxEdge(cap: GlyphCap, maxLen: number): void {
    const max2 = maxLen * maxLen;
    const boundary = new Set<string>();
    for (const loop of cap.loops) {
        for (let i = 0; i < loop.length; i++) {
            boundary.add(edgeKey(loop[i]!, loop[(i + 1) % loop.length]!));
        }
    }
    const isBoundary = (a: number, b: number): boolean => boundary.has(edgeKey(a, b));
    for (let pass = 0; pass < 12; pass++) {
        const mids = new Map<string, number>();
        const midOf = (a: number, b: number): number => {
            const k = edgeKey(a, b);
            let m = mids.get(k);
            if (m == null) {
                const pa = cap.points[a]!;
                const pb = cap.points[b]!;
                m = cap.points.length;
                cap.points.push({ x: (pa.x + pb.x) * 0.5, y: (pa.y + pb.y) * 0.5 });
                mids.set(k, m);
            }
            return m;
        };
        const next: Array<[number, number, number]> = [];
        let splits = 0;
        for (const [a, b, c] of cap.faces) {
            const pa = cap.points[a]!;
            const pb = cap.points[b]!;
            const pc = cap.points[c]!;
            const lab = dist2(pa, pb);
            const lbc = dist2(pb, pc);
            const lca = dist2(pc, pa);
            const ab = lab > max2 && !isBoundary(a, b);
            const bc = lbc > max2 && !isBoundary(b, c);
            const ca = lca > max2 && !isBoundary(c, a);
            const n = (ab ? 1 : 0) + (bc ? 1 : 0) + (ca ? 1 : 0);
            if (!n) {
                next.push([a, b, c]);
                continue;
            }
            splits++;
            const mab = ab ? midOf(a, b) : -1;
            const mbc = bc ? midOf(b, c) : -1;
            const mca = ca ? midOf(c, a) : -1;
            if (n === 3) {
                next.push([a, mab, mca], [mab, b, mbc], [mca, mbc, c], [mab, mbc, mca]);
            } else if (n === 1) {
                if (ab) next.push([a, mab, c], [mab, b, c]);
                else if (bc) next.push([a, b, mbc], [a, mbc, c]);
                else next.push([a, b, mca], [b, c, mca]);
            } else if (ab && bc) {
                next.push([a, mab, c], [mab, b, mbc], [mab, mbc, c]);
            } else if (bc && ca) {
                next.push([a, b, mbc], [a, mbc, mca], [mbc, c, mca]);
            } else {
                next.push([a, mab, mca], [mab, b, c], [mca, mab, c]);
            }
        }
        cap.faces = next;
        if (!splits) break;
    }
}

function triMinAngleDeg(A: TextXy, B: TextXy, C: TextXy): number {
    const ang = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => {
        const ux = px - qx;
        const uy = py - qy;
        const vx = rx - qx;
        const vy = ry - qy;
        const lu = Math.hypot(ux, uy);
        const lv = Math.hypot(vx, vy);
        if (lu < 1e-12 || lv < 1e-12) return 0;
        const c = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv)));
        return (Math.acos(c) * 180) / Math.PI;
    };
    return Math.min(
        ang(B.x, B.y, A.x, A.y, C.x, C.y),
        ang(A.x, A.y, B.x, B.y, C.x, C.y),
        ang(A.x, A.y, C.x, C.y, B.x, B.y),
    );
}

/** Split an interior edge into both adjacent faces. Returns the new vertex, or -1. */
function splitEdge(cap: GlyphCap, u: number, v: number): number {
    const pa = cap.points[u];
    const pb = cap.points[v];
    if (!pa || !pb) return -1;
    const m = cap.points.length;
    cap.points.push({ x: (pa.x + pb.x) * 0.5, y: (pa.y + pb.y) * 0.5 });
    const next: Array<[number, number, number]> = [];
    let hit = 0;
    for (const [a, b, c] of cap.faces) {
        const order = [a, b, c];
        const iu = order.indexOf(u);
        const iv = order.indexOf(v);
        if (iu < 0 || iv < 0) {
            next.push([a, b, c]);
            continue;
        }
        const rot = [order[iu]!, order[(iu + 1) % 3]!, order[(iu + 2) % 3]!];
        hit++;
        if (rot[1] === v) next.push([rot[0]!, m, rot[2]!], [m, rot[1]!, rot[2]!]);
        else next.push([rot[0]!, rot[1]!, m], [rot[1]!, rot[2]!, m]);
    }
    cap.faces = next;
    return hit ? m : -1;
}

/**
 * Chase a 20° minimum angle on triangles that do not touch a glyph corner.
 * Outlines stay constrained: boundary edges are not split.
 */
function refineMinAngle(cap: GlyphCap, feature: Set<number>, minDeg: number): void {
    const boundary = new Set<string>();
    for (const loop of cap.loops) {
        for (let i = 0; i < loop.length; i++) {
            boundary.add(edgeKey(loop[i]!, loop[(i + 1) % loop.length]!));
        }
    }
    const pointCap = cap.points.length + 500;
    for (let pass = 0; pass < 6; pass++) {
        if (cap.points.length >= pointCap) break;
        const queued: Array<[number, number]> = [];
        const seen = new Set<string>();
        for (const [a, b, c] of cap.faces) {
            if (feature.has(a) || feature.has(b) || feature.has(c)) continue;
            const A = cap.points[a]!;
            const B = cap.points[b]!;
            const C = cap.points[c]!;
            if (triMinAngleDeg(A, B, C) + 1e-6 >= minDeg) continue;
            const edges: Array<[number, number, number]> = [
                [a, b, dist2(A, B)],
                [b, c, dist2(B, C)],
                [c, a, dist2(C, A)],
            ];
            edges.sort((p, q) => q[2] - p[2]);
            let picked = false;
            for (const [u, v] of edges) {
                if (boundary.has(edgeKey(u!, v!))) continue;
                const k = edgeKey(u!, v!);
                if (seen.has(k)) {
                    picked = true;
                    break;
                }
                seen.add(k);
                queued.push([u!, v!]);
                picked = true;
                break;
            }
            if (!picked) continue;
        }
        if (!queued.length) break;
        let splits = 0;
        for (const [u, v] of queued) {
            if (cap.points.length >= pointCap) break;
            if (splitEdge(cap, u, v) >= 0) splits++;
        }
        if (!splits) break;
    }
}

function tagFeatureIndices(cap: GlyphCap, flagged: TextXy[]): number[] {
    const out: number[] = [];
    for (let i = 0; i < cap.points.length; i++) {
        const p = cap.points[i]!;
        for (const f of flagged) {
            const dx = p.x - f.x;
            const dy = p.y - f.y;
            if (dx * dx + dy * dy < 1e-10) {
                out.push(i);
                break;
            }
        }
    }
    return out;
}

export function cdtGlyphCap(group: TextGlyphGroup): GlyphCap {
    const outerA = resampleGlyphAdaptive(group.outer);
    const holeA = group.holes.map((h) => resampleGlyphAdaptive(h)).filter((h) => h.points.length >= 3);
    const outer = outerA.points;
    const holes = holeA.map((h) => h.points);
    const flagged: TextXy[] = [];
    outerA.feature.forEach((on, i) => {
        if (on) flagged.push(outer[i]!);
    });
    for (const h of holeA) {
        h.feature.forEach((on, i) => {
            if (on) flagged.push(h.points[i]!);
        });
    }
    const steiner = gridSteiner(outer, holes, TEXT_CDT_STEINER_MM);
    let cap = cdtWithHoles(outer, holes, steiner);
    if (!cap) cap = fallbackCap(outer, holes, steiner);
    if (!cap) {
        return {
            points: outer.slice(),
            faces: [],
            loops: [outer.map((_, i) => i)],
            feature: tagFeatureIndices({ points: outer, faces: [], loops: [], feature: [] }, flagged),
        };
    }
    refineMaxEdge(cap, TEXT_CDT_MAX_EDGE_MM);
    const feature = new Set(tagFeatureIndices(cap, flagged));
    refineMinAngle(cap, feature, TEXT_CDT_MIN_ANGLE_DEG);
    refineMaxEdge(cap, TEXT_CDT_MAX_EDGE_MM);
    exciseCollinearFaces(cap);
    orientLoops(cap);
    cap.feature = tagFeatureIndices(cap, flagged);
    return cap;
}

/**
 * 36e7211b wall/medial cutter. Steiner grid 0.25 mm, max edge 0.3 mm, sidewall
 * rings through the extrusion. Not the bottom quality CDT.
 */
function legacyGlyphCap(group: TextGlyphGroup): GlyphCap {
    const steiner = gridSteiner(group.outer, group.holes, TEXT_CUTTER_STEINER_MM);
    let cap = cdtWithHoles(group.outer, group.holes, steiner);
    if (!cap) cap = fallbackCap(group.outer, group.holes, steiner);
    if (!cap) {
        return {
            points: group.outer.slice(),
            faces: [],
            loops: [group.outer.map((_, i) => i)],
            feature: [],
        };
    }
    refineMaxEdge(cap, TEXT_CUTTER_MAX_EDGE_MM);
    orientLoops(cap);
    return cap;
}

export interface QualityCdtOptions {
    /** Return true to keep that loop unsplit. Index 0 is the outer loop. */
    lockLoop?: (loopIndex: number) => boolean;
}

/**
 * Ruppert refinement (`pq20a0.18`): minimum angle 20°, maximum area 0.18 mm²,
 * edges at most the glyph spacing. Steiner points land in the interior
 * (circumcenter, or the Shewchuk off-center when that lies outside) and may
 * also split hole and outline edges unless `lockLoop` fixes that loop.
 * A proposed point that falls in a segment's diametral ball splits the segment
 * instead of being inserted. Bowyer–Watson keeps the mesh Delaunay.
 */
function ruppertRefine(cap: GlyphCap, lockLoop?: (loopIndex: number) => boolean): void {
    const minDeg = TEXT_CDT_MIN_ANGLE_DEG;
    const maxArea = TEXT_CDT_MAX_AREA_MM2;
    const maxEdge2 = TEXT_CDT_MAX_EDGE_MM * TEXT_CDT_MAX_EDGE_MM;
    // Don't mint edges far below the glyph spacing. A Steiner point that
    // lands on top of an existing vertex recreates the sub-degree sliver.
    const minLen2 = 0.05 * 0.05;
    const clear2 = 0.05 * 0.05;
    const pointCap = cap.points.length + 30_000;
    const pts = cap.points;
    const tanMin = Math.tan((minDeg * Math.PI) / 180);

    interface Tri {
        v: [number, number, number];
        alive: boolean;
    }
    const tris: Tri[] = [];
    const edgeFaces = new Map<string, number[]>();
    const constrained = new Set<string>();
    const locked = new Set<string>();
    const segMap = new Map<string, [number, number]>();
    const lockedSegs: Array<[number, number]> = [];

    const link = (a: number, b: number, fi: number) => {
        const k = edgeKey(a, b);
        let list = edgeFaces.get(k);
        if (!list) {
            list = [];
            edgeFaces.set(k, list);
        }
        list.push(fi);
    };
    const unlink = (a: number, b: number, fi: number) => {
        const list = edgeFaces.get(edgeKey(a, b));
        if (!list) return;
        const at = list.indexOf(fi);
        if (at >= 0) list.splice(at, 1);
    };
    const triQ: number[] = [];
    const triQueued = new Set<number>();
    let triHead = 0;
    const segQ: Array<[number, number]> = [];
    let segHead = 0;
    const enqueueTri = (fi: number) => {
        if (fi < 0 || !tris[fi]?.alive || triQueued.has(fi)) return;
        triQueued.add(fi);
        triQ.push(fi);
    };
    const enqueueSeg = (u: number, v: number) => {
        const k = edgeKey(u, v);
        if (constrained.has(k) && !locked.has(k)) segQ.push([u, v]);
    };
    const kill = (fi: number) => {
        const t = tris[fi];
        if (!t?.alive) return;
        t.alive = false;
        unlink(t.v[0], t.v[1], fi);
        unlink(t.v[1], t.v[2], fi);
        unlink(t.v[2], t.v[0], fi);
    };
    const addTri = (a: number, b: number, c: number): number => {
        const A = pts[a]!;
        const B = pts[b]!;
        const C = pts[c]!;
        const o = orient2(A.x, A.y, B.x, B.y, C.x, C.y);
        if (Math.abs(o) < 1e-14) return -1;
        const v: [number, number, number] = o > 0 ? [a, b, c] : [a, c, b];
        const fi = tris.length;
        tris.push({ v, alive: true });
        link(v[0], v[1], fi);
        link(v[1], v[2], fi);
        link(v[2], v[0], fi);
        enqueueTri(fi);
        enqueueSeg(v[0], v[1]);
        enqueueSeg(v[1], v[2]);
        enqueueSeg(v[2], v[0]);
        return fi;
    };
    const apexOf = (v: [number, number, number], u: number, w: number): number =>
        v[0] !== u && v[0] !== w ? v[0] : v[1] !== u && v[1] !== w ? v[1] : v[2];
    const aliveFaces = (u: number, v: number): number[] =>
        (edgeFaces.get(edgeKey(u, v)) ?? []).filter((fi) => tris[fi]?.alive);
    const inCircleRel = (a: number, b: number, c: number, d: number): number => {
        const A = pts[a]!;
        const B = pts[b]!;
        const C = pts[c]!;
        const D = pts[d]!;
        const adx = A.x - D.x;
        const ady = A.y - D.y;
        const bdx = B.x - D.x;
        const bdy = B.y - D.y;
        const cdx = C.x - D.x;
        const cdy = C.y - D.y;
        const ab = adx * bdy - bdx * ady;
        const bc = bdx * cdy - cdx * bdy;
        const ca = cdx * ady - adx * cdy;
        const al = adx * adx + ady * ady;
        const bl = bdx * bdx + bdy * bdy;
        const cl = cdx * cdx + cdy * cdy;
        const det = al * bc + bl * ca + cl * ab;
        const scale = (al + bl + cl) / 3;
        return det / (scale * scale + 1e-30);
    };
    const encroaches = (u: number, v: number, p: TextXy): boolean => {
        const A = pts[u]!;
        const B = pts[v]!;
        const mx = (A.x + B.x) * 0.5;
        const my = (A.y + B.y) * 0.5;
        const r2 = dist2(A, B) * 0.25;
        const dx = p.x - mx;
        const dy = p.y - my;
        return dx * dx + dy * dy < r2 * (1 - 1e-9);
    };
    const insertLoopMid = (u: number, v: number, m: number) => {
        const k = edgeKey(u, v);
        for (const loop of cap.loops) {
            for (let i = 0; i < loop.length; i++) {
                if (edgeKey(loop[i]!, loop[(i + 1) % loop.length]!) !== k) continue;
                loop.splice(i + 1, 0, m);
                return;
            }
        }
    };
    const tryFlip = (u: number, v: number, q: Array<[number, number]>): boolean => {
        const k = edgeKey(u, v);
        if (constrained.has(k)) return false;
        const faces = aliveFaces(u, v);
        if (faces.length !== 2) return false;
        const t1 = tris[faces[0]!]!;
        const t2 = tris[faces[1]!]!;
        const a1 = apexOf(t1.v, u, v);
        const a2 = apexOf(t2.v, u, v);
        if (inCircleRel(t1.v[0], t1.v[1], t1.v[2], a2) <= 1e-10) return false;
        const su = orient2(pts[a1]!.x, pts[a1]!.y, pts[a2]!.x, pts[a2]!.y, pts[u]!.x, pts[u]!.y);
        const sv = orient2(pts[a1]!.x, pts[a1]!.y, pts[a2]!.x, pts[a2]!.y, pts[v]!.x, pts[v]!.y);
        if (su * sv >= 0) return false;
        const n1: [number, number, number] = su > 0 ? [a1, a2, u] : [a2, a1, u];
        const n2: [number, number, number] = sv > 0 ? [a1, a2, v] : [a2, a1, v];
        kill(faces[0]!);
        kill(faces[1]!);
        addTri(n1[0], n1[1], n1[2]);
        addTri(n2[0], n2[1], n2[2]);
        q.push([u, a1], [u, a2], [v, a1], [v, a2]);
        return true;
    };
    const lawson = (seed: Array<[number, number]>) => {
        const q = seed;
        let n = 0;
        while (q.length && n++ < 40_000) {
            const e = q.pop()!;
            tryFlip(e[0], e[1], q);
        }
    };
    const splitEdge = (u: number, v: number): boolean => {
        const k = edgeKey(u, v);
        if (locked.has(k)) return false;
        if (dist2(pts[u]!, pts[v]!) < minLen2) return false;
        const faces = aliveFaces(u, v);
        if (!faces.length) return false;
        const A = pts[u]!;
        const B = pts[v]!;
        const m = pts.length;
        pts.push({ x: (A.x + B.x) * 0.5, y: (A.y + B.y) * 0.5 });
        const seeds: Array<[number, number]> = [];
        for (const fi of faces) {
            const tri = tris[fi]!;
            const apex = apexOf(tri.v, u, v);
            const iu = tri.v.indexOf(u);
            const iv = tri.v.indexOf(v);
            const fwd = iv === (iu + 1) % 3;
            kill(fi);
            if (fwd) {
                addTri(u, m, apex);
                addTri(m, v, apex);
            } else {
                addTri(v, m, apex);
                addTri(m, u, apex);
            }
            seeds.push([m, apex]);
        }
        if (constrained.has(k)) {
            constrained.delete(k);
            constrained.add(edgeKey(u, m));
            constrained.add(edgeKey(m, v));
            segMap.delete(k);
            segMap.set(edgeKey(u, m), [u, m]);
            segMap.set(edgeKey(m, v), [m, v]);
            insertLoopMid(u, v, m);
            enqueueSeg(u, m);
            enqueueSeg(m, v);
        }
        lawson(seeds);
        return true;
    };
    const circumOf = (a: number, b: number, c: number): TextXy | null => {
        const A = pts[a]!;
        const B = pts[b]!;
        const C = pts[c]!;
        const d = 2 * (A.x * (B.y - C.y) + B.x * (C.y - A.y) + C.x * (A.y - B.y));
        if (Math.abs(d) < 1e-12) return null;
        const a2 = A.x * A.x + A.y * A.y;
        const b2 = B.x * B.x + B.y * B.y;
        const c2 = C.x * C.x + C.y * C.y;
        const p = {
            x: (a2 * (B.y - C.y) + b2 * (C.y - A.y) + c2 * (A.y - B.y)) / d,
            y: (a2 * (C.x - B.x) + b2 * (A.x - C.x) + c2 * (B.x - A.x)) / d,
        };
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
        return p;
    };
    const propose = (a: number, b: number, c: number): TextXy | null => {
        const cc = circumOf(a, b, c);
        if (!cc) return null;
        const A = pts[a]!;
        const B = pts[b]!;
        const C = pts[c]!;
        const reach = Math.max(dist2(A, B), dist2(B, C), dist2(C, A));
        // A nearly collinear wedge has a circumcenter far outside the glyph.
        if (dist2(cc, A) > reach * 64) return null;
        return cc;
    };
    const pointEncroaches = (p: TextXy): [number, number] | "locked" | null => {
        for (const [u, v] of segMap.values()) {
            if (!constrained.has(edgeKey(u, v))) continue;
            if (encroaches(u, v, p)) return [u, v];
        }
        for (const [u, v] of lockedSegs) {
            if (encroaches(u, v, p)) return "locked";
        }
        return null;
    };
    const locate = (p: TextXy, hint: number): { tri: number } | { edge: [number, number] } | null => {
        let fi = hint;
        if (!tris[fi]?.alive) {
            fi = tris.findIndex((t) => t.alive);
            if (fi < 0) return null;
        }
        for (let step = 0; step < tris.length + 5; step++) {
            const t = tris[fi]!;
            const A = pts[t.v[0]]!;
            const B = pts[t.v[1]]!;
            const C = pts[t.v[2]]!;
            const oab = orient2(A.x, A.y, B.x, B.y, p.x, p.y);
            const obc = orient2(B.x, B.y, C.x, C.y, p.x, p.y);
            const oca = orient2(C.x, C.y, A.x, A.y, p.x, p.y);
            if (oab >= -1e-12 && obc >= -1e-12 && oca >= -1e-12) return { tri: fi };
            let eu = t.v[0];
            let ev = t.v[1];
            if (oab <= obc && oab <= oca) {
                eu = t.v[0];
                ev = t.v[1];
            } else if (obc <= oca) {
                eu = t.v[1];
                ev = t.v[2];
            } else {
                eu = t.v[2];
                ev = t.v[0];
            }
            const nbs = aliveFaces(eu, ev).filter((n) => n !== fi);
            if (!nbs.length) return { edge: [eu, ev] };
            fi = nbs[0]!;
        }
        return null;
    };

    for (let li = 0; li < cap.loops.length; li++) {
        const loop = cap.loops[li]!;
        const lock = lockLoop?.(li) ?? false;
        for (let i = 0; i < loop.length; i++) {
            const u = loop[i]!;
            const v = loop[(i + 1) % loop.length]!;
            const k = edgeKey(u, v);
            constrained.add(k);
            if (lock) {
                locked.add(k);
                lockedSegs.push([u, v]);
            } else {
                segMap.set(k, [u, v]);
                segQ.push([u, v]);
            }
        }
    }
    for (const [a, b, c] of cap.faces) {
        if (a === b || b === c || c === a) continue;
        addTri(a, b, c);
    }

    // inCircle against a free point (not yet a vertex). Kept next to insertPoint's flood.
    const inCirclePoint = (a: number, b: number, c: number, p: TextXy): number => {
        const A = pts[a]!;
        const B = pts[b]!;
        const C = pts[c]!;
        const adx = A.x - p.x;
        const ady = A.y - p.y;
        const bdx = B.x - p.x;
        const bdy = B.y - p.y;
        const cdx = C.x - p.x;
        const cdy = C.y - p.y;
        const ab = adx * bdy - bdx * ady;
        const bc = bdx * cdy - cdx * bdy;
        const ca = cdx * ady - adx * cdy;
        const al = adx * adx + ady * ady;
        const bl = bdx * bdx + bdy * bdy;
        const cl = cdx * cdx + cdy * cdy;
        const det = al * bc + bl * ca + cl * ab;
        const scale = (al + bl + cl) / 3;
        return det / (scale * scale + 1e-30);
    };
    const bowyer = (p: TextXy, hint: number, commit: boolean): number => {
        for (let i = 0; i < pts.length; i++) {
            if (dist2(pts[i]!, p) < clear2) return -1;
        }
        const loc = locate(p, hint);
        if (!loc || !("tri" in loc)) return -1;
        const inCav = new Set<number>();
        const stack = [loc.tri];
        while (stack.length) {
            const fi = stack.pop()!;
            if (inCav.has(fi) || !tris[fi]?.alive) continue;
            if (fi !== loc.tri) {
                const t = tris[fi]!.v;
                if (inCirclePoint(t[0], t[1], t[2], p) <= 1e-12) continue;
            }
            inCav.add(fi);
            const t = tris[fi]!.v;
            for (let ei = 0; ei < 3; ei++) {
                const u = t[ei]!;
                const v = t[(ei + 1) % 3]!;
                if (constrained.has(edgeKey(u, v))) continue;
                for (const nb of aliveFaces(u, v)) if (!inCav.has(nb)) stack.push(nb);
            }
        }
        const boundary: Array<[number, number]> = [];
        for (const fi of inCav) {
            const t = tris[fi]!.v;
            for (let ei = 0; ei < 3; ei++) {
                const u = t[ei]!;
                const v = t[(ei + 1) % 3]!;
                const users = aliveFaces(u, v).filter((n) => inCav.has(n));
                if (users.length >= 2) continue;
                const elen = Math.hypot(pts[v]!.x - pts[u]!.x, pts[v]!.y - pts[u]!.y) || 1;
                const o = orient2(pts[u]!.x, pts[u]!.y, pts[v]!.x, pts[v]!.y, p.x, p.y);
                if (o <= 1e-9 * elen) return -1;
                if (constrained.has(edgeKey(u, v)) && encroaches(u, v, p)) return -1;
                boundary.push([u, v]);
            }
        }
        if (boundary.length < 3) return -1;
        // Never introduce an angle worse than both 20° and the worst triangle
        // this cavity is about to delete.
        let worstCav = 180;
        for (const cfi of inCav) {
            const tv = tris[cfi]!.v;
            worstCav = Math.min(worstCav, triMinAngleDeg(pts[tv[0]]!, pts[tv[1]]!, pts[tv[2]]!));
        }
        let fanMin = 180;
        for (const [u, v] of boundary) {
            fanMin = Math.min(fanMin, triMinAngleDeg(pts[u]!, pts[v]!, p));
        }
        const limit = Math.min(minDeg, worstCav);
        if (fanMin + 1e-3 < limit) return -1;
        if (!commit) return fanMin;
        const pi = pts.length;
        pts.push(p);
        for (const fi of inCav) kill(fi);
        const seeds: Array<[number, number]> = [];
        for (const [u, v] of boundary) {
            addTri(u, v, pi);
            if (!constrained.has(edgeKey(u, v))) seeds.push([u, v]);
        }
        lawson(seeds);
        return fanMin;
    };

    const frozen = new Set<string>();
    const triKey = (a: number, b: number, c: number) => {
        const s = [a, b, c].sort((x, y) => x - y);
        return `${s[0]},${s[1]},${s[2]}`;
    };
    let guard = 0;
    while (guard++ < 250_000 && pts.length < pointCap) {
        let splitOne = false;
        while (segHead < segQ.length) {
            const [u, v] = segQ[segHead++]!;
            const k = edgeKey(u, v);
            if (!constrained.has(k) || locked.has(k)) continue;
            const d2 = dist2(pts[u]!, pts[v]!);
            if (d2 < minLen2) continue;
            // Existing apexes of a coarse CDT sit in long diametral balls.
            // Splitting those all the way down builds the slivers. Only a
            // proposed Steiner point, below, may split a shorter segment.
            if (d2 <= maxEdge2) continue;
            if (splitEdge(u, v)) {
                splitOne = true;
                break;
            }
        }
        if (splitOne) continue;
        let fi = -1;
        while (triHead < triQ.length) {
            const cand = triQ[triHead++]!;
            triQueued.delete(cand);
            if (!tris[cand]?.alive) continue;
            const key = triKey(tris[cand]!.v[0], tris[cand]!.v[1], tris[cand]!.v[2]);
            if (frozen.has(key)) continue;
            fi = cand;
            break;
        }
        if (fi < 0) break;
        const [a, b, c] = tris[fi]!.v;
        const A = pts[a]!;
        const B = pts[b]!;
        const C = pts[c]!;
        const lab = dist2(A, B);
        const lbc = dist2(B, C);
        const lca = dist2(C, A);
        const ang = triMinAngleDeg(A, B, C);
        const area = Math.abs(orient2(A.x, A.y, B.x, B.y, C.x, C.y)) * 0.5;
        const tooLong = lab > maxEdge2 || lbc > maxEdge2 || lca > maxEdge2;
        const skinny = ang + 1e-4 < minDeg;
        const bulky = area > maxArea;
        if (!tooLong && !skinny && !bulky) continue;
        const before = pts.length;
        const cands: TextXy[] = [];
        if (skinny || bulky) {
            const cc = propose(a, b, c);
            if (cc) cands.push(cc);
            let su = a;
            let sv = b;
            let sl = lab;
            if (lbc < sl) {
                su = b;
                sv = c;
                sl = lbc;
            }
            if (lca < sl) {
                su = c;
                sv = a;
                sl = lca;
            }
            const S = pts[su]!;
            const T = pts[sv]!;
            const len = Math.sqrt(sl);
            const mx = (S.x + T.x) * 0.5;
            const my = (S.y + T.y) * 0.5;
            let px = -(T.y - S.y);
            let py = T.x - S.x;
            const plen = Math.hypot(px, py) || 1;
            px /= plen;
            py /= plen;
            const third = pts[su !== a && sv !== a ? a : su !== b && sv !== b ? b : c]!;
            if ((third.x - mx) * px + (third.y - my) * py < 0) {
                px = -px;
                py = -py;
            }
            const hOff = len * 0.5 * tanMin;
            cands.push({ x: mx + px * hOff, y: my + py * hOff });
            for (const wa of [0.25, 0.5]) {
                for (const wb of [0.25, 0.5]) {
                    const wc = 1 - wa - wb;
                    if (wc < 0.2) continue;
                    cands.push({
                        x: wa * A.x + wb * B.x + wc * C.x,
                        y: wa * A.y + wb * B.y + wc * C.y,
                    });
                }
            }
        }
        let placed = false;
        for (const cand of cands) {
            if (pointEncroaches(cand)) continue;
            if (bowyer(cand, fi, false) < 0) continue;
            if (bowyer(cand, fi, true) >= 0) {
                placed = true;
                break;
            }
        }
        if (!placed) {
            for (const cand of cands) {
                const enc = pointEncroaches(cand);
                if (!enc || enc === "locked") continue;
                if (splitEdge(enc[0], enc[1])) {
                    placed = true;
                    break;
                }
            }
        }
        if (pts.length === before && tooLong) {
            let u = a;
            let v = b;
            let len = lab;
            if (lbc > len) {
                u = b;
                v = c;
                len = lbc;
            }
            if (lca > len) {
                u = c;
                v = a;
            }
            if (!locked.has(edgeKey(u, v))) splitEdge(u, v);
        }
        if (pts.length === before) frozen.add(triKey(a, b, c));
        else if (tris[fi]?.alive) enqueueTri(fi);
    }

    const passEdges: Array<[number, number]> = [];
    const seenE = new Set<string>();
    for (const t of tris) {
        if (!t.alive) continue;
        for (let ei = 0; ei < 3; ei++) {
            const u = t.v[ei]!;
            const v = t.v[(ei + 1) % 3]!;
            const k = edgeKey(u, v);
            if (constrained.has(k) || seenE.has(k)) continue;
            seenE.add(k);
            passEdges.push([u, v]);
        }
    }
    lawson(passEdges);

    const live: Array<[number, number, number]> = [];
    for (const t of tris) if (t.alive) live.push(t.v);
    cap.faces = live;
}

/**
 * Quality CDT. Steiner points land on hole and outline edges (Ruppert), except
 * loops `lockLoop` keeps fixed. Reused sole edges longer than the glyph spacing
 * are split down to 0.6 mm.
 */
export function qualityCdtFixed(
    outer: TextXy[],
    holes: TextXy[][],
    extra: TextXy[] = [],
    options?: QualityCdtOptions,
): GlyphCap {
    // No pre-seeded lattice. A 0.45 mm grid makes Delaunay slivers where an
    // outline corner sees a far lattice edge. Ruppert inserts Steiner points.
    const steiner: TextXy[] = [];
    let cap = cdtWithHoles(outer, holes, steiner);
    if (!cap) cap = fallbackCap(outer, holes, steiner);
    if (!cap) {
        return {
            points: outer.slice(),
            faces: [],
            loops: [outer.map((_, i) => i)],
            feature: [],
        };
    }
    for (const p of extra) {
        if (!nearExisting(p, cap.points, 1e-12)) insertSteiner(cap, p);
    }
    // Ruppert splits long edges itself. A prior interior-only midpoint pass leaves
    // the outline intact and shatters the cap into slivers along those edges.
    const feature = new Set<number>();
    for (const loop of cap.loops) {
        const n = loop.length;
        for (let i = 0; i < n; i++) {
            const a = cap.points[loop[(i - 1 + n) % n]!]!;
            const b = cap.points[loop[i]!]!;
            const c = cap.points[loop[(i + 1) % n]!]!;
            const abx = b.x - a.x;
            const aby = b.y - a.y;
            const bcx = c.x - b.x;
            const bcy = c.y - b.y;
            const lab = Math.hypot(abx, aby) || 1;
            const lbc = Math.hypot(bcx, bcy) || 1;
            const cos = Math.max(-1, Math.min(1, (abx * bcx + aby * bcy) / (lab * lbc)));
            const deg = (Math.acos(cos) * 180) / Math.PI;
            if (deg > TEXT_FEATURE_CORNER_DEG) feature.add(loop[i]!);
        }
    }
    ruppertRefine(cap, options?.lockLoop);
    orientLoops(cap);
    cap.feature = [...feature];
    return cap;
}

/**
 * Refine the 2D CDT (Steiner grid + max-edge splits), then map every vertex.
 * Caps at t=0 / t=1; `TEXT_CUTTER_SIDEWALL_RINGS` bands through the depth.
 * This is the 36e7211b wall path: every cap vertex is repeated on each ring.
 */
export function buildTextCutterMesh(
    groups: TextGlyphGroup[],
    mapPoint: MapTextPoint,
    sidewallRings = TEXT_CUTTER_SIDEWALL_RINGS,
): BufferGeometry {
    const positions: number[] = [];
    const indices: number[] = [];
    const faceClass: number[] = [];
    const nRings = Math.max(1, sidewallRings) + 1;
    for (const group of groups) {
        if (group.outer.length < 3) continue;
        const cap = legacyGlyphCap(group);
        const n2 = cap.points.length;
        if (n2 < 3) continue;
        const base = positions.length / 3;
        const vert = (ring: number, i: number) => base + ring * n2 + i;
        for (let r = 0; r < nRings; r++) {
            const t = r / (nRings - 1);
            for (const p of cap.points) {
                const q = mapPoint(p, t);
                positions.push(q.x, q.y, q.z);
            }
        }
        const last = nRings - 1;
        for (const [a, b, c] of cap.faces) {
            if (a === b || b === c || c === a) continue;
            indices.push(vert(0, a), vert(0, c), vert(0, b));
            indices.push(vert(last, a), vert(last, b), vert(last, c));
            faceClass.push(1, 1);
        }
        for (const loop of cap.loops) {
            const n = loop.length;
            if (n < 2) continue;
            for (let r = 0; r < last; r++) {
                for (let i = 0; i < n; i++) {
                    const p = loop[i]!;
                    const q = loop[(i + 1) % n]!;
                    indices.push(vert(r, p), vert(r, q), vert(r + 1, q));
                    indices.push(vert(r, p), vert(r + 1, q), vert(r + 1, p));
                    faceClass.push(2, 2);
                }
            }
        }
    }
    if (indices.length < 9) {
        throw new Error("text cutter produced no triangles");
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    geo.setIndex(indices);
    geo.userData = { faceClass };
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    return geo;
}

export function cutterMaxEdgeMm(group: TextGlyphGroup): number {
    const cap = cdtGlyphCap(group);
    let max = 0;
    for (const [a, b, c] of cap.faces) {
        const A = cap.points[a]!;
        const B = cap.points[b]!;
        const C = cap.points[c]!;
        max = Math.max(max, Math.sqrt(dist2(A, B)), Math.sqrt(dist2(B, C)), Math.sqrt(dist2(C, A)));
    }
    return max;
}
