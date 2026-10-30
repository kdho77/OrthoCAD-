// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import {
    booleanOp,
    ClipType,
    EndType,
    FillRule,
    inflatePaths,
    isPositive,
    JoinType,
    type Path64,
} from "clipper2-ts";
import { BufferAttribute, BufferGeometry } from "three";
import { pointInPoly } from "@/lib/geometry/procedural-wall/cdt-band";
import type { PolyPoint } from "@/lib/geometry/procedural-wall/curves";
import { assertExactManifold } from "./boolean";
import { resampleGlyphAdaptive } from "./contours";
import { type GlyphCap, qualityCdtFixed } from "./cutter";
import { TextMarkingError } from "./errors";
import { flatBottomBoundaryLoop } from "./place";
import type { TextGlyphGroup, TextXy } from "./types";

const UM = 1000;
const SOLE_Z = 0.08;

export interface BottomOutlineWorld {
    outer: Array<{ x: number; y: number; z: number }>;
    holes: Array<Array<{ x: number; y: number; z: number }>>;
}

function dedupe(loop: TextXy[]): TextXy[] {
    const out: TextXy[] = [];
    for (const p of loop) {
        const prev = out[out.length - 1];
        if (prev && Math.hypot(prev.x - p.x, prev.y - p.y) < 1e-6) continue;
        out.push({ x: p.x, y: p.y });
    }
    if (out.length >= 2) {
        const a = out[0]!;
        const b = out[out.length - 1]!;
        if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) out.pop();
    }
    return out;
}

function toUm(loop: TextXy[]): Path64 {
    return dedupe(loop).map((p) => ({ x: Math.round(p.x * UM), y: Math.round(p.y * UM) }));
}

function fromUm(path: Path64): TextXy[] {
    const pts = path.map((p) => ({ x: p.x / UM, y: p.y / UM }));
    return dedupe(pts);
}

function asPoly(loop: TextXy[]): PolyPoint[] {
    return loop.map((p) => ({ x: p.x, y: p.y, z: 0 }));
}

function area2(loop: TextXy[]): number {
    let s = 0;
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        s += a.x * b.y - b.x * a.y;
    }
    return s;
}

function insetSole(loop: TextXy[], mm: number): TextXy[] {
    const raw = toUm(loop);
    if (raw.length < 3) throw new TextMarkingError("boolean", "sole outline is not a loop");
    const ccw = isPositive(raw) ? raw : raw.slice().reverse();
    const inflated = inflatePaths([ccw], -Math.round(mm * UM), JoinType.Round, EndType.Polygon, 2, 80);
    let best: Path64 | null = null;
    let bestA = 0;
    for (const path of inflated) {
        if (path.length < 3) continue;
        const a = Math.abs(area2(fromUm(path)));
        if (a > bestA) {
            bestA = a;
            best = path;
        }
    }
    if (!best) throw new TextMarkingError("boolean", "sole inset collapsed");
    const pts = fromUm(best);
    return area2(pts) < 0 ? pts.slice().reverse() : pts;
}

function orientPositive(path: Path64): Path64 {
    return isPositive(path) ? path : path.slice().reverse();
}

