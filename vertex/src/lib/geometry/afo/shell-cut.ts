// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { AfoTriMesh, AfoVec3 } from "./types";

/**
 * Split every triangle the trim polyline crosses so the curve becomes a chain
 * of mesh edges. Only the faces on the split edge are rewritten, and point
 * location uses a grid, so a 100k-triangle shell does not rescan the body
 * once per sample.
 */
export function embedTrimPolyline(
    mesh: AfoTriMesh,
    polygon: AfoVec3[],
): { mesh: AfoTriMesh; loop: number[] } {
    const positions: number[] = Array.from(mesh.positions);
    let weldMm = 0.01;
    const cell = 8;
    type Face = { a: number; b: number; c: number; live: boolean; cells: string[] };
    const faces: Face[] = [];
    const edgeFaces = new Map<string, number[]>();
    const vertFaces: number[][] = [];
    const grid = new Map<string, number[]>();
    const vertGrid = new Map<string, number[]>();

    const edgeKey = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const cellKey = (x: number, y: number, z: number) =>
        `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
    const at = (i: number): AfoVec3 => ({
        x: positions[i * 3] ?? 0,
        y: positions[i * 3 + 1] ?? 0,
        z: positions[i * 3 + 2] ?? 0,
    });
    const cellsFor = (a: number, b: number, c: number): string[] => {
        const pa = at(a);
        const pb = at(b);
        const pc = at(c);
        let x0 = Math.floor(Math.min(pa.x, pb.x, pc.x) / cell);
        let x1 = Math.floor(Math.max(pa.x, pb.x, pc.x) / cell);
        let y0 = Math.floor(Math.min(pa.y, pb.y, pc.y) / cell);
        let y1 = Math.floor(Math.max(pa.y, pb.y, pc.y) / cell);
        let z0 = Math.floor(Math.min(pa.z, pb.z, pc.z) / cell);
        let z1 = Math.floor(Math.max(pa.z, pb.z, pc.z) / cell);
        if (x1 - x0 > 4) {
            const m = Math.floor((x0 + x1) / 2);
            x0 = m - 2;
            x1 = m + 2;
        }
        if (y1 - y0 > 4) {
            const m = Math.floor((y0 + y1) / 2);
            y0 = m - 2;
            y1 = m + 2;
        }
        if (z1 - z0 > 4) {
            const m = Math.floor((z0 + z1) / 2);
            z0 = m - 2;
            z1 = m + 2;
        }
        const keys: string[] = [];
        for (let x = x0; x <= x1; x++) {
            for (let y = y0; y <= y1; y++) {
                for (let z = z0; z <= z1; z++) keys.push(`${x},${y},${z}`);
            }
        }
        return keys;
    };
    const pushMap = (map: Map<string, number[]>, key: string, value: number) => {
        const list = map.get(key);
        if (list) list.push(value);
        else map.set(key, [value]);
    };
    const dropMap = (map: Map<string, number[]>, key: string, value: number) => {
        const list = map.get(key);
        if (!list) return;
        const i = list.indexOf(value);
        if (i >= 0) list.splice(i, 1);
    };
    const register = (a: number, b: number, c: number): number => {
        if (a === b || b === c || c === a) return -1;
        const cells = cellsFor(a, b, c);
        const fi = faces.length;
        faces.push({ a, b, c, live: true, cells });
        for (const key of [edgeKey(a, b), edgeKey(b, c), edgeKey(c, a)]) pushMap(edgeFaces, key, fi);
        for (const v of [a, b, c]) {
            while (vertFaces.length <= v) vertFaces.push([]);
            vertFaces[v]!.push(fi);
        }
        for (const key of cells) pushMap(grid, key, fi);
        return fi;
    };
    const unregister = (fi: number) => {
        const f = faces[fi];
        if (!f || !f.live) return;
        f.live = false;
        for (const key of [edgeKey(f.a, f.b), edgeKey(f.b, f.c), edgeKey(f.c, f.a)])
            dropMap(edgeFaces, key, fi);
        for (const key of f.cells) dropMap(grid, key, fi);
    };
    const addVert = (p: AfoVec3): number => {
        const i = (positions.length / 3) | 0;
        positions.push(p.x, p.y, p.z);
        pushMap(vertGrid, cellKey(p.x, p.y, p.z), i);
        return i;
    };
    const tcount = (mesh.indices.length / 3) | 0;
    for (let i = 0; i < tcount; i++) {
        const a = mesh.indices[i * 3] ?? 0;
        const b = mesh.indices[i * 3 + 1] ?? 0;
        const c = mesh.indices[i * 3 + 2] ?? 0;
        register(a, b, c);
    }
    const n0 = (mesh.positions.length / 3) | 0;
    for (let i = 0; i < n0; i++) {
        pushMap(
            vertGrid,
            cellKey(positions[i * 3] ?? 0, positions[i * 3 + 1] ?? 0, positions[i * 3 + 2] ?? 0),
            i,
        );
    }
    const linked = (a: number, b: number) => (edgeFaces.get(edgeKey(a, b))?.length ?? 0) > 0;
    const nearestVert = (p: AfoVec3, maxMm: number): number => {
        const ix = Math.floor(p.x / cell);
        const iy = Math.floor(p.y / cell);
        const iz = Math.floor(p.z / cell);
        let best = -1;
        let bestD = maxMm * maxMm;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    for (const i of vertGrid.get(`${ix + dx},${iy + dy},${iz + dz}`) ?? []) {
                        const ddx = (positions[i * 3] ?? 0) - p.x;
                        const ddy = (positions[i * 3 + 1] ?? 0) - p.y;
                        const ddz = (positions[i * 3 + 2] ?? 0) - p.z;
                        const d = ddx * ddx + ddy * ddy + ddz * ddz;
                        if (d <= bestD) {
                            bestD = d;
                            best = i;
                        }
                    }
                }
            }
        }
        return best;
    };
    const candidates = (p: AfoVec3, extra: number): number[] => {
        const ix = Math.floor(p.x / cell);
        const iy = Math.floor(p.y / cell);
        const iz = Math.floor(p.z / cell);
        const out: number[] = [];
        const seen = new Set<number>();
        for (let dx = -extra; dx <= extra; dx++) {
            for (let dy = -extra; dy <= extra; dy++) {
                for (let dz = -extra; dz <= extra; dz++) {
                    for (const fi of grid.get(`${ix + dx},${iy + dy},${iz + dz}`) ?? []) {
                        if (seen.has(fi)) continue;
                        seen.add(fi);
                        if (faces[fi]?.live) out.push(fi);
                    }
                }
            }
        }
        return out;
    };
    const splitEdge = (a: number, b: number, point: AfoVec3): number => {
        if (vDist(point, at(a)) <= weldMm) return a;
        if (vDist(point, at(b)) <= weldMm) return b;
        const existing = nearestVert(point, weldMm);
        if (existing === a || existing === b) return existing;
        if (existing >= 0 && linked(existing, a) && linked(existing, b)) return existing;
        const v = existing >= 0 ? existing : addVert(point);
        const incident = [...(edgeFaces.get(edgeKey(a, b)) ?? [])];
        for (const fi of incident) {
            const f = faces[fi];
            if (!f?.live) continue;
            const order = [f.a, f.b, f.c];
            let x = -1;
            let y = -1;
            let z = -1;
            for (let k = 0; k < 3; k++) {
                const p0 = order[k]!;
                const p1 = order[(k + 1) % 3]!;
                if ((p0 === a && p1 === b) || (p0 === b && p1 === a)) {
                    x = p0;
                    y = p1;
                    z = order[(k + 2) % 3]!;
                    break;
                }
            }
            if (x < 0) continue;
            unregister(fi);
            register(x, v, z);
            register(v, y, z);
        }
        return v;
    };
    const splitFace = (fi: number, point: AfoVec3): number => {
        const existing = nearestVert(point, weldMm);
        if (existing >= 0) return existing;
        const f = faces[fi];
        if (!f?.live) return addVert(point);
        const v = addVert(point);
        const a = f.a;
        const b = f.b;
        const c = f.c;
        unregister(fi);
        register(a, b, v);
        register(b, c, v);
        register(c, a, v);
        return v;
    };
    const locate = (
        p: AfoVec3,
    ):
        | { kind: "vertex"; index: number }
        | { kind: "edge"; a: number; b: number; point: AfoVec3 }
        | { kind: "face"; index: number; point: AfoVec3 }
        | null => {
        const welded = nearestVert(p, weldMm);
        if (welded >= 0) return { kind: "vertex", index: welded };
        let pool = candidates(p, 1);
        if (pool.length === 0) pool = candidates(p, 3);
        let bestD = Infinity;
        let best:
            | { kind: "vertex"; index: number }
            | { kind: "edge"; a: number; b: number; point: AfoVec3 }
            | { kind: "face"; index: number; point: AfoVec3 }
            | null = null;
        for (const i of pool) {
            const f = faces[i];
            if (!f?.live) continue;
            const A = at(f.a);
            const B = at(f.b);
            const C = at(f.c);
            const cp = closestOnTriangle(p, A, B, C);
            const d = vDist(p, cp);
            if (d >= bestD) continue;
            bestD = d;
            if (vDist(cp, A) <= weldMm) best = { kind: "vertex", index: f.a };
            else if (vDist(cp, B) <= weldMm) best = { kind: "vertex", index: f.b };
            else if (vDist(cp, C) <= weldMm) best = { kind: "vertex", index: f.c };
            else {
                const ab = projectToSegment(cp, A, B);
                const bc = projectToSegment(cp, B, C);
                const ca = projectToSegment(cp, C, A);
                if (ab.d <= weldMm) best = { kind: "edge", a: f.a, b: f.b, point: ab.point };
                else if (bc.d <= weldMm) best = { kind: "edge", a: f.b, b: f.c, point: bc.point };
                else if (ca.d <= weldMm) best = { kind: "edge", a: f.c, b: f.a, point: ca.point };
                else best = { kind: "face", index: i, point: cp };
            }
        }
        return best;
    };
    const insertPoint = (p: AfoVec3): number => {
        const loc = locate(p);
        if (!loc) return addVert(p);
        if (loc.kind === "vertex") return loc.index;
        if (loc.kind === "edge") return splitEdge(loc.a, loc.b, loc.point);
        return splitFace(loc.index, loc.point);
    };
    const findExit = (
        ia: number,
        ib: number,
    ): { kind: "vertex"; index: number } | { kind: "edge"; a: number; b: number; point: AfoVec3 } | null => {
        const A = at(ia);
        const B = at(ib);
        let bestScore = Infinity;
        let best:
            | { kind: "vertex"; index: number }
            | { kind: "edge"; a: number; b: number; point: AfoVec3 }
            | null = null;
        for (const fi of vertFaces[ia] ?? []) {
            const f = faces[fi];
            if (!f?.live) continue;
            let u = -1;
            let v = -1;
            if (f.a === ia) {
                u = f.b;
                v = f.c;
            } else if (f.b === ia) {
                u = f.c;
                v = f.a;
            } else if (f.c === ia) {
                u = f.a;
                v = f.b;
            } else continue;
            const hit = wedgeCross(A, at(u), at(v), B);
            if (!hit) continue;
            const score = pointToSegment(hit.point, A, B);
            if (score >= bestScore) continue;
            bestScore = score;
            if (hit.t <= 0.02) best = { kind: "vertex", index: u };
            else if (hit.t >= 0.98) best = { kind: "vertex", index: v };
            else best = { kind: "edge", a: u, b: v, point: hit.point };
        }
        if (!best || bestScore > 6) return null;
        return best;
    };
    const connect = (ia: number, ib: number, depth: number, seen: Set<string>): number[] => {
        if (ia === ib || depth > 48) return [];
        if (linked(ia, ib)) return [];
        const token = ia < ib ? `${ia}|${ib}` : `${ib}|${ia}`;
        if (seen.has(token)) return [];
        seen.add(token);
        const exit = findExit(ia, ib);
        if (!exit) {
            if (vDist(at(ia), at(ib)) <= 0.2) return [];
            const mid = insertPoint(vLerp(at(ia), at(ib), 0.5));
            if (mid === ia || mid === ib) return [];
            return [...connect(ia, mid, depth + 1, seen), mid, ...connect(mid, ib, depth + 1, seen)];
        }
        const im = exit.kind === "vertex" ? exit.index : splitEdge(exit.a, exit.b, exit.point);
        if (im === ia || im === ib) return [];
        return [...connect(ia, im, depth + 1, seen), im, ...connect(im, ib, depth + 1, seen)];
    };
    const samples: AfoVec3[] = [];
    for (const p of polygon) {
        const last = samples[samples.length - 1];
        if (last && vDist(last, p) < 0.04) continue;
        samples.push(p);
    }
    if (samples.length >= 2 && vDist(samples[0]!, samples[samples.length - 1]!) < 0.04) samples.pop();
    const uniq: number[] = [];
    for (const p of samples) {
        const id = insertPoint(p);
        if (uniq[uniq.length - 1] !== id) uniq.push(id);
    }
    if (uniq.length >= 2 && uniq[0] === uniq[uniq.length - 1]) uniq.pop();
    const stitch = (loop: number[]): number[] => {
        const out: number[] = [];
        for (let i = 0; i < loop.length; i++) {
            const a = loop[i]!;
            const b = loop[(i + 1) % loop.length]!;
            if (out.length === 0 || out[out.length - 1] !== a) out.push(a);
            if (linked(a, b)) continue;
            for (const m of connect(a, b, 0, new Set())) {
                if (out[out.length - 1] !== m) out.push(m);
            }
        }
        if (out.length >= 2 && out[0] === out[out.length - 1]) out.pop();
        return out;
    };
    let loop = uniq.length >= 3 ? stitch(uniq) : uniq;
    loop = loop.length >= 3 ? stitch(loop) : loop;
    for (let pass = 0; pass < 6 && loop.length >= 3; pass++) {
        let grew = false;
        const savedWeld = weldMm;
        weldMm = 0;
        for (let i = 0; i < loop.length; i++) {
            const a = loop[i]!;
            const b = loop[(i + 1) % loop.length]!;
            if (a === b || linked(a, b)) continue;
            if (vDist(at(a), at(b)) > 1.5) continue;
            const mid = insertPoint(vLerp(at(a), at(b), 0.5));
            if (mid === a || mid === b) continue;
            loop.splice(i + 1, 0, mid);
            grew = true;
            i++;
        }
        weldMm = savedWeld;
        if (!grew) break;
    }
    const nearPath = (ia: number, ib: number): number[] | null => {
        const A = at(ia);
        const B = at(ib);
        const prev = new Map<number, number>([[ia, -1]]);
        const queue = [ia];
        while (queue.length) {
            const u = queue.shift()!;
            if (u === ib) break;
            const nbrs = new Set<number>();
            for (const fi of vertFaces[u] ?? []) {
                const f = faces[fi];
                if (!f?.live) continue;
                nbrs.add(f.a);
                nbrs.add(f.b);
                nbrs.add(f.c);
            }
            for (const v of nbrs) {
                if (prev.has(v)) continue;
                if (v !== ib && pointToSegment(at(v), A, B) > 0.08) continue;
                prev.set(v, u);
                queue.push(v);
                if (queue.length > 64) return null;
            }
        }
        if (!prev.has(ib)) return null;
        const path: number[] = [];
        let x = ib;
        while (x !== -1) {
            path.push(x);
            x = prev.get(x)!;
        }
        path.reverse();
        return path;
    };
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        if (a === b || linked(a, b) || vDist(at(a), at(b)) > 0.4) continue;
        const path = nearPath(a, b);
        if (!path || path.length < 3) continue;
        loop.splice(i + 1, 0, ...path.slice(1, -1));
        i += path.length - 2;
    }
    const indices: number[] = [];
    for (const f of faces) {
        if (!f.live || f.a === f.b || f.b === f.c || f.c === f.a) continue;
        indices.push(f.a, f.b, f.c);
    }
    return {
        mesh: { positions: new Float32Array(positions), indices: new Uint32Array(indices) },
        loop,
    };
}

function vDist(a: AfoVec3, b: AfoVec3): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function vLerp(a: AfoVec3, b: AfoVec3, t: number): AfoVec3 {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

function vDot(a: AfoVec3, b: AfoVec3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

function vSub(a: AfoVec3, b: AfoVec3): AfoVec3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function vCross(a: AfoVec3, b: AfoVec3): AfoVec3 {
    return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function pointToSegment(p: AfoVec3, a: AfoVec3, b: AfoVec3): number {
    return projectToSegment(p, a, b).d;
}

function projectToSegment(p: AfoVec3, a: AfoVec3, b: AfoVec3): { d: number; point: AfoVec3 } {
    const ab = vSub(b, a);
    const ab2 = vDot(ab, ab);
    const t = ab2 < 1e-12 ? 0 : Math.min(1, Math.max(0, vDot(vSub(p, a), ab) / ab2));
    const point = vLerp(a, b, t);
    return { d: vDist(p, point), point };
}

function closestOnTriangle(p: AfoVec3, a: AfoVec3, b: AfoVec3, c: AfoVec3): AfoVec3 {
    const ab = vSub(b, a);
    const ac = vSub(c, a);
    const ap = vSub(p, a);
    const d1 = vDot(ab, ap);
    const d2 = vDot(ac, ap);
    if (d1 <= 0 && d2 <= 0) return a;
    const bp = vSub(p, b);
    const d3 = vDot(ab, bp);
    const d4 = vDot(ac, bp);
    if (d3 >= 0 && d4 <= d3) return b;
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) return vLerp(a, b, d1 / (d1 - d3 || 1));
    const cp = vSub(p, c);
    const d5 = vDot(ab, cp);
    const d6 = vDot(ac, cp);
    if (d6 >= 0 && d5 <= d6) return c;
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) return vLerp(a, c, d2 / (d2 - d6 || 1));
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
        const w = (d4 - d3) / (d4 - d3 + (d5 - d6) || 1);
        return vLerp(b, c, w);
    }
    const denom = 1 / (va + vb + vc || 1);
    const v = vb * denom;
    const w = vc * denom;
    return { x: a.x + ab.x * v + ac.x * w, y: a.y + ab.y * v + ac.y * w, z: a.z + ab.z * v + ac.z * w };
}

/** Where the ray from A toward B crosses edge UV, in the plane of triangle AUV. */
function wedgeCross(a: AfoVec3, u: AfoVec3, v: AfoVec3, b: AfoVec3): { t: number; point: AfoVec3 } | null {
    const n = vCross(vSub(u, a), vSub(v, a));
    const nl = Math.hypot(n.x, n.y, n.z);
    if (nl < 1e-12) return null;
    const nx = n.x / nl;
    const ny = n.y / nl;
    const nz = n.z / nl;
    const signed = (b.x - a.x) * nx + (b.y - a.y) * ny + (b.z - a.z) * nz;
    const bp = { x: b.x - nx * signed, y: b.y - ny * signed, z: b.z - nz * signed };
    const v0 = vSub(u, a);
    const v1 = vSub(v, a);
    const v2 = vSub(bp, a);
    const d00 = vDot(v0, v0);
    const d01 = vDot(v0, v1);
    const d11 = vDot(v1, v1);
    const d20 = vDot(v2, v0);
    const d21 = vDot(v2, v1);
    const denom = d00 * d11 - d01 * d01 || 1e-12;
    const wU = (d11 * d20 - d01 * d21) / denom;
    const wV = (d00 * d21 - d01 * d20) / denom;
    if (wU < -1e-4 || wV < -1e-4) return null;
    const s = wU + wV;
    if (s < 1e-8) return null;
    const t = Math.min(1, Math.max(0, wV / s));
    return { t, point: vLerp(u, v, t) };
}
