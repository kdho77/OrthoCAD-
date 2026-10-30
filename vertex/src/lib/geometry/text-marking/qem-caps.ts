// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { BufferAttribute, type BufferGeometry } from "three";
import { TEXT_FEATURE_CORNER_DEG, TEXT_QEM_COPLANAR_MM, TEXT_TRI_CAP_WALL, TEXT_WELD_MM } from "./constants";
import { buildTextCutterMesh } from "./cutter";
import { countSoupSelfIntersections } from "./soup-intersect";
import type { MapTextPoint, TextGlyphGroup } from "./types";

const TRI_CAP = TEXT_TRI_CAP_WALL;
const CAP_DIST_MM = 0.15;
const HAUSDORFF_MM = 0.05;

export interface TextQemReport {
    applied: boolean;
    before: number;
    after: number;
    reason?: string;
}

type V3 = { x: number; y: number; z: number };

function triCount(tris: number[]): number {
    return Math.floor(tris.length / 3);
}

function edgeKey(a: number, b: number): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function readPos(geo: BufferGeometry): Float64Array {
    const attr = geo.getAttribute("position");
    const out = new Float64Array(attr.count * 3);
    for (let i = 0; i < attr.count; i++) {
        out[i * 3] = attr.getX(i);
        out[i * 3 + 1] = attr.getY(i);
        out[i * 3 + 2] = attr.getZ(i);
    }
    return out;
}

function readTris(geo: BufferGeometry): number[] {
    const index = geo.getIndex();
    const pos = geo.getAttribute("position");
    const tris: number[] = [];
    if (index) {
        for (let i = 0; i < index.count; i++) tris.push(index.getX(i));
    } else {
        for (let i = 0; i < pos.count; i++) tris.push(i);
    }
    return tris;
}

function writeMesh(geo: BufferGeometry, pos: Float64Array, tris: number[]): void {
    const f = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i++) f[i] = pos[i]!;
    geo.setAttribute("position", new BufferAttribute(f, 3));
    geo.setIndex(tris);
    geo.computeVertexNormals();
}

function watertight(tris: number[]): boolean {
    const edge = new Map<string, number>();
    const n = triCount(tris);
    for (let t = 0; t < n; t++) {
        const a = tris[t * 3]!;
        const b = tris[t * 3 + 1]!;
        const c = tris[t * 3 + 2]!;
        if (a === b || b === c || c === a) return false;
        for (const [u, v] of [
            [a, b],
            [b, c],
            [c, a],
        ] as const) {
            const k = edgeKey(u, v);
            edge.set(k, (edge.get(k) ?? 0) + 1);
        }
    }
    for (const count of edge.values()) if (count !== 2) return false;
    return true;
}

function planeOf(
    pos: Float64Array,
    a: number,
    b: number,
    c: number,
): { x: number; y: number; z: number; d: number } | null {
    const ax = pos[a * 3]!;
    const ay = pos[a * 3 + 1]!;
    const az = pos[a * 3 + 2]!;
    const bx = pos[b * 3]! - ax;
    const by = pos[b * 3 + 1]! - ay;
    const bz = pos[b * 3 + 2]! - az;
    const cx = pos[c * 3]! - ax;
    const cy = pos[c * 3 + 1]! - ay;
    const cz = pos[c * 3 + 2]! - az;
    const nx = by * cz - bz * cy;
    const ny = bz * cx - bx * cz;
    const nz = bx * cy - by * cx;
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-12) return null;
    return { x: nx / nl, y: ny / nl, z: nz / nl, d: (nx * ax + ny * ay + nz * az) / nl };
}

function distPointPlane(
    pos: Float64Array,
    v: number,
    p: { x: number; y: number; z: number; d: number },
): number {
    return Math.abs(p.x * pos[v * 3]! + p.y * pos[v * 3 + 1]! + p.z * pos[v * 3 + 2]! - p.d);
}

function turningDeg(a: V3, b: V3, c: V3): number {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const bcx = c.x - b.x;
    const bcy = c.y - b.y;
    const bcz = c.z - b.z;
    const lab = Math.hypot(abx, aby, abz);
    const lbc = Math.hypot(bcx, bcy, bcz);
    if (lab < 1e-9 || lbc < 1e-9) return 0;
    const cos = Math.max(-1, Math.min(1, (abx * bcx + aby * bcy + abz * bcz) / (lab * lbc)));
    return (Math.acos(cos) * 180) / Math.PI;
}