function clipGlyphs(groups: TextGlyphGroup[], inset: TextXy[]): TextGlyphGroup[] {
    const clip = toUm(inset);
    const subject: Path64[] = [];
    for (const g of groups) {
        if (g.outer.length < 3) continue;
        subject.push(orientPositive(toUm(g.outer)));
        for (const h of g.holes) {
            if (h.length < 3) continue;
            const hole = toUm(h);
            subject.push(isPositive(hole) ? hole.slice().reverse() : hole);
        }
    }
    const run = (paths: Path64[]): Path64[] =>
        booleanOp(ClipType.Intersection, paths, [clip], FillRule.NonZero);
    let hit: Path64[];
    try {
        hit = run(subject);
        if (!hit.length) throw new Error("empty clip");
    } catch {
        const united = booleanOp(ClipType.Union, subject, null, FillRule.NonZero);
        hit = run(united);
    }
    const outers: TextXy[][] = [];
    const holes: TextXy[][] = [];
    for (const path of hit) {
        if (path.length < 3) continue;
        const pts = fromUm(path);
        if (Math.abs(area2(pts)) < 0.05) continue;
        if (isPositive(path)) outers.push(area2(pts) < 0 ? pts.slice().reverse() : pts);
        else holes.push(area2(pts) > 0 ? pts.slice().reverse() : pts);
    }
    const groupsOut: TextGlyphGroup[] = [];
    const used = new Set<number>();
    for (const outer of outers) {
        const own: TextXy[][] = [];
        for (let i = 0; i < holes.length; i++) {
            if (used.has(i)) continue;
            const h = holes[i]!;
            if (pointInPoly(h[0]!.x, h[0]!.y, asPoly(outer))) {
                own.push(h);
                used.add(i);
            }
        }
        groupsOut.push({ outer, holes: own });
    }
    if (!groupsOut.length) throw new TextMarkingError("forbidden-zone", "glyphs missed the sole inset");
    return groupsOut;
}

function resampleGroups(groups: TextGlyphGroup[]): TextGlyphGroup[] {
    return groups.map((g) => ({
        outer: resampleGlyphAdaptive(g.outer).points,
        holes: g.holes.map((h) => resampleGlyphAdaptive(h).points).filter((h) => h.length >= 3),
    }));
}

interface MeshBuf {
    pos: number[];
    index: number[];
    key: Map<string, number>;
    /** 0 insole, 1 floor, 2 wall. Parallel to triangles. */
    faceClass: number[];
}

function xyKey(x: number, y: number): string {
    return `${x.toFixed(6)}|${y.toFixed(6)}`;
}

function addVert(buf: MeshBuf, x: number, y: number, z: number): number {
    const k = `${xyKey(x, y)}|${z.toFixed(5)}`;
    const hit = buf.key.get(k);
    if (hit != null) {
        const dx = buf.pos[hit * 3]! - x;
        const dy = buf.pos[hit * 3 + 1]! - y;
        const dz = buf.pos[hit * 3 + 2]! - z;
        if (dx * dx + dy * dy + dz * dz < 1e-16) return hit;
    }
    const i = buf.pos.length / 3;
    buf.pos.push(x, y, z);
    buf.key.set(k, i);
    return i;
}

function triArea2(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
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
    const o0 = triArea2(ax, ay, bx, by, px, py);
    const o1 = triArea2(bx, by, cx, cy, px, py);
    const o2 = triArea2(cx, cy, ax, ay, px, py);
    const neg = o0 < -1e-8 || o1 < -1e-8 || o2 < -1e-8;
    const pos = o0 > 1e-8 || o1 > 1e-8 || o2 > 1e-8;
    return !(neg && pos);
}

function pushFace(buf: MeshBuf, a: number, b: number, c: number, wantNegZ: boolean, cls: number): void {
    if (a === b || b === c || c === a) return;
    const ax = buf.pos[a * 3]!;
    const ay = buf.pos[a * 3 + 1]!;
    const bx = buf.pos[b * 3]!;
    const by = buf.pos[b * 3 + 1]!;
    const cx = buf.pos[c * 3]!;
    const cy = buf.pos[c * 3 + 1]!;
    const area = triArea2(ax, ay, bx, by, cx, cy);
    if (Math.abs(area) < 1e-10) return;
    const ccw = area > 0;
    if (wantNegZ === ccw) buf.index.push(a, c, b);
    else buf.index.push(a, b, c);
    buf.faceClass.push(cls);
}

