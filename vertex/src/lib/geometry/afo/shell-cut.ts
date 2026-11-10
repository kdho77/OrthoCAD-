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
    const weldMm = 0.01;
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
    const incident = (v: number): number[] => {
        const out: number[] = [];
        for (const fi of vertFaces[v] ?? []) {
            const f = faces[fi];
            if (f?.live && (f.a === v || f.b === v || f.c === v)) out.push(fi);
        }
        return out;
    };
    const others = (f: Face, v: number): [number, number] => {
        if (f.a === v) return [f.b, f.c];
        if (f.b === v) return [f.c, f.a];
        return [f.a, f.b];
    };
    /** Plane test: does O→G cross the opposite edge UV, or does G sit inside triangle OUV? */
    const classify = (
        o: AfoVec3,
        g: AfoVec3,
        u: AfoVec3,
        v: AfoVec3,
    ): { inside: boolean; s: number; point: AfoVec3 } | null => {
        const n = vCross(vSub(u, o), vSub(v, o));
        const nl = Math.hypot(n.x, n.y, n.z);
        if (nl < 1e-12) return null;
        const nx = n.x / nl;
        const ny = n.y / nl;
        const nz = n.z / nl;
        const signed = (g.x - o.x) * nx + (g.y - o.y) * ny + (g.z - o.z) * nz;
        const gp = { x: g.x - nx * signed, y: g.y - ny * signed, z: g.z - nz * signed };
        const v0 = vSub(u, o);
        const v1 = vSub(v, o);
        const v2 = vSub(gp, o);
        const d00 = vDot(v0, v0);
        const d01 = vDot(v0, v1);
        const d11 = vDot(v1, v1);
        const d20 = vDot(v2, v0);
        const d21 = vDot(v2, v1);
        const denom = d00 * d11 - d01 * d01;
        if (Math.abs(denom) < 1e-14) return null;
        const wU = (d11 * d20 - d01 * d21) / denom;
        const wV = (d00 * d21 - d01 * d20) / denom;
        const wO = 1 - wU - wV;
        if (wO >= -1e-4 && wU >= -1e-4 && wV >= -1e-4) return { inside: true, s: 1, point: gp };
        if (wU < -1e-4 || wV < -1e-4) return null;
        const sum = wU + wV;
        if (sum < 1e-8) return null;
        const point = vLerp(u, v, Math.min(1, Math.max(0, wV / sum)));
        const og = vSub(g, o);
        const og2 = vDot(og, og);
        const s = og2 < 1e-12 ? 0 : vDot(vSub(point, o), og) / og2;
        if (s <= 1e-4) return null;
        return { inside: false, s, point };
    };
    const crossToward = (cur: number, goal: AfoVec3): number | null => {
        let best: { a: number; b: number; point: AfoVec3; score: number } | null = null;
        const goalD = vDist(at(cur), goal);
        for (const fi of incident(cur)) {
            const f = faces[fi];
            if (!f) continue;
            const [u, v] = others(f, cur);
            const hit = classify(at(cur), goal, at(u), at(v));
            if (hit && !hit.inside && hit.s < 1.02 && vDist(hit.point, goal) < goalD - 1e-4) {
                if (!best || hit.s < best.score) best = { a: u, b: v, point: hit.point, score: hit.s };
                continue;
            }
            const near = segmentSegmentClosest(at(cur), goal, at(u), at(v));
            if (
                near.dist < 0.2 &&
                near.sA > 0.02 &&
                near.sA < 0.98 &&
                near.sB > 0.02 &&
                near.sB < 0.98 &&
                vDist(near.pointB, goal) < goalD - 1e-4
            ) {
                const score = 2 + near.dist;
                if (!best || score < best.score) best = { a: u, b: v, point: near.pointB, score };
            }
        }
        if (!best) return null;
        const id = splitEdge(best.a, best.b, best.point);
        if (id === cur || !linked(cur, id)) return null;
        return id;
    };
    const pushV = (loop: number[], id: number) => {
        if (loop.length === 0 || loop[loop.length - 1] !== id) loop.push(id);
    };
    const walkTo = (loop: number[], start: number, goalId: number, depth: number): number => {
        if (goalId === start) return start;
        let cur = start;
        const seen = new Set<number>([start]);
        for (let step = 0; step < 64; step++) {
            if (linked(cur, goalId)) {
                pushV(loop, goalId);
                return goalId;
            }
            const nxt = crossToward(cur, at(goalId));
            if (nxt == null || seen.has(nxt)) break;
            if (vDist(at(nxt), at(goalId)) >= vDist(at(cur), at(goalId)) - 1e-4) break;
            seen.add(nxt);
            pushV(loop, nxt);
            cur = nxt;
        }
        if (linked(cur, goalId)) {
            pushV(loop, goalId);
            return goalId;
        }
        if (depth >= 10 || vDist(at(cur), at(goalId)) <= 0.05) {
            pushV(loop, goalId);
            return goalId;
        }
        const midId = insertPoint(vLerp(at(cur), at(goalId), 0.5));
        if (midId === cur || midId === goalId) {
            pushV(loop, goalId);
            return goalId;
        }
        const midReached = walkTo(loop, cur, midId, depth + 1);
        return walkTo(loop, midReached, goalId, depth + 1);
    };
    const mergeVerts = (from: number, into: number) => {
        if (from === into) return;
        const mid = vLerp(at(from), at(into), 0.5);
        positions[into * 3] = mid.x;
        positions[into * 3 + 1] = mid.y;
        positions[into * 3 + 2] = mid.z;
        const owned = [...(vertFaces[from] ?? [])];
        for (const fi of owned) {
            const f = faces[fi];
            if (!f?.live) continue;
            const repl = (v: number) => (v === from ? into : v);
            const a = repl(f.a);
            const b = repl(f.b);
            const c = repl(f.c);
            unregister(fi);
            if (a !== b && b !== c && c !== a) register(a, b, c);
        }
    };
    const nearPath = (ia: number, ib: number): number[] | null => {
        const A = at(ia);
        const B = at(ib);
        const prev = new Map<number, number>([[ia, -1]]);
        const queue = [ia];
        while (queue.length) {
            const u = queue.shift()!;
            if (u === ib) break;
            const nbrs = new Set<number>();
            for (const fi of incident(u)) {
                const f = faces[fi];
                if (!f) continue;
                nbrs.add(f.a);
                nbrs.add(f.b);
                nbrs.add(f.c);
            }
            for (const v of nbrs) {
                if (prev.has(v)) continue;
                if (v !== ib && pointToSegment(at(v), A, B) > 0.08) continue;
                prev.set(v, u);
                queue.push(v);
                if (queue.length > 80) return null;
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
    const dedupe = (ids: number[]): number[] => {
        const out: number[] = [];
        for (const id of ids) {
            if (out.length === 0 || out[out.length - 1] !== id) out.push(id);
        }
        if (out.length >= 2 && out[0] === out[out.length - 1]) out.pop();
        return out;
    };
    const samples: AfoVec3[] = [];
    for (const p of polygon) {
        const last = samples[samples.length - 1];
        if (last && vDist(last, p) < 0.04) continue;
        samples.push(p);
    }
    if (samples.length >= 2 && vDist(samples[0]!, samples[samples.length - 1]!) < 0.04) samples.pop();
    const loop: number[] = [];
    if (samples.length >= 3) {
        pushV(loop, insertPoint(samples[0]!));
        for (let i = 1; i < samples.length; i++)
            walkTo(loop, loop[loop.length - 1]!, insertPoint(samples[i]!), 0);
        walkTo(loop, loop[loop.length - 1]!, loop[0]!, 0);
    }
    let sealed = dedupe(loop);
    for (let pass = 0; pass < 8 && sealed.length >= 3; pass++) {
        let gapAt = -1;
        for (let i = 0; i < sealed.length; i++) {
            const a = sealed[i]!;
            const b = sealed[(i + 1) % sealed.length]!;
            if (a !== b && !linked(a, b)) {
                gapAt = i;
                break;
            }
        }
        if (gapAt < 0) break;
        const a = sealed[gapAt]!;
        const b = sealed[(gapAt + 1) % sealed.length]!;
        const span = vDist(at(a), at(b));
        const path = span <= 1.5 ? nearPath(a, b) : null;
        if (path && path.length >= 2) {
            sealed.splice(gapAt + 1, 0, ...path.slice(1, -1));
            sealed = dedupe(sealed);
            continue;
        }
        if (span <= 0.05) {
            mergeVerts(b, a);
            sealed = dedupe(sealed.map((v) => (v === b ? a : v)));
            continue;
        }
        const midId = insertPoint(vLerp(at(a), at(b), 0.5));
        if (midId === a || midId === b) {
            if (span <= 0.1) {
                mergeVerts(b, a);
                sealed = dedupe(sealed.map((v) => (v === b ? a : v)));
            }
            break;
        }
        sealed.splice(gapAt + 1, 0, midId);
        sealed = dedupe(sealed);
    }
    const indices: number[] = [];
    for (const f of faces) {
        if (!f.live || f.a === f.b || f.b === f.c || f.c === f.a) continue;
        indices.push(f.a, f.b, f.c);
    }
    return {
        mesh: { positions: new Float32Array(positions), indices: new Uint32Array(indices) },
        loop: sealed,
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

/** Closest points of segments AB and CD. sA/sB are clamped parameters. */
function segmentSegmentClosest(
    a: AfoVec3,
    b: AfoVec3,
    c: AfoVec3,
    d: AfoVec3,
): { dist: number; sA: number; sB: number; pointB: AfoVec3 } {
    const u = vSub(b, a);
    const v = vSub(d, c);
    const w = vSub(a, c);
    const uu = vDot(u, u);
    const uv = vDot(u, v);
    const vv = vDot(v, v);
    const uw = vDot(u, w);
    const vw = vDot(v, w);
    const denom = uu * vv - uv * uv;
    let sA = denom < 1e-12 ? 0 : (uv * vw - vv * uw) / denom;
    let sB = denom < 1e-12 ? 0 : (uu * vw - uv * uw) / denom;
    sA = Math.min(1, Math.max(0, sA));
    sB = Math.min(1, Math.max(0, sB));
    const pointB = vLerp(c, d, sB);
    const pointA = vLerp(a, b, sA);
    return { dist: vDist(pointA, pointB), sA, sB, pointB };
}