/** Glyph corners (turning > 30°) on both cutter caps. */
function featureCorners(groups: TextGlyphGroup[], mapPoint: MapTextPoint): V3[] {
    const out: V3[] = [];
    const consider = (loop: Array<{ x: number; y: number }>) => {
        if (loop.length < 3) return;
        for (const t of [0, 1]) {
            const world = loop.map((p) => mapPoint(p, t));
            const n = world.length;
            for (let i = 0; i < n; i++) {
                const a = world[(i - 1 + n) % n]!;
                const b = world[i]!;
                const c = world[(i + 1) % n]!;
                if (turningDeg(a, b, c) > TEXT_FEATURE_CORNER_DEG) out.push(b);
            }
        }
    };
    for (const g of groups) {
        consider(g.outer);
        for (const h of g.holes) consider(h);
    }
    return out;
}

function nearCorner(p: V3, corners: V3[]): boolean {
    for (const c of corners) {
        if (Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z) <= 0.2) return true;
    }
    return false;
}

/**
 * Result triangles that lie on a cutter cap (floor or emboss cap), not on a
 * wall and not on the insole skin. The legacy cutter is only a classifier.
 */
function capFaceMask(
    pos: Float64Array,
    tris: number[],
    groups: TextGlyphGroup[],
    mapPoint: MapTextPoint,
): Uint8Array {
    const nTri = triCount(tris);
    const mask = new Uint8Array(nTri);
    let cutter: BufferGeometry | null = null;
    try {
        cutter = buildTextCutterMesh(groups, mapPoint);
    } catch {
        return mask;
    }
    const cPos = cutter.getAttribute("position");
    const cIndex = cutter.getIndex();
    if (!cPos || !cIndex) {
        cutter.dispose();
        return mask;
    }
    const dirGrid = new Map<string, V3>();
    const dirKey = (x: number, y: number, z: number) => `${Math.floor(x)}|${Math.floor(y)}|${Math.floor(z)}`;
    for (const g of groups) {
        for (const p of g.outer) {
            const a = mapPoint(p, 0);
            const b = mapPoint(p, 1);
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dz = b.z - a.z;
            const l = Math.hypot(dx, dy, dz) || 1;
            dirGrid.set(dirKey(a.x, a.y, a.z), { x: dx / l, y: dy / l, z: dz / l });
            dirGrid.set(dirKey(b.x, b.y, b.z), { x: dx / l, y: dy / l, z: dz / l });
        }
    }
    const nOutAt = (x: number, y: number, z: number): V3 => {
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        const iz = Math.floor(z);
        for (let r = 0; r <= 3; r++) {
            for (let dx = -r; dx <= r; dx++) {
                for (let dy = -r; dy <= r; dy++) {
                    for (let dz = -r; dz <= r; dz++) {
                        const hit = dirGrid.get(`${ix + dx}|${iy + dy}|${iz + dz}`);
                        if (hit) return hit;
                    }
                }
            }
        }
        return { x: 0, y: 0, z: 1 };
    };
    const caps: Array<{
        ax: number;
        ay: number;
        az: number;
        bx: number;
        by: number;
        bz: number;
        cx: number;
        cy: number;
        cz: number;
        nx: number;
        ny: number;
        nz: number;
    }> = [];
    const cell = 2;
    const grid = new Map<string, number[]>();
    for (let t = 0; t + 2 < cIndex.count; t += 3) {
        const ia = cIndex.getX(t);
        const ib = cIndex.getX(t + 1);
        const ic = cIndex.getX(t + 2);
        const ax = cPos.getX(ia);
        const ay = cPos.getY(ia);
        const az = cPos.getZ(ia);
        const bx = cPos.getX(ib);
        const by = cPos.getY(ib);
        const bz = cPos.getZ(ib);
        const cx = cPos.getX(ic);
        const cy = cPos.getY(ic);
        const cz = cPos.getZ(ic);
        const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
        const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
        const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        const nl = Math.hypot(nx, ny, nz);
        if (nl < 1e-12) continue;
        const ux = nx / nl;
        const uy = ny / nl;
        const uz = nz / nl;
        const mx = (ax + bx + cx) / 3;
        const my = (ay + by + cy) / 3;
        const mz = (az + bz + cz) / 3;
        const dir = nOutAt(mx, my, mz);
        if (Math.abs(ux * dir.x + uy * dir.y + uz * dir.z) < 0.75) continue;
        const id = caps.length;
        caps.push({ ax, ay, az, bx, by, bz, cx, cy, cz, nx: ux, ny: uy, nz: uz });
        const key = `${Math.floor(mx / cell)}|${Math.floor(my / cell)}|${Math.floor(mz / cell)}`;
        let list = grid.get(key);
        if (!list) {
            list = [];
            grid.set(key, list);
        }
        list.push(id);
    }
    cutter.dispose();
    const distToCap = (x: number, y: number, z: number, nx: number, ny: number, nz: number): number => {
        let best = Infinity;
        const ix = Math.floor(x / cell);
        const iy = Math.floor(y / cell);
        const iz = Math.floor(z / cell);
        for (let dx = -2; dx <= 2; dx++) {
            for (let dy = -2; dy <= 2; dy++) {
                for (let dz = -2; dz <= 2; dz++) {
                    const list = grid.get(`${ix + dx}|${iy + dy}|${iz + dz}`);
                    if (!list) continue;
                    for (const id of list) {
                        const c = caps[id]!;
                        if (Math.abs(c.nx * nx + c.ny * ny + c.nz * nz) < 0.8) continue;
                        const d = Math.abs(c.nx * (x - c.ax) + c.ny * (y - c.ay) + c.nz * (z - c.az));
                        if (d < best) best = d;
                    }
                }
            }
        }
        return best;
    };
    for (let t = 0; t < nTri; t++) {
        const a = tris[t * 3]!;
        const b = tris[t * 3 + 1]!;
        const c = tris[t * 3 + 2]!;
        const pl = planeOf(pos, a, b, c);
        if (!pl) continue;
        const x = (pos[a * 3]! + pos[b * 3]! + pos[c * 3]!) / 3;
        const y = (pos[a * 3 + 1]! + pos[b * 3 + 1]! + pos[c * 3 + 1]!) / 3;
        const z = (pos[a * 3 + 2]! + pos[b * 3 + 2]! + pos[c * 3 + 2]!) / 3;
        if (distToCap(x, y, z, pl.x, pl.y, pl.z) <= CAP_DIST_MM) mask[t] = 1;
    }
    return mask;
}