function matchDir(src: TextXy[], loop: TextXy[]): TextXy[] {
    const area = (pts: TextXy[]) => {
        let s = 0;
        for (let i = 0; i < pts.length; i++) {
            const a = pts[i]!;
            const b = pts[(i + 1) % pts.length]!;
            s += a.x * b.y - b.x * a.y;
        }
        return s;
    };
    const as = area(src);
    const al = area(loop);
    if (as === 0 || al === 0 || as * al > 0) return loop;
    return loop.slice().reverse();
}

function emitCap(
    buf: MeshBuf,
    cap: GlyphCap,
    z: number,
    boundary: Map<string, number>,
    wantNegZ: boolean,
    cls: number,
): number[][] {
    const loopVert = new Set<number>();
    for (const loop of cap.loops) for (const i of loop) loopVert.add(i);
    const cache = new Map<number, number>();
    const idOf = (i: number): number => {
        const hit = cache.get(i);
        if (hit != null) return hit;
        const p = cap.points[i]!;
        let id: number;
        if (loopVert.has(i)) {
            const known = boundary.get(xyKey(p.x, p.y));
            id = known != null ? known : addVert(buf, p.x, p.y, z);
        } else {
            id = buf.pos.length / 3;
            buf.pos.push(p.x, p.y, z);
        }
        cache.set(i, id);
        return id;
    };
    for (const [a, b, c] of cap.faces) {
        pushFace(buf, idOf(a), idOf(b), idOf(c), wantNegZ, cls);
    }
    return cap.loops.map((loop) => loop.map((i) => idOf(i)));
}

function emitCdt(
    buf: MeshBuf,
    outer: TextXy[],
    holes: TextXy[][],
    extra: TextXy[],
    z: number,
    boundary: Map<string, number>,
    wantNegZ: boolean,
    cls: number,
    lockLoop?: (loopIndex: number) => boolean,
): number[][] {
    const cap = qualityCdtFixed(outer, holes, extra, lockLoop ? { lockLoop } : undefined);
    if (!cap.faces.length) throw new TextMarkingError("boolean", "sole CDT produced no triangles");
    return emitCap(buf, cap, z, boundary, wantNegZ, cls);
}

function wallStrip(buf: MeshBuf, top: number[], bot: number[]): void {
    const n = top.length;
    if (n < 2 || bot.length !== n) return;
    for (let i = 0; i < n; i++) {
        const a0 = top[i]!;
        const b0 = top[(i + 1) % n]!;
        const ad = bot[i]!;
        const bd = bot[(i + 1) % n]!;
        const ax = buf.pos[a0 * 3]!;
        const ay = buf.pos[a0 * 3 + 1]!;
        const az = buf.pos[a0 * 3 + 2]!;
        const bx = buf.pos[b0 * 3]!;
        const by = buf.pos[b0 * 3 + 1]!;
        const bz = buf.pos[b0 * 3 + 2]!;
        const cx = buf.pos[ad * 3]!;
        const cy = buf.pos[ad * 3 + 1]!;
        const cz = buf.pos[ad * 3 + 2]!;
        const dx = buf.pos[bd * 3]!;
        const dy = buf.pos[bd * 3 + 1]!;
        const dz = buf.pos[bd * 3 + 2]!;
        const diagAC = Math.hypot(ax - dx, ay - dy, az - dz);
        const diagBD = Math.hypot(bx - cx, by - cy, bz - cz);
        if (diagAC <= diagBD) {
            buf.index.push(a0, bd, b0, a0, ad, bd);
        } else {
            buf.index.push(a0, ad, b0, b0, ad, bd);
        }
        buf.faceClass.push(2, 2);
    }
}

