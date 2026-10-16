// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import Constrainautor from "@kninnug/constrainautor";
import { triangulateD } from "clipper2-ts";
import Delaunator from "delaunator";
import { BufferAttribute, BufferGeometry } from "three";
import { minDistToLoopXY, pointInPoly } from "@/lib/geometry/procedural-wall/cdt-band";
import type { PolyPoint } from "@/lib/geometry/procedural-wall/curves";
import { TEXT_CUTTER_MAX_EDGE_MM, TEXT_CUTTER_SIDEWALL_RINGS, TEXT_CUTTER_STEINER_MM } from "./constants";
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

interface GlyphCap {
    points: TextXy[];
    faces: Array<[number, number, number]>;
    loops: number[][];
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
    return { points, faces, loops };
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
    const cap: GlyphCap = { points, faces, loops };
    for (const s of extra) insertSteiner(cap, s);
    return cap;
}

function refineMaxEdge(cap: GlyphCap, maxLen: number, nBoundary: number): void {
    const max2 = maxLen * maxLen;
    const isBoundary = (a: number, b: number): boolean => {
        if (a >= nBoundary || b >= nBoundary) return false;
        const d = Math.abs(a - b);
        return d === 1 || d === nBoundary - 1;
    };
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

export function cdtGlyphCap(group: TextGlyphGroup): GlyphCap {
    const steiner = gridSteiner(group.outer, group.holes, TEXT_CUTTER_STEINER_MM);
    let cap = cdtWithHoles(group.outer, group.holes, steiner);
    if (!cap) cap = fallbackCap(group.outer, group.holes, steiner);
    if (!cap) {
        return {
            points: group.outer.slice(),
            faces: [],
            loops: [group.outer.map((_, i) => i)],
        };
    }
    refineMaxEdge(cap, TEXT_CUTTER_MAX_EDGE_MM, group.outer.length);
    return cap;
}

/**
 * Refine the 2D CDT (Steiner grid + max-edge splits), then map every vertex.
 * Caps at t=0 / t=1; `TEXT_CUTTER_SIDEWALL_RINGS` bands through the depth.
 */
export function buildTextCutterMesh(groups: TextGlyphGroup[], mapPoint: MapTextPoint): BufferGeometry {
    const positions: number[] = [];
    const indices: number[] = [];
    const nRings = TEXT_CUTTER_SIDEWALL_RINGS + 1;
    for (const group of groups) {
        if (group.outer.length < 3) continue;
        const cap = cdtGlyphCap(group);
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