function linkOk(vertTris: number[][], tris: number[], u: number, v: number): boolean {
    const around = (vert: number) => {
        const s = new Set<number>();
        for (const t of vertTris[vert] ?? []) {
            for (let k = 0; k < 3; k++) {
                const w = tris[t * 3 + k]!;
                if (w !== vert) s.add(w);
            }
        }
        return s;
    };
    const nu = around(u);
    const nv = around(v);
    let common = 0;
    for (const w of nu) if (nv.has(w)) common++;
    return common === 2;
}

function collapseOk(
    pos: Float64Array,
    tris: number[],
    vertTris: number[][],
    cap: Uint8Array,
    u: number,
    v: number,
    x: number,
    y: number,
    z: number,
): boolean {
    const seen = new Set<number>();
    for (const vert of [u, v]) {
        for (const t of vertTris[vert] ?? []) {
            if (seen.has(t) || !cap[t]) continue;
            seen.add(t);
            const a = tris[t * 3]!;
            const b = tris[t * 3 + 1]!;
            const c = tris[t * 3 + 2]!;
            if ((a === u || a === v) && (b === u || b === v)) continue;
            if ((b === u || b === v) && (c === u || c === v)) continue;
            if ((c === u || c === v) && (a === u || a === v)) continue;
            const pl = planeOf(pos, a, b, c);
            if (!pl) return false;
            if (Math.abs(pl.x * x + pl.y * y + pl.z * z - pl.d) > TEXT_QEM_COPLANAR_MM) return false;
            const nx =
                (pos[b * 3 + 1]! - pos[a * 3 + 1]!) * (pos[c * 3 + 2]! - pos[a * 3 + 2]!) -
                (pos[b * 3 + 2]! - pos[a * 3 + 2]!) * (pos[c * 3 + 1]! - pos[a * 3 + 1]!);
            const ny =
                (pos[b * 3 + 2]! - pos[a * 3 + 2]!) * (pos[c * 3]! - pos[a * 3]!) -
                (pos[b * 3]! - pos[a * 3]!) * (pos[c * 3 + 2]! - pos[a * 3 + 2]!);
            const nz =
                (pos[b * 3]! - pos[a * 3]!) * (pos[c * 3 + 1]! - pos[a * 3 + 1]!) -
                (pos[b * 3 + 1]! - pos[a * 3 + 1]!) * (pos[c * 3]! - pos[a * 3]!);
            const mv = (id: number) =>
                id === u || id === v
                    ? { x, y, z }
                    : { x: pos[id * 3]!, y: pos[id * 3 + 1]!, z: pos[id * 3 + 2]! };
            const pa = mv(a);
            const pb = mv(b);
            const pc = mv(c);
            const mx = (pb.y - pa.y) * (pc.z - pa.z) - (pb.z - pa.z) * (pc.y - pa.y);
            const my = (pb.z - pa.z) * (pc.x - pa.x) - (pb.x - pa.x) * (pc.z - pa.z);
            const mz = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x);
            if (nx * mx + ny * my + nz * mz <= 1e-10) return false;
        }
    }
    return true;
}