function ensureAirOnLeft(loop: TextXy[], outer: TextXy[], holes: TextXy[][]): TextXy[] {
    if (loop.length < 2) return loop;
    const a = loop[0]!;
    const b = loop[1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const x = (a.x + b.x) / 2 + (-dy / len) * 0.05;
    const y = (a.y + b.y) / 2 + (dx / len) * 0.05;
    const inside = pointInPoly(x, y, asPoly(outer));
    let counter = false;
    for (const h of holes) {
        if (h.length >= 3 && pointInPoly(x, y, asPoly(h))) counter = true;
    }
    const air = inside && !counter;
    return air ? loop : loop.slice().reverse();
}

function loopIds(buf: MeshBuf, loop: TextXy[], z: number, boundary: Map<string, number>): number[] {
    return loop.map((p) => {
        const known = boundary.get(xyKey(p.x, p.y));
        if (known != null && Math.abs((buf.pos[known * 3 + 2] ?? 0) - z) < 1e-5) return known;
        return addVert(buf, p.x, p.y, z);
    });
}

interface SoleTri {
    i: number;
    a: number;
    b: number;
    c: number;
}

function collectSole(geo: BufferGeometry): { tris: SoleTri[]; wantNegZ: boolean } {
    const pos = geo.getAttribute("position");
    const index = geo.getIndex();
    if (!pos || !index) throw new TextMarkingError("boolean", "sole mesh has no index");
    const tris: SoleTri[] = [];
    let nzSum = 0;
    for (let t = 0; t + 2 < index.count; t += 3) {
        const a = index.getX(t);
        const b = index.getX(t + 1);
        const c = index.getX(t + 2);
        const ax = pos.getX(a);
        const ay = pos.getY(a);
        const az = pos.getZ(a);
        const bx = pos.getX(b);
        const by = pos.getY(b);
        const bz = pos.getZ(b);
        const cx = pos.getX(c);
        const cy = pos.getY(c);
        const cz = pos.getZ(c);
        if (Math.abs(az) > SOLE_Z || Math.abs(bz) > SOLE_Z || Math.abs(cz) > SOLE_Z) continue;
        const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
        const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
        const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        const nl = Math.hypot(nx, ny, nz);
        if (nl < 1e-12 || Math.abs(nz) / nl < 0.9) continue;
        tris.push({ i: t / 3, a, b, c });
        nzSum += nz;
    }
    if (!tris.length) throw new TextMarkingError("boolean", "no planar sole face at z=0");
    return { tris, wantNegZ: nzSum < 0 };
}

function glyphHitsTri(
    pos: BufferGeometry["attributes"]["position"],
    tri: SoleTri,
    glyphs: TextGlyphGroup[],
): boolean {
    const ax = pos.getX(tri.a);
    const ay = pos.getY(tri.a);
    const bx = pos.getX(tri.b);
    const by = pos.getY(tri.b);
    const cx = pos.getX(tri.c);
    const cy = pos.getY(tri.c);
    const samples: TextXy[] = [];
    for (const g of glyphs) {
        samples.push(...g.outer);
        for (const h of g.holes) samples.push(...h);
    }
    for (const p of samples) {
        if (inTri(p.x, p.y, ax, ay, bx, by, cx, cy)) return true;
        if (Math.hypot(p.x - ax, p.y - ay) <= 2) return true;
        if (Math.hypot(p.x - bx, p.y - by) <= 2) return true;
        if (Math.hypot(p.x - cx, p.y - cy) <= 2) return true;
    }
    return false;
}

function boundaryLoops(pos: BufferGeometry["attributes"]["position"], tris: SoleTri[]): number[][] {
    const count = new Map<string, number>();
    const dir = new Map<string, [number, number]>();
    const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (const tri of tris) {
        for (const [u, v] of [
            [tri.a, tri.b],
            [tri.b, tri.c],
            [tri.c, tri.a],
        ] as const) {
            const k = key(u, v);
            count.set(k, (count.get(k) ?? 0) + 1);
            dir.set(`${u}>${v}`, [u, v]);
        }
    }
    const next = new Map<number, number[]>();
    for (const [k, n] of count) {
        if (n !== 1) continue;
        const [as, bs] = k.split("|");
        const a = Number(as);
        const b = Number(bs);
        const forward = dir.has(`${a}>${b}`);
        const u = forward ? a : b;
        const v = forward ? b : a;
        let list = next.get(u);
        if (!list) {
            list = [];
            next.set(u, list);
        }
        list.push(v);
    }
    const used = new Set<string>();
    const loops: number[][] = [];
    for (const [start, tos] of next) {
        for (const first of tos) {
            const mark = `${start}>${first}`;
            if (used.has(mark)) continue;
            const loop = [start];
            let prev = start;
            let cur = first;
            used.add(mark);
            let guard = 0;
            while (cur !== start && guard++ < next.size + 2) {
                loop.push(cur);
                const opts = (next.get(cur) ?? []).filter((v) => !used.has(`${cur}>${v}`));
                if (!opts.length) break;
                const ix = pos.getX(cur) - pos.getX(prev);
                const iy = pos.getY(cur) - pos.getY(prev);
                let nxt = opts[0]!;
                let best = Infinity;
                for (const v of opts) {
                    const ox = pos.getX(v) - pos.getX(cur);
                    const oy = pos.getY(v) - pos.getY(cur);
                    const ang = Math.atan2(ix * oy - iy * ox, ix * ox + iy * oy);
                    if (ang < best) {
                        best = ang;
                        nxt = v;
                    }
                }
                used.add(`${cur}>${nxt}`);
                prev = cur;
                cur = nxt;
            }
            if (loop.length >= 3) loops.push(loop);
        }
    }
    loops.sort((a, b) => Math.abs(loopAreaIdx(pos, b)) - Math.abs(loopAreaIdx(pos, a)));
    return loops;
}

function loopAreaIdx(pos: BufferGeometry["attributes"]["position"], loop: number[]): number {
    let s = 0;
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        s += pos.getX(a) * pos.getY(b) - pos.getX(b) * pos.getY(a);
    }
    return s * 0.5;
}