function rimHausdorff(
    pos: Float64Array,
    tris: number[],
    cap: Uint8Array,
    groups: TextGlyphGroup[],
    mapPoint: MapTextPoint,
): number {
    const edge = new Map<string, number>();
    const n = triCount(tris);
    for (let t = 0; t < n; t++) {
        if (!cap[t]) continue;
        const a = tris[t * 3]!;
        const b = tris[t * 3 + 1]!;
        const c = tris[t * 3 + 2]!;
        for (const [u, v] of [
            [a, b],
            [b, c],
            [c, a],
        ] as const) {
            const k = edgeKey(u, v);
            edge.set(k, (edge.get(k) ?? 0) + 1);
        }
    }
    const rim: V3[] = [];
    for (const [k, count] of edge) {
        if (count !== 1) continue;
        const [us, vs] = k.split("|");
        const u = Number(us);
        const v = Number(vs);
        rim.push({
            x: (pos[u * 3]! + pos[v * 3]!) * 0.5,
            y: (pos[u * 3 + 1]! + pos[v * 3 + 1]!) * 0.5,
            z: (pos[u * 3 + 2]! + pos[v * 3 + 2]!) * 0.5,
        });
    }
    const outline: V3[] = [];
    for (const g of groups) {
        for (const loop of [g.outer, ...g.holes]) {
            for (const p of loop) {
                outline.push(mapPoint(p, 0), mapPoint(p, 1));
            }
        }
    }
    if (!rim.length || !outline.length) return 0;
    let max = 0;
    for (const p of rim) {
        let best = Infinity;
        for (const q of outline) {
            const d = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
            if (d < best) best = d;
        }
        if (best > max) max = best;
    }
    return max;
}

/**
 * QEM on coplanar floor/cap faces only. Boundary and feature vertices stay
 * locked. Wall and insole faces are not rewritten. A failed watertight, SI,
 * or Hausdorff check returns the input mesh.
 */