function xyOf(pos: BufferGeometry["attributes"]["position"], i: number): TextXy {
    return { x: pos.getX(i), y: pos.getY(i) };
}

function connectedSole(tris: SoleTri[]): SoleTri[][] {
    const parent = tris.map((_, i) => i);
    const find = (i: number): number => {
        let x = i;
        while (parent[x] !== x) x = parent[x]!;
        parent[i] = x;
        return x;
    };
    const owner = new Map<string, number>();
    const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    tris.forEach((tri, i) => {
        for (const [u, v] of [
            [tri.a, tri.b],
            [tri.b, tri.c],
            [tri.c, tri.a],
        ] as const) {
            const k = key(u, v);
            const prev = owner.get(k);
            if (prev == null) owner.set(k, i);
            else {
                const ra = find(prev);
                const rb = find(i);
                if (ra !== rb) parent[rb] = ra;
            }
        }
    });
    const groups = new Map<number, SoleTri[]>();
    tris.forEach((tri, i) => {
        const r = find(i);
        let list = groups.get(r);
        if (!list) {
            list = [];
            groups.set(r, list);
        }
        list.push(tri);
    });
    return [...groups.values()];
}

/** Pull sole triangles enclosed by the pocket into the pocket so a hole loop is not left open. */
function absorbEnclosed(
    pos: BufferGeometry["attributes"]["position"],
    sole: SoleTri[],
    selected: SoleTri[],
): SoleTri[] {
    const chosen = new Set(selected.map((t) => t.i));
    const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const byEdge = new Map<string, SoleTri[]>();
    for (const tri of sole) {
        for (const [u, v] of [
            [tri.a, tri.b],
            [tri.b, tri.c],
            [tri.c, tri.a],
        ] as const) {
            const k = key(u, v);
            let list = byEdge.get(k);
            if (!list) {
                list = [];
                byEdge.set(k, list);
            }
            list.push(tri);
        }
    }
    const loops = boundaryLoops(pos, selected);
    if (loops.length < 2) return selected;
    const barrier = new Set<string>();
    const outer = loops[0]!;
    for (let i = 0; i < outer.length; i++) barrier.add(key(outer[i]!, outer[(i + 1) % outer.length]!));
    const extra: SoleTri[] = [];
    for (const loop of loops.slice(1)) {
        const start = key(loop[0]!, loop[1] ?? loop[0]!);
        if (barrier.has(start)) continue;
        const added: SoleTri[] = [];
        const stack = (byEdge.get(start) ?? []).filter((t) => !chosen.has(t.i));
        let overflow = false;
        while (stack.length) {
            const tri = stack.pop()!;
            if (chosen.has(tri.i)) continue;
            chosen.add(tri.i);
            added.push(tri);
            if (added.length > 64) {
                overflow = true;
                break;
            }
            for (const [u, v] of [
                [tri.a, tri.b],
                [tri.b, tri.c],
                [tri.c, tri.a],
            ] as const) {
                const k = key(u, v);
                if (barrier.has(k)) continue;
                for (const n of byEdge.get(k) ?? []) if (!chosen.has(n.i)) stack.push(n);
            }
        }
        if (overflow) {
            for (const t of added) chosen.delete(t.i);
            continue;
        }
        extra.push(...added);
    }
    return extra.length ? selected.concat(extra) : selected;
}

function hostEdgeKey(a: number, b: number): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Split a kept host triangle where Ruppert inserted Steiner points on its boundary edge. */
function splitHostSeam(buf: MeshBuf, seam: Set<string>, loops: number[][]): void {
    const seamVert = new Set<number>();
    for (const k of seam) {
        const bar = k.indexOf("|");
        seamVert.add(Number(k.slice(0, bar)));
        seamVert.add(Number(k.slice(bar + 1)));
    }
    const findEdge = (u: number, v: number): { tri: number; a: number; b: number; c: number } | null => {
        for (let t = 0; t + 2 < buf.index.length; t += 3) {
            const a = buf.index[t]!;
            const b = buf.index[t + 1]!;
            const c = buf.index[t + 2]!;
            const n =
                (a === u || a === v ? 1 : 0) + (b === u || b === v ? 1 : 0) + (c === u || c === v ? 1 : 0);
            if (n === 2) return { tri: t / 3, a, b, c };
        }
        return null;
    };
    for (const loop of loops) {
        const start = loop.findIndex((id) => seamVert.has(id));
        if (start < 0) continue;
        let u = loop[start]!;
        let mids: number[] = [];
        for (let k = 1; k <= loop.length; k++) {
            const id = loop[(start + k) % loop.length]!;
            if (!seamVert.has(id)) {
                mids.push(id);
                continue;
            }
            const v = id;
            if (mids.length && seam.has(hostEdgeKey(u, v))) {
                const ax = buf.pos[u * 3]!;
                const ay = buf.pos[u * 3 + 1]!;
                const bx = buf.pos[v * 3]!;
                const by = buf.pos[v * 3 + 1]!;
                const abx = bx - ax;
                const aby = by - ay;
                const ab2 = abx * abx + aby * aby;
                const scored: Array<{ m: number; t: number }> = [];
                let onEdge = ab2 > 1e-12;
                for (const m of mids) {
                    const mx = buf.pos[m * 3]! - ax;
                    const my = buf.pos[m * 3 + 1]! - ay;
                    const t = (mx * abx + my * aby) / ab2;
                    const dist = Math.hypot(mx - abx * t, my - aby * t);
                    if (t <= 1e-4 || t >= 1 - 1e-4 || dist > 1e-3) onEdge = false;
                    scored.push({ m, t });
                }
                const hit = onEdge ? findEdge(u, v) : null;
                if (hit && onEdge) {
                    scored.sort((p, q) => p.t - q.t);
                    const chain = [u, ...scored.map((s) => s.m), v];
                    const order = [hit.a, hit.b, hit.c];
                    const iu = order.indexOf(u);
                    const iv = order.indexOf(v);
                    const third = order.find((p) => p !== u && p !== v)!;
                    const fwd = iv === (iu + 1) % 3;
                    const faces: Array<[number, number, number]> = [];
                    for (let i = 0; i < chain.length - 1; i++) {
                        const s0 = chain[i]!;
                        const s1 = chain[i + 1]!;
                        faces.push(fwd ? [s0, s1, third] : [s1, s0, third]);
                    }
                    const f0 = faces[0]!;
                    buf.index[hit.tri * 3] = f0[0];
                    buf.index[hit.tri * 3 + 1] = f0[1];
                    buf.index[hit.tri * 3 + 2] = f0[2];
                    for (const f of faces.slice(1)) {
                        buf.index.push(f[0], f[1], f[2]);
                        buf.faceClass.push(0);
                    }
                }
            }
            u = v;
            mids = [];
        }
    }
}