export function decimateCoplanarCaps(
    geo: BufferGeometry,
    groups: TextGlyphGroup[],
    mapPoint: MapTextPoint,
): { geo: BufferGeometry; report: TextQemReport } {
    const beforeTris = readTris(geo);
    const before = triCount(beforeTris);
    if (before <= TRI_CAP) {
        return { geo, report: { applied: false, before, after: before, reason: "under-cap" } };
    }
    const work = geo.clone();
    work.userData = { ...geo.userData };
    const pos = readPos(work);
    const tris = beforeTris.slice();
    const corners = featureCorners(groups, mapPoint);
    let cap = capFaceMask(pos, tris, groups, mapPoint);
    const hausBefore = rimHausdorff(pos, tris, cap, groups, mapPoint);
    for (let pass = 0; pass < 24 && triCount(tris) > TRI_CAP; pass++) {
        const nTri = triCount(tris);
        const nV = Math.floor(pos.length / 3);
        const vertTris: number[][] = Array.from({ length: nV }, () => []);
        const edgeFaces = new Map<string, number[]>();
        for (let t = 0; t < nTri; t++) {
            const a = tris[t * 3]!;
            const b = tris[t * 3 + 1]!;
            const c = tris[t * 3 + 2]!;
            vertTris[a]!.push(t);
            vertTris[b]!.push(t);
            vertTris[c]!.push(t);
            for (const [u, v] of [
                [a, b],
                [b, c],
                [c, a],
            ] as const) {
                const k = edgeKey(u, v);
                let list = edgeFaces.get(k);
                if (!list) {
                    list = [];
                    edgeFaces.set(k, list);
                }
                list.push(t);
            }
        }
        const touchesNonCap = new Uint8Array(nV);
        const feature = new Uint8Array(nV);
        for (let t = 0; t < nTri; t++) {
            const ids = [tris[t * 3]!, tris[t * 3 + 1]!, tris[t * 3 + 2]!];
            if (cap[t]) continue;
            for (const v of ids) touchesNonCap[v] = 1;
        }
        for (let v = 0; v < nV; v++) {
            if (!vertTris[v]!.length) continue;
            const p = { x: pos[v * 3]!, y: pos[v * 3 + 1]!, z: pos[v * 3 + 2]! };
            if (nearCorner(p, corners)) feature[v] = 1;
        }
        const locked = (v: number) => feature[v] === 1 || touchesNonCap[v] === 1;
        const cands: Array<{ u: number; v: number; len: number }> = [];
        for (const [k, faces] of edgeFaces) {
            if (faces.length !== 2) continue;
            if (!cap[faces[0]!] || !cap[faces[1]!]) continue;
            const [us, vs] = k.split("|");
            const u = Number(us);
            const v = Number(vs);
            if (locked(u) || locked(v)) continue;
            const pl = planeOf(pos, tris[faces[0]! * 3]!, tris[faces[0]! * 3 + 1]!, tris[faces[0]! * 3 + 2]!);
            if (!pl) continue;
            const ids = [
                tris[faces[0]! * 3]!,
                tris[faces[0]! * 3 + 1]!,
                tris[faces[0]! * 3 + 2]!,
                tris[faces[1]! * 3]!,
                tris[faces[1]! * 3 + 1]!,
                tris[faces[1]! * 3 + 2]!,
            ];
            let coplanar = true;
            for (const id of ids) {
                if (distPointPlane(pos, id, pl) > TEXT_QEM_COPLANAR_MM) {
                    coplanar = false;
                    break;
                }
            }
            if (!coplanar) continue;
            const len = Math.hypot(
                pos[u * 3]! - pos[v * 3]!,
                pos[u * 3 + 1]! - pos[v * 3 + 1]!,
                pos[u * 3 + 2]! - pos[v * 3 + 2]!,
            );
            cands.push({ u, v, len });
        }
        cands.sort((a, b) => a.len - b.len);
        const used = new Set<number>();
        const collapses: Array<{ u: number; v: number; x: number; y: number; z: number }> = [];
        for (const e of cands) {
            if (used.has(e.u) || used.has(e.v)) continue;
            if (!linkOk(vertTris, tris, e.u, e.v)) continue;
            const x = (pos[e.u * 3]! + pos[e.v * 3]!) * 0.5;
            const y = (pos[e.u * 3 + 1]! + pos[e.v * 3 + 1]!) * 0.5;
            const z = (pos[e.u * 3 + 2]! + pos[e.v * 3 + 2]!) * 0.5;
            if (!collapseOk(pos, tris, vertTris, cap, e.u, e.v, x, y, z)) continue;
            used.add(e.u);
            used.add(e.v);
            collapses.push({ u: e.u, v: e.v, x, y, z });
            if (nTri - collapses.length * 2 <= TRI_CAP) break;
        }
        if (!collapses.length) break;
        const remap = new Int32Array(nV);
        for (let i = 0; i < nV; i++) remap[i] = i;
        for (const c of collapses) {
            remap[c.v] = c.u;
            pos[c.u * 3] = c.x;
            pos[c.u * 3 + 1] = c.y;
            pos[c.u * 3 + 2] = c.z;
        }
        const next: number[] = [];
        const nextCap: number[] = [];
        for (let t = 0; t < nTri; t++) {
            const a = remap[tris[t * 3]!]!;
            const b = remap[tris[t * 3 + 1]!]!;
            const c = remap[tris[t * 3 + 2]!]!;
            if (a === b || b === c || c === a) continue;
            next.push(a, b, c);
            nextCap.push(cap[t] ?? 0);
        }
        tris.length = 0;
        for (let i = 0; i < next.length; i++) tris.push(next[i]!);
        cap = Uint8Array.from(nextCap);
    }
    const after = triCount(tris);
    const haus = rimHausdorff(pos, tris, cap, groups, mapPoint);
    writeMesh(work, pos, tris);
    const si = countSoupSelfIntersections(work, TEXT_WELD_MM).real;
    const ok = watertight(tris) && si === 0 && haus <= HAUSDORFF_MM + 1e-6 && haus <= hausBefore + 1e-4;
    if (!ok || after >= before) {
        work.dispose();
        return {
            geo,
            report: {
                applied: false,
                before,
                after: before,
                reason: !watertight(tris)
                    ? "not-watertight"
                    : si > 0
                      ? "self-intersection"
                      : haus > HAUSDORFF_MM
                        ? "hausdorff"
                        : "no-reduction",
            },
        };
    }
    return { geo: work, report: { applied: true, before, after } };
}