/**
 * Bottom engrave without a 3D boolean. The sole is planar at z=0: clip the
 * glyphs, retriangulate that sole region with the glyph holes, and add a
 * floor plus vertical walls. Vertices on the seam keep their indices.
 */
export async function engraveBottomPlanar(
    host: BufferGeometry,
    groups: TextGlyphGroup[],
    depthMm: number,
): Promise<BufferGeometry> {
    const seam = flatBottomBoundaryLoop(host);
    const seamXy = seam?.map((p) => ({ x: p.x, y: p.y })) ?? [];
    const inset = seamXy.length >= 3 ? insetSole(seamXy, 1) : null;
    const clipped = resampleGroups(inset ? clipGlyphs(groups, inset) : groups);
    const { tris: sole, wantNegZ } = collectSole(host);
    const posAttr = host.getAttribute("position");
    const near = absorbEnclosed(
        posAttr,
        sole,
        sole.filter((tri) => glyphHitsTri(posAttr, tri, clipped)),
    );
    if (!near.length) throw new TextMarkingError("boolean", "glyphs missed the sole faces");
    const index = host.getIndex();
    if (!index) throw new TextMarkingError("boolean", "sole mesh has no index");
    const buf: MeshBuf = { pos: [], index: [], key: new Map(), faceClass: [] };
    for (let i = 0; i < posAttr.count; i++) {
        buf.pos.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
    }
    const pocketEdgeCount = new Map<string, number>();
    for (const tri of near) {
        for (const [u, v] of [
            [tri.a, tri.b],
            [tri.b, tri.c],
            [tri.c, tri.a],
        ] as const) {
            const k = hostEdgeKey(u, v);
            pocketEdgeCount.set(k, (pocketEdgeCount.get(k) ?? 0) + 1);
        }
    }
    const seamEdges = new Set<string>();
    for (const [k, n] of pocketEdgeCount) if (n === 1) seamEdges.add(k);
    const removed = new Set(near.map((t) => t.i));
    for (let t = 0; t + 2 < index.count; t += 3) {
        if (removed.has(t / 3)) continue;
        const a = index.getX(t);
        const b = index.getX(t + 1);
        const c = index.getX(t + 2);
        buf.index.push(a, b, c);
        buf.faceClass.push(0);
    }
    const outlineWorld: BottomOutlineWorld[] = [];
    const parts = connectedSole(near);
    const pending = clipped.slice();
    for (const part of parts) {
        const loops = boundaryLoops(posAttr, part);
        const outerIdx = loops[0];
        if (!outerIdx || outerIdx.length < 3) continue;
        const outer = outerIdx.map((i) => xyOf(posAttr, i));
        const pocketHoles = loops.slice(1).map((loop) => loop.map((i) => xyOf(posAttr, i)));
        const boundary = new Map<string, number>();
        const remember = (i: number) => boundary.set(xyKey(posAttr.getX(i), posAttr.getY(i)), i);
        for (const loop of loops) for (const i of loop) remember(i);
        const glyphHoles: TextXy[][] = [];
        const mine = pending.filter((g) => {
            let x = 0;
            let y = 0;
            for (const p of g.outer) {
                x += p.x;
                y += p.y;
            }
            return pointInPoly(x / g.outer.length, y / g.outer.length, asPoly(outer));
        });
        for (const g of mine) {
            const at = pending.indexOf(g);
            if (at >= 0) pending.splice(at, 1);
        }
        for (const g of mine) {
            const outerLoop = ensureAirOnLeft(g.outer, g.outer, g.holes);
            const holeLoops = g.holes.map((h) => ensureAirOnLeft(h, g.outer, g.holes));
            const floorCap = qualityCdtFixed(outerLoop, holeLoops);
            if (!floorCap.faces.length) {
                throw new TextMarkingError("boolean", "glyph floor CDT produced no triangles");
            }
            const refinedOuter = matchDir(
                outerLoop,
                floorCap.loops[0]!.map((i) => floorCap.points[i]!),
            );
            const refinedHoles = holeLoops.map((src, hi) =>
                matchDir(
                    src,
                    (floorCap.loops[hi + 1] ?? []).map((i) => floorCap.points[i]!),
                ),
            );
            const top = loopIds(buf, refinedOuter, 0, boundary);
            const bot = loopIds(buf, refinedOuter, depthMm, boundary);
            for (let i = 0; i < refinedOuter.length; i++) {
                boundary.set(xyKey(refinedOuter[i]!.x, refinedOuter[i]!.y), top[i]!);
            }
            const counterTops: number[][] = [];
            const counterBots: number[][] = [];
            for (const h of refinedHoles) {
                const ht = loopIds(buf, h, 0, boundary);
                const hb = loopIds(buf, h, depthMm, boundary);
                counterTops.push(ht);
                counterBots.push(hb);
                for (let i = 0; i < h.length; i++) boundary.set(xyKey(h[i]!.x, h[i]!.y), ht[i]!);
            }
            glyphHoles.push(refinedOuter);
            wallStrip(buf, top, bot);
            for (let i = 0; i < refinedHoles.length; i++) wallStrip(buf, counterTops[i]!, counterBots[i]!);
            const floorBound = new Map(boundary);
            for (let i = 0; i < refinedOuter.length; i++) {
                floorBound.set(xyKey(refinedOuter[i]!.x, refinedOuter[i]!.y), bot[i]!);
            }
            for (let hi = 0; hi < refinedHoles.length; hi++) {
                const h = refinedHoles[hi]!;
                for (let i = 0; i < h.length; i++) {
                    floorBound.set(xyKey(h[i]!.x, h[i]!.y), counterBots[hi]![i]!);
                }
            }
            emitCap(buf, floorCap, depthMm, floorBound, wantNegZ, 1);
            for (const h of refinedHoles) {
                emitCdt(buf, h, [], [], 0, boundary, wantNegZ, 0, () => true);
            }
            outlineWorld.push({
                outer: refinedOuter.map((p) => ({ x: p.x, y: p.y, z: 0 })),
                holes: refinedHoles.map((h) => h.map((p) => ({ x: p.x, y: p.y, z: 0 }))),
            });
        }
        const nPocket = pocketHoles.length;
        const soleLoops = emitCdt(
            buf,
            outer,
            [...pocketHoles, ...glyphHoles],
            [],
            0,
            boundary,
            wantNegZ,
            0,
            (li) => li > nPocket,
        );
        splitHostSeam(buf, seamEdges, soleLoops);
    }
    if (pending.length) {
        throw new TextMarkingError("boolean", "glyph did not land on a sole pocket");
    }

    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(new Float32Array(buf.pos), 3));
    geo.setIndex(buf.index);
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.userData = { ...host.userData, bottomOutlineWorld: outlineWorld, faceClass: buf.faceClass };
    await assertExactManifold(geo);
    return geo;
}
